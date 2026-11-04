'use strict';
const { config, cli, usage, assertConfig } = require('./config');

if (cli.help) {
  process.stdout.write(usage + '\n');
  process.exit(0);
}

// Assert configuration lazily before starting
assertConfig();

const { createApp } = require('./app');

const app = createApp();
const server = app.listen(config.port, () => {
  const banner = `
==================================================
  QR Attendance MVP Server
==================================================
  Port:           ${config.port}
  Frontend:       ${config.frontend ? 'on' : 'off'}
  Geofence:       ${config.geofence ? 'on' : 'off'}
  Secure cookies: ${config.secureCookies ? 'on' : 'off'}
  Database:       ${config.dbPath}
  Minimum gap:    ${config.minGapMinutes} min
  Max accuracy:   ${config.maxAccuracyM} m
  Timezone:       offset ${config.tzOffsetSeconds} s
  Public host:    ${config.publicHost || 'none'}
==================================================
`;
  process.stdout.write(banner.trim() + '\n\n');
});

module.exports = server;
