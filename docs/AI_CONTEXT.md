# AI Context: QR Attendance MVP

Read this first and follow it. If a request conflicts with it, say so instead of guessing.
Requirements: `docs/SRS/SRS_MVP.md`. Token vectors: `docs/TOTP_VECTORS.md`. Full-scope (post-MVP) requirements: `docs/SRS/SRS_Backend.md` and `SRS_Frontend.md` (v3.0).

## What this is
Students mark attendance by scanning a QR code shown on a **PHY_NODE** (ESP32 + OLED + DS3231, works offline) fixed in a classroom. The code changes every 30 seconds. The server checks the code, the classroom, the student's location and timing, then records a check-in or check-out automatically.

MVP scope: universal **login**, **student attendance** (pick class, allow location, scan QR), **teacher class management** (create, rename, archive, assign a PHY_NODE). Everything else is deferred (see "Not in the MVP").

## Stack
Node 20+ (works on 22), plain JavaScript (CommonJS), **Express 4**, SQLite through `better-sqlite3`, `bcryptjs@2`, `cookie-parser`, `helmet`, `express-rate-limit`, `dotenv`, `jsqr`. Tests use the built-in `node:test`. Frontend is plain HTML, CSS and ES modules in `public/` (no framework, no bundler). One process serves both the API (`/api`) and the web app (`/`).

## Directory
```
package.json  .env.example  .gitignore  README.md
docs/            AI_CONTEXT.md, SRS/, TOTP_VECTORS.md   (do not restructure)
phy_node/        newAttendance.ino                       (read-only reference)
data/            SQLite file (git-ignored)
scripts/         seed.js, add-user.js, add-node.js, token.js
src/             server.js, app.js, config.js, db.js, schema.sql, validate.js
  middleware/    auth.js, origin.js, errors.js
  routes/        auth.js, student.js, teacher.js, scan.js
  services/      totp.js, crypto.js, geofence.js, attendance.js
public/          index.html, styles.css
  js/            main.js, api.js, ui.js, messages.js
  js/views/      login.js, student.js, scan.js, teacher.js, admin.js
tests/           totp.test.js, services.test.js, api.test.js
```

## Startup parameters (flags override `.env`, `.env` overrides defaults)
`--port`, `--frontend on|off`, `--geofence on|off`, `--secure-cookies on|off`, `--db <path|:memory:>`, `--min-gap <min>`, `--max-accuracy <m>`, `--tz-offset <s>`, `--public-host <host>`, `--help`. Defined only in `src/config.js`. Code reads these values **at request time** (never cached at import) so tests can change them.

## The PHY_NODE token (normative; matches the firmware; never change)
`step = floor(unix/30)`; message `ROOM_ID:step`; key = 32 bytes from the 64-hex secret; `h = HMAC-SHA256`; `off = h[31] % 24`; 64-bit value from `h[off]&0x7F, h[off+1..off+7]`; 12 base-36 digits; payload `CODE:ROOM_ID` (example `3YBMBMJTZIO8:R101`). Implemented once in `src/services/totp.js`. The server accepts steps `n-1`, `n`, `n+1` from **server time**, compared with `crypto.timingSafeEqual`. The frontend never computes or validates a code; it only checks `^[0-9A-Z]{12}:[0-9A-Z]{1,16}$` and forwards the payload.

## Scan verification order (server)
1. Student session. 2. Body validation. 3. Payload format. 4. Node exists and is active, then code check. Unknown node, inactive node and wrong code all return `ERR_QR_INVALID`. 5. Classroom exists and is not archived; the node is assigned to it (`ERR_NODE_NOT_ASSIGNED`, `ERR_CLASS_MISMATCH`); the student joined it (`ERR_NOT_JOINED`). 6. If geofence is on: location present (`ERR_LOCATION_REQUIRED`), accuracy at most the limit (`ERR_LOW_ACCURACY`), distance at most the node radius (`ERR_OUTSIDE_GEOFENCE`). 7. Check-in/out rule. 8. Record. Every attempt, accepted or rejected, is written to `scan_attempts`.

**Check-in/out is automatic.** Latest accepted event for this student, classroom and date (default IST): none or a check-out gives check-in; a check-in at least `min-gap` minutes old gives check-out; otherwise `ERR_TOO_SOON`. The client never chooses.

## Result codes
`OK_CHECK_IN`, `OK_CHECK_OUT`, `ERR_SESSION`, `ERR_QR_INVALID`, `ERR_NODE_NOT_ASSIGNED`, `ERR_CLASS_MISMATCH`, `ERR_NOT_JOINED`, `ERR_LOCATION_REQUIRED`, `ERR_LOW_ACCURACY`, `ERR_OUTSIDE_GEOFENCE`, `ERR_TOO_SOON`, `ERR_RATE_LIMITED`. Others: `ERR_LOGIN`, `ERR_LOCKED`, `ERR_FORBIDDEN`, `ERR_NOT_FOUND`, `ERR_BAD_REQUEST`, `ERR_SERVER`.

## Hard rules
- Every API route is under `/api`. The server checks session **and role** on every route.
- JSON only. Success `{ "ok": true, ... }`. Errors `{ "ok": false, "error": "<CODE>", "message": "<plain text>" }`. Never return stack traces.
- Passwords: bcryptjs, cost 12. Sessions: random 32-byte token in a cookie `sid` (`HttpOnly`, `SameSite=Strict`, `Secure` unless `--secure-cookies off`); only the SHA-256 of the token is stored; 8 hours idle expiry.
- Unknown login ID and wrong password return the same error; still run a dummy bcrypt compare for unknown IDs. Lock an account for 15 minutes after 5 failed attempts.
- State-changing requests are rejected if an `Origin` header is present and its host is not the request host (or `--public-host`).
- SQL is parameterised only. Inputs are validated with small helpers in `src/validate.js`.
- Node secrets are stored AES-256-GCM encrypted with `MASTER_KEY`. Never log passwords, session tokens or secrets. Never commit `.env` or `data/`.
- Frontend: never put server data into `innerHTML` (use `textContent`); never use `localStorage` or `sessionStorage`; all requests use `fetch` with same-origin credentials.
- Rate limits must tolerate a classroom behind one IP address (at least 300 requests per minute per IP).

## Not in the MVP (do not build, do not block)
Passkeys and device binding, scan nonces, admin screens, attendance history and CSV export, log viewer, PWA install and service worker, node secret rotation. Keep auth in one module and role checks in one middleware so these can be added later.

## Working method
One stage at a time. Run `npm test` and exercise the feature before moving on. Treat security-sensitive code (auth, sessions, scan verification, encryption) as a draft until a person has read it. If something is not covered here, ask.
