'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { config, cli, assertConfig } = require('../src/config');
const { db } = require('../src/db');
const { encryptSecret } = require('../src/services/crypto');

assertConfig();

async function runSeed() {
  process.stdout.write('Seeding database...\n');

  const defaultSecretHex = '0123456789abcdef'.repeat(4);
  const secretHex = cli['secret'] || defaultSecretHex;
  const lat = cli['lat'] !== undefined ? Number(cli['lat']) : 19.0760;
  const lng = cli['lng'] !== undefined ? Number(cli['lng']) : 72.8777;
  const radius = cli['radius'] !== undefined ? Number(cli['radius']) : 35;

  const users = [
    { login: 'admin', name: 'System Admin', role: 'admin', pass: 'admin123' },
    { login: 'teacher1', name: 'Demo Teacher', role: 'teacher', pass: 'teacher123' },
    { login: 'student1', name: 'Demo Student', role: 'student', pass: 'student123' }
  ];

  for (const u of users) {
    const existing = db.prepare('SELECT id FROM users WHERE login_id = ?').get(u.login);
    if (!existing) {
      const hash = await bcrypt.hash(u.pass, 12);
      db.prepare(`
        INSERT INTO users (login_id, name, role, password_hash, active, failed_attempts, locked_until)
        VALUES (?, ?, ?, ?, 1, 0, 0)
      `).run(u.login, u.name, u.role, hash);
      process.stdout.write(`  Created user: ${u.login} (${u.role})\n`);
    } else {
      process.stdout.write(`  User already exists: ${u.login}\n`);
    }
  }

  // Node R101
  const existingNode = db.prepare('SELECT uid FROM phy_nodes WHERE uid = ?').get('R101');
  if (!existingNode) {
    const encSecret = encryptSecret(secretHex, config.masterKey);
    db.prepare(`
      INSERT INTO phy_nodes (uid, label, lat, lng, radius_m, secret_enc, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run('R101', 'Room 101', lat, lng, radius, encSecret);
    process.stdout.write(`  Created PHY_NODE: R101 (lat=${lat}, lng=${lng}, radius=${radius}m)\n`);
  } else {
    process.stdout.write('  PHY_NODE already exists: R101\n');
  }

  // Demo Class for teacher1 linked to R101
  const teacher = db.prepare("SELECT id FROM users WHERE login_id = 'teacher1'").get();
  if (teacher) {
    const existingClass = db.prepare('SELECT id FROM classrooms WHERE name = ? AND teacher_id = ?').get('Demo Class', teacher.id);
    if (!existingClass) {
      db.prepare(`
        INSERT INTO classrooms (teacher_id, name, code, archived, node_uid)
        VALUES (?, 'Demo Class', 'CS101', 0, 'R101')
      `).run(teacher.id);
      process.stdout.write('  Created class: Demo Class (CS101) linked to R101\n');
    } else {
      process.stdout.write('  Class already exists: Demo Class\n');
    }
  }

  process.stdout.write(`
----------------------------------------------------------------------
WARNING: The following default credentials have been seeded for DEMO:
  - Admin:   admin    / admin123
  - Teacher: teacher1 / teacher123
  - Student: student1 / student123
Change these in production environments!
----------------------------------------------------------------------
`);
}

runSeed().catch(err => {
  process.stderr.write('Seed failed: ' + err.message + '\n');
  process.exit(1);
});
