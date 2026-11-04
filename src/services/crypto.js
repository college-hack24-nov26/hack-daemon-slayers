'use strict';
const crypto = require('crypto');

function keyFrom(masterKeyB64) {
  const k = Buffer.from(masterKeyB64, 'base64');
  if (k.length !== 32) throw new Error('MASTER_KEY must be 32 bytes, base64 encoded');
  return k;
}

// Returns one base64 string: iv(12) + tag(16) + ciphertext
function encryptSecret(plain, masterKeyB64) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(masterKeyB64), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptSecret(blobB64, masterKeyB64) {
  const b = Buffer.from(blobB64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(masterKeyB64), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
