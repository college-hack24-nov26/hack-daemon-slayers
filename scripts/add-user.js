'use strict';
const bcrypt = require('bcryptjs');
const { cli, assertConfig } = require('../src/config');
const { db } = require('../src/db');
const { isNonEmptyString, isStringWithLength } = require('../validate');

assertConfig();

async function run() {
  const login = cli['login'];
  const name = cli['name'];
  const role = cli['role'];
  const password = cli['password'];

  if (!isNonEmptyString(login)) {
    throw new Error('Missing or empty --login');
  }
  if (!isNonEmptyString(name)) {
    throw new Error('Missing or empty --name');
  }
  if (!['admin', 'teacher', 'student'].includes(role)) {
    throw new Error('Invalid --role: must be admin, teacher, or student');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('--password must be at least 8 characters long');
  }

  const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(login.trim());
  if (existing) {
    throw new Error(`User already exists: ${login}`);
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO users (login_id, name, role, password_hash, active, failed_attempts, locked_until)
    VALUES (?, ?, ?, ?, 1, 0, 0)
  `).run(login.trim(), name.trim(), role, hash);

  process.stdout.write(`User created successfully: ${login} (${role})\n`);
}

run().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
