# Software Requirements Specification: Frontend (PWA)
**Project:** QR Attendance System (Frontend)
**Version:** 3.0
**Date:** 3 November 2026
**Status:** Draft for hackathon
**Related document:** `SRS_Backend.md` (API, code specification, result codes)

| Version | Change |
|---|---|
| 1.0 | Initial draft. The phone displayed a QR code and staff scanned it. |
| 2.0 | Students scan the PHY_NODE's code and share location. Teacher and admin screens added. |
| 3.0 | Passkeys as the student authentication factor, scanner accepts white-on-black codes, payload format matches the firmware (`CODE:ROOM_ID`), the PWA is served by the backend on the same origin, and Mac-based testing is included. |

---

## 1. Introduction

### 1.1 Purpose
This document specifies the frontend of the QR attendance system: a Progressive Web App (PWA) used on Android and iPhone by students, and in desktop browsers by teachers and admins. Students authenticate with a password and a device-bound passkey.

### 1.2 Scope
The PWA will:
- Log in users by role. Students confirm with a passkey, teachers and admins with a password.
- Bind a student's phone with a passkey on first login.
- Let students join classrooms, scan the code shown on a PHY_NODE with their location, and view attendance history.
- Let teachers manage classrooms, assign PHY_NODEs, view attendance and export CSV.
- Let admins manage users, device bindings, PHY_NODEs and logs.

The PWA does not verify codes, decide check-in or check-out, or enforce permissions. These are server responsibilities.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| PHY_NODE | Fixed device that displays a rotating code on an OLED |
| Payload | QR content, in the form `CODE:ROOM_ID` |
| Passkey | WebAuthn credential unlocked by biometrics or screen lock |
| Nonce | One-time value issued by the server before each scan |
| PWA | Web app installable to the home screen |

### 1.4 References
W3C Web App Manifest, Service Worker, WebAuthn Level 2, Geolocation API, MediaDevices (`getUserMedia`). Libraries: `@simplewebauthn/browser` (passkeys), `jsQR` (QR decoding, with inverted-code support).

---

## 2. Overall Description

### 2.1 Product Perspective
The PWA is built with React and Vite. The build output is served by the backend from the same origin as the API (for example `https://<reserved-domain>/` for the app and `https://<reserved-domain>/api` for the API). The app uses session cookies and no CORS.

### 2.2 Users and Screens
| Role | Screens |
|---|---|
| All | Login, Change Password |
| Student | Passkey Confirmation, Bind Device, My Classrooms, Browse and Join, Scan, History |
| Teacher | My Classrooms, Classroom Detail (node assignment, roster), Attendance, Export |
| Admin | Users, Device Bindings, PHY_NODEs, Classrooms (read only), Logs |

### 2.3 Operating Environment
- **Android:** Chrome 110 or later, Android 10 or later.
- **iPhone:** Safari on iOS 16 or later, installed to the home screen with "Add to Home Screen".
- **Desktop:** Chrome or Edge, for teachers and admins.
- **Development and testing:** a MacBook Air with Safari Web Inspector and the iOS Simulator. Real iPhones and Android phones are still required for passkeys, camera and GPS.

### 2.4 Design Constraints
- PWA only. Camera, geolocation and passkeys all require HTTPS and user permission.
- iOS has no install prompt. The app shows manual "Add to Home Screen" steps.
- On iOS, the installed app and the Safari tab have separate storage and passkey scope. Students are told to use the installed app for all steps.
- Scanning requires a network connection. The service worker caches only the app shell.
- The app must work with the reserved ngrok hostname, and the domain must not change once students have bound devices.

### 2.5 Assumptions
- Students have phones with a camera, location services and a screen lock or biometrics.
- The PHY_NODE displays a white code on a black background. The scanner must decode it.

---

## 3. Functional Requirements

### 3.1 General
| ID | Requirement |
|---|---|
| FR-GEN-01 | The app shall be responsive from 360 px wide phones to desktop screens. Tables shall scroll horizontally inside their own container on small screens. |
| FR-GEN-02 | Navigation shall show only the screens allowed for the logged-in role. The server enforces permissions regardless. |
| FR-GEN-03 | The app shall provide a web app manifest and service worker so it can be installed. |
| FR-GEN-04 | The app shall show platform-specific install steps for iPhone and Android. |
| FR-GEN-05 | The app shall show a clear message when the device is offline. |
| FR-GEN-06 | Every authenticated screen shall give access to logout and change password. |
| FR-GEN-07 | When the server returns a session error, the app shall return to the Login screen with a short explanation. |

### 3.2 Login (All Roles)
| ID | Requirement |
|---|---|
| FR-LOG-01 | The Login screen shall accept login ID and password. |
| FR-LOG-02 | Wrong credentials shall show a generic message that does not say which field was wrong. |
| FR-LOG-03 | A locked account shall show the remaining lock time. |
| FR-LOG-04 | Teachers and admins shall go to their home screen after a successful password login. |
| FR-LOG-05 | After a successful password login, a student with no binding shall go to Bind Device. A student with a binding shall go to Passkey Confirmation. |
| FR-LOG-06 | A user with a forced password change shall be taken to Change Password first. |

### 3.3 Passkey Confirmation and Bind Device (Student)
| ID | Requirement |
|---|---|
| FR-PKY-01 | Passkey Confirmation shall request the server's login options and prompt for biometrics or screen lock. |
| FR-PKY-02 | On success, the app shall go to My Classrooms. |
| FR-PKY-03 | If the passkey or device is rejected, the screen shall show "This phone is not registered for this account. Contact your administrator." |
| FR-BND-01 | Bind Device shall explain that this phone becomes the only phone allowed for the account, and that only an admin can change it. |
| FR-BND-02 | The screen shall request registration options and prompt for a passkey. |
| FR-BND-03 | If the user cancels the prompt, they can retry without logging in again. |
| FR-BND-04 | If the server reports that the account already has a binding, the screen shall tell the student to contact an admin. |

### 3.4 Student: Classrooms
| ID | Requirement |
|---|---|
| FR-CLS-01 | My Classrooms shall list joined classrooms. Selecting one opens Scan for that classroom. |
| FR-CLS-02 | Browse and Join shall list active classrooms with search and a Join button. |
| FR-CLS-03 | The student shall be able to leave a classroom after confirmation. |
| FR-CLS-04 | The classroom screen shall show the student's state for today, for example "Checked in at 09:02". |

### 3.5 Student: Scan
| ID | Requirement |
|---|---|
| FR-SCN-01 | The Scan screen shall show the classroom name and a notice that location is read only during the scan. |
| FR-SCN-02 | Tapping Scan shall request a nonce from the server and then open the rear camera. |
| FR-SCN-03 | The app shall request the device location with high accuracy and a 10-second timeout. If permission is denied, the app shall explain that location is required and how to enable it. The scan cannot continue without location. |
| FR-SCN-04 | The app shall decode codes continuously with `jsQR`, using inversion attempts so that white-on-black codes are read. |
| FR-SCN-05 | A decoded value that does not match `^[0-9A-Z]{12}:[0-9A-Z]{1,16}$` shall be ignored, with a short "Not an attendance code" message. |
| FR-SCN-06 | After a candidate payload is read, the app shall submit nonce, classroom ID, payload, latitude, longitude and accuracy in one request. |
| FR-SCN-07 | The app shall not ask the student to choose check-in or check-out. It shall display the result the server chose. |
| FR-SCN-08 | Success shall show "Checked in" or "Checked out", the classroom name and the time. |
| FR-SCN-09 | Each result code shall map to a plain-language message and a next step, for example: outside the room area, GPS accuracy too low (move near a window and retry), code expired (scan again), wrong classroom, not joined, scanned too soon. |
| FR-SCN-10 | If the accuracy is worse than the server's limit, the app shall ask the student to wait for a better fix before submitting. |
| FR-SCN-11 | After any failed attempt, the next attempt shall request a new nonce. |
| FR-SCN-12 | If the server reports that the device is not the bound one, the app shall stop and show the "contact your administrator" message. |

### 3.6 Student: History
| ID | Requirement |
|---|---|
| FR-HIS-01 | History shall list attendance by date and classroom, with check-in and check-out times. |
| FR-HIS-02 | History shall be filterable by classroom and date range. |
| FR-HIS-03 | A day with a check-in and no check-out shall be labelled "No check-out". |

### 3.7 Teacher
| ID | Requirement |
|---|---|
| FR-TCH-01 | My Classrooms shall let a teacher create, edit and archive classrooms. |
| FR-TCH-02 | Classroom Detail shall show the assigned PHY_NODE (or "none") and let the teacher assign one by UID or from a list of active nodes. |
| FR-TCH-03 | If the chosen node belongs to another classroom, the app shall warn that it will be taken over before the teacher confirms. |
| FR-TCH-04 | Teachers shall be able to unassign the node. |
| FR-TCH-05 | Classroom Detail shall show the roster of joined students. |
| FR-TCH-06 | Attendance shall show present and absent students for a date or range, with first check-in, last check-out and duration. |
| FR-TCH-07 | Export shall download a CSV for the selected classroom and range, as a daily summary or as raw events. |

### 3.8 Admin
| ID | Requirement |
|---|---|
| FR-ADM-01 | Users shall be listed, searchable, created, edited, enabled and disabled, with roles and password resets. CSV import shall show per-row errors. |
| FR-ADM-02 | Device Bindings shall list students and their binding status, with revocation after confirmation. |
| FR-ADM-03 | PHY_NODEs shall list UID, status, coordinates, radius, assigned classroom and last accepted scan. |
| FR-ADM-04 | Registering a node shall show its UID and the 64-character secret once, with copy and download options and a warning that the secret cannot be shown again. |
| FR-ADM-05 | Admins shall edit coordinates and radius. A "Use my current location" button shall fill in the coordinates and show the reported accuracy. |
| FR-ADM-06 | Admins shall revoke, reactivate and rotate the secret of a node, each after confirmation. Rotation shall warn that the node must be reprogrammed. |
| FR-ADM-07 | Classrooms shall be listed read only, with the option to unassign a node. |
| FR-ADM-08 | Logs shall show audit, scan and attendance logs with filters and CSV export. |

---

## 4. Non-Functional Requirements

### 4.1 Usability
| ID | Requirement |
|---|---|
| NFR-USA-01 | A student shall be able to log in, bind a phone, join a classroom and complete a first scan in under 3 minutes. |
| NFR-USA-02 | Touch targets shall be at least 44 x 44 px. |
| NFR-USA-03 | Error messages shall use plain language and state the next step. |
| NFR-USA-04 | The Scan screen shall show clear feedback for scanning, success and failure. |

### 4.2 Compatibility
| ID | Requirement |
|---|---|
| NFR-CMP-01 | The app shall work on Safari for iOS 16+, Chrome for Android 10+ and desktop Chrome or Edge. |
| NFR-CMP-02 | Before the demo, passkeys, camera and location shall be tested in the installed app on at least one real iPhone and one real Android phone. |
| NFR-CMP-03 | The UI shall follow the system light or dark theme. |
| NFR-CMP-04 | Before the device tests, the app shall be checked in the iOS Simulator and Safari Web Inspector on the MacBook Air. |

### 4.3 Performance
| ID | Requirement |
|---|---|
| NFR-PER-01 | The first screen shall appear within 3 seconds on 4G. |
| NFR-PER-02 | From the moment a code is read to the result being shown should take under 3 seconds, excluding the location fix. |
| NFR-PER-03 | Tables of up to 500 rows shall use pagination so that they render smoothly on a mid-range phone. |
| NFR-PER-04 | Scanning shall decode a clearly presented code within 1 second. |

### 4.4 Security and Privacy
| ID | Requirement |
|---|---|
| NFR-SEC-01 | The app shall be served only over HTTPS. |
| NFR-SEC-02 | Session tokens shall be `HttpOnly` cookies. Passwords, session data and passkey material shall never be stored in `localStorage` or `sessionStorage`. |
| NFR-SEC-03 | State-changing requests shall include the CSRF token issued by the server. |
| NFR-SEC-04 | The app shall not log passwords, nonces, payloads or secrets to the console in production builds. |
| NFR-SEC-05 | Location shall be read only during a scan or an admin "Use my current location" action, never continuously or in the background. |
| NFR-SEC-06 | Logout shall clear in-memory state and the QR scanner. |
| NFR-SEC-07 | The app shall use a Content-Security-Policy compatible with the backend header (NFR-SEC-08 in the backend SRS). |

### 4.5 Reliability
| ID | Requirement |
|---|---|
| NFR-REL-01 | On a network failure the app shall offer a retry and keep the selected classroom. |
| NFR-REL-02 | The service worker shall cache the app shell only. API responses shall never be cached. |

### 4.6 Accessibility
| ID | Requirement |
|---|---|
| NFR-ACC-01 | Interactive elements shall have accessible labels. |
| NFR-ACC-02 | Colour shall not be the only way to show success or failure. |

---

## 5. External Interfaces

### 5.1 Backend API
All endpoints, request and response formats, and result codes are defined in `SRS_Backend.md` (sections 5.1 and 5.3). The PWA shall use only those endpoints, under `/api`.

### 5.2 Browser APIs
- WebAuthn (`navigator.credentials`) for passkeys, through `@simplewebauthn/browser`.
- `getUserMedia` for the camera.
- Geolocation API for position and accuracy.
- Service Worker and Web App Manifest for installation and app-shell caching.

### 5.3 QR Payload
The payload is `CODE:ROOM_ID`, where `CODE` is 12 characters from `0-9A-Z` and `ROOM_ID` is the node UID. The PWA checks the format only. It never computes or validates the code itself.

### 5.4 Scanner Configuration
- Library: `jsQR`.
- Inversion: attempt both normal and inverted decoding on every frame, because the PHY_NODE displays white on black.
- Frame source: the rear camera at the highest resolution the browser allows.

---

## 6. Acceptance Criteria
On a real iPhone and a real Android phone, using the installed app:
1. A new student logs in with password, binds the phone with a passkey, and logs in again with the passkey.
2. The student joins a classroom and scans a PHY_NODE from inside the room. The result is "Checked in".
3. A later scan shows "Checked out". An immediate second scan shows the "scanned too soon" message.
4. Denying location or camera permission shows an explanation and steps to fix it.
5. A scan from outside the radius shows the outside-the-area message.
6. A scan against another classroom's node shows the wrong-classroom message.
7. After an admin revokes the binding, the phone shows the "contact your administrator" message.
8. A teacher creates a classroom, assigns a node by UID and from the list, sees present and absent students, and downloads CSV.
9. An admin registers a node, edits its coordinates, rotates its secret, and exports the audit log.
10. Role navigation hides screens the role cannot use, and the server refuses direct API access to them.
11. The white-on-black PHY_NODE code is decoded by the scanner under normal room lighting.

---

## 7. Open Issues
1. Whether the scanner should show a short preview of the geofence to students. (Not planned for v3.)
2. Wording of the location notice shown to students.
3. Whether the "current state" line (FR-CLS-04) is needed for the demo.
4. The ngrok warning page on the first browser visit: whether to ask students to tap through it or to upgrade the plan.
