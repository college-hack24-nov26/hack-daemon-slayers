'use strict';
const crypto = require('crypto');
const { config, cli, assertConfig } = require('../src/config');
const { db } = require('../src/db');
const { encryptSecret } = require('../src/services/crypto');
const { isValidLat, isValidLng, isValidAccuracy } = require('../validate');

assertConfig();

async function run() {
  const uid = cli['uid'];
  let secret = cli['secret'];
  const generate = cli['generate'] === 'on' || cli['generate'] === true || cli['generate'] === 'true';
  const lat = cli['lat'];
  const lng = cli['lng'];
  const radius = cli['radius'] !== undefined ? Number(cli['radius']) : 35;
  const label = cli['label'] !== undefined ? String(cli['label']).trim() : '';

  if (!uid || !/^[0-9A-Z]{1,16}$/.test(uid)) {
    throw new Error('Invalid --uid: must match ^[0-9A-Z]{1,16}$');
  }

  if (!isValidLat(lat)) {
    throw new Error('Invalid or missing --lat: must be between -90 and 90');
  }
  if (!isValidLng(lng)) {
    throw new Error('Invalid or missing --lng: must be between -180 and 180');
  }
  if (!isValidAccuracy(radius)) {
    throw new Error('Invalid --radius: must be a non-negative number');
  }

  let generatedSecretPrinted = false;

  if (generate) {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    secret = rawSecret;
    process.stdout.write(`
======================================================================
GENERATED ROOM_SECRET (64 hex characters):
${rawSecret}

Paste this into the firmware's ROOM_SECRET configuration in phy_node!
It will NOT be shown again.
======================================================================
`);
    generatedSecretPrinted = true;
  }

  if (secret !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
      throw new Error('Invalid --secret: must be exactly 64 hex characters');
    }
  }

  const existing = db.prepare('SELECT uid, secret_enc FROM phy_nodes WHERE uid = ?').get(uid);

  if (existing) {
    let secretEnc = existing.secret_enc;
    if (secret) {
      secretEnc = encryptSecret(secret.toLowerCase(), config.masterKey);
    }
    db.prepare(`
      UPDATE phy_nodes
      SET label = ?, lat = ?, lng = ?, radius_m = ?, secret_enc = ?, active = 1
      WHERE uid = ?
    `).run(label, Number(lat), Number(lng), radius, secretEnc, uid);
    process.stdout.write(`Node ${uid} updated successfully.\n`);
  } else {
    if (!secret) {
      throw new Error('Must provide either --secret <64 hex> or --generate for a new node');
    }
    const secretEnc = encryptSecret(secret.toLowerCase(), config.masterKey);
    db.prepare(`
      INSERT INTO phy_nodes (uid, label, lat, lng, radius_m, secret_enc, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(uid, label, Number(lat), Number(lng), radius, secretEnc);
    process.stdout.write(`Node ${uid} created successfully.\n`);
  }
}

run().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
