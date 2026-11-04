'use strict';
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { isStringWithLength, isPositiveInteger, isNonEmptyString } = require('../validate');

const router = express.Router();

// Teacher only: Get own classrooms
router.get('/teacher/classrooms', requireRole('teacher'), asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const rows = db.prepare(`
    SELECT
      c.id, c.name, c.code, c.archived, c.node_uid AS nodeUid,
      COALESCE(n.label, '') AS nodeLabel
    FROM classrooms c
    LEFT JOIN phy_nodes n ON n.uid = c.node_uid
    WHERE c.teacher_id = ?
    ORDER BY c.id DESC
  `).all(teacherId);

  res.json({
    ok: true,
    classrooms: rows.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      archived: Boolean(r.archived),
      nodeUid: r.nodeUid || null,
      nodeLabel: r.nodeLabel || null
    }))
  });
}));

// Teacher only: Create classroom
router.post('/teacher/classrooms', requireRole('teacher'), asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const { name, code } = req.body || {};

  if (!isStringWithLength(name, 1, 80)) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Classroom name must be between 1 and 80 characters.'
    });
  }

  const trimmedName = name.trim();
  const trimmedCode = typeof code === 'string' ? code.trim().slice(0, 20) : '';

  const info = db.prepare(`
    INSERT INTO classrooms (teacher_id, name, code, archived, node_uid)
    VALUES (?, ?, ?, 0, NULL)
  `).run(teacherId, trimmedName, trimmedCode);

  res.json({
    ok: true,
    classroom: {
      id: Number(info.lastInsertRowid),
      name: trimmedName,
      code: trimmedCode,
      archived: false,
      nodeUid: null,
      nodeLabel: null
    }
  });
}));

// Teacher only: Update classroom (rename, code, archive)
router.patch('/teacher/classrooms/:id', requireRole('teacher'), asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const classroomId = Number(req.params.id);

  if (!isPositiveInteger(classroomId)) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid classroom ID.'
    });
  }

  const existing = db.prepare('SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?').get(classroomId, teacherId);
  if (!existing) {
    return res.status(404).json({
      ok: false,
      error: 'ERR_NOT_FOUND',
      message: 'Classroom not found.'
    });
  }

  const { name, code, archived } = req.body || {};
  let newName = existing.name;
  let newCode = existing.code;
  let newArchived = existing.archived;
  let newNodeUid = existing.node_uid;

  if (name !== undefined) {
    if (!isStringWithLength(name, 1, 80)) {
      return res.status(400).json({
        ok: false,
        error: 'ERR_BAD_REQUEST',
        message: 'Classroom name must be between 1 and 80 characters.'
      });
    }
    newName = name.trim();
  }

  if (code !== undefined) {
    newCode = typeof code === 'string' ? code.trim().slice(0, 20) : '';
  }

  if (archived !== undefined) {
    newArchived = archived ? 1 : 0;
    // Archiving a class also clears its node_uid
    if (newArchived === 1) {
      newNodeUid = null;
    }
  }

  db.prepare(`
    UPDATE classrooms
    SET name = ?, code = ?, archived = ?, node_uid = ?
    WHERE id = ? AND teacher_id = ?
  `).run(newName, newCode, newArchived, newNodeUid, classroomId, teacherId);

  res.json({
    ok: true,
    classroom: {
      id: classroomId,
      name: newName,
      code: newCode,
      archived: Boolean(newArchived),
      nodeUid: newNodeUid
    }
  });
}));

// Teacher only: List active nodes (never return secret_enc)
router.get('/nodes', requireRole('teacher'), asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT
      n.uid, n.label,
      c.id AS classroomId, c.name AS classroomName
    FROM phy_nodes n
    LEFT JOIN classrooms c ON c.node_uid = n.uid
    WHERE n.active = 1
    ORDER BY n.uid ASC
  `).all();

  res.json({
    ok: true,
    nodes: rows.map(r => ({
      uid: r.uid,
      label: r.label,
      classroomId: r.classroomId || null,
      classroomName: r.classroomName || null
    }))
  });
}));

// Teacher only: Assign or take over a node
router.put('/teacher/classrooms/:id/node', requireRole('teacher'), asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const classroomId = Number(req.params.id);
  const { nodeUid } = req.body || {};

  if (!isPositiveInteger(classroomId) || !isNonEmptyString(nodeUid)) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid classroom ID or node UID.'
    });
  }

  const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?').get(classroomId, teacherId);
  if (!classroom) {
    return res.status(404).json({
      ok: false,
      error: 'ERR_NOT_FOUND',
      message: 'Classroom not found.'
    });
  }

  if (classroom.archived) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Cannot assign a node to an archived class.'
    });
  }

  const node = db.prepare('SELECT uid, active FROM phy_nodes WHERE uid = ?').get(nodeUid.trim());
  if (!node || !node.active) {
    return res.status(404).json({
      ok: false,
      error: 'ERR_NOT_FOUND',
      message: 'PHY_NODE not found or inactive.'
    });
  }

  const assignTransaction = db.transaction(() => {
    // Find any other class holding the node
    const otherClass = db.prepare('SELECT id, name FROM classrooms WHERE node_uid = ? AND id != ?').get(node.uid, classroomId);
    let takenFrom = null;

    if (otherClass) {
      db.prepare('UPDATE classrooms SET node_uid = NULL WHERE id = ?').run(otherClass.id);
      takenFrom = otherClass.name;
    }

    db.prepare('UPDATE classrooms SET node_uid = ? WHERE id = ?').run(node.uid, classroomId);

    return { takenFrom };
  });

  const { takenFrom } = assignTransaction();

  res.json({
    ok: true,
    takenFrom
  });
}));

// Teacher only: Unassign node
router.delete('/teacher/classrooms/:id/node', requireRole('teacher'), asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const classroomId = Number(req.params.id);

  if (!isPositiveInteger(classroomId)) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid classroom ID.'
    });
  }

  const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?').get(classroomId, teacherId);
  if (!classroom) {
    return res.status(404).json({
      ok: false,
      error: 'ERR_NOT_FOUND',
      message: 'Classroom not found.'
    });
  }

  db.prepare('UPDATE classrooms SET node_uid = NULL WHERE id = ?').run(classroomId);

  res.json({ ok: true });
}));

module.exports = router;
