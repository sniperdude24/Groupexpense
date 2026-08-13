import { renameGroup, setGroupArchived, deleteGroup, isGroupSettledUp } from '../repo/groups.js';
import { escapeHtml, toast } from './helpers.js';
import { openModal, closeModal } from './modal.js';
import { navigate } from '../router.js';

export function openGroupSettingsModal(group, onRenamed) {
  openModal(`
    <h2>${escapeHtml(group.name)}</h2>
    <div class="field">
      <label for="rename-input">Rename group</label>
      <input id="rename-input" type="text" value="${escapeHtml(group.name)}" />
    </div>
    <div class="btn-row" style="margin-bottom:10px;">
      <button class="btn secondary" id="rename-save">Save name</button>
    </div>
    <button class="btn ghost" id="share-qr-btn">Share to another phone&hellip;</button>
    <button class="btn ghost" id="archive-btn" style="margin-top:10px;">${group.archived ? 'Unarchive group' : 'Archive group'}</button>
    <button class="btn ghost" id="delete-btn" style="margin-top:10px; color:var(--negative); border-color:var(--negative);">Delete group&hellip;</button>
  `);
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('#share-qr-btn').addEventListener('click', () => {
    closeModal();
    navigate(`/groups/${group.id}/share`);
  });
  overlay.querySelector('#rename-save').addEventListener('click', async () => {
    const val = overlay.querySelector('#rename-input').value.trim();
    if (!val) return;
    await renameGroup(group.id, val);
    closeModal();
    onRenamed();
  });
  overlay.querySelector('#archive-btn').addEventListener('click', async () => {
    await setGroupArchived(group.id, !group.archived);
    closeModal();
    toast(group.archived ? 'Group unarchived' : 'Group archived');
    navigate('/');
  });
  overlay.querySelector('#delete-btn').addEventListener('click', async () => {
    const settled = await isGroupSettledUp(group.id);
    if (!settled) {
      openModal(`
        <h2>Can't delete this group yet</h2>
        <p style="color:var(--text-dim); font-size:14px;">
          It still has an outstanding balance. Settle up first, or archive it instead to hide
          it without losing anything.
        </p>
        <button class="btn secondary" id="blocked-close">Close</button>
      `);
      document.getElementById('modal-overlay').querySelector('#blocked-close').addEventListener('click', closeModal);
      return;
    }
    openModal(`
      <h2>Delete this group?</h2>
      <p style="color:var(--text-dim); font-size:14px;">
        This permanently deletes the group and everything in it — trips, expenses, and payment
        history. This can't be undone.
      </p>
      <div class="btn-row">
        <button class="btn secondary" id="delete-group-cancel">Cancel</button>
        <button class="btn danger" id="delete-group-confirm">Delete</button>
      </div>
    `);
    const confirmOverlay = document.getElementById('modal-overlay');
    confirmOverlay.querySelector('#delete-group-cancel').addEventListener('click', closeModal);
    confirmOverlay.querySelector('#delete-group-confirm').addEventListener('click', async () => {
      try {
        await deleteGroup(group.id);
        closeModal();
        toast('Group deleted');
        navigate('/');
      } catch (err) {
        closeModal();
        toast(err.message || 'Could not delete group');
      }
    });
  });
}
