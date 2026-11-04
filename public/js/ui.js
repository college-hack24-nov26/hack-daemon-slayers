// UI Helper creating DOM elements without using innerHTML
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'className' || key === 'class') {
      el.className = val;
    } else if (key === 'disabled') {
      if (val) el.setAttribute('disabled', '');
      else el.removeAttribute('disabled');
    } else if (val !== null && val !== undefined) {
      el.setAttribute(key, val);
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c !== null && c !== undefined && c !== false) {
          el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c);
        }
      }
    } else if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(child));
    } else {
      el.appendChild(child);
    }
  }

  return el;
}

export function showAlert(container, text, type = 'error') {
  container.replaceChildren();
  if (!text) return;
  const alertEl = h('div', { class: `alert alert-${type}`, role: 'alert' }, text);
  container.appendChild(alertEl);
}
