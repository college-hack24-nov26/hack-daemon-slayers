'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { encryptSecret, decryptSecret } = require('../src/services/crypto');
const { distanceMeters } = require('../src/services/geofence');
const { decide, dateKey } = require('../src/services/attendance');

test('Crypto service', async (t) => {
  const masterKeyB64 = crypto.randomBytes(32).toString('base64');
  const secret = '0123456789abcdef'.repeat(4);

  await t.test('round-trip encryption and decryption', () => {
    const enc = encryptSecret(secret, masterKeyB64);
    const dec = decryptSecret(enc, masterKeyB64);
    assert.equal(dec, secret);
  });

  await t.test('tampered ciphertext throws error', () => {
    const enc = encryptSecret(secret, masterKeyB64);
    const buf = Buffer.from(enc, 'base64');
    buf[buf.length - 1] ^= 0x01; // flip last byte
    const tamperedB64 = buf.toString('base64');
    assert.throws(() => decryptSecret(tamperedB64, masterKeyB64));
  });

  await t.test('unique IVs produce different ciphertexts', () => {
    const enc1 = encryptSecret(secret, masterKeyB64);
    const enc2 = encryptSecret(secret, masterKeyB64);
    assert.notEqual(enc1, enc2);
  });

  await t.test('wrong key length throws', () => {
    const badKey = crypto.randomBytes(16).toString('base64');
    assert.throws(() => encryptSecret(secret, badKey), /MASTER_KEY must be 32 bytes/);
    const enc = encryptSecret(secret, masterKeyB64);
    assert.throws(() => decryptSecret(enc, badKey), /MASTER_KEY must be 32 bytes/);
  });
});

test('Geofence service', async (t) => {
  await t.test('zero distance between identical points', () => {
    assert.equal(distanceMeters(19.0760, 72.8777, 19.0760, 72.8777), 0);
  });

  await t.test('one degree of latitude is ~111,195 m within 100 m', () => {
    const d = distanceMeters(0, 0, 1, 0);
    assert.ok(Math.abs(d - 111195) <= 100, `Expected ~111195 but got ${d}`);
  });

  await t.test('10 m inside 35 m radius, 100 m outside', () => {
    // 0.0001 deg lat is approx 11.1 m
    const d10 = distanceMeters(19.0760, 72.8777, 19.07609, 72.8777);
    assert.ok(d10 < 35, `10m should be within 35m, got ${d10}`);

    // 0.001 deg lat is approx 111 m
    const d100 = distanceMeters(19.0760, 72.8777, 19.0770, 72.8777);
    assert.ok(d100 > 35, `100m should be outside 35m, got ${d100}`);
  });

  await t.test('anti-meridian distance under 30 m', () => {
    // 179.9999 to -179.9999 lon at equator (diff 0.0002 deg lon = ~22.2 m)
    const d = distanceMeters(0, 179.9999, 0, -179.9999);
    assert.ok(d < 30, `Distance across anti-meridian should be < 30m, got ${d}`);
  });
});

test('Attendance service', async (t) => {
  await t.test('decide: none gives check-in', () => {
    assert.deepEqual(decide(null, 1000, 300), { type: 'CHECK_IN' });
  });

  await t.test('decide: 299s gap gives ERR_TOO_SOON', () => {
    const lastEvent = { type: 'CHECK_IN', scanned_at: 1000 };
    assert.deepEqual(decide(lastEvent, 1299, 300), { error: 'ERR_TOO_SOON' });
  });

  await t.test('decide: 300s gap gives CHECK_OUT', () => {
    const lastEvent = { type: 'CHECK_IN', scanned_at: 1000 };
    assert.deepEqual(decide(lastEvent, 1300, 300), { type: 'CHECK_OUT' });
  });

  await t.test('decide: after CHECK_OUT gives CHECK_IN even immediately', () => {
    const lastEvent = { type: 'CHECK_OUT', scanned_at: 1000 };
    assert.deepEqual(decide(lastEvent, 1005, 300), { type: 'CHECK_IN' });
  });

  await t.test('dateKey IST boundary: 18:29:59 UTC and 18:30:00 UTC fall on different dates', () => {
    // 2026-11-03 18:29:59 UTC + 19800s (5h30m) = 2026-11-03 23:59:59 IST
    const t1 = Math.floor(new Date('2026-11-03T18:29:59Z').getTime() / 1000);
    // 2026-11-03 18:30:00 UTC + 19800s (5h30m) = 2026-11-04 00:00:00 IST
    const t2 = Math.floor(new Date('2026-11-03T18:30:00Z').getTime() / 1000);

    assert.equal(dateKey(t1, 19800), '2026-11-03');
    assert.equal(dateKey(t2, 19800), '2026-11-04');
  });
});
