'use strict';
const express = require('express');
const { config } = require('../config');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { parsePayload, verifyCode } = require('../services/totp');
const { decryptSecret } = require('../services/crypto');
const { distanceMeters } = require('../services/geofence');
const { decide, dateKey } = require('../services/attendance');
const {
  isPositiveInteger,
  isStringWithLength,
  isValidLat,
  isValidLng,
  isValidAccuracy
} = require('../validate');

const router = express.Router();

router.post('/submit', requireRole('student'), asyncHandler(async (req, res) => {
  const studentId = req.user.id;
  const ip = req.ip || req.connection.remoteAddress || null;
  const now = Math.floor(Date.now() / 1000);

  const { classroomId, payload, lat, lng, accuracy } = req.body || {};

  // Helper to record attempt in scan_attempts
  function logAttempt(resultCode, classIdVal, nodeUidVal, distanceVal) {
    try {
      db.prepare(`
        INSERT INTO scan_attempts (
          student_id, classroom_id, node_uid, result_code,
          lat, lng, accuracy_m, distance_m, ip, at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        studentId,
        classIdVal || null,
        nodeUidVal || null,
        resultCode,
        isValidLat(lat) ? Number(lat) : null,
        isValidLng(lng) ? Number(lng) : null,
        isValidAccuracy(accuracy) ? Number(accuracy) : null,
        typeof distanceVal === 'number' && Number.isFinite(distanceVal) ? distanceVal : null,
        ip,
        now
      );
    } catch (e) {
      // Don't crash request if logging fails
    }
  }

  // 1. Initial Validation
  if (!isPositiveInteger(classroomId) || !isStringWithLength(payload, 1, 64)) {
    logAttempt('ERR_BAD_REQUEST', classroomId, null, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid classroom ID or payload.'
    });
  }

  if (lat !== undefined && !isValidLat(lat)) {
    logAttempt('ERR_BAD_REQUEST', classroomId, null, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid latitude.'
    });
  }

  if (lng !== undefined && !isValidLng(lng)) {
    logAttempt('ERR_BAD_REQUEST', classroomId, null, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid longitude.'
    });
  }

  if (accuracy !== undefined && !isValidAccuracy(accuracy)) {
    logAttempt('ERR_BAD_REQUEST', classroomId, null, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid accuracy.'
    });
  }

  // Step 1: Parse payload
  const parsed = parsePayload(payload.trim());
  if (!parsed) {
    logAttempt('ERR_QR_INVALID', classroomId, null, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_QR_INVALID',
      message: "That code isn't valid or has expired. Scan the code on the screen again."
    });
  }

  const { code, roomId } = parsed;

  // Step 2: Node lookup and code verification
  const node = db.prepare('SELECT uid, label, lat, lng, radius_m, secret_enc, active FROM phy_nodes WHERE uid = ?').get(roomId);
  let verified = false;

  if (node && node.active) {
    try {
      const secretHex = decryptSecret(node.secret_enc, config.masterKey);
      verified = verifyCode(secretHex, roomId, code, now);
    } catch (e) {
      verified = false;
    }
  }

  if (!node || !node.active || !verified) {
    logAttempt('ERR_QR_INVALID', classroomId, roomId, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_QR_INVALID',
      message: "That code isn't valid or has expired. Scan the code on the screen again."
    });
  }

  // Step 3: Class check, node assignment check, class match
  const classroom = db.prepare('SELECT id, name, archived, node_uid FROM classrooms WHERE id = ?').get(classroomId);
  if (!classroom || classroom.archived) {
    logAttempt('ERR_CLASS_MISMATCH', classroomId, roomId, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_CLASS_MISMATCH',
      message: 'This code belongs to a different class. Pick the right class and try again.'
    });
  }

  // Node assigned check
  const assignedClass = db.prepare('SELECT id FROM classrooms WHERE node_uid = ?').get(roomId);
  if (!assignedClass) {
    logAttempt('ERR_NODE_NOT_ASSIGNED', classroomId, roomId, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_NODE_NOT_ASSIGNED',
      message: "This device isn't linked to a class yet. Ask your teacher."
    });
  }

  if (classroom.node_uid !== roomId) {
    logAttempt('ERR_CLASS_MISMATCH', classroomId, roomId, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_CLASS_MISMATCH',
      message: 'This code belongs to a different class. Pick the right class and try again.'
    });
  }

  // Step 4: Enrollment check
  const enrollment = db.prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND classroom_id = ?').get(studentId, classroomId);
  if (!enrollment) {
    logAttempt('ERR_NOT_JOINED', classroomId, roomId, null);
    return res.status(400).json({
      ok: false,
      error: 'ERR_NOT_JOINED',
      message: "You haven't joined this class. Go back and select it."
    });
  }

  // Step 5: Geofence check
  let dist = null;
  if (lat !== undefined && lng !== undefined) {
    dist = distanceMeters(node.lat, node.lng, Number(lat), Number(lng));
  }

  if (config.geofence) {
    if (lat === undefined || lng === undefined || accuracy === undefined) {
      logAttempt('ERR_LOCATION_REQUIRED', classroomId, roomId, dist);
      return res.status(400).json({
        ok: false,
        error: 'ERR_LOCATION_REQUIRED',
        message: 'Location is needed to mark attendance. Allow location access and try again.'
      });
    }

    const acc = Number(accuracy);
    if (acc > config.maxAccuracyM) {
      logAttempt('ERR_LOW_ACCURACY', classroomId, roomId, dist);
      return res.status(400).json({
        ok: false,
        error: 'ERR_LOW_ACCURACY',
        message: "Your location isn't accurate enough. Move closer to a window or step outside for a moment, then try again."
      });
    }

    if (dist > node.radius_m) {
      logAttempt('ERR_OUTSIDE_GEOFENCE', classroomId, roomId, dist);
      return res.status(400).json({
        ok: false,
        error: 'ERR_OUTSIDE_GEOFENCE',
        message: 'You seem to be outside the classroom area. Move closer and try again.'
      });
    }
  }

  // Step 6: Decide check-in or check-out
  const todayStr = dateKey(now, config.tzOffsetSeconds);
  const lastEventToday = db.prepare(`
    SELECT id, type, scanned_at
    FROM attendance_events
    WHERE student_id = ? AND classroom_id = ? AND att_date = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(studentId, classroomId, todayStr);

  const decision = decide(lastEventToday, now, config.minGapMinutes * 60);

  if (decision.error) {
    logAttempt(decision.error, classroomId, roomId, dist);
    return res.status(400).json({
      ok: false,
      error: decision.error,
      message: 'You already scanned a moment ago. Wait a few minutes before scanning again.'
    });
  }

  // Step 7: Record attendance event & scan attempt in a transaction
  const recordTransaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO attendance_events (
        student_id, classroom_id, node_uid, type,
        scanned_at, att_date, distance_m, accuracy_m
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      studentId,
      classroomId,
      roomId,
      decision.type,
      now,
      todayStr,
      dist,
      accuracy !== undefined ? Number(accuracy) : null
    );

    logAttempt(decision.type === 'CHECK_IN' ? 'OK_CHECK_IN' : 'OK_CHECK_OUT', classroomId, roomId, dist);
  });

  recordTransaction();

  const isoTime = new Date(now * 1000).toISOString();

  res.json({
    ok: true,
    result: decision.type === 'CHECK_IN' ? 'OK_CHECK_IN' : 'OK_CHECK_OUT',
    classroomName: classroom.name,
    at: isoTime
  });
}));

module.exports = router;
