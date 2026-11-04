'use strict';
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { isPositiveInteger } = require('../validate');

const router = express.Router();

// Student only: List all active classes with whether joined
router.get('/classrooms', requireRole('student'), asyncHandler(async (req, res) => {
  const studentId = req.user.id;

  const rows = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.code,
      u.name AS teacherName,
      CASE WHEN c.node_uid IS NOT NULL THEN 1 ELSE 0 END AS hasNode,
      CASE WHEN e.student_id IS NOT NULL THEN 1 ELSE 0 END AS joined
    FROM classrooms c
    JOIN users u ON u.id = c.teacher_id
    LEFT JOIN enrollments e ON e.classroom_id = c.id AND e.student_id = ?
    WHERE c.archived = 0
    ORDER BY c.name ASC
  `).all(studentId);

  res.json({
    ok: true,
    classrooms: rows.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      teacherName: r.teacherName,
      hasNode: Boolean(r.hasNode),
      joined: Boolean(r.joined)
    }))
  });
}));

// Student only: Join classroom
router.post('/classrooms/:id/join', requireRole('student'), asyncHandler(async (req, res) => {
  const classroomId = Number(req.params.id);
  if (!isPositiveInteger(classroomId)) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid classroom ID.'
    });
  }

  const classroom = db.prepare('SELECT id, archived FROM classrooms WHERE id = ?').get(classroomId);
  if (!classroom || classroom.archived) {
    return res.status(404).json({
      ok: false,
      error: 'ERR_NOT_FOUND',
      message: 'Classroom not found or archived.'
    });
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO enrollments (student_id, classroom_id, joined_at)
    VALUES (?, ?, ?)
  `).run(req.user.id, classroomId, now);

  res.json({ ok: true });
}));

module.exports = router;
