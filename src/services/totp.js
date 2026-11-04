'use strict';
const crypto = require('crypto');

const INTERVAL_SECONDS = 30;
const PAYLOAD_RE = /^[0-9A-Z]{12}:[0-9A-Z]{1,16}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function stepFor(unixSeconds) {
  return Math.floor(unixSeconds / INTERVAL_SECONDS);
}

// Must match phy_node/newAttendance.ino exactly.
function computeCode(secretHex, roomId, step) {
  const key = Buffer.from(secretHex, 'hex'); // 32 bytes
  const msg = Buffer.from(`${roomId}:${step}`, 'ascii');
  const h = crypto.createHmac('sha256', key).update(msg).digest(); // 32 bytes
  const off = h[31] % 24;
  let v = BigInt(h[off] & 0x7f);
  for (let i = 1; i < 8; i++) v = (v << 8n) | BigInt(h[off + i]);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out = ALPHABET[Number(v % 36n)] + out;
    v /= 36n;
  }
  return out;
}

function buildPayload(secretHex, roomId, unixSeconds) {
  return `${computeCode(secretHex, roomId, stepFor(unixSeconds))}:${roomId}`;
}

function parsePayload(payload) {
  if (typeof payload !== 'string' || !PAYLOAD_RE.test(payload)) return null;
  const i = payload.indexOf(':');
  return { code: payload.slice(0, i), roomId: payload.slice(i + 1) };
}

// Accepts the previous, current and next 30-second step. No early exit.
function verifyCode(secretHex, roomId, code, nowSeconds) {
  const step = stepFor(nowSeconds);
  const given = Buffer.from(String(code), 'ascii');
  let ok = false;
  for (const s of [step - 1, step, step + 1]) {
    const expected = Buffer.from(computeCode(secretHex, roomId, s), 'ascii');
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

module.exports = { INTERVAL_SECONDS, PAYLOAD_RE, stepFor, computeCode, buildPayload, parsePayload, verifyCode };
