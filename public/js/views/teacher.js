import { h, showAlert } from '../ui.js';
import { api } from '../api.js';

export function render(container) {
  container.replaceChildren();

  const msgContainer = h('div', { 'aria-live': 'polite' });
  const classListContainer = h('div');

  // New class form inputs
  const nameInput = h('input', {
    type: 'text',
    id: 'className',
    placeholder: 'e.g. Distributed Systems',
    required: 'true',
    maxlength: '80'
  });
  const codeInput = h('input', {
    type: 'text',
    id: 'classCode',
    placeholder: 'e.g. CS402',
    maxlength: '20'
  });
  const createBtn = h('button', {
    type: 'submit',
    class: 'btn btn-primary'
  }, 'Create class');

  const newClassForm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const code = codeInput.value.trim();
      if (!name) return;

      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
      try {
        await api('/api/teacher/classrooms', {
          method: 'POST',
          body: { name, code }
        });
        nameInput.value = '';
        codeInput.value = '';
        showAlert(msgContainer, 'Class created successfully.', 'success');
        await loadData();
      } catch (err) {
        showAlert(msgContainer, err.message || 'Failed to create class.');
      } finally {
        createBtn.disabled = false;
        createBtn.textContent = 'Create class';
      }
    }
  },
    h('div', { class: 'form-group' },
      h('label', { for: 'className' }, 'Class name'),
      nameInput
    ),
    h('div', { class: 'form-group' },
      h('label', { for: 'classCode' }, 'Code (optional)'),
      codeInput
    ),
    createBtn
  );

  const newClassCard = h('div', { class: 'card' },
    h('h2', {}, 'Create new class'),
    newClassForm
  );

  const mainWrapper = h('div', {},
    h('h1', {}, 'Teacher dashboard'),
    msgContainer,
    newClassCard,
    h('h2', { style: 'margin-top: 24px;' }, 'Your classes'),
    classListContainer
  );

  container.appendChild(mainWrapper);

  async function loadData() {
    classListContainer.replaceChildren(h('p', {}, 'Loading classes...'));
    try {
      const [classRes, nodeRes] = await Promise.all([
        api('/api/teacher/classrooms'),
        api('/api/nodes')
      ]);

      const classrooms = classRes.classrooms || [];
      const nodes = nodeRes.nodes || [];

      classListContainer.replaceChildren();

      if (classrooms.length === 0) {
        classListContainer.appendChild(h('p', {}, 'No classes created yet.'));
        return;
      }

      for (const cls of classrooms) {
        const classCard = h('div', { class: 'card' });

        // Header: name, code, archived badge
        const header = h('div', { style: 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;' },
          h('div', {},
            h('h3', { style: 'font-size: 1.15rem; font-weight: 700;' }, cls.name),
            cls.code ? h('div', { style: 'font-size: 0.875rem; color: var(--text-muted);' }, `Code: ${cls.code}`) : null
          ),
          cls.archived ? h('span', { class: 'badge badge-archived' }, 'Archived') : null
        );

        // Actions: Rename & Archive/Restore
        const renameBtn = h('button', {
          class: 'btn btn-outline',
          style: 'min-height: 36px; padding: 0 12px; font-size: 0.875rem;',
          onclick: async () => {
            const newName = window.prompt('Enter new class name:', cls.name);
            if (!newName || newName.trim() === '' || newName.trim() === cls.name) return;

            try {
              await api(`/api/teacher/classrooms/${cls.id}`, {
                method: 'PATCH',
                body: { name: newName.trim() }
              });
              showAlert(msgContainer, 'Class renamed.', 'success');
              await loadData();
            } catch (e) {
              showAlert(msgContainer, e.message || 'Could not rename class.');
            }
          }
        }, 'Rename');

        const archiveBtn = h('button', {
          class: 'btn btn-outline',
          style: 'min-height: 36px; padding: 0 12px; font-size: 0.875rem;',
          onclick: async () => {
            const targetState = !cls.archived;
            const actionWord = targetState ? 'archive' : 'restore';
            if (!window.confirm(`Are you sure you want to ${actionWord} '${cls.name}'?`)) return;

            try {
              await api(`/api/teacher/classrooms/${cls.id}`, {
                method: 'PATCH',
                body: { archived: targetState }
              });
              showAlert(msgContainer, `Class ${targetState ? 'archived' : 'restored'}.`, 'success');
              await loadData();
            } catch (e) {
              showAlert(msgContainer, e.message || `Could not ${actionWord} class.`);
            }
          }
        }, cls.archived ? 'Restore' : 'Archive');

        const actionRow = h('div', { style: 'display: flex; gap: 8px; margin-bottom: 16px;' },
          renameBtn,
          archiveBtn
        );

        // Node management row (if not archived)
        let nodeSection = null;
        if (!cls.archived) {
          const selectEl = h('select', { style: 'flex: 1; max-width: 240px;' },
            h('option', { value: '' }, '-- Select PHY_NODE --'),
            nodes.map(n => {
              const opt = h('option', { value: n.uid },
                n.uid + (n.label ? ` (${n.label})` : '') + (n.classroomId && n.classroomId !== cls.id ? ` [in '${n.classroomName}']` : '')
              );
              if (cls.nodeUid === n.uid) opt.setAttribute('selected', '');
              return opt;
            })
          );

          const assignBtn = h('button', {
            class: 'btn btn-primary',
            style: 'min-height: 44px;',
            onclick: async () => {
              const selectedUid = selectEl.value;
              if (!selectedUid) return;

              const targetNode = nodes.find(n => n.uid === selectedUid);
              if (targetNode && targetNode.classroomId && targetNode.classroomId !== cls.id) {
                const confirmed = window.confirm(`Node ${selectedUid} is used by '${targetNode.classroomName}'. Take it over?`);
                if (!confirmed) return;
              }

              assignBtn.disabled = true;
              try {
                const res = await api(`/api/teacher/classrooms/${cls.id}/node`, {
                  method: 'PUT',
                  body: { nodeUid: selectedUid }
                });
                const note = res.takenFrom ? ` (taken over from '${res.takenFrom}')` : '';
                showAlert(msgContainer, `Node ${selectedUid} assigned${note}.`, 'success');
                await loadData();
              } catch (e) {
                showAlert(msgContainer, e.message || 'Could not assign node.');
              } finally {
                assignBtn.disabled = false;
              }
            }
          }, 'Assign');

          const unassignBtn = cls.nodeUid ? h('button', {
            class: 'btn btn-danger',
            style: 'min-height: 44px;',
            onclick: async () => {
              if (!window.confirm(`Unlink node ${cls.nodeUid} from '${cls.name}'?`)) return;
              unassignBtn.disabled = true;
              try {
                await api(`/api/teacher/classrooms/${cls.id}/node`, {
                  method: 'DELETE'
                });
                showAlert(msgContainer, 'Node unlinked.', 'success');
                await loadData();
              } catch (e) {
                showAlert(msgContainer, e.message || 'Could not unlink node.');
              } finally {
                unassignBtn.disabled = false;
              }
            }
          }, 'Unassign') : null;

          nodeSection = h('div', { style: 'background: var(--bg-color); padding: 12px; border-radius: 8px;' },
            h('label', { style: 'margin-bottom: 6px;' },
              'Linked PHY_NODE: ',
              cls.nodeUid ? h('strong', {}, `${cls.nodeUid} ${cls.nodeLabel ? `(${cls.nodeLabel})` : ''}`) : h('span', { style: 'color: var(--text-muted);' }, 'None')
            ),
            h('div', { style: 'display: flex; gap: 8px; align-items: center; margin-top: 8px;' },
              selectEl,
              assignBtn,
              unassignBtn
            )
          );
        }

        classCard.appendChild(header);
        classCard.appendChild(actionRow);
        if (nodeSection) classCard.appendChild(nodeSection);

        classListContainer.appendChild(classCard);
      }
    } catch (err) {
      showAlert(msgContainer, err.message || 'Failed to load teacher dashboard data.');
    }
  }

  loadData();
}
