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
