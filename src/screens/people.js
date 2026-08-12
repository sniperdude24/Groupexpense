import { listPeople, createPerson } from '../repo/people.js';
import { escapeHtml, toast, onActivate, submitOnEnter } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { openPersonEditModal } from '../ui/personEditModal.js';

export async function render(container) {
  const people = await listPeople();
  people.sort((a, b) => a.name.localeCompare(b.name));

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>People</h1>
    </div>
    <div class="screen">
      <div class="list">
        ${
          people.length === 0
            ? '<p class="empty">No one in your roster yet.</p>'
            : people
                .map(
                  (p) => `<div class="row edit-person" data-id="${p.id}" role="button" tabindex="0">
                    <div>
                      <div class="row-title">${escapeHtml(p.name)}${p.is_me ? ' (you)' : ''}</div>
                      ${p.note ? `<div class="row-sub">${escapeHtml(p.note)}</div>` : ''}
                    </div>
                  </div>`
                )
                .join('')
        }
      </div>
      <button class="btn secondary" id="add-person-btn">+ Add person</button>
    </div>
  `;

  container.querySelectorAll('.edit-person').forEach((row) => {
    onActivate(row, () => {
      const person = people.find((p) => p.id === row.dataset.id);
      openPersonEditModal(person, () => render(container));
    });
  });

  container.querySelector('#add-person-btn').addEventListener('click', () => {
    openModal(`
      <h2>Add someone new</h2>
      <div class="field">
        <label for="new-name">Name</label>
        <input id="new-name" type="text" autocomplete="off" />
      </div>
      <div class="field">
        <label for="new-note">Note (optional)</label>
        <input id="new-note" type="text" placeholder="e.g. Bob from work" autocomplete="off" />
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="new-cancel">Cancel</button>
        <button class="btn" id="new-create">Add</button>
      </div>
    `);
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('#new-cancel').addEventListener('click', closeModal);
    const nameInput = overlay.querySelector('#new-name');
    nameInput.focus();
    overlay.querySelector('#new-create').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const note = overlay.querySelector('#new-note').value.trim();
      await createPerson({ name, note });
      closeModal();
      toast('Person added');
      render(container);
    });
    submitOnEnter(overlay.querySelector('#new-create'), nameInput, overlay.querySelector('#new-note'));
  });
}
