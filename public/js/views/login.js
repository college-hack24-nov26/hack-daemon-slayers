import { h, showAlert } from '../ui.js';
import { api } from '../api.js';

export function render(container) {
  container.replaceChildren();

  const errorContainer = h('div', { 'aria-live': 'polite' });
  let isSubmitting = false;

  const loginIdInput = h('input', {
    type: 'text',
    id: 'loginId',
    name: 'loginId',
    autocomplete: 'username',
    required: 'true',
    placeholder: 'e.g. student1'
  });

  const passwordInput = h('input', {
    type: 'password',
    id: 'password',
    name: 'password',
    autocomplete: 'current-password',
    required: 'true',
    placeholder: '••••••••'
  });

  const submitBtn = h('button', {
    type: 'submit',
    class: 'btn btn-primary btn-full'
  }, 'Log in');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (isSubmitting) return;

      showAlert(errorContainer, '');
      const loginId = loginIdInput.value.trim();
      const password = passwordInput.value;

      if (!loginId || !password) {
        showAlert(errorContainer, 'Please enter both login ID and password.');
        return;
      }

      isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Logging in...';

      try {
        const res = await api('/api/auth/login', {
          method: 'POST',
          body: { loginId, password }
        });

        if (typeof window.onLoginSuccess === 'function') {
          window.onLoginSuccess(res.user);
        } else {
          // Fallback redirect based on role
          if (res.user.role === 'student') window.location.hash = '#/student';
          else if (res.user.role === 'teacher') window.location.hash = '#/teacher';
          else if (res.user.role === 'admin') window.location.hash = '#/admin';
          else window.location.hash = '#/login';
        }
      } catch (err) {
        showAlert(errorContainer, err.message || 'Login failed.');
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Log in';
      }
    }
  },
    h('div', { class: 'form-group' },
      h('label', { for: 'loginId' }, 'Login ID'),
      loginIdInput
    ),
    h('div', { class: 'form-group' },
      h('label', { for: 'password' }, 'Password'),
      passwordInput
    ),
    h('div', { style: 'margin-top: 24px;' }, submitBtn)
  );

  const card = h('div', { class: 'card' },
    h('h1', {}, 'Log in'),
    h('p', {}, 'Enter your credentials to mark attendance or manage classes.'),
    errorContainer,
    form
  );

  container.appendChild(card);
}
