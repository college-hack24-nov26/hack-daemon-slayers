'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { createSession, destroySession, requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errors');
const { isNonEmptyString } = require('../validate');

const router = express.Router();

// A fixed dummy bcrypt hash for constant-time comparison on unknown users
const DUMMY_HASH = '$2a$12$e80y99g14P8q5V6f4Q5U2u86U9B9mF/72o6R7X7M7O7P7Q7R7S7T6';

router.post('/login', asyncHandler(async (req, res) => {
  const { loginId, password } = req.body || {};

  if (!isNonEmptyString(loginId) || typeof password !== 'string') {
    return res.status(401).json({
      ok: false,
      error: 'ERR_LOGIN',
      message: 'Wrong login ID or password.'
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const user = db.prepare('SELECT * FROM users WHERE login_id = ?').get(loginId.trim());

  if (!user) {
    // Run dummy compare to balance timing
    await bcrypt.compare(password, DUMMY_HASH);
    return res.status(401).json({
      ok: false,
      error: 'ERR_LOGIN',
      message: 'Wrong login ID or password.'
    });
  }

  // Check if locked
  if (user.locked_until && user.locked_until > now) {
    const minutesLeft = Math.ceil((user.locked_until - now) / 60);
    return res.status(429).json({
      ok: false,
      error: 'ERR_LOCKED',
      message: `Too many attempts. Try again in ${minutesLeft} minutes.`
    });
  }

  // Account disabled check
  if (!user.active) {
    await bcrypt.compare(password, user.password_hash);
    return res.status(401).json({
      ok: false,
      error: 'ERR_LOGIN',
      message: 'Wrong login ID or password.'
    });
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatch) {
    const failedAttempts = (user.failed_attempts || 0) + 1;
    let lockedUntil = 0;
    if (failedAttempts >= 5) {
      lockedUntil = now + 900; // 15 minutes lockout
    }
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .run(failedAttempts, lockedUntil, user.id);

    if (lockedUntil > 0) {
      return res.status(429).json({
        ok: false,
        error: 'ERR_LOCKED',
        message: 'Too many attempts. Try again in 15 minutes.'
      });
    }

    return res.status(401).json({
      ok: false,
      error: 'ERR_LOGIN',
      message: 'Wrong login ID or password.'
    });
  }

  // Reset failed attempts on success
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?').run(user.id);

  createSession(user.id, res);

  res.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      role: user.role
    }
  });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  destroySession(req.sessionTokenHash, res);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    }
  });
});

module.exports = router;
