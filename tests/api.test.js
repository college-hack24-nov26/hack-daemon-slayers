'use strict';
const crypto = require('crypto');

// Set environment variables before any module loads
process.env.DB_PATH = ':memory:';
process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.SERVE_FRONTEND = 'on';
process.env.GEOFENCE = 'on';
process.env.SECURE_COOKIES = 'off'; // So cookie is readable without https in test fetch
process.env.MIN_GAP_MINUTES = '5';
process.env.MAX_ACCURACY_M = '50';
process.env.TZ_OFFSET_SECONDS = '19800';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const { config } = require('../src/config');
const { db } = require('../src/db');
const { buildPayload } = require('../src/services/totp');
const { encryptSecret } = require('../src/services/crypto');

test('API Integration Suite', async (t) => {
  const app = createApp();
  let server;
  let baseUrl;

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  const nodeSecretHex = '0123456789abcdef'.repeat(4);
  const passwordHash = await bcrypt.hash('secret123', 12);

  // Helper to query API with cookie management
  async function request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    const headers = options.headers || {};
    if (options.cookie) {
      headers['Cookie'] = options.cookie;
    }
    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch(url, { ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    let cookie = options.cookie;
    if (setCookie) {
      const match = setCookie.match(/sid=[^;]+/);
      if (match) cookie = match[0];
    }
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }
    return { status: res.status, data, cookie, headers: res.headers };
  }

  // Setup seed data directly in :memory: DB
  db.prepare(`
    INSERT INTO users (login_id, name, role, password_hash, active, failed_attempts, locked_until)
    VALUES ('admin1', 'Admin User', 'admin', ?, 1, 0, 0),
           ('teacher_a', 'Teacher A', 'teacher', ?, 1, 0, 0),
           ('teacher_b', 'Teacher B', 'teacher', ?, 1, 0, 0),
           ('student_x', 'Student X', 'student', ?, 1, 0, 0),
           ('student_y', 'Student Y', 'student', ?, 1, 0, 0)
  `).run(passwordHash, passwordHash, passwordHash, passwordHash, passwordHash);

  const encSecret = encryptSecret(nodeSecretHex, config.masterKey);
  db.prepare(`
    INSERT INTO phy_nodes (uid, label, lat, lng, radius_m, secret_enc, active)
    VALUES ('NODE1', 'Room 101', 19.0760, 72.8777, 35, ?, 1),
           ('NODE2', 'Room 102', 19.0760, 72.8777, 35, ?, 1),
           ('INACTIVE_NODE', 'Room 103', 19.0760, 72.8777, 35, ?, 0)
  `).run(encSecret, encSecret, encSecret);

  // 1. Health and config
  await t.test('GET /api/health and GET /api/config', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.ok(health.data.time);

    const cfg = await request('/api/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.data.ok, true);
    assert.equal(cfg.data.geofence, true);
    assert.equal(cfg.data.maxAccuracyM, 50);
    assert.equal(cfg.data.minGapMinutes, 5);
  });

  // 2. Authentication flows
  let studentCookie;
  let teacherACookie;
  let teacherBCookie;
  let adminCookie;

  await t.test('Login flows & lockout', async () => {
    // Wrong password
    const badPass = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'student_x', password: 'wrongpassword' }
    });
    assert.equal(badPass.status, 401);
    assert.equal(badPass.data.error, 'ERR_LOGIN');

    // Unknown user returns identical error
    const unknownUser = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'nonexistent', password: 'wrongpassword' }
    });
    assert.equal(unknownUser.status, 401);
    assert.equal(unknownUser.data.error, 'ERR_LOGIN');
    assert.equal(badPass.data.message, unknownUser.data.message);

    // Lockout test on a dedicated test user
    db.prepare(`
      INSERT INTO users (login_id, name, role, password_hash, active, failed_attempts, locked_until)
      VALUES ('lockme', 'Lock Me', 'student', ?, 1, 0, 0)
    `).run(passwordHash);

    for (let i = 0; i < 4; i++) {
      const r = await request('/api/auth/login', {
        method: 'POST',
        body: { loginId: 'lockme', password: 'bad' }
      });
      assert.equal(r.status, 401);
    }
    // 5th attempt locks account
    const lockResp = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'lockme', password: 'bad' }
    });
    assert.equal(lockResp.status, 429);
    assert.equal(lockResp.data.error, 'ERR_LOCKED');

    // Subsequent attempt while locked
    const lockedAgain = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'lockme', password: 'bad' }
    });
    assert.equal(lockedAgain.status, 429);
    assert.equal(lockedAgain.data.error, 'ERR_LOCKED');

    // Successful logins
    const stuLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'student_x', password: 'secret123' }
    });
    assert.equal(stuLogin.status, 200);
    assert.equal(stuLogin.data.ok, true);
    assert.equal(stuLogin.data.user.role, 'student');
    studentCookie = stuLogin.cookie;
    assert.ok(studentCookie);

    const tchALogin = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'teacher_a', password: 'secret123' }
    });
    teacherACookie = tchALogin.cookie;

    const tchBLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'teacher_b', password: 'secret123' }
    });
    teacherBCookie = tchBLogin.cookie;

    const admLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'admin1', password: 'secret123' }
    });
    adminCookie = admLogin.cookie;

    // GET /api/me with session
    const me = await request('/api/me', { cookie: studentCookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, 'Student X');

    // 401 without session
    const noSession = await request('/api/me');
    assert.equal(noSession.status, 401);
    assert.equal(noSession.data.error, 'ERR_SESSION');

    // 403 for wrong role
    const forbidden = await request('/api/teacher/classrooms', { cookie: studentCookie });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.data.error, 'ERR_FORBIDDEN');
  });

  // 3. Teacher classroom management
  let class1Id;
  let class2Id;

  await t.test('Teacher classroom CRUD and node assignment', async () => {
    // Create class
    const createRes = await request('/api/teacher/classrooms', {
      method: 'POST',
      cookie: teacherACookie,
      body: { name: 'Physics 101', code: 'PHY1' }
    });
    assert.equal(createRes.status, 200);
    assert.equal(createRes.data.classroom.name, 'Physics 101');
    class1Id = createRes.data.classroom.id;

    // Second class for teacher A
    const createRes2 = await request('/api/teacher/classrooms', {
      method: 'POST',
      cookie: teacherACookie,
      body: { name: 'Chemistry 101', code: 'CHM1' }
    });
    class2Id = createRes2.data.classroom.id;

    // Rename class
    const renameRes = await request(`/api/teacher/classrooms/${class1Id}`, {
      method: 'PATCH',
      cookie: teacherACookie,
      body: { name: 'Physics Advanced' }
    });
    assert.equal(renameRes.status, 200);
    assert.equal(renameRes.data.classroom.name, 'Physics Advanced');

    // Teacher B attempts to view or modify Teacher A's class -> 404
    const bTouch = await request(`/api/teacher/classrooms/${class1Id}`, {
      method: 'PATCH',
      cookie: teacherBCookie,
      body: { name: 'Hacked Class' }
    });
    assert.equal(bTouch.status, 404);
    assert.equal(bTouch.data.error, 'ERR_NOT_FOUND');

    // List nodes
    const nodesRes = await request('/api/nodes', { cookie: teacherACookie });
    assert.equal(nodesRes.status, 200);
    assert.ok(nodesRes.data.nodes.length >= 2);
    assert.equal(nodesRes.data.nodes[0].secret_enc, undefined); // Never return secret_enc

    // Assign node NODE1 to class1
    const assignRes = await request(`/api/teacher/classrooms/${class1Id}/node`, {
      method: 'PUT',
      cookie: teacherACookie,
      body: { nodeUid: 'NODE1' }
    });
    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.data.takenFrom, null);

    // Node takeover: assign NODE1 to class2
    const takeoverRes = await request(`/api/teacher/classrooms/${class2Id}/node`, {
      method: 'PUT',
      cookie: teacherACookie,
      body: { nodeUid: 'NODE1' }
    });
    assert.equal(takeoverRes.status, 200);
    assert.equal(takeoverRes.data.takenFrom, 'Physics Advanced');

    // Put NODE1 back to class1
    await request(`/api/teacher/classrooms/${class1Id}/node`, {
      method: 'PUT',
      cookie: teacherACookie,
      body: { nodeUid: 'NODE1' }
    });

    // Unassign node
    const unassignRes = await request(`/api/teacher/classrooms/${class2Id}/node`, {
      method: 'DELETE',
      cookie: teacherACookie
    });
    assert.equal(unassignRes.status, 200);
  });

  // 4. Student classroom listing and joining
  await t.test('Student lists and joins class', async () => {
    const listRes = await request('/api/classrooms', { cookie: studentCookie });
    assert.equal(listRes.status, 200);
    const cls = listRes.data.classrooms.find(c => c.id === class1Id);
    assert.ok(cls);
    assert.equal(cls.joined, false);
    assert.equal(cls.hasNode, true);

    // Join
    const joinRes = await request(`/api/classrooms/${class1Id}/join`, {
      method: 'POST',
      cookie: studentCookie
    });
    assert.equal(joinRes.status, 200);
    assert.equal(joinRes.data.ok, true);

    // List again, now joined is true
    const listAgain = await request('/api/classrooms', { cookie: studentCookie });
    const clsJoined = listAgain.data.classrooms.find(c => c.id === class1Id);
    assert.equal(clsJoined.joined, true);
  });

  // 5. Scan verification pipeline
  await t.test('Scan verification pipeline: success and failures', async () => {
    const now = Math.floor(Date.now() / 1000);
    const validPayload = buildPayload(nodeSecretHex, 'NODE1', now);

    // Failure: malformed payload
    const failMalformed = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: 'BADFORMAT', lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failMalformed.status, 400);
    assert.equal(failMalformed.data.error, 'ERR_QR_INVALID');

    // Failure: unknown node in payload
    const failUnknownNode = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: buildPayload(nodeSecretHex, 'NONODE', now), lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failUnknownNode.status, 400);
    assert.equal(failUnknownNode.data.error, 'ERR_QR_INVALID');

    // Failure: inactive node
    const failInactiveNode = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: buildPayload(nodeSecretHex, 'INACTIVE_NODE', now), lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failInactiveNode.status, 400);
    assert.equal(failInactiveNode.data.error, 'ERR_QR_INVALID');

    // Failure: expired code (+3 steps)
    const futurePayload = buildPayload(nodeSecretHex, 'NODE1', now + 90);
    const failExpired = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: futurePayload, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failExpired.status, 400);
    assert.equal(failExpired.data.error, 'ERR_QR_INVALID');

    // Failure: node not assigned to this class (NODE2 is unassigned)
    const validPayloadNode2 = buildPayload(nodeSecretHex, 'NODE2', now);
    const failUnassigned = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayloadNode2, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failUnassigned.status, 400);
    assert.equal(failUnassigned.data.error, 'ERR_NODE_NOT_ASSIGNED');

    // Failure: class mismatch (scan NODE1 payload for class2)
    const failMismatch = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class2Id, payload: validPayload, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failMismatch.status, 400);
    assert.equal(failMismatch.data.error, 'ERR_CLASS_MISMATCH');

    // Student Y logs in (not joined class1)
    const stuYLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { loginId: 'student_y', password: 'secret123' }
    });
    const failNotJoined = await request('/api/scan/submit', {
      method: 'POST',
      cookie: stuYLogin.cookie,
      body: { classroomId: class1Id, payload: validPayload, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failNotJoined.status, 400);
    assert.equal(failNotJoined.data.error, 'ERR_NOT_JOINED');

    // Location failures when geofence is on
    const failNoLoc = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload }
    });
    assert.equal(failNoLoc.status, 400);
    assert.equal(failNoLoc.data.error, 'ERR_LOCATION_REQUIRED');

    const failLowAcc = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload, lat: 19.0760, lng: 72.8777, accuracy: 55 }
    });
    assert.equal(failLowAcc.status, 400);
    assert.equal(failLowAcc.data.error, 'ERR_LOW_ACCURACY');

    const failOutside = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload, lat: 19.0780, lng: 72.8777, accuracy: 10 } // ~222m away
    });
    assert.equal(failOutside.status, 400);
    assert.equal(failOutside.data.error, 'ERR_OUTSIDE_GEOFENCE');

    // SUCCESS: Check-in
    const successCheckIn = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(successCheckIn.status, 200);
    assert.equal(successCheckIn.data.ok, true);
    assert.equal(successCheckIn.data.result, 'OK_CHECK_IN');
    assert.equal(successCheckIn.data.classroomName, 'Physics Advanced');

    // Immediate second scan -> ERR_TOO_SOON
    const failTooSoon = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(failTooSoon.status, 400);
    assert.equal(failTooSoon.data.error, 'ERR_TOO_SOON');

    // Set config.minGapMinutes = 0 and scan again -> OK_CHECK_OUT
    const originalMinGap = config.minGapMinutes;
    config.minGapMinutes = 0;
    const successCheckOut = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload, lat: 19.0760, lng: 72.8777, accuracy: 10 }
    });
    assert.equal(successCheckOut.status, 200);
    assert.equal(successCheckOut.data.result, 'OK_CHECK_OUT');
    config.minGapMinutes = originalMinGap;

    // Verify scan_attempts has recorded every single attempt
    const attemptsCount = db.prepare('SELECT COUNT(*) as count FROM scan_attempts').get().count;
    assert.ok(attemptsCount >= 10, `Expected at least 10 scan attempts logged, got ${attemptsCount}`);
  });

  // 6. Geofence off toggle
  await t.test('Geofence off toggle ignores location', async () => {
    config.geofence = false;
    const now = Math.floor(Date.now() / 1000);
    const validPayload = buildPayload(nodeSecretHex, 'NODE1', now);

    // No location sent, should succeed without error (since after CHECK_OUT gives CHECK_IN)
    const res = await request('/api/scan/submit', {
      method: 'POST',
      cookie: studentCookie,
      body: { classroomId: class1Id, payload: validPayload }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.result, 'OK_CHECK_IN');

    config.geofence = true;
  });

  // 7. Security: Origin check on state-changing requests
  await t.test('Foreign Origin header returns 403', async () => {
    const res = await request('/api/classrooms/1/join', {
      method: 'POST',
      cookie: studentCookie,
      headers: {
        Origin: 'http://malicious-site.com'
      }
    });
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'ERR_FORBIDDEN');
  });

  // 8. Static frontend and vendor route
  await t.test('Frontend toggles and /vendor/jsQR.js', async () => {
    // With frontend on (default in test)
    const homeHtml = await request('/');
    assert.equal(homeHtml.status, 200);

    const vendorJs = await request('/vendor/jsQR.js');
    assert.equal(vendorJs.status, 200);
    assert.ok(vendorJs.data.length > 1000);

    // Toggle frontend off
    config.frontend = false;
    const apiOnly = await request('/');
    assert.equal(apiOnly.status, 200);
    assert.deepEqual(apiOnly.data, { ok: true, message: 'API only' });
    config.frontend = true;
  });
});
