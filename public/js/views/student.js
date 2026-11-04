import { h, showAlert } from '../ui.js';
import { api } from '../api.js';

export function render(container) {
  container.replaceChildren();

  const title = h('h1', {}, 'Mark attendance');
  const subtitle = h('p', {}, 'Select your class to start scanning.');
  const msgContainer = h('div', { 'aria-live': 'polite' });
  const listContainer = h('div', { class: 'classes-list' });

  const card = h('div', { class: 'card' },
    title,
    subtitle,
    msgContainer,
    listContainer
  );

  container.appendChild(card);

  async function loadClassrooms() {
    listContainer.replaceChildren(h('p', {}, 'Loading classes...'));
    try {
      const res = await api('/api/classrooms');
      listContainer.replaceChildren();

      if (!res.classrooms || res.classrooms.length === 0) {
        listContainer.appendChild(h('p', {}, 'No active classes available right now.'));
        return;
      }

      for (const cls of res.classrooms) {
        const item = h('div', {
          class: 'list-item',
          role: 'button',
          tabindex: '0',
          onclick: async () => {
            try {
              // Join classroom then navigate to scan
              await api(`/api/classrooms/${cls.id}/join`, { method: 'POST' });
              window.location.hash = `#/scan/${cls.id}`;
            } catch (err) {
              showAlert(msgContainer, err.message || 'Could not join classroom.');
            }
          }
        },
          h('div', {},
            h('div', { style: 'font-weight: 600; font-size: 1.05rem;' }, cls.name),
            h('div', { style: 'font-size: 0.875rem; color: var(--text-muted); margin-top: 2px;' },
              cls.code ? `${cls.code} • ` : '',
              cls.teacherName || 'Teacher'
            ),
            !cls.hasNode ? h('div', { style: 'font-size: 0.8rem; color: var(--warning); margin-top: 4px;' }, '⚠️ No device linked yet') : null
          ),
          h('div', { class: 'badge' }, cls.joined ? 'Joined' : 'Select →')
        );

        listContainer.appendChild(item);
      }
    } catch (err) {
      showAlert(msgContainer, err.message || 'Failed to load classrooms.');
    }
  }

  loadClassrooms();
}
