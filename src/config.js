'use strict';
const path = require('path');
require('dotenv').config();

// Accepts --flag=value, --flag value, or a bare --flag (treated as "on").
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; }
    else out[a.slice(2)] = 'on';
  }
  return out;
}

const cli = parseArgs(process.argv.slice(2));
const pick = (flag, env, dflt) => cli[flag] ?? process.env[env] ?? dflt;
const asBool = (v) => ['on', 'true', '1', 'yes'].includes(String(v).toLowerCase());
const asNum = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
};

const rawDb = String(pick('db', 'DB_PATH', './data/attendance.db'));

const config = {
  port: asNum(pick('port', 'PORT', 3000), 'port'),
  frontend: asBool(pick('frontend', 'SERVE_FRONTEND', 'on')),
  geofence: asBool(pick('geofence', 'GEOFENCE', 'on')),
  secureCookies: asBool(pick('secure-cookies', 'SECURE_COOKIES', 'on')),
  dbPath: rawDb === ':memory:' ? rawDb : path.resolve(rawDb),
  minGapMinutes: asNum(pick('min-gap', 'MIN_GAP_MINUTES', 5), 'min-gap'),
  maxAccuracyM: asNum(pick('max-accuracy', 'MAX_ACCURACY_M', 50), 'max-accuracy'),
  tzOffsetSeconds: asNum(pick('tz-offset', 'TZ_OFFSET_SECONDS', 19800), 'tz-offset'),
  publicHost: String(pick('public-host', 'PUBLIC_HOST', '')),
  masterKey: process.env.MASTER_KEY || '',
};

function assertConfig() {
  if (!config.masterKey) {
    throw new Error('MASTER_KEY is required in .env. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
  const keyBuf = Buffer.from(config.masterKey, 'base64');
  if (keyBuf.length !== 32) {
    throw new Error('MASTER_KEY must be exactly 32 bytes (base64 encoded). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  }
}

const usage = `
Usage: node src/server.js [options]      (flags override .env, .env overrides defaults)

  --port <n>              HTTP port                              (default 3000)
  --frontend on|off       serve the web app from public/         (default on)
  --geofence on|off       enforce location + radius on scans     (default on)
  --secure-cookies on|off set the Secure flag on the cookie      (default on)
  --db <path>             SQLite file, or :memory:               (default ./data/attendance.db)
  --min-gap <minutes>     minimum gap between check-in/out       (default 5)
  --max-accuracy <m>      worst accepted GPS accuracy in metres  (default 50)
  --tz-offset <seconds>   attendance-day offset from UTC         (default 19800 = IST)
  --public-host <host>    extra allowed Origin host (ngrok name) (default none)
  --help                  show this message
`;

module.exports = { config, cli, usage, assertConfig };
