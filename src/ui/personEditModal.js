import { renamePerson, setPersonNote, setIsMe, listPeople } from '../repo/people.js';
import { mergePeople, previewMerge } from '../repo/merge.js';
import { escapeHtml, toast, onActivate } from './helpers.js';
import { openModal, closeModal } from './modal.js';

export function openPersonEditModal(person, onDone) {
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
    onDone();
  });
  overlay.querySelector('#edit-merge').addEventListener('click', async () => {
    const others = (await listPeople()).filter((p) => p.id !== person.id);
    openMergePicker(person, others, onDone);
  });
}

function openMergePicker(source, others, onDone) {
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
      openMergeConfirm(source, target, onDone);
    });
  });
}

async function openMergeConfirm(source, target, onDone) {
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
      onDone();
    } catch (err) {
      toast(err.message || 'Could not merge');
    }
  });
}
