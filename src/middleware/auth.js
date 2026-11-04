'use strict';
const crypto = require('crypto');
const { config } = require('../config');
const { db } = require('../db');

const COOKIE_NAME = 'sid';
const IDLE_TIMEOUT_SECONDS = 8 * 3600; // 8 hours

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    req.user = null;
    return next();
  }

  const tokenHash = hashToken(token);
  const now = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    SELECT s.token_hash, s.user_id, s.last_seen_at,
           u.id, u.login_id, u.name, u.role, u.active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `);
  const row = stmt.get(tokenHash);

  if (!row) {
    req.user = null;
    return next();
  }

  // 8 hours idle expiry
  if (now - row.last_seen_at > IDLE_TIMEOUT_SECONDS || !row.active) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    res.clearCookie(COOKIE_NAME);
    req.user = null;
    return next();
  }

  // Sliding update on use
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, tokenHash);

  req.user = {
    id: row.id,
    login_id: row.login_id,
    name: row.name,
    role: row.role
  };
  req.sessionTokenHash = tokenHash;

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      ok: false,
      error: 'ERR_SESSION',
      message: 'Authentication required or session expired.'
    });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        ok: false,
        error: 'ERR_SESSION',
        message: 'Authentication required or session expired.'
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        error: 'ERR_FORBIDDEN',
        message: 'Insufficient permissions for this action.'
      });
    }
    next();
  };
}

function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, userId, now, now);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    maxAge: IDLE_TIMEOUT_SECONDS * 1000,
    path: '/'
  });

  return token;
}

function destroySession(tokenHash, res) {
  if (tokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookies,
    path: '/'
  });
}

module.exports = {
  COOKIE_NAME,
  IDLE_TIMEOUT_SECONDS,
  hashToken,
  authMiddleware,
  requireAuth,
  requireRole,
  createSession,
  destroySession
};
