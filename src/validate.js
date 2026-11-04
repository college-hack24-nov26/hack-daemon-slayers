'use strict';

function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

function isStringWithLength(val, min, max) {
  if (typeof val !== 'string') return false;
  const len = val.trim().length;
  return len >= min && len <= max;
}

function isPositiveInteger(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0;
}

function isFiniteNumber(val) {
  const n = Number(val);
  return typeof val !== 'boolean' && val !== null && val !== '' && Number.isFinite(n);
}

function isValidLat(val) {
  if (!isFiniteNumber(val)) return false;
  const n = Number(val);
  return n >= -90 && n <= 90;
}

function isValidLng(val) {
  if (!isFiniteNumber(val)) return false;
  const n = Number(val);
  return n >= -180 && n <= 180;
}

function isValidAccuracy(val) {
  if (!isFiniteNumber(val)) return false;
  const n = Number(val);
  return n >= 0;
}

module.exports = {
  isNonEmptyString,
  isStringWithLength,
  isPositiveInteger,
  isFiniteNumber,
  isValidLat,
  isValidLng,
  isValidAccuracy
};
