# Software Requirements Specification: Backend API Server
**Project:** QR Attendance System (Backend)
**Version:** 3.0
**Date:** 3 November 2026
**Status:** Draft for hackathon
**Related document:** `SRS_Frontend.md`

| Version | Change |
|---|---|
| 1.0 | Initial draft. Python, passkey login, student QR shown on phone. |
| 2.0 | PHY_NODE displays the rotating code. Roles, classrooms, geofence, automatic check-in/out. |
| 3.0 | Node.js (JavaScript) backend, SQLite database, ngrok stable HTTPS hostname, TOTP and payload formats aligned to the PHY_NODE firmware (`newAttendance.ino`), passkeys as the student authentication factor, backend served as an API with the PWA on the same origin. |

---

## 1. Introduction

### 1.1 Purpose
This document specifies the backend API for the QR attendance system. The backend authenticates users (passkeys for students, passwords for teachers and admins), manages classrooms and PHY_NODEs, verifies scans, applies geofencing and automatic check-in/check-out, and records attendance.

### 1.2 Scope
In scope:
- Authentication, sessions and role-based access.
- Device binding for students through WebAuthn passkeys.
- PHY_NODE registration, geofence storage and secret management.
- Classroom management and node assignment.
- Scan verification (TOTP, device, classroom, location, timing).
- Attendance history, CSV export and audit logs.
- Serving the PWA static files on the same origin.

Out of scope: PHY_NODE firmware (the device works offline and is not modified by this document), native mobile apps, and cloud hosting.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| PHY_NODE | Fixed ESP32 device with an OLED and a DS3231 RTC that displays a rotating QR code |
| ROOM_ID (node UID) | Identifier of a PHY_NODE, used in the code and the QR payload |
| Secret | 32-byte key shared between one PHY_NODE and the backend |
| Step | 30-second time window, `floor(unix_time / 30)` |
| Nonce | Single-use random value issued for one scan attempt |
| Geofence | Circle around a PHY_NODE within which a scan is accepted |
| RP ID | WebAuthn relying party identifier, here the ngrok hostname |
| Passkey | WebAuthn credential unlocked by biometrics or screen lock |

### 1.4 References
- RFC 2104 (HMAC), RFC 4231 (HMAC-SHA-256 test vectors)
- W3C Web Authentication Level 2
- OWASP Authentication and Session Management Cheat Sheets

---

## 2. Overall Description

### 2.1 Product Perspective
Three parts interact:
1. **PWA** on phones and browsers, served by the backend.
2. **Backend API** (this document), running on a development laptop and exposed through an ngrok HTTPS tunnel.
3. **PHY_NODE** devices, fixed in rooms. They work offline: they compute their codes from the DS3231 time and never contact the backend. The backend recomputes the same codes from the shared secret to verify scans.

### 2.2 Roles and Permissions
| Capability | Admin | Teacher | Student |
|---|---|---|---|
| Manage users, reset passwords, enable/disable | Yes | No | No |
| List device bindings, revoke a binding | Yes | No | No |
| Register PHY_NODEs, set coordinates and radius, revoke, rotate secret | Yes | No | No |
| List PHY_NODEs | Yes | Yes | No |
| Create, edit, archive own classrooms | Any | Own | No |
| Assign or unassign a PHY_NODE to a classroom | Any | Own classrooms | No |
| Join or leave classrooms | No | No | Yes |
| Scan to check in or out | No | No | Yes |
| Own attendance history | No | No | Yes |
| Classroom attendance and CSV export | All | Own classrooms | No |
| Audit log, scan log, attendance log | Yes | No | No |

### 2.3 Operating Environment
- Node.js 20 LTS, Express, SQLite (single file, WAL mode) through `better-sqlite3`.
- Hosted on a development laptop (Windows) during the event.
- HTTPS through ngrok with a reserved static domain. This hostname is the RP ID and must not change once any student has bound a device.
- Clock: the server runs NTP-synchronised system time. Scan decisions use server time only.

### 2.4 Design Constraints
- **Stable hostname.** Passkeys are bound to the RP ID. The ngrok reserved domain must be set before any binding happens, and must be the same in `.env`.
- **Single origin.** The backend serves the PWA's static files and the API from the same origin. Cookies are then `SameSite=Strict` and no CORS is needed.
- **Laptop must stay on.** If the laptop sleeps or ngrok stops, scans fail. The device must be set not to sleep during the event.
- **Low-cost, offline nodes.** A node cannot be updated remotely, so any change to a node's secret or coordinates is an admin action with a physical step.
- **Shared networks.** Many students share one IP address through the campus Wi-Fi, so per-IP limits must be generous.

### 2.5 Assumptions
- Students' phones support passkeys and have a screen lock or biometrics.
- Accounts are created by an admin, including CSV import. There is no self-registration.
- The PHY_NODE RTC is set correctly during installation, and its clock drifts less than about 10 seconds per day.

---

## 3. Functional Requirements

### 3.1 Authentication and Sessions
| ID | Requirement |
|---|---|
| FR-AUTH-01 | Students shall log in with a login ID and password, then confirm with a passkey assertion. A session is issued only after the passkey step succeeds. |
| FR-AUTH-02 | Teachers and admins shall log in with a login ID and password. |
| FR-AUTH-03 | Passwords shall be stored only as salted Argon2id (or bcrypt) hashes. |
| FR-AUTH-04 | Sessions shall use a random token in a cookie with `HttpOnly`, `Secure` and `SameSite=Strict`. The server stores only a hash of the token. Sessions expire after 8 hours of inactivity. |
| FR-AUTH-05 | State-changing requests shall require a CSRF token bound to the session. |
| FR-AUTH-06 | An account shall be locked for 15 minutes after 5 consecutive failed password attempts. |
| FR-AUTH-07 | Every endpoint shall check the session and the role on the server. |
| FR-AUTH-08 | Logout shall delete the session on the server. |
| FR-AUTH-09 | Users shall be able to change their own password. |
| FR-AUTH-10 | A session shall be invalidated when its user is disabled or its student device binding is revoked. |

### 3.2 Student Passkeys and Device Binding
| ID | Requirement |
|---|---|
| FR-DEV-01 | After a correct password, a student with no active binding shall receive WebAuthn registration options (`residentKey: required`, `userVerification: required`). |
| FR-DEV-02 | On successful registration the server shall store the credential ID, public key, signature counter, creation time and a hash of a device cookie (see FR-DEV-06). |
| FR-DEV-03 | Each student shall have at most one active binding. A second registration attempt is rejected until an admin revokes the first. |
| FR-DEV-04 | Login for a bound student shall require an assertion for the bound credential with user verification. The assertion challenge shall be random, single-use and expire after 60 seconds. |
| FR-DEV-05 | The server shall verify the origin and RP ID on every ceremony. |
| FR-DEV-06 | The server shall set a long-lived `HttpOnly`, `Secure` device cookie at binding time and require it at login. This limits the account to the bound browser profile, because passkeys can sync through the platform cloud. |
| FR-DEV-07 | If the stored counter is non-zero and the received counter is not greater, the login shall be rejected and logged. |
| FR-DEV-08 | A revoked binding shall be unable to log in or scan. |
| FR-DEV-09 | Binding, revocation and rejected logins shall be audit-logged. |

### 3.3 User Management (Admin)
| ID | Requirement |
|---|---|
| FR-USR-01 | Admins shall create, edit, enable, disable users and assign roles (Admin, Teacher, Student). |
| FR-USR-02 | Student accounts shall hold name, roll number and login ID. |
| FR-USR-03 | Admins shall reset passwords. A reset password shall be changed at the next login. |
| FR-USR-04 | Admins shall import users from a CSV file with validation and a per-row error report. |
| FR-USR-05 | Admins shall list device bindings and revoke them. |

### 3.4 PHY_NODE Management (Admin)
| ID | Requirement |
|---|---|
| FR-NODE-01 | Admins shall register a PHY_NODE with a UID, a label, a room description, latitude, longitude and radius. |
| FR-NODE-02 | The UID shall be 1 to 16 characters from `A-Z` and `0-9`, unique, and shall not contain `:`. The UID is the ROOM_ID programmed into the node. |
| FR-NODE-03 | On registration the server shall generate a random 32-byte secret and display it once as 64 hexadecimal characters for the admin to copy into the node's firmware. The secret shall be stored encrypted (FR-SEC-03). |
| FR-NODE-04 | The default radius shall be 35 m. The admin may set any value from 10 m to 100 m. |
| FR-NODE-05 | Admins shall update a node's coordinates and radius. Every change shall be audit-logged with the old and new values. |
| FR-NODE-06 | Admins shall revoke and reactivate a node. Scans for a revoked node shall be rejected. |
| FR-NODE-07 | Admins shall rotate a node's secret. The old secret shall stop working immediately, and the node must be reprogrammed physically. |
| FR-NODE-08 | The node list shall show UID, status, coordinates, radius, assigned classroom and the time of the last accepted scan. |
| FR-NODE-09 | A PHY_NODE shall be assigned to at most one classroom at a time. |

### 3.5 Classroom Management (Teacher)
| ID | Requirement |
|---|---|
| FR-CLS-01 | Teachers shall create classrooms with a name and optional code and description. |
| FR-CLS-02 | Teachers shall edit and archive only their own classrooms. |
| FR-CLS-03 | Teachers shall assign a PHY_NODE to a classroom by UID or by choosing from the active node list. |
| FR-CLS-04 | If the node is already assigned to another classroom, the new assignment takes it over. The previous classroom is left unassigned. Both changes are audit-logged, and the teacher is warned before confirming. |
| FR-CLS-05 | Teachers shall unassign a node from their own classroom. |
| FR-CLS-06 | Admins shall view all classrooms and unassign any node. |
| FR-CLS-07 | Assignment history shall record classroom, node, start, end and the user who made each change. |

### 3.6 Joining Classrooms (Student)
| ID | Requirement |
|---|---|
| FR-ENR-01 | Students shall list active classrooms and join any of them without approval. |
| FR-ENR-02 | Students shall leave classrooms. Leaving shall not delete attendance history. |
| FR-ENR-03 | Teachers shall view the list of students who joined their classroom. |

### 3.7 PHY_NODE Code Specification (normative)
The backend shall reproduce exactly the code produced by the PHY_NODE firmware (`newAttendance.ino`, function `computeToken`). Any change must be made in both places and verified against the shared test vectors (`docs/TOTP_VECTORS.md`).

1. **Step:** `step = floor(utc / 30)`, where `utc` is the Unix time in seconds.
2. **Message:** the ASCII string `ROOM_ID + ":" + step`, with `step` in decimal and no leading zeros.
3. **Key:** the 32 bytes obtained by decoding the 64-hex-character secret.
4. **MAC:** `HMAC-SHA256(key, message)`, producing 32 bytes `h[0..31]`.
5. **Offset:** `off = h[31] mod 24`.
6. **Binary value:** `v = h[off] & 0x7F` (most significant byte), followed by `h[off+1] .. h[off+7]`, read big-endian as a 64-bit unsigned integer.
7. **Code:** 12 base-36 digits, uppercase `0-9A-Z`, most significant digit first, obtained by repeated division of `v` by 36 starting with the least significant digit. Because only 12 digits are produced, the value is effectively `v mod 36^12`.
8. **Token (QR payload):** `CODE + ":" + ROOM_ID`, for example `7K2M9XQ1ZP4A:R101`.

**Verification of a scanned payload**
- Split the payload at the first `:`. The left part shall match `^[0-9A-Z]{12}$`, and the right part shall be a valid UID that exists in the node table.
- The server looks up the node's secret, computes the expected codes for `step - 1`, `step` and `step + 1` (step taken from server time), and compares them with the submitted code using a constant-time comparison.
- A match in any of the three steps is accepted. Each accepted code is logged with its step number so that replays inside the window are visible.

### 3.8 Scan and Attendance
| ID | Requirement |
|---|---|
| FR-SCN-01 | A bound, logged-in student shall request a nonce before scanning. The nonce is 128-bit random, bound to the student's session, valid for 60 seconds and usable once. |
| FR-SCN-02 | A scan submission shall contain: nonce, classroom ID, QR payload, latitude, longitude and accuracy in metres. |
| FR-SCN-03 | The payload shall be checked against the format in FR-SCN-04 before any database lookup. |
| FR-SCN-04 | The payload shall be parsed and verified according to section 3.7. |
| FR-SCN-05 | Unknown UID, revoked node and wrong code shall all return the same external error, `ERR_QR_INVALID`. The real reason is logged internally. |
| FR-SCN-06 | The node shall be assigned to the submitted classroom, and the student shall have joined that classroom. Otherwise the scan is rejected (`ERR_CLASS_MISMATCH`, `ERR_NODE_NOT_ASSIGNED`, `ERR_NOT_JOINED`). |
| FR-SCN-07 | Location is mandatory. A submission without a location is rejected (`ERR_LOCATION_REQUIRED`). |
| FR-SCN-08 | The distance from the submitted position to the node's coordinates is computed with the haversine formula. A distance above the node's radius is rejected (`ERR_OUTSIDE_GEOFENCE`). |
| FR-SCN-09 | A reported accuracy worse than 50 m is rejected (`ERR_LOW_ACCURACY`). The limit is configurable. |
| FR-SCN-10 | A nonce is consumed by the first submission that uses it, whether the scan succeeds or fails. |
| FR-SCN-11 | Server time is the only time used for decisions. Client timestamps are not trusted. |
| FR-SCN-12 | Check-in or check-out is decided automatically (rule in 3.8.1). The student cannot choose. |
| FR-SCN-13 | Every attempt, accepted or rejected, is written to the scan log with result code, node, classroom, step, location, accuracy, distance, IP address and user agent. |
| FR-SCN-14 | Scan submissions are rate-limited per student (10 per minute) and per IP address (300 per minute). |

#### 3.8.1 Automatic check-in and check-out
For a valid scan by student S for classroom C at time t, with attendance date d in the configured time zone:
1. Find S's latest accepted event for C on date d.
2. If there is none, or the latest is a check-out, record a **check-in**.
3. If the latest is a check-in and at least `MIN_GAP` (default 5 minutes) has passed, record a **check-out**.
4. Otherwise reject with `ERR_TOO_SOON`.

A check-in without a later check-out at the end of day d is reported as `NO_CHECKOUT`. The system never invents a check-out time.

### 3.9 Attendance History and Export
| ID | Requirement |
|---|---|
| FR-ATT-01 | Students shall view their own history, filtered by classroom and date range, with check-in and check-out times. |
| FR-ATT-02 | A student is **present** for a classroom on a date if at least one check-in was accepted that day. |
| FR-ATT-03 | Teachers shall view, for a date or range, present students and joined students with no check-in (absent). |
| FR-ATT-04 | Teachers and admins shall export CSV (UTF-8 with header row). The daily summary has: date, classroom, student ID, name, status (`PRESENT`, `ABSENT`, `NO_CHECKOUT`), first check-in, last check-out, duration in minutes. A raw event export is also available. |
| FR-ATT-05 | Teachers shall access only their own classrooms. Admins shall access all. |
| FR-ATT-06 | Students shall have no export function. |

### 3.10 Logs (Admin)
| ID | Requirement |
|---|---|
| FR-LOG-01 | The audit log shall record logins (success and failure), user changes, bindings, node registration and changes, secret rotation and classroom-node assignments. |
| FR-LOG-02 | The scan log shall be viewable by admins. |
| FR-LOG-03 | Logs shall be filterable by type, user, node and date, and exportable as CSV. |
| FR-LOG-04 | No function shall edit or delete log entries. |
| FR-LOG-05 | Stored scan coordinates shall be removed after 90 days. Attendance keeps only the distance. |

### 3.11 Static Hosting
| ID | Requirement |
|---|---|
| FR-WEB-01 | The backend shall serve the built PWA from the same origin as the API under `/`, with the API under `/api`. |
| FR-WEB-02 | The backend shall serve the web app manifest and service worker with correct content types. |

---

## 4. Non-Functional Requirements

### 4.1 Security
| ID | Requirement |
|---|---|
| NFR-SEC-01 | All traffic shall use HTTPS through ngrok. The server shall refuse requests whose `Host` header is not the configured hostname. |
| NFR-SEC-02 | Secrets (session pepper, master key, database path) shall be in a `.env` file excluded from version control. |
| NFR-SEC-03 | PHY_NODE secrets shall be encrypted at rest with AES-256-GCM using the master key, because the server must read them to compute codes. |
| NFR-SEC-04 | All SQL shall use parameterised statements. |
| NFR-SEC-05 | Inputs shall be validated against schemas before use. |
| NFR-SEC-06 | CSV export shall neutralise formula injection by prefixing cells that begin with `=`, `+`, `-` or `@`. |
| NFR-SEC-07 | Error responses shall not include stack traces. |
| NFR-SEC-08 | The server shall send `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options` and `Referrer-Policy` headers. |
| NFR-SEC-09 | Security-relevant events shall never be logged with passwords, session tokens, nonces or secrets. |

### 4.2 Performance
| ID | Requirement |
|---|---|
| NFR-PER-01 | A scan submission shall complete within 500 ms under normal load. |
| NFR-PER-02 | The server shall handle 60 scans in one minute from one classroom without errors. |
| NFR-PER-03 | The server shall support 50 concurrent logged-in users. |

### 4.3 Reliability and Time
| ID | Requirement |
|---|---|
| NFR-REL-01 | Attendance and audit data shall survive restarts (SQLite WAL mode). |
| NFR-REL-02 | The database shall be backed up every hour during the event to a separate folder, using SQLite's online backup. |
| NFR-REL-03 | The server shall log a warning when its clock differs from NTP by more than 2 seconds. |
| NFR-REL-04 | The server shall restart automatically after a crash (process manager). |

### 4.4 Privacy
| ID | Requirement |
|---|---|
| NFR-PRV-01 | Location is collected only during a scan and never continuously. |
| NFR-PRV-02 | Students shall be told that location is used for attendance verification. |
| NFR-PRV-03 | Only data needed for attendance and authentication shall be stored. |

### 4.5 Maintainability
| ID | Requirement |
|---|---|
| NFR-MNT-01 | The API shall be documented in `docs/API.md` and kept in sync with the code. |
| NFR-MNT-02 | `docs/TOTP_VECTORS.md` shall contain test vectors (secret, UTC time, ROOM_ID, expected token). The backend test suite and the firmware output must match them. |
| NFR-MNT-03 | Schema changes shall be migration scripts. |

---

## 5. External Interfaces

### 5.1 REST API (summary)
Base path `/api`. Request and response bodies are JSON.

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| POST | /auth/login | Password login | Any |
| POST | /auth/logout | End session | Any |
| POST | /auth/passkey/register/options | Start binding | Student (after password) |
| POST | /auth/passkey/register/verify | Complete binding | Student (after password) |
| POST | /auth/passkey/login/options | Start passkey login | Student (after password) |
| POST | /auth/passkey/login/verify | Complete passkey login | Student (after password) |
| POST | /auth/password/change | Change own password | Any |
| GET | /classrooms | List active classrooms | Student |
| POST / DELETE | /classrooms/{id}/join | Join or leave | Student |
| GET | /me/classrooms | Joined classrooms | Student |
| POST | /scan/nonce | Issue a nonce | Student |
| POST | /scan/submit | Submit a scan | Student |
| GET | /me/attendance | Own history | Student |
| GET / POST / PATCH | /teacher/classrooms | Manage own classrooms | Teacher |
| GET | /nodes | Active nodes | Teacher, Admin |
| PUT / DELETE | /teacher/classrooms/{id}/node | Assign or unassign node | Teacher |
| GET | /teacher/classrooms/{id}/attendance | Attendance view | Teacher |
| GET | /teacher/classrooms/{id}/attendance.csv | Export | Teacher |
| GET / POST / PATCH | /admin/users | Manage users | Admin |
| POST | /admin/users/{id}/reset-password | Reset password | Admin |
| POST | /admin/users/import | CSV import | Admin |
| GET | /admin/devices | List bindings | Admin |
| POST | /admin/devices/{id}/revoke | Revoke binding | Admin |
| GET / POST | /admin/nodes | List or register nodes | Admin |
| PATCH | /admin/nodes/{uid} | Update coordinates or radius | Admin |
| POST | /admin/nodes/{uid}/revoke | Revoke node | Admin |
| POST | /admin/nodes/{uid}/reactivate | Reactivate node | Admin |
| POST | /admin/nodes/{uid}/rotate-secret | Rotate secret | Admin |
| GET | /admin/logs/{audit,scans,attendance} | View logs | Admin |
| GET | /admin/logs/{type}/export.csv | Export logs | Admin |

### 5.2 Data Model (SQLite)
| Table | Main columns |
|---|---|
| users | id, login_id, name, role, roll_no, password_hash, status, failed_attempts, locked_until, must_change_password |
| sessions | id, user_id, token_hash, csrf_token, created_at, last_seen_at, expires_at |
| devices | id, student_id, credential_id, public_key, sign_count, device_cookie_hash, created_at, revoked_at, revoked_by |
| webauthn_challenges | id, user_id, challenge, purpose, expires_at, used |
| phy_nodes | uid (PK), label, room_label, lat, lng, radius_m, secret_enc, secret_iv, status, created_at, updated_at |
| classrooms | id, teacher_id, name, code, description, node_uid (unique, nullable), archived |
| node_assignments | id, classroom_id, node_uid, assigned_at, unassigned_at, assigned_by |
| enrollments | student_id, classroom_id, joined_at, left_at |
| scan_nonces | nonce_hash, student_id, session_id, issued_at, expires_at, used_at |
| attendance_events | id, student_id, classroom_id, node_uid, type, scanned_at, step, distance_m, accuracy_m |
| scan_attempts | id, student_id, classroom_id, node_uid, result_code, step, lat, lng, accuracy_m, distance_m, ip, user_agent, at |
| audit_log | id, actor_id, action, target_type, target_id, details_json, at |

### 5.3 Result Codes
| Code | Meaning |
|---|---|
| OK_CHECK_IN, OK_CHECK_OUT | Accepted |
| ERR_SESSION | Not logged in or session expired |
| ERR_DEVICE_NOT_BOUND | Device cookie or passkey does not match the binding |
| ERR_NONCE_INVALID | Nonce missing, expired or used |
| ERR_QR_INVALID | Malformed payload, unknown or revoked node, or wrong code |
| ERR_NODE_NOT_ASSIGNED | Node has no classroom |
| ERR_CLASS_MISMATCH | Node belongs to another classroom |
| ERR_NOT_JOINED | Student has not joined the classroom |
| ERR_LOCATION_REQUIRED | No location supplied |
| ERR_LOW_ACCURACY | Accuracy worse than the limit |
| ERR_OUTSIDE_GEOFENCE | Outside the node's radius |
| ERR_TOO_SOON | Scan inside `MIN_GAP` |
| ERR_RATE_LIMITED | Too many requests |

---

## 6. Threat Model and Known Limitations
The system is built to reduce cheating at low cost, not to eliminate it.

| Threat | Mitigation | Residual risk |
|---|---|---|
| Photo or screenshot of the node's QR sent to an absent friend | Code changes every 30 s, nonce per scan, geofence, device binding | Works if the absent friend is also located in the room |
| GPS spoofing | Accuracy and location logged | Browsers cannot detect mock locations |
| Passkey synced to another device | Device cookie, admin revocation | A determined student can clone the binding |
| Phone lent to a classmate | User verification on each passkey login | Not preventable in software |
| Node secret extracted from flash | Unique secret per node, rotation | Physical access can read the firmware unless flash encryption is enabled on the node |
| Guessing the code | 36^12 possible values, three accepted steps, rate limits | Negligible |
| Node clock drift | DS3231 accuracy, one-step tolerance on the server | Drift beyond about 30 s causes rejections |
| Node moved without updating coordinates | Admin updates coordinates, audit log | Scans fail with `ERR_OUTSIDE_GEOFENCE` until fixed |
| ngrok URL changes | Reserved domain in `.env` | Every binding breaks if the domain changes |

---

## 7. Acceptance Criteria
1. A student logs in with password and passkey, and the passkey login works on a second visit.
2. A second phone cannot log in to the account. After admin revocation it can bind.
3. A payload produced by the firmware for the node's ROOM_ID is accepted at the node's assigned classroom, inside the geofence, by a joined student, and recorded as a check-in.
4. A second scan after `MIN_GAP` is recorded as a check-out. A scan inside `MIN_GAP` is rejected with `ERR_TOO_SOON`.
5. A wrong code, a code older than the tolerance, a reused nonce and a scan outside the radius are each rejected with the right result code.
6. A node assigned to classroom A rejects a scan for classroom B.
7. The server reproduces every case in `TOTP_VECTORS.md`, and the firmware produces the same tokens for the same inputs.
8. A teacher can create a classroom, assign a node and export CSV, but cannot see another teacher's classroom.
9. An admin can register a node, change its coordinates, rotate its secret and see every action in the audit log.
10. The API responds through the ngrok hostname with the PWA served from the same origin.

---

## 8. Open Issues
1. Whether admins also need a second factor.
2. Confirm `MIN_GAP` (5 minutes), the end-of-day rule and the definition of "present".
3. Tune the 50 m accuracy limit and 35 m radius in the real rooms.
4. Ngrok reserved domain name, which must be set before any student binds a device.
5. The ngrok free plan shows a warning page to browsers on first visit. Decide whether to accept it or upgrade.
