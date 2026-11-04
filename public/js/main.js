import { h } from './ui.js';
import { api } from './api.js';

import * as LoginView from './views/login.js';
import * as StudentView from './views/student.js';
import * as ScanView from './views/scan.js';
import * as TeacherView from './views/teacher.js';
import * as AdminView from './views/admin.js';

let currentUser = null;
let currentCleanup = null;

const appEl = document.getElementById('app');

function renderTopBar() {
  let topbar = document.getElementById('topbar');
  if (!topbar) {
    topbar = h('header', { id: 'topbar' });
    appEl.parentNode.insertBefore(topbar, appEl);
  }

  topbar.replaceChildren();

  const brand = h('a', { href: '#/', class: 'topbar-brand' }, '📱 QR Attendance');
  topbar.appendChild(brand);

  if (currentUser) {
    const logoutBtn = h('button', {
      class: 'btn btn-outline',
      style: 'min-height: 32px; padding: 0 10px; font-size: 0.85rem;',
      onclick: async () => {
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } catch (e) {
          // ignore
        }
        currentUser = null;
        window.location.hash = '#/login';
        router();
      }
    }, 'Log out');

    const userInfo = h('div', { class: 'topbar-user' },
      h('span', {}, currentUser.name),
      logoutBtn
    );
    topbar.appendChild(userInfo);
  }
}

async function checkAuth() {
  try {
    const res = await api('/api/me');
    currentUser = res.user;
  } catch (err) {
    currentUser = null;
  }
}

window.onLoginSuccess = (user) => {
  currentUser = user;
  if (user.role === 'student') window.location.hash = '#/student';
  else if (user.role === 'teacher') window.location.hash = '#/teacher';
  else if (user.role === 'admin') window.location.hash = '#/admin';
  else window.location.hash = '#/login';
  router();
};

function parseHash() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  return { path: '/' + (parts[0] || ''), params: { id: parts[1] } };
}

async function router() {
  // Call previous cleanup if exists (e.g. stops camera tracks)
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch (e) {
      console.error('Error during view cleanup:', e);
    }
    currentCleanup = null;
  }

  let viewContainer = document.getElementById('view');
  if (!viewContainer) {
    viewContainer = h('main', { id: 'view' });
    appEl.replaceChildren(viewContainer);
  }

  const { path, params } = parseHash();

  renderTopBar();

  // Role guarding
  if (!currentUser) {
    if (path !== '/login') {
      window.location.hash = '#/login';
      return;
    }
    currentCleanup = LoginView.render(viewContainer);
    return;
  }

  // User is logged in
  if (path === '/login' || path === '/') {
    // Redirect to user's home role
    if (currentUser.role === 'student') window.location.hash = '#/student';
    else if (currentUser.role === 'teacher') window.location.hash = '#/teacher';
    else if (currentUser.role === 'admin') window.location.hash = '#/admin';
    return;
  }

  // Guard student routes
  if (path === '/student') {
    if (currentUser.role !== 'student') {
      window.location.hash = '#/';
      return;
    }
    currentCleanup = StudentView.render(viewContainer);
    return;
  }

  if (path === '/scan') {
    if (currentUser.role !== 'student') {
      window.location.hash = '#/';
      return;
    }
    currentCleanup = ScanView.render(viewContainer, params);
    return;
  }

  // Guard teacher routes
  if (path === '/teacher') {
    if (currentUser.role !== 'teacher') {
      window.location.hash = '#/';
      return;
    }
    currentCleanup = TeacherView.render(viewContainer);
    return;
  }

  // Guard admin routes
  if (path === '/admin') {
    if (currentUser.role !== 'admin') {
      window.location.hash = '#/';
      return;
    }
    currentCleanup = AdminView.render(viewContainer);
    return;
  }

  // Unknown route -> redirect to home
  window.location.hash = '#/';
}

window.addEventListener('hashchange', router);

// Start application
checkAuth().finally(() => {
  router();
});
