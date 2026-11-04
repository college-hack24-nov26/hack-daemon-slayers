# QR Attendance MVP

A clean, single-process web application and JSON API for marking physical classroom attendance using rotating QR codes shown on offline embedded PHY_NODEs (ESP32 + OLED + DS3231).

---

## 1. Quick Start

### Prerequisites
- Node.js 20 or later (tested on Node 20, 22, and 26)
- npm

### Installation
```bash
git clone <repo-url>
cd qr-attendance
npm install
```

### Environment Configuration
Create a `.env` file with a freshly generated 32-byte base64 `MASTER_KEY`:
```bash
node -e "console.log('MASTER_KEY=' + require('crypto').randomBytes(32).toString('base64'))" >> .env
```
Copy other defaults as needed from `.env.example`:
```bash
cat << 'EOF' >> .env
PORT=3000
SERVE_FRONTEND=on
GEOFENCE=on
SECURE_COOKIES=on
DB_PATH=./data/attendance.db
MIN_GAP_MINUTES=5
MAX_ACCURACY_M=50
TZ_OFFSET_SECONDS=19800
PUBLIC_HOST=
EOF
```

### Seed Demo Data
Populates demo users (`admin`, `teacher1`, `student1`), an active PHY_NODE (`R101`), and a demo class:
```bash
npm run seed
```

Default credentials:
- **Admin**: `admin` / `admin123`
- **Teacher**: `teacher1` / `teacher123`
- **Student**: `student1` / `student123`

### Start Server
Run the web application and API on port 3000:
```bash
npm start
```
To run API-only mode without serving the frontend:
```bash
npm run start:api
# or: npm start -- --frontend off
```

### Exposing to Phones (ngrok)
To allow students and teachers to access the application securely on their phones:
1. Start an HTTPS tunnel with ngrok:
   ```bash
   ngrok http 3000
   ```
2. Note your ngrok domain (e.g. `abc-123.ngrok-free.app`).
3. Set `PUBLIC_HOST` in `.env` or pass `--public-host abc-123.ngrok-free.app` so cross-origin checks accept tunnel requests.
4. Open the HTTPS URL on your phone's browser.

---

## 2. Server Startup Parameters

Command-line flags override `.env` values, which in turn override defaults:

| Flag | `.env` Key | Default | Description |
|---|---|---|---|
| `--port <n>` | `PORT` | `3000` | HTTP port |
| `--frontend on\|off` | `SERVE_FRONTEND` | `on` | Serve web app from `public/` at `/` |
| `--geofence on\|off` | `GEOFENCE` | `on` | Enforce location radius and accuracy on scans |
| `--secure-cookies on\|off` | `SECURE_COOKIES` | `on` | Set the `Secure` attribute on cookies |
| `--db <path>` | `DB_PATH` | `./data/attendance.db` | SQLite database file or `:memory:` |
| `--min-gap <min>` | `MIN_GAP_MINUTES` | `5` | Minimum gap in minutes between check-in and check-out |
| `--max-accuracy <m>` | `MAX_ACCURACY_M` | `50` | Maximum acceptable GPS accuracy in metres |
| `--tz-offset <s>` | `TZ_OFFSET_SECONDS` | `19800` | Attendance day boundary offset from UTC (19800s = IST) |
| `--public-host <host>` | `PUBLIC_HOST` | `""` | Additional allowed Origin host (e.g. ngrok hostname) |
| `--help` | — | — | Print usage and exit |

---

## 3. CLI Scripts

All scripts connect directly to the SQLite database using `src/config.js` and `src/db.js`:

### `npm run seed`
Idempotent script to insert initial demo accounts and room node:
```bash
npm run seed
# Optional arguments: --secret <64 hex> --lat <float> --lng <float> --radius <metres>
```

### `npm run add-user`
Add a new user to the database:
```bash
npm run add-user -- --login student2 --name "Alice Smith" --role student --password student_pass123
```
Roles allowed: `admin`, `teacher`, `student`. Passwords must be at least 8 characters.

### `npm run add-node`
Register or update a classroom PHY_NODE:
```bash
# Register with an existing secret
npm run add-node -- --uid R102 --secret 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --lat 19.0760 --lng 72.8777 --radius 35 --label "Room 102"

# Or generate a new random secret (printed once to configure in firmware)
npm run add-node -- --uid R103 --generate --lat 19.0760 --lng 72.8777
```

### `npm run token`
Verify the real PHY_NODE device clock and token against the server algorithm:
```bash
npm run token -- --uid R101 --secret 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```
Prints the step windows (`n-1`, `n`, `n+1`) with their ISO UTC timestamps and payload strings (`CODE:ROOM_ID`).

---

## 4. Tests
Run all unit and integration tests using Node's built-in test runner:
```bash
npm test
```
The test suite covers:
- RFC 4231 HMAC-SHA256 test cases
- PHY_NODE token vectors matching `docs/TOTP_VECTORS.md` and `phy_node/newAttendance.ino`
- AES-256-GCM secret encryption and tampering detection
- Haversine geofence calculations (equator, anti-meridian, radius thresholds)
- Attendance state transitions and IST date boundary handling
- Complete API integration: authentication, 5-strike account lockout, role isolation, classroom CRUD, node takeover, scan verification pipeline (all error codes), geofence bypass toggles, and CSRF origin protection.

---

## 5. Troubleshooting & Operational Notes

- **Camera & Geolocation Permissions**: Modern browsers (especially Safari on iOS and Chrome on Android) strictly require a secure context (`HTTPS` or `localhost`) to access the camera or GPS. When testing on a physical phone, you must access the app through an HTTPS tunnel (e.g. ngrok).
- **iOS Safari Notes**: Audio/video streams and geolocation require explicit user interaction to trigger permission prompts. The "Start scan" button serves as this user gesture.
- **ngrok Interstitial Page**: If using a free ngrok account, the first visit from a browser displays a warning page. Click "Visit Site" once to proceed to the application.
- **Node Clock Synchronization**: The PHY_NODE DS3231 RTC must be set to UTC time. The server accepts `step - 1`, `step`, and `step + 1` (a ±30 second grace window), so verify that the node's RTC and the server clock are synchronized within ~20 seconds.
- **Manual Fallback**: If a phone's camera fails or permissions are denied, the student can use the "Camera not working? Enter code manually" fallback on the scan screen to submit the code.
