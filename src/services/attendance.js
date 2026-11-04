'use strict';

// lastEvent: latest accepted event for this student + classroom + date, or null.
function decide(lastEvent, nowSec, minGapSec) {
  if (!lastEvent || lastEvent.type === 'CHECK_OUT') return { type: 'CHECK_IN' };
  if (nowSec - lastEvent.scanned_at >= minGapSec) return { type: 'CHECK_OUT' };
  return { error: 'ERR_TOO_SOON' };
}

// Attendance date as YYYY-MM-DD in the configured offset (default IST = 19800 s).
function dateKey(unixSec, tzOffsetSeconds) {
  return new Date((unixSec + tzOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

module.exports = { decide, dateKey };
