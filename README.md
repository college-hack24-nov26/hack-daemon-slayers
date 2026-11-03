# QR-based Proof-of-Presence Attendance System
directory structure:
```
qr-attendance/
├── README.md              # setup and run instructions for all parts
├── .gitignore             # excludes .env, *.db, node_modules, build output
├── docs/
│   ├── API.md             # endpoints and result codes (from SRS_Backend §5)
│   ├── TOTP_VECTORS.md    # shared test vectors for the 12-digit TOTP
│   └── SRS/
│       ├── SRS_Backend.md
│       ├── SRS_Frontend.md
│       └── SRS_PHY_NODE.md
│
├── backend/               # Asus A
│   ├── .env.example       # template only, real .env is never committed
│   ├── requirements.txt   # or package.json if using Node
│   ├── app/
│   │   ├── main.py        # app startup, routers, middleware
│   │   ├── config.py      # reads environment variables
│   │   ├── db.py          # SQLite connection and session
│   │   ├── models/        # table definitions (users, devices, phy_nodes, ...)
│   │   ├── routers/
│   │   │   ├── auth.py          # login, logout, passkey endpoints
│   │   │   ├── classrooms.py    # teacher classroom management
│   │   │   ├── nodes.py         # admin PHY_NODE management
│   │   │   ├── scan.py          # nonce and scan submission
│   │   │   ├── attendance.py    # history, reports, CSV export
│   │   │   └── admin.py         # users, bindings, logs
│   │   ├── services/
│   │   │   ├── totp.py          # 12-digit TOTP (must match firmware)
│   │   │   ├── geofence.py      # haversine distance and radius check
│   │   │   ├── attendance_rules.py  # check-in/check-out decision (§3.7.1)
│   │   │   ├── secrets.py       # AES-GCM encrypt/decrypt of node secrets
│   │   │   └── audit.py         # audit and scan log writers
│   │   ├── security/
│   │   │   ├── passwords.py     # Argon2id/bcrypt hashing
│   │   │   ├── sessions.py      # cookies and CSRF
│   │   │   ├── rate_limit.py    # per-account and per-IP limits
│   │   │   └── rbac.py          # role checks used by routers
│   │   └── schemas/             # request and response validation
│   ├── migrations/              # schema change scripts
│   ├── scripts/
│   │   ├── create_admin.py      # bootstrap first admin account
│   │   ├── register_node.py     # generates UID and secret for a PHY_NODE
│   │   └── backup_db.py         # daily backup during the event
│   └── tests/
│       ├── test_totp.py         # checks against TOTP_VECTORS.md
│       ├── test_geofence.py
│       ├── test_attendance_rules.py
│       └── test_scan_flow.py
│
├── frontend/              # Asus B (PWA)
│   ├── package.json
│   ├── vite.config.js     # or equivalent build config
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   ├── service-worker.js    # caches the app shell only, never API data
│   │   └── icons/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── api/
│   │   │   ├── client.js        # fetch wrapper, CSRF header, error mapping
│   │   │   ├── auth.js
│   │   │   ├── scan.js
│   │   │   ├── classrooms.js
│   │   │   ├── nodes.js
│   │   │   └── admin.js
│   │   ├── auth/
│   │   │   ├── passkey.js       # WebAuthn register and login helpers
│   │   │   └── session.js       # session state and logout
│   │   ├── location/
│   │   │   └── geo.js           # high-accuracy location and error handling
│   │   ├── scanner/
│   │   │   └── scanner.js       # camera, decoding, PN1: prefix check
│   │   ├── messages/
│   │   │   └── resultCodes.js   # result code to plain-language message
│   │   ├── components/          # buttons, tables, banners, install hint
│   │   ├── screens/
│   │   │   ├── login/
│   │   │   ├── bind/            # Bind Device and Passkey Confirmation
│   │   │   ├── student/         # My Classrooms, Browse, Scan, History
│   │   │   ├── teacher/         # Classrooms, Attendance, Export
│   │   │   └── admin/           # Users, Bindings, Nodes, Logs
│   │   ├── routes/              # route table filtered by role
│   │   └── styles/
│   └── tests/
│
├── phy_node/              # ESP32 firmware
│   ├── platformio.ini     # or Arduino project file
│   ├── include/
│   │   └── config.h       # build-time settings (no secrets here)
│   ├── src/
│   │   ├── main.cpp       # boot, watchdog, main loop
│   │   ├── time_sync.cpp  # NTP and RTC handling
│   │   ├── totp.cpp       # same algorithm as backend/services/totp.py
│   │   ├── display.cpp    # QR rendering and status screens
│   │   ├── qr.cpp         # builds PN1:<UID>:<CODE>
│   │   ├── nvs_store.cpp  # UID, secret, Wi-Fi credentials in NVS
│   │   └── provision.cpp  # serial provisioning
│   ├── test/
│   │   └── test_totp.cpp  # runs the same TOTP_VECTORS.md cases
│   └── tools/
│       └── provision.py   # sends the provisioning string over USB
│
└── tools/
    └── qr_preview.html    # optional: renders a QR for display testing
```
