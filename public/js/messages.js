export const MESSAGES = {
  OK_CHECK_IN: 'Checked in',
  OK_CHECK_OUT: 'Checked out',
  ERR_QR_INVALID: "That code isn't valid or has expired. Scan the code on the screen again.",
  ERR_NODE_NOT_ASSIGNED: "This device isn't linked to a class yet. Ask your teacher.",
  ERR_CLASS_MISMATCH: 'This code belongs to a different class. Pick the right class and try again.',
  ERR_NOT_JOINED: "You haven't joined this class. Go back and select it.",
  ERR_LOCATION_REQUIRED: 'Location is needed to mark attendance. Allow location access and try again.',
  ERR_LOW_ACCURACY: "Your location isn't accurate enough. Move closer to a window or step outside for a moment, then try again.",
  ERR_OUTSIDE_GEOFENCE: 'You seem to be outside the classroom area. Move closer and try again.',
  ERR_TOO_SOON: 'You already scanned a moment ago. Wait a few minutes before scanning again.',
  ERR_SESSION: 'Your session ended. Log in again.',
  ERR_RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  ERR_LOGIN: 'Wrong login ID or password.',
  ERR_LOCKED: 'Too many attempts. Please try again later.',
  ERR_FORBIDDEN: 'Action forbidden.',
  ERR_NOT_FOUND: 'Item not found.',
  ERR_BAD_REQUEST: 'Invalid request.',
  ERR_SERVER: 'Internal server error. Please try again later.'
};

export function getMessage(code, fallback = 'An unexpected error occurred.') {
  return MESSAGES[code] || fallback;
}
