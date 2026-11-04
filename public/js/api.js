// Fetch API wrapper with JSON and error handling
export async function api(path, options = {}) {
  const opts = {
    method: options.method || 'GET',
    headers: { ...(options.headers || {}) },
    credentials: 'same-origin'
  };

  if (options.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  }

  const res = await fetch(path, opts);
  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  }

  if (!res.ok) {
    const error = data?.error || 'ERR_REQUEST';
    const message = data?.message || res.statusText || 'Request failed';
    if (res.status === 401 && error === 'ERR_SESSION') {
      window.location.hash = '#/login';
    }
    const errObj = new Error(message);
    errObj.error = error;
    errObj.message = message;
    errObj.status = res.status;
    errObj.data = data;
    throw errObj;
  }

  return data;
}
