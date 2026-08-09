import { listPeople, createPerson, renamePerson, setPersonNote, setIsMe } from '../repo/people.js';
import { mergePeople, previewMerge } from '../repo/merge.js';
import { escapeHtml, toast, onActivate } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';

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
      openEditModal(container, person);
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
  });
}

function openEditModal(container, person) {
  openModal(`
    <h2>Edit person</h2>
    <div class="field">
      <label for="edit-name">Name</label>
      <input id="edit-name" type="text" value="${escapeHtml(person.name)}" autocomplete="off" />
    </div>
    <div class="field">
      <label for="edit-note">Note</label>
      <input id="edit-note" type="text" value="${escapeHtml(person.note || '')}" placeholder="e.g. Bob from work" autocomplete="off" />
    </div>
    <label class="checkbox-row" style="margin-bottom:16px;">
      <input type="checkbox" id="edit-is-me" ${person.is_me ? 'checked' : ''} />
      <span>This is me</span>
    </label>
    <div class="btn-row">
      <button class="btn secondary" id="edit-cancel">Cancel</button>
      <button class="btn" id="edit-save">Save</button>
    </div>
    <button class="btn ghost" id="edit-merge" style="margin-top:10px;">Merge into another person&hellip;</button>
  `);
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('#edit-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#edit-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#edit-name').value.trim();
    if (!name) return;
    const note = overlay.querySelector('#edit-note').value.trim();
    const isMe = overlay.querySelector('#edit-is-me').checked;
    await renamePerson(person.id, name);
    await setPersonNote(person.id, note);
    if (isMe && !person.is_me) await setIsMe(person.id);
    closeModal();
    render(container);
  });
  overlay.querySelector('#edit-merge').addEventListener('click', async () => {
    const others = (await listPeople()).filter((p) => p.id !== person.id);
    openMergePicker(container, person, others);
  });
}

function openMergePicker(container, source, others) {
  if (others.length === 0) {
    openModal(`
      <h2>Merge into another person</h2>
      <p style="color:var(--text-dim); font-size:14px;">There's no one else in your roster to merge into.</p>
      <button class="btn secondary" id="picker-close">Close</button>
    `);
    document.getElementById('modal-overlay').querySelector('#picker-close').addEventListener('click', closeModal);
    return;
  }

  openModal(`
    <h2>Merge ${escapeHtml(source.name)} into&hellip;</h2>
    <p style="color:var(--text-dim); font-size:14px;">
      Pick who ${escapeHtml(source.name)}'s expenses, splits, memberships and payments should move
      to. ${escapeHtml(source.name)} will be deleted.
    </p>
    <div class="roster-pick">
      ${others
        .map(
          (p) => `<div class="row merge-target" data-id="${p.id}" role="button" tabindex="0">
            <div>
              <div class="row-title">${escapeHtml(p.name)}</div>
              ${p.note ? `<div class="row-sub">${escapeHtml(p.note)}</div>` : ''}
            </div>
          </div>`
        )
        .join('')}
    </div>
    <button class="btn ghost" id="picker-cancel">Cancel</button>
  `);
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('#picker-cancel').addEventListener('click', closeModal);
  overlay.querySelectorAll('.merge-target').forEach((row) => {
    onActivate(row, () => {
      const target = others.find((p) => p.id === row.dataset.id);
      openMergeConfirm(container, source, target);
    });
  });
}

async function openMergeConfirm(container, source, target) {
  const counts = await previewMerge(source.id);
  const parts = [];
  if (counts.expenses) parts.push(`${counts.expenses} expense${counts.expenses === 1 ? '' : 's'}`);
  if (counts.splits) parts.push(`${counts.splits} split${counts.splits === 1 ? '' : 's'}`);
  if (counts.memberships) parts.push(`${counts.memberships} group membership${counts.memberships === 1 ? '' : 's'}`);
  if (counts.settlements) parts.push(`${counts.settlements} payment${counts.settlements === 1 ? '' : 's'}`);
  const summary = parts.length ? parts.join(', ') : 'nothing yet';

  openModal(`
    <h2>Merge ${escapeHtml(source.name)} into ${escapeHtml(target.name)}?</h2>
    <p style="color:var(--text-dim); font-size:14px;">
      This moves ${summary} from ${escapeHtml(source.name)} to ${escapeHtml(target.name)}, then
      deletes ${escapeHtml(source.name)}. This cannot be undone.
    </p>
    <div class="btn-row">
      <button class="btn secondary" id="confirm-cancel">Cancel</button>
      <button class="btn danger" id="confirm-merge">Merge</button>
    </div>
  `);
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('#confirm-cancel').addEventListener('click', closeModal);
  overlay.querySelector('#confirm-merge').addEventListener('click', async () => {
    try {
      await mergePeople(source.id, target.id);
      closeModal();
      toast(`Merged into ${target.name}`);
      render(container);
    } catch (err) {
      toast(err.message || 'Could not merge');
    }
  });
}
