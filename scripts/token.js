'use strict';
const { cli, assertConfig } = require('../src/config');
const { stepFor, computeCode } = require('../src/services/totp');

assertConfig();

function run() {
  const uid = cli['uid'];
  const secret = cli['secret'];
  const timeArg = cli['time'];

  if (!uid || !/^[0-9A-Z]{1,16}$/.test(uid)) {
    throw new Error('Invalid or missing --uid: must match ^[0-9A-Z]{1,16}$');
  }
  if (!secret || !/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error('Invalid or missing --secret: must be 64 hex characters');
  }

  const nowSec = timeArg !== undefined ? Number(timeArg) : Math.floor(Date.now() / 1000);
  if (!Number.isFinite(nowSec)) {
    throw new Error('Invalid --time: must be a finite number');
  }

  const currentStep = stepFor(nowSec);
  const secretHex = secret.toLowerCase();

  process.stdout.write(`Token Verification for Node ${uid} (Reference time: ${new Date(nowSec * 1000).toISOString()})\n\n`);

  for (const s of [currentStep - 1, currentStep, currentStep + 1]) {
    const code = computeCode(secretHex, uid, s);
    const stepTimeSec = s * 30;
    const utcIso = new Date(stepTimeSec * 1000).toISOString();
    const isCurrent = s === currentStep ? ' (CURRENT)' : (s < currentStep ? ' (PREV)' : ' (NEXT)');
    process.stdout.write(`Step ${s}${isCurrent}:\n  Payload:  ${code}:${uid}\n  UTC Time: ${utcIso}\n\n`);
  }
}

try {
  run();
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
