'use strict';

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: 'ERR_NOT_FOUND',
    message: 'Endpoint not found.'
  });
}

function errorHandler(err, req, res, next) {
  // Handle JSON parse error from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      ok: false,
      error: 'ERR_BAD_REQUEST',
      message: 'Invalid JSON payload.'
    });
  }

  // Never leak internal errors or stack traces
  const status = err.status || 500;
  const errorCode = err.error || (status === 500 ? 'ERR_SERVER' : 'ERR_BAD_REQUEST');
  const message = err.status ? err.message : 'Internal server error.';

  res.status(status).json({
    ok: false,
    error: errorCode,
    message
  });
}

module.exports = { asyncHandler, notFoundHandler, errorHandler };
