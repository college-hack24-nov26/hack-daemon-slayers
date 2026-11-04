'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  INTERVAL_SECONDS,
  PAYLOAD_RE,
  stepFor,
  computeCode,
  buildPayload,
  parsePayload,
  verifyCode
} = require('../src/services/totp');

test('TOTP vectors and algorithm', async (t) => {
  const secret64Hex = '0123456789abcdef'.repeat(4);

  await t.test('RFC 4231 test case 1 (HMAC-SHA256)', () => {
    const key = Buffer.alloc(20, 0x0b);
    const data = Buffer.from('Hi There', 'ascii');
    const h = crypto.createHmac('sha256', key).update(data).digest('hex');
    assert.equal(h, 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  await t.test('Normative vector: R101 at 1762200000 -> 3YBMBMJTZIO8:R101', () => {
    assert.equal(buildPayload(secret64Hex, 'R101', 1762200000), '3YBMBMJTZIO8:R101');
  });

  await t.test('Normative vector: R101 at 1762200029 -> 3YBMBMJTZIO8:R101', () => {
    assert.equal(buildPayload(secret64Hex, 'R101', 1762200029), '3YBMBMJTZIO8:R101');
  });

  await t.test('Normative vector: R101 at 1762200030 -> RR3P1ZV7341Z:R101', () => {
    assert.equal(buildPayload(secret64Hex, 'R101', 1762200030), 'RR3P1ZV7341Z:R101');
  });

  await t.test('Normative vector: LAB2 at 1762300123 -> KIU2L532K3JQ:LAB2', () => {
    assert.equal(buildPayload(secret64Hex, 'LAB2', 1762300123), 'KIU2L532K3JQ:LAB2');
  });

  await t.test('verifyCode: accepts steps -1, 0, +1 and rejects +3', () => {
    const now = 1762200000;
    const currentCode = computeCode(secret64Hex, 'R101', stepFor(now));
    const prevCode = computeCode(secret64Hex, 'R101', stepFor(now) - 1);
    const nextCode = computeCode(secret64Hex, 'R101', stepFor(now) + 1);
    const futureCode = computeCode(secret64Hex, 'R101', stepFor(now) + 3);

    assert.equal(verifyCode(secret64Hex, 'R101', currentCode, now), true);
    assert.equal(verifyCode(secret64Hex, 'R101', prevCode, now), true);
    assert.equal(verifyCode(secret64Hex, 'R101', nextCode, now), true);
    assert.equal(verifyCode(secret64Hex, 'R101', futureCode, now), false);
  });

  await t.test('verifyCode: rejects wrong secret, wrong roomId, or 1-char tamper', () => {
    const now = 1762200000;
    const currentCode = computeCode(secret64Hex, 'R101', stepFor(now));
    const wrongSecret = 'fedcba9876543210'.repeat(4);

    assert.equal(verifyCode(wrongSecret, 'R101', currentCode, now), false);
    assert.equal(verifyCode(secret64Hex, 'R102', currentCode, now), false);

    // 1-char tamper
    const tamperedCode = (currentCode[0] === 'A' ? 'B' : 'A') + currentCode.slice(1);
    assert.equal(verifyCode(secret64Hex, 'R101', tamperedCode, now), false);
  });

  await t.test('parsePayload rejects invalid forms', () => {
    assert.equal(parsePayload(''), null);
    assert.equal(parsePayload('ABC'), null);
    assert.equal(parsePayload('3ybmbmjtzio8:R101'), null);
    assert.equal(parsePayload('3YBMBMJTZIO8:R101:EXTRA'), null);
    assert.equal(parsePayload(':R101'), null);
    assert.equal(parsePayload('3YBMBMJTZIO8:'), null);
    assert.equal(parsePayload(null), null);
    assert.equal(parsePayload(12345), null);
    assert.deepEqual(parsePayload('3YBMBMJTZIO8:R101'), { code: '3YBMBMJTZIO8', roomId: 'R101' });
  });
});
