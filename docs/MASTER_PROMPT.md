# Master Prompt: QR Attendance MVP (for Antigravity)

## How to use
1. Put `docs/AI_CONTEXT.md`, `docs/SRS/SRS_MVP.md` and `docs/TOTP_VECTORS.md` in the repo. Keep `docs/` and `phy_node/` as they are. Move the old `backend/` and `frontend/` folders out of the way.
2. Open the repo folder in Antigravity.
3. Paste everything between the two horizontal rules below as one message.
4. Read the plan it writes before it starts building.
5. When it finishes, run the acceptance checklist (section 13) yourself. Don't take "it works" on trust.

---

# TASK: Build the MVP of a QR attendance web app

## 1. Goal
Build, in this repository, one Node.js process that serves both a JSON API (`/api`) and a mobile web app (`/`). `npm start` is the only thing to run. The MVP has exactly three things:
1. **Login** (universal: admin, teacher, student).
2. **Student attendance:** pick a class, allow location, scan a QR code shown on a classroom device (PHY_NODE), see the result.
3. **Teacher class management:** create, rename, archive classes, and assign a PHY_NODE to a class.

Everything else is out of scope (section 12). Quality bar: clean, secure, readable code and a polished phone UI, but small. No extra features.

## 2. Read first, and boundaries
- Read `docs/AI_CONTEXT.md`, `docs/SRS/SRS_MVP.md` and `docs/TOTP_VECTORS.md`. They are the requirements. If this prompt and the SRS disagree, stop and tell me.
- **Never modify anything in `docs/` or `phy_node/`.** The firmware is the source of truth for the QR token. Never change the payload format `CODE:ROOM_ID`.
- Do not commit secrets. Create a local `.env` from `.env.example` with a freshly generated `MASTER_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Never print it.
- Don't add dependencies beyond section 3. Don't run destructive commands.

## 3. Tech (fixed)
Node 20+ (works on 22), plain JavaScript, CommonJS. **Express 4** (not 5). No TypeScript, no bundler, no frontend framework. Install exactly:
```
npm install express@4 bcryptjs@2 better-sqlite3 cookie-parser helmet express-rate-limit dotenv jsqr
```
Tests use the built-in `node:test` (`"test": "node --test"`), HTTP tests use Node's built-in `fetch`. Validation uses small hand-written helpers in `src/validate.js`.

`package.json` scripts:
```json
"start": "node src/server.js",
"start:api": "node src/server.js --frontend=off",
"dev": "node --watch src/server.js",
"seed": "node scripts/seed.js",
"add-user": "node scripts/add-user.js",
"add-node": "node scripts/add-node.js",
"token": "node scripts/token.js",
"test": "node --test"
```
Also set `"private": true` and `"engines": { "node": ">=20" }`.

## 4. Directory (create exactly this)
```
package.json  .env.example  .gitignore  README.md
docs/            (exists, do not touch)
phy_node/        (exists, do not touch)
data/            SQLite file, git-ignored
scripts/         seed.js  add-user.js  add-node.js  token.js
src/             server.js  app.js  config.js  db.js  schema.sql  validate.js
  middleware/    auth.js  origin.js  errors.js
  routes/        auth.js  student.js  teacher.js  scan.js
  services/      totp.js  crypto.js  geofence.js  attendance.js
public/          index.html  styles.css
  js/            main.js  api.js  ui.js  messages.js
  js/views/      login.js  student.js  scan.js  teacher.js  admin.js
tests/           totp.test.js  services.test.js  api.test.js
```
`.gitignore`: `node_modules/`, `.env`, `data/`, `*.db`, `*.db-wal`, `*.db-shm`, `.DS_Store`.
`.env.example` (placeholders only): `MASTER_KEY=`, `PORT=3000`, `SERVE_FRONTEND=on`, `GEOFENCE=on`, `SECURE_COOKIES=on`, `DB_PATH=./data/attendance.db`, `MIN_GAP_MINUTES=5`, `MAX_ACCURACY_M=50`, `TZ_OFFSET_SECONDS=19800`, `PUBLIC_HOST=`.

## 5. Startup parameters (the toggles)
Flags override `.env`, `.env` overrides defaults. They are defined **only** in `src/config.js`. Routes and middleware must read `config.*` **at request time** (never copy a value into a constant at import) so tests can change them.

`src/server.js`: `const { config, cli, usage } = require('./config');` if `cli.help` print `usage` and exit 0; otherwise start `createApp()` (from `app.js`) and print a short banner of the effective settings: port, frontend on/off, geofence on/off, secure cookies on/off, database path, minimum gap.

`app.js` exports `createApp()` which builds and returns the Express app **without listening** (so tests can use it). `--frontend off`: only `/api` is served and `GET /` returns `{ "ok": true, "message": "API only" }`.

**Copy this file verbatim** to `src/config.js` (it is tested):
```js
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

module.exports = { config, cli, usage };
```
Add to `config.js`, after `masterKey` is read: if `masterKey` does not decode to exactly 32 bytes (base64), throw an Error with a clear message that includes the command to generate one. Do this lazily from `server.js` and the scripts (call a small exported `assertConfig()`), so that `--help` still works without a `.env`.

## 6. Services to copy verbatim
These are tested against an independent port of the firmware. **Do not rewrite, "improve" or refactor them.**

`src/services/totp.js`:
```js
'use strict';
const crypto = require('crypto');

const INTERVAL_SECONDS = 30;
const PAYLOAD_RE = /^[0-9A-Z]{12}:[0-9A-Z]{1,16}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function stepFor(unixSeconds) {
  return Math.floor(unixSeconds / INTERVAL_SECONDS);
}

// Must match phy_node/newAttendance.ino exactly.
function computeCode(secretHex, roomId, step) {
  const key = Buffer.from(secretHex, 'hex'); // 32 bytes
  const msg = Buffer.from(`${roomId}:${step}`, 'ascii');
  const h = crypto.createHmac('sha256', key).update(msg).digest(); // 32 bytes
  const off = h[31] % 24;
  let v = BigInt(h[off] & 0x7f);
  for (let i = 1; i < 8; i++) v = (v << 8n) | BigInt(h[off + i]);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out = ALPHABET[Number(v % 36n)] + out;
    v /= 36n;
  }
  return out;
}

function buildPayload(secretHex, roomId, unixSeconds) {
  return `${computeCode(secretHex, roomId, stepFor(unixSeconds))}:${roomId}`;
}

function parsePayload(payload) {
  if (typeof payload !== 'string' || !PAYLOAD_RE.test(payload)) return null;
  const i = payload.indexOf(':');
  return { code: payload.slice(0, i), roomId: payload.slice(i + 1) };
}

// Accepts the previous, current and next 30-second step. No early exit.
function verifyCode(secretHex, roomId, code, nowSeconds) {
  const step = stepFor(nowSeconds);
  const given = Buffer.from(String(code), 'ascii');
  let ok = false;
  for (const s of [step - 1, step, step + 1]) {
    const expected = Buffer.from(computeCode(secretHex, roomId, s), 'ascii');
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

module.exports = { INTERVAL_SECONDS, PAYLOAD_RE, stepFor, computeCode, buildPayload, parsePayload, verifyCode };
```
`src/services/crypto.js`:
```js
'use strict';
const crypto = require('crypto');

function keyFrom(masterKeyB64) {
  const k = Buffer.from(masterKeyB64, 'base64');
  if (k.length !== 32) throw new Error('MASTER_KEY must be 32 bytes, base64 encoded');
  return k;
}

// Returns one base64 string: iv(12) + tag(16) + ciphertext
function encryptSecret(plain, masterKeyB64) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(masterKeyB64), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptSecret(blobB64, masterKeyB64) {
  const b = Buffer.from(blobB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(masterKeyB64), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
```
`src/services/geofence.js`:
```js
'use strict';

// Haversine distance in metres.
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = { distanceMeters };
```
`src/services/attendance.js`:
```js
'use strict';

// lastEvent: latest accepted event for this student + classroom + date, or null.
function decide(lastEvent, nowSec, minGapSec) {
  if (!lastEvent || lastEvent.type === 'CHECK_OUT') return { type: 'CHECK_IN' };
  if (nowSec - lastEvent.scanned_at >= minGapSec) return { type: 'CHECK_OUT' };
  return { error: 'ERR_TOO_SOON' };
}

// Attendance date as YYYY-MM-DD in the configured offset (default IST = 19800 s).
function dateKey(unixSec, tzOffsetSeconds) {
  return new Date((unixSec + tzOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

module.exports = { decide, dateKey };
```

## 7. Database
`src/schema.sql` (copy verbatim; it is tested and idempotent):
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id        TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('admin','teacher','student')),
  password_hash   TEXT    NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS phy_nodes (
  uid        TEXT PRIMARY KEY,
  label      TEXT NOT NULL DEFAULT '',
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius_m   REAL NOT NULL DEFAULT 35,
  secret_enc TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS classrooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  name       TEXT    NOT NULL,
  code       TEXT    NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0,
  node_uid   TEXT UNIQUE REFERENCES phy_nodes(uid)
);

CREATE TABLE IF NOT EXISTS enrollments (
  student_id   INTEGER NOT NULL REFERENCES users(id),
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (student_id, classroom_id)
);

CREATE TABLE IF NOT EXISTS attendance_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER NOT NULL REFERENCES users(id),
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
  node_uid     TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('CHECK_IN','CHECK_OUT')),
  scanned_at   INTEGER NOT NULL,
  att_date     TEXT    NOT NULL,
  distance_m   REAL,
  accuracy_m   REAL
);
CREATE INDEX IF NOT EXISTS idx_events_lookup
  ON attendance_events (student_id, classroom_id, att_date, id);

CREATE TABLE IF NOT EXISTS scan_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id   INTEGER,
  classroom_id INTEGER,
  node_uid     TEXT,
  result_code  TEXT NOT NULL,
  lat          REAL,
  lng          REAL,
  accuracy_m   REAL,
  distance_m   REAL,
  ip           TEXT,
  at           INTEGER NOT NULL
);
```
`src/db.js`: create the `data/` folder if needed, open `better-sqlite3` at `config.dbPath`, set `journal_mode = WAL` (skip for `:memory:`) and `foreign_keys = ON`, run `schema.sql`, export the connection. Use prepared statements and transactions for multi-step writes (node takeover, recording a scan).

## 8. Backend behaviour

### 8.1 Conventions
JSON only. Success `{ "ok": true, ... }`. Errors `{ "ok": false, "error": "<CODE>", "message": "<plain text>" }`. Statuses: 400 validation and scan-rule errors, 401 `ERR_SESSION` / `ERR_LOGIN`, 403 `ERR_FORBIDDEN`, 404 `ERR_NOT_FOUND`, 429 `ERR_LOCKED` / `ERR_RATE_LIMITED`, 500 `ERR_SERVER` (generic message, never a stack trace). Wrap async handlers in a small `asyncHandler` so rejected promises reach the error middleware. Bad JSON gives 400 `ERR_BAD_REQUEST`. Unknown `/api/*` paths give 404 `ERR_NOT_FOUND`.

### 8.2 Middleware and app setup (`app.js`)
- `app.set('trust proxy', 1)` (the server runs behind ngrok).
- helmet with the CSP default **minus** `upgrade-insecure-requests` (otherwise plain-http localhost breaks):
  `helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } } })`
- A tiny middleware adding `Permissions-Policy: camera=(self), geolocation=(self)`.
- `express.json({ limit: '50kb' })`, `cookie-parser`.
- `middleware/origin.js`: for POST, PUT, PATCH, DELETE, if an `Origin` header is present and its host is neither the request `Host` nor `config.publicHost`, respond 403 `ERR_FORBIDDEN`.
- `express-rate-limit` on `/api/auth/login` and `/api/scan/submit`: 300 requests per minute per IP (a whole classroom shares one address), returning `ERR_RATE_LIMITED`.
- Static (only if `config.frontend`): `express.static('public')`, plus `GET /vendor/jsQR.js` sending `node_modules/jsqr/dist/jsQR.js`.
- `GET /api/health` returns `{ ok, time }` (ISO time). `GET /api/config` returns `{ ok, geofence, maxAccuracyM, minGapMinutes }`.

### 8.3 Sessions and auth (`middleware/auth.js`, `routes/auth.js`)
- Cookie `sid`: 32 random bytes (hex). Store only its SHA-256 in `sessions`. Cookie flags: `HttpOnly`, `SameSite=Strict`, `Secure` = `config.secureCookies`, `maxAge` 8 hours. A session idle for more than 8 hours is deleted and rejected with `ERR_SESSION`. Update `last_seen_at` on use.
- `requireAuth` and `requireRole(...roles)`: missing/invalid session gives 401 `ERR_SESSION`; wrong role gives 403 `ERR_FORBIDDEN`. All role checks live here.
- `POST /api/auth/login` `{ loginId, password }`: bcryptjs compare. Unknown login, wrong password and disabled account all return 401 `ERR_LOGIN` "Wrong login ID or password." For an unknown ID, still run `bcrypt.compare` against a fixed dummy hash (similar timing). After 5 consecutive failures set `locked_until = now + 900`; while locked return 429 `ERR_LOCKED` "Too many attempts. Try again in N minutes." A success resets the counter. Returns `{ ok, user: { id, name, role } }`.
- `POST /api/auth/logout` deletes the session and clears the cookie. `GET /api/me` returns the user.
- Hash passwords with bcryptjs cost 12.

### 8.4 Student routes (`routes/student.js`, role `student`)
- `GET /api/classrooms`: active classes only: `{ id, name, code, teacherName, hasNode, joined }`, ordered by name.
- `POST /api/classrooms/:id/join`: class must exist and not be archived; `INSERT OR IGNORE` into `enrollments`; idempotent.

### 8.5 Teacher routes (`routes/teacher.js`, role `teacher`)
A teacher only ever sees or changes classes where `teacher_id` equals their own ID. Anything else is 404 `ERR_NOT_FOUND`.
- `GET /api/teacher/classrooms`: own classes, archived included: `{ id, name, code, archived, nodeUid, nodeLabel }`.
- `POST /api/teacher/classrooms` `{ name, code? }`: name trimmed, 1 to 80 characters; code up to 20.
- `PATCH /api/teacher/classrooms/:id` `{ name?, code?, archived? }`. Archiving a class also clears its `node_uid`.
- `GET /api/nodes`: active nodes: `{ uid, label, classroomId, classroomName }`.
- `PUT /api/teacher/classrooms/:id/node` `{ nodeUid }`: node must exist and be active (404 `ERR_NOT_FOUND`), class must not be archived. In **one transaction**: find any other class holding the node, set its `node_uid` to NULL, then assign. Return `{ ok, takenFrom: "<class name>" | null }`.
- `DELETE /api/teacher/classrooms/:id/node`: sets `node_uid` NULL.
- Never return `secret_enc` or any secret from any route.

### 8.6 Scan route (`routes/scan.js`, role `student`)
`POST /api/scan/submit` `{ classroomId, payload, lat?, lng?, accuracy? }`. Validate: `classroomId` positive integer; `payload` string up to 64 characters; `lat` in [-90, 90]; `lng` in [-180, 180]; `accuracy` a finite number >= 0. Then, in this exact order, stopping at the first failure (HTTP 400 with the result code as `error`):
1. `parsePayload` returns null: `ERR_QR_INVALID`.
2. Node not found, or `active = 0`, or `verifyCode(decryptSecret(...), roomId, code, nowSeconds)` is false: `ERR_QR_INVALID`. (Same code and same message for all three. Never reveal which.)
3. Class not found or archived: `ERR_CLASS_MISMATCH`. Node not assigned to any class: `ERR_NODE_NOT_ASSIGNED`. Node's class is not `classroomId`: `ERR_CLASS_MISMATCH`.
4. No row in `enrollments`: `ERR_NOT_JOINED`.
5. If `config.geofence`: `lat` or `lng` missing: `ERR_LOCATION_REQUIRED`; `accuracy` missing: `ERR_LOCATION_REQUIRED`; `accuracy > config.maxAccuracyM`: `ERR_LOW_ACCURACY`; `distanceMeters(...) > node.radius_m`: `ERR_OUTSIDE_GEOFENCE`. If geofence is off, skip all of step 5 (still store location if supplied).
6. `decide(lastEventToday, now, config.minGapMinutes * 60)`. `lastEventToday` = latest `attendance_events` row for this student + class + `att_date = dateKey(now, config.tzOffsetSeconds)`, ordered by `id` descending. An `error` result becomes `ERR_TOO_SOON`.
7. Insert into `attendance_events` and return `{ ok: true, result: "OK_CHECK_IN" | "OK_CHECK_OUT", classroomName, at: <ISO time> }`.

`now` is `Math.floor(Date.now() / 1000)` on the server. Ignore any time the client sends. **Every** attempt (accepted or rejected, including step 1 failures) inserts one row into `scan_attempts` with the result code, student, class (if given), node uid (if parsed), lat, lng, accuracy, distance (if computed) and `req.ip`.

### 8.7 Scripts (`scripts/`)
All scripts reuse `src/config.js` and `src/db.js`, call `assertConfig()`, print clear errors, and exit non-zero on failure.
- `seed.js`: idempotent. Creates `admin` / `admin123` (admin), `teacher1` / `teacher123` (teacher, "Demo Teacher"), `student1` / `student123` (student, "Demo Student"); node `R101` using `--secret` or, by default, the firmware placeholder `0123456789abcdef` repeated 4 times, `--lat` / `--lng` (default 19.0760 / 72.8777), radius 35; a class "Demo Class" for `teacher1` linked to `R101`. Skip anything that already exists. Print the credentials with a warning that they are demo values.
- `add-user.js --login L --name N --role admin|teacher|student --password P` (password at least 8 characters).
- `add-node.js --uid R101 (--secret <64 hex> | --generate) --lat X --lng Y [--radius 35] [--label text]`: validate the uid (`^[0-9A-Z]{1,16}$`), the secret (64 hex characters), and the coordinates. Upsert; change the secret only if one is given. With `--generate`, create 32 random bytes, print the 64-hex secret **once** with a note to paste it into the firmware's `ROOM_SECRET`.
- `token.js --uid R101 --secret <64 hex> [--time <unix>]`: print the payload for steps `n-1`, `n`, `n+1` with the UTC time of each step. This is how the real node is verified against the server.

## 9. Frontend (`public/`)
Plain HTML, CSS and ES modules. `index.html` has `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, a `<header id="topbar">`, a `<main id="view">`, a classic `<script src="/vendor/jsQR.js"></script>` (global `jsQR`), then `<script type="module" src="/js/main.js">`.

### 9.1 Rules
- Mobile first (360 px and up), centred column max 520 px on larger screens. `color-scheme: light dark` with CSS variables for both themes; system font stack; 16 px base text; buttons and tappable rows at least 44 px high; focus outlines; safe-area padding (`env(safe-area-inset-*)`); respect `prefers-reduced-motion`.
- Calm, clean look: one accent colour, rounded cards, clear spacing. Status is never colour alone (use words and a symbol). Buttons disable and show a loading label during requests. Provide empty states and error states.
- **Never** assign server-provided text with `innerHTML` (use `textContent` or a small `h(tag, attrs, ...children)` helper in `ui.js`). **Never** use `localStorage` or `sessionStorage`.
- `api.js`: one `api(path, { method, body })` wrapper around `fetch` (same-origin credentials, JSON). On non-2xx it throws an object `{ error, message, status }`. A 401 `ERR_SESSION` clears the user and sends the app to `#/login`.
- `messages.js`: map every result code to friendly text:
  - `OK_CHECK_IN` "Checked in" / `OK_CHECK_OUT` "Checked out"
  - `ERR_QR_INVALID` "That code isn't valid or has expired. Scan the code on the screen again."
  - `ERR_NODE_NOT_ASSIGNED` "This device isn't linked to a class yet. Ask your teacher."
  - `ERR_CLASS_MISMATCH` "This code belongs to a different class. Pick the right class and try again."
  - `ERR_NOT_JOINED` "You haven't joined this class. Go back and select it."
  - `ERR_LOCATION_REQUIRED` "Location is needed to mark attendance. Allow location access and try again."
  - `ERR_LOW_ACCURACY` "Your location isn't accurate enough. Move closer to a window or step outside for a moment, then try again."
  - `ERR_OUTSIDE_GEOFENCE` "You seem to be outside the classroom area. Move closer and try again."
  - `ERR_TOO_SOON` "You already scanned a moment ago. Wait a few minutes before scanning again."
  - `ERR_SESSION` "Your session ended. Log in again." / `ERR_RATE_LIMITED` "Too many attempts. Wait a minute and try again."

### 9.2 Routing (`main.js`)
Hash routes: `#/login`, `#/student`, `#/scan/:id`, `#/teacher`, `#/admin`. On start call `GET /api/me`. Guard routes by role; unknown or disallowed routes go to the user's home (student `#/student`, teacher `#/teacher`, admin `#/admin`, none `#/login`). Each view is `render(container, params)` and may return a cleanup function; the router calls the previous cleanup on every navigation (this stops the camera). The top bar shows the app name, the user's name and a Log out button when logged in.

### 9.3 Screens
- **Login:** login ID and password fields (`autocomplete="username"` / `"current-password"`), a submit button, an `aria-live` error area. On success go to the role's home.
- **Student, class list (`#/student`):** heading "Mark attendance", a list of active classes (name, code, teacher, and a "No device linked yet" note when `hasNode` is false). Tapping a class calls the join endpoint and opens `#/scan/:id`. Empty state when there are no classes.
- **Scan (`#/scan/:id`):** shows the class name (fetch `GET /api/classrooms` and find it), a one-line privacy note ("Your location is read only when you scan"), a large **Start scan** button, a `<video playsinline muted autoplay>` area with a framing guide, a status line, and a result card. Flow:
  1. On the Start tap (a user gesture, needed on iOS): request location with `enableHighAccuracy: true, timeout: 10000, maximumAge: 0`. Handle denied (explain how to enable it in the browser's site settings), unavailable and timeout with specific messages. If `GET /api/config` says geofence is off, continue without location and say so.
  2. Open the rear camera: `getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })`; handle denied and no-camera with a message and the manual fallback.
  3. Decode loop about every 120 ms: draw the frame to a canvas scaled to at most 640 px wide, `getImageData`, `jsQR(data, w, h, { inversionAttempts: 'attemptBoth' })` (the node shows white on black). Accept only a value matching `^[0-9A-Z]{12}:[0-9A-Z]{1,16}$`; otherwise show a brief "That isn't an attendance code" hint. Ignore the same value for 3 seconds.
  4. On a valid read: stop the loop, get a fresh position (`maximumAge: 15000`, `timeout: 10000`, fall back to the first fix), `POST /api/scan/submit`, show the result card (success: large "Checked in" or "Checked out", class name, local time; failure: the mapped message and a **Try again** button). Always stop the camera tracks after a result.
  5. Also stop the camera on cleanup and when `document.visibilityState` becomes hidden.
  6. A collapsed "Camera not working? Enter the code" section with a text input (auto-uppercase, same format check) that submits the same way.
- **Teacher (`#/teacher`):** a "New class" form (name, optional code). Below, a card per class showing name, code, an "Archived" label when archived, and the linked node. Actions per class: **Rename** (inline edit or prompt), **Archive / Restore**, a node `<select>` filled from `GET /api/nodes` with an **Assign** button (if the chosen node is used by another class, `confirm()` "Node X is used by 'Y'. Take it over?" before calling), and **Unassign** when a node is linked. Refresh the list after each action and show a short confirmation message.
- **Admin (`#/admin`):** one card: "Admin screens are not part of the MVP. Use the command-line scripts (see README)." plus the Log out button.

## 10. Security checklist (must hold)
bcrypt cost 12; hashed session tokens; cookie flags as in 8.3; account lock; same error for unknown user and wrong password; Origin check on state-changing requests; parameterised SQL only; all inputs validated; secrets encrypted at rest and never returned or logged; no stack traces; no `innerHTML` with data; no web storage; `.env` and `data/` ignored by git.

## 11. Tests (`node:test`)
- `tests/totp.test.js`: these vectors, secret `0123456789abcdef` x4 (64 hex characters): `R101` at 1762200000 and 1762200029 give `3YBMBMJTZIO8:R101`; `R101` at 1762200030 gives `RR3P1ZV7341Z:R101`; `LAB2` at 1762300123 gives `KIU2L532K3JQ:LAB2`. Plus: HMAC-SHA256 RFC 4231 test case 1 (key 20 bytes of 0x0b, data `Hi There`) equals `b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7`; accepts steps -1, 0, +1 and rejects +3; rejects a wrong secret, wrong ROOM_ID and a one-character change; `parsePayload` rejects `''`, `ABC`, lowercase, extra colons, `:R101`, `CODE:`, `null`, a number.
- `tests/services.test.js`: crypto round-trip, tampered ciphertext throws, unique IVs, wrong key length throws; geofence (zero, one degree of latitude about 111195 m within 100 m, 10 m inside 35, 100 m outside, anti-meridian under 30 m); `decide` (none gives check-in, 299 s gives too-soon, 300 s gives check-out, after check-out gives check-in); `dateKey` IST boundary (18:29:59 UTC and 18:30:00 UTC on 2026-11-03 fall on different dates).
- `tests/api.test.js`: set `process.env.DB_PATH = ':memory:'` and a generated `MASTER_KEY` **before** requiring the app; start `createApp()` on port 0; use `fetch` and keep the `sid` cookie by hand. Create users and a node directly through the db module. Cover: health and config; login success, wrong password, unknown user (same body), lock after 5 failures; 401 without a session; 403 for the wrong role; teacher creates, renames and archives a class; a second teacher gets 404 on the first teacher's class; node assignment, takeover (`takenFrom` set) and unassign; student lists classes and joins; a valid scan (payload from `buildPayload` at the current time, location inside the radius) gives `OK_CHECK_IN`; an immediate second scan gives `ERR_TOO_SOON`; with `config.minGapMinutes = 0` the next gives `OK_CHECK_OUT`; each failure code (wrong code, unknown node, inactive node, not assigned, class mismatch, not joined, no location, low accuracy, outside geofence); with `config.geofence = false` location is ignored; every attempt has a `scan_attempts` row; a POST with a foreign `Origin` header gets 403; `GET /` returns HTML with the frontend on and JSON with it off; `/vendor/jsQR.js` returns 200.

## 12. Build in these stages. Stop after each, run `npm test`, and exercise what you built.
1. **Setup:** `package.json`, folders, `.gitignore`, `.env.example`, local `.env`, install, copy the verbatim files, write `totp.test.js` and `services.test.js`. `npm test` must pass.
2. **Server core:** `db.js`, `validate.js`, middleware, `app.js`, `server.js`. Check `node src/server.js --help`, `--frontend=off`, and `GET /api/health`.
3. **Auth and scripts:** auth routes, the four scripts. Check `npm run seed`, then log in with `curl`.
4. **Teacher, student and scan routes**, and `api.test.js`. All tests pass.
5. **Frontend:** all screens. Test in the browser at a 390 x 844 viewport: login for all three roles, the teacher flows, the student class list. Use the manual-code fallback with a payload from `npm run token` to test the scan result path end to end (set `--geofence=off` for desktop testing).
6. **README and review:** `README.md` with quick start (install, `.env`, seed, start, ngrok to the phone), the parameter table, the script usage, and a troubleshooting section (camera and location need HTTPS, iOS notes, ngrok warning page, clock must be UTC on the node). Then review your own work against sections 10 and 13 and report honestly what you ran, what passed, and anything you could not verify (the real camera, real GPS and the real PHY_NODE cannot be tested by you).

## 13. Acceptance checklist (I will run this)
1. `npm start` serves the app and API; `npm start -- --frontend off` serves only the API; `--help` lists every flag.
2. `npm run seed`; all three demo accounts log in; five wrong passwords lock an account.
3. Teacher creates, renames, archives a class and assigns `R101`; a second teacher cannot touch it.
4. Student selects the class and scans the real node inside the room: "Checked in". After the minimum gap: "Checked out". Immediately again: "too soon".
5. With geofence on, scanning from far away is refused; with `--geofence=off` it is accepted.
6. Works on a real iPhone and a real Android phone through ngrok (HTTPS).
7. `npm test` passes. `npm run token` output matches the real node's QR text.

## 14. Out of scope (do not build, do not block)
Passkeys and device binding, scan nonces, admin screens, attendance history and CSV export, log viewer, PWA install and service worker, node secret rotation, user import. Keep auth in one module and role checks in one middleware so these can be added later.

---
