# Software Requirements Specification: QR Attendance MVP
**Version:** MVP 1.0 · **Date:** 4 November 2026 · **Status:** Draft for hackathon
**Replaces for now:** `SRS_Backend.md` and `SRS_Frontend.md` (v3.0). Those remain the full-scope target. This document covers the first build only.

---

## 1. Introduction

### 1.1 Purpose
Specify the minimum working system: one Node.js process that serves a JSON API and a phone-friendly web app, so that students can mark attendance by scanning a PHY_NODE's QR code and teachers can manage their classes.

### 1.2 In scope
- Universal login (login ID and password) for Admin, Teacher and Student.
- **Student:** list classes, select one, allow location, scan the PHY_NODE QR, see the result (automatic check-in or check-out).
- **Teacher:** create, rename and archive classes; assign or unassign a PHY_NODE.
- Server startup parameters (toggles), including serving the frontend.
- Command-line scripts to create users and register PHY_NODEs (no admin screens).

### 1.3 Out of scope (deferred)
See section 7.

### 1.4 Definitions
| Term | Meaning |
|---|---|
| PHY_NODE | Fixed ESP32 device with OLED and DS3231 RTC that shows a rotating QR code. Works offline. |
| ROOM_ID (UID) | The node's identifier. Uppercase letters and digits, 1 to 16 characters. |
| Payload | QR content: `CODE:ROOM_ID`. `CODE` is 12 characters from `0-9A-Z`. |
| Step | 30-second window: `floor(unix_time / 30)`. |
| Geofence | Circle (node latitude, longitude, radius) inside which a scan is accepted. |

### 1.5 References
`docs/TOTP_VECTORS.md` (token algorithm and vectors), `phy_node/newAttendance.ino` (source of truth for the token).

---

## 2. Overall Description

### 2.1 System context
A single Node.js process (`npm start`) serves `/api` (JSON) and `/` (the web app). The PHY_NODE never contacts the server. It shows a code derived from its secret and its DS3231 time. The server holds the same secret and recomputes the code to verify scans.

### 2.2 Users
| Role | MVP capabilities |
|---|---|
| Student | Log in, list active classes, select a class (joins it), scan and check in or out. |
| Teacher | Log in, manage own classes, assign a PHY_NODE to a class. |
| Admin | Log in only. Administration is done with command-line scripts. |

### 2.3 Operating environment
- Server: Node.js 20 or later, SQLite file, on a laptop. Exposed to phones through an HTTPS tunnel (for example ngrok).
- Phones: Chrome on Android 10+, Safari on iOS 16+. Camera and location need HTTPS (or `localhost`).
- Teachers: any modern browser.

### 2.4 Constraints
- Plain JavaScript on the server (Express 4, SQLite). Plain HTML, CSS and ES modules on the client. No build step.
- The PHY_NODE token format and algorithm are fixed by the firmware and must not change.
- The firmware displays white modules on a black background, so the scanner must decode inverted codes.
- Attendance dates use a fixed UTC offset (default IST, +19800 s).

### 2.5 Assumptions
- Node RTCs hold UTC and are accurate to within a few seconds.
- Each PHY_NODE has its own secret, registered on the server with its coordinates.
- Students and teachers have accounts created by an administrator.

---

## 3. Functional Requirements

### 3.1 Server and startup parameters
| ID | Requirement |
|---|---|
| FR-SRV-01 | Starting the server shall need one command (`npm start`). |
| FR-SRV-02 | The server shall serve the web app from `public/` at `/` when `--frontend on` (default), and shall serve only the API when `--frontend off`. |
| FR-SRV-03 | The server shall support these parameters, each also settable in `.env`; flags override `.env`, `.env` overrides defaults: `--port` (3000), `--frontend on\|off` (on), `--geofence on\|off` (on), `--secure-cookies on\|off` (on), `--db` (`./data/attendance.db`, or `:memory:`), `--min-gap` minutes (5), `--max-accuracy` metres (50), `--tz-offset` seconds (19800), `--public-host`, `--help`. |
| FR-SRV-04 | `--help` shall print every parameter with its default and exit. |
| FR-SRV-05 | At startup the server shall print its effective settings (port, frontend, geofence, secure cookies, database, minimum gap). |
| FR-SRV-06 | The server shall refuse to start with a clear message if `MASTER_KEY` is missing or is not 32 bytes (base64). |
| FR-SRV-07 | The server shall create the database and tables on first start. |
| FR-SRV-08 | `GET /api/health` shall return the server time. `GET /api/config` shall return the geofence flag, the accuracy limit and the minimum gap. |
| FR-SRV-09 | The server shall serve the `jsqr` browser build at `/vendor/jsQR.js` from `node_modules`. |

### 3.2 Authentication
| ID | Requirement |
|---|---|
| FR-AUTH-01 | A user shall log in with login ID and password. |
| FR-AUTH-02 | A wrong password, an unknown login ID and a disabled account shall return the same error. |
| FR-AUTH-03 | After 5 consecutive failed attempts an account shall be locked for 15 minutes. |
| FR-AUTH-04 | A successful login shall create a session stored as a SHA-256 hash, delivered in an `HttpOnly`, `SameSite=Strict` cookie (with `Secure` unless disabled). Sessions expire after 8 hours without use. |
| FR-AUTH-05 | Logout shall delete the session on the server. |
| FR-AUTH-06 | `GET /api/me` shall return the logged-in user or `ERR_SESSION`. |
| FR-AUTH-07 | Every protected route shall check the session and the role on the server. |
| FR-AUTH-08 | State-changing requests whose `Origin` host differs from the request host (or `--public-host`) shall be refused. |

### 3.3 Teacher: manage classes
| ID | Requirement |
|---|---|
| FR-TCH-01 | A teacher shall see all of their own classes, including archived ones, with the assigned node (if any). |
| FR-TCH-02 | A teacher shall create a class with a name (1 to 80 characters) and an optional code (up to 20). |
| FR-TCH-03 | A teacher shall rename a class, change its code, and archive or restore it. |
| FR-TCH-04 | A teacher shall list the active PHY_NODEs, each with the class that currently uses it. |
| FR-TCH-05 | A teacher shall assign a node to one of their classes. If another class holds the node, it shall be taken over: the other class becomes unassigned and the response names it. The interface shall ask for confirmation first. |
| FR-TCH-06 | A teacher shall unassign the node from their class. |
| FR-TCH-07 | A teacher shall not read or change another teacher's class (`ERR_NOT_FOUND`). |
| FR-TCH-08 | A node shall belong to at most one class at a time. An archived class cannot receive a node. |

### 3.4 Student: attendance
| ID | Requirement |
|---|---|
| FR-STU-01 | A student shall see all active classes with the teacher's name and whether a node is linked. |
| FR-STU-02 | Selecting a class shall join it (idempotent) and open the scan screen for it. |
| FR-STU-03 | The scan screen shall ask for location permission on the student's tap and explain how to enable it if it is denied. |
| FR-STU-04 | The scan screen shall open the rear camera and decode QR codes continuously, including white-on-black codes. |
| FR-STU-05 | A decoded value that does not match `^[0-9A-Z]{12}:[0-9A-Z]{1,16}$` shall be ignored with a short hint. |
| FR-STU-06 | After a valid-looking code is read, the app shall read a fresh location and submit class, payload, latitude, longitude and accuracy. |
| FR-STU-07 | The student shall not choose check-in or check-out. The result shall show "Checked in" or "Checked out", the class name and the time. |
| FR-STU-08 | Every result code shall map to a plain-language message with a next step. |
| FR-STU-09 | The screen shall offer manual entry of the code text as a fallback when the camera is unavailable. |
| FR-STU-10 | The camera shall stop when the student leaves the screen, the page is hidden, or a result is shown. |

### 3.5 Scan verification
| ID | Requirement |
|---|---|
| FR-SCN-01 | Only a logged-in student may submit a scan. |
| FR-SCN-02 | The body shall be validated: class ID (positive integer), payload (string, at most 64 characters), latitude (-90 to 90), longitude (-180 to 180), accuracy (number, 0 or more). Latitude, longitude and accuracy are optional at this stage. |
| FR-SCN-03 | The payload shall be parsed as `CODE:ROOM_ID`. A malformed payload gives `ERR_QR_INVALID`. |
| FR-SCN-04 | The server shall look up the node and recompute the code for steps `n-1`, `n` and `n+1` from **server time**, comparing in constant time. An unknown node, an inactive node and a wrong code all give `ERR_QR_INVALID`. |
| FR-SCN-05 | The class shall exist and not be archived, the node shall be assigned to it (`ERR_NODE_NOT_ASSIGNED`, `ERR_CLASS_MISMATCH`), and the student shall have joined it (`ERR_NOT_JOINED`). |
| FR-SCN-06 | When geofence is on: location shall be present (`ERR_LOCATION_REQUIRED`), accuracy shall not exceed the limit (`ERR_LOW_ACCURACY`), and the haversine distance to the node shall not exceed the node's radius, default 35 m (`ERR_OUTSIDE_GEOFENCE`). When geofence is off, location is ignored but still logged if supplied. |
| FR-SCN-07 | Check-in or check-out shall be decided by the server: no accepted event today (or the last is a check-out) gives check-in; the last is a check-in at least `min-gap` minutes old gives check-out; otherwise `ERR_TOO_SOON`. |
| FR-SCN-08 | The attendance date shall be computed from server time and the configured offset. Client timestamps shall be ignored. |
| FR-SCN-09 | Every attempt, accepted or rejected, shall be recorded in `scan_attempts` with the result code, node, class, location, accuracy, distance and IP. Accepted scans shall also be recorded in `attendance_events`. |
| FR-SCN-10 | Scan and login routes shall be rate-limited to at least 300 requests per minute per IP address (a classroom may share one address). |

### 3.6 Operations (command line)
| ID | Requirement |
|---|---|
| FR-OPS-01 | `npm run seed` shall create demo users (admin, teacher, student), a demo node and a demo class, skipping anything that already exists, and print the demo credentials with a warning. |
| FR-OPS-02 | `npm run add-user` shall create a user from `--login`, `--name`, `--role`, `--password` (at least 8 characters). |
| FR-OPS-03 | `npm run add-node` shall register or update a node from `--uid`, `--secret` (64 hex characters) or `--generate`, `--lat`, `--lng`, optional `--radius` (default 35) and `--label`. A generated secret shall be printed once. |
| FR-OPS-04 | `npm run token` shall print the payloads for the previous, current and next step for `--uid` and `--secret` (and optional `--time`), so that a real node can be verified. |

---

## 4. Non-Functional Requirements

### 4.1 Security
| ID | Requirement |
|---|---|
| NFR-SEC-01 | Passwords shall be stored only as bcrypt hashes (cost 12). |
| NFR-SEC-02 | Node secrets shall be stored AES-256-GCM encrypted with `MASTER_KEY`, and shall never be returned by the API or logged. |
| NFR-SEC-03 | All SQL shall be parameterised. All input shall be validated. |
| NFR-SEC-04 | Error responses shall not contain stack traces or internal details. |
| NFR-SEC-05 | The server shall send security headers (Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, and a Permissions-Policy allowing camera and geolocation for the same origin). |
| NFR-SEC-06 | The client shall never write server data with `innerHTML`, and shall never use `localStorage` or `sessionStorage`. |
| NFR-SEC-07 | `.env` and the `data/` folder shall be excluded from version control. |

### 4.2 Usability and compatibility
| ID | Requirement |
|---|---|
| NFR-USA-01 | The interface shall be mobile-first and usable from 360 px wide screens, with touch targets of at least 44 x 44 px. |
| NFR-USA-02 | The interface shall follow the system light or dark theme and respect safe-area insets. |
| NFR-USA-03 | Messages shall be plain language and say what to do next. Colour shall not be the only status signal. |
| NFR-USA-04 | A first-time student shall be able to log in and complete a scan in under 2 minutes. |
| NFR-CMP-01 | The app shall work on Chrome (Android 10+), Safari (iOS 16+) and desktop Chrome or Edge. |

### 4.3 Performance and reliability
| ID | Requirement |
|---|---|
| NFR-PER-01 | A scan submission shall complete within 500 ms on the development laptop under normal load. |
| NFR-PER-02 | The server shall handle 60 scans in one minute. |
| NFR-REL-01 | Data shall survive restarts (SQLite WAL mode). |
| NFR-REL-02 | The decoder shall read a clearly shown code within about 1 second. |

### 4.4 Privacy
| ID | Requirement |
|---|---|
| NFR-PRV-01 | Location shall be read only during a scan, never continuously. The scan screen shall say so. |

---

## 5. Interfaces

### 5.1 REST API (all under `/api`, JSON)
Success `{ "ok": true, ... }`. Error `{ "ok": false, "error": "<CODE>", "message": "<text>" }`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | /health | public | Server time |
| GET | /config | public | Geofence flag, accuracy limit, minimum gap |
| POST | /auth/login | public | `{ loginId, password }` |
| POST | /auth/logout | any | End session |
| GET | /me | any | Current user |
| GET | /classrooms | student | Active classes with `joined` flag |
| POST | /classrooms/:id/join | student | Join (idempotent) |
| GET | /teacher/classrooms | teacher | Own classes |
| POST | /teacher/classrooms | teacher | `{ name, code? }` |
| PATCH | /teacher/classrooms/:id | teacher | `{ name?, code?, archived? }` |
| PUT | /teacher/classrooms/:id/node | teacher | `{ nodeUid }` (takeover allowed) |
| DELETE | /teacher/classrooms/:id/node | teacher | Unassign |
| GET | /nodes | teacher | Active nodes and who uses them |
| POST | /scan/submit | student | `{ classroomId, payload, lat?, lng?, accuracy? }` |

HTTP statuses: 400 validation and scan-rule errors, 401 `ERR_SESSION` and `ERR_LOGIN`, 403 `ERR_FORBIDDEN`, 404 `ERR_NOT_FOUND`, 429 `ERR_LOCKED` and `ERR_RATE_LIMITED`, 500 `ERR_SERVER`.

### 5.2 Result codes
| Code | Meaning |
|---|---|
| OK_CHECK_IN, OK_CHECK_OUT | Accepted |
| ERR_SESSION | Not logged in or session expired |
| ERR_QR_INVALID | Malformed payload, unknown or inactive node, or wrong or expired code |
| ERR_NODE_NOT_ASSIGNED | Node is not linked to any class |
| ERR_CLASS_MISMATCH | Node belongs to a different class |
| ERR_NOT_JOINED | Student has not joined the class |
| ERR_LOCATION_REQUIRED | Location missing (geofence on) |
| ERR_LOW_ACCURACY | Accuracy worse than the limit |
| ERR_OUTSIDE_GEOFENCE | Outside the node's radius |
| ERR_TOO_SOON | Second scan inside the minimum gap |
| ERR_RATE_LIMITED | Too many requests |

### 5.3 Data model (SQLite)
`users`, `sessions`, `phy_nodes`, `classrooms` (with a unique nullable `node_uid`), `enrollments`, `attendance_events` (with `att_date`), `scan_attempts`. The exact SQL is in `src/schema.sql`.

---

## 6. Acceptance Criteria
1. `npm start` serves the web app and API. `npm start -- --frontend off` serves only the API. `--help` lists every parameter.
2. All three demo accounts can log in. A wrong password gives the generic error, and five failures lock the account.
3. A teacher creates a class, renames it, assigns the demo node, and archives it. A second teacher cannot see or change it.
4. A student sees the class, selects it, grants location, scans the real PHY_NODE inside the room, and sees "Checked in".
5. A second scan after the minimum gap shows "Checked out". An immediate second scan shows the "too soon" message.
6. A scan far from the node is refused when geofence is on, and accepted when it is off.
7. A wrong or old code, a node linked to another class, and a class not joined each show the right message.
8. The scan works on a real iPhone and a real Android phone through the HTTPS tunnel.
9. `npm test` passes, including the token vectors in `docs/TOTP_VECTORS.md`.
10. `npm run token` output matches the QR shown by a real node (this verifies the firmware and server agree).

---

## 7. Deferred (v3.0 requirements not built in the MVP)
| Feature | Full-scope reference |
|---|---|
| Passkeys and device binding, device cookie | Backend FR-DEV, FR-AUTH-01 |
| One-time scan nonce | Backend FR-SCN-01, FR-SCN-10 |
| Admin screens (users, bindings, nodes, logs) | Frontend FR-ADM |
| Attendance view, student history, CSV export | Backend FR-ATT, Frontend FR-HIS, FR-TCH-06/07 |
| Audit log and log viewer | Backend FR-LOG |
| Node secret rotation, revoke and reactivate from the UI | Backend FR-NODE-05 to 07 |
| PWA install and service worker | Frontend FR-GEN-03 |
| User CSV import, forced password change | Backend FR-USR |

## 8. Open issues
1. Tune the 50 m accuracy limit and 35 m radius in the real rooms.
2. Confirm `min-gap` (5 minutes) and the IST day boundary.
3. Choose the ngrok domain and decide how to handle its first-visit warning page.
4. Verify the real node against `docs/TOTP_VECTORS.md` before relying on any scan result.
