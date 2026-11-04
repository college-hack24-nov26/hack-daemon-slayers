'use strict';
const { config } = require('../config');

// For POST, PUT, PATCH, DELETE:
// If an Origin header is present and its host is neither req.headers.host nor config.publicHost, respond 403 ERR_FORBIDDEN.
function originCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const origin = req.headers['origin'];
  if (!origin) {
    return next();
  }

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host; // e.g. "localhost:3000" or "demo.ngrok-free.app"
    const reqHost = req.headers['host']; // e.g. "localhost:3000"
    const publicHost = config.publicHost; // e.g. "demo.ngrok-free.app" or ""

    if (originHost === reqHost) {
      return next();
    }

    if (publicHost && (originHost === publicHost || originUrl.hostname === publicHost)) {
      return next();
    }

    return res.status(403).json({
      ok: false,
      error: 'ERR_FORBIDDEN',
      message: 'Cross-origin request forbidden.'
    });
  } catch (e) {
    return res.status(403).json({
      ok: false,
      error: 'ERR_FORBIDDEN',
      message: 'Invalid origin.'
    });
  }
}

module.exports = { originCheck };
