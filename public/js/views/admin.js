import { h } from '../ui.js';
import { api } from '../api.js';

export function render(container) {
  container.replaceChildren();

  const logoutBtn = h('button', {
    class: 'btn btn-outline btn-full',
    style: 'margin-top: 16px;',
    onclick: async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        // ignore
      }
      window.location.hash = '#/login';
      window.location.reload();
    }
  }, 'Log out');

  const card = h('div', { class: 'card' },
    h('h1', {}, 'Admin dashboard'),
    h('p', {}, 'Admin screens are not part of the MVP. Use the command-line scripts (see README).'),
    h('div', { style: 'background: var(--bg-color); padding: 12px; border-radius: 8px; font-family: monospace; font-size: 0.85rem;' },
      h('div', {}, 'npm run add-user -- --login <L> --name <N> --role <R> --password <P>'),
      h('div', { style: 'margin-top: 6px;' }, 'npm run add-node -- --uid <U> --secret <S> --lat <X> --lng <Y>'),
      h('div', { style: 'margin-top: 6px;' }, 'npm run token -- --uid <U> --secret <S>')
    ),
    logoutBtn
  );

  container.appendChild(card);
}
