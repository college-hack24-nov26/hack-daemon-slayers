'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
const { authMiddleware } = require('./middleware/auth');
const { originCheck } = require('./middleware/origin');
const { errorHandler, notFoundHandler } = require('./middleware/errors');

function createApp() {
  const app = express();

  // Behind reverse proxy (ngrok)
  app.set('trust proxy', 1);

  // Helmet with default CSP minus upgrade-insecure-requests
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'upgrade-insecure-requests': null
      }
    }
  }));

  // Permissions-Policy header
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self)');
    next();
  });

  // Body parser & cookie parser
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  // Origin check for state-changing requests
  app.use(originCheck);

  // Session middleware
  app.use(authMiddleware);

  // Rate limiter for login and scan submit (300 requests per minute per IP)
  const authAndScanLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        ok: false,
        error: 'ERR_RATE_LIMITED',
        message: 'Too many requests. Please wait a minute and try again.'
      });
    }
  });

  // Public system endpoints
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString()
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      ok: true,
      geofence: config.geofence,
      maxAccuracyM: config.maxAccuracyM,
      minGapMinutes: config.minGapMinutes
    });
  });

  // API Routes
  app.use('/api/auth/login', authAndScanLimiter);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/student'));
  app.use('/api', require('./routes/teacher'));
  app.use('/api/scan/submit', authAndScanLimiter);
  app.use('/api/scan', require('./routes/scan'));

  // Vendor script route
  app.get('/vendor/jsQR.js', (req, res) => {
    const jsQRPath = path.resolve(__dirname, '../node_modules/jsqr/dist/jsQR.js');
    res.sendFile(jsQRPath);
  });

  // 404 for any unmatched /api/* route
  app.all('/api/*', notFoundHandler);

  // Frontend static or API-only mode
  app.use((req, res, next) => {
    if (config.frontend) {
      next();
    } else {
      if (req.path === '/') {
        return res.json({ ok: true, message: 'API only' });
      }
      next();
    }
  });

  if (config.frontend) {
    const publicDir = path.resolve(__dirname, '../public');
    app.use(express.static(publicDir));
  }

  // Generic error handler
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
