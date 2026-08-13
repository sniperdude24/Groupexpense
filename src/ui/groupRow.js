import { setGroupArchived, deleteGroup, isGroupSettledUp } from '../repo/groups.js';
import { formatCents } from '../lib/money.js';
import { escapeHtml, toast, originBadge } from './helpers.js';
import { openModal, closeModal } from './modal.js';

export function balanceClass(cents) {
  if (cents > 0) return 'positive';
  if (cents < 0) return 'negative';
  return 'zero';
}

export function balanceLabel(cents) {
  if (cents === 0) return 'Settled up';
  return cents > 0 ? `you're owed ${formatCents(cents)}` : `you owe ${formatCents(-cents)}`;
}

export function groupRowHtml({ group, mine, linkTo }) {
  return `
    <div class="row group-row">
      <a class="group-row-link" href="#${linkTo || `/groups/${group.id}`}">
        <div class="row-title">${escapeHtml(group.name)} ${originBadge(group)}</div>
        <div class="row-sub">${balanceLabel(mine)}</div>
      </a>
      <div class="row-actions">
        <div class="amount ${balanceClass(mine)}">${mine === 0 ? '' : formatCents(Math.abs(mine))}</div>
        <button class="icon-btn archive-group-btn" data-id="${group.id}" data-archived="${group.archived}" title="${group.archived ? 'Unarchive' : 'Archive'}">${group.archived ? '&#9733;' : '&#9734;'}</button>
        <button class="icon-btn delete-group-btn" data-id="${group.id}" title="Delete">&#128465;</button>
      </div>
    </div>
  `;
}

export function wireGroupRowActions(container, onChange) {
  container.querySelectorAll('.archive-group-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const archived = btn.dataset.archived === 'true';
      await setGroupArchived(btn.dataset.id, !archived);
      toast(archived ? 'Group unarchived' : 'Group archived');
      onChange();
    });
  });

  container.querySelectorAll('.delete-group-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const settled = await isGroupSettledUp(btn.dataset.id);
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
      const overlay = document.getElementById('modal-overlay');
      overlay.querySelector('#delete-group-cancel').addEventListener('click', closeModal);
      overlay.querySelector('#delete-group-confirm').addEventListener('click', async () => {
        try {
          await deleteGroup(btn.dataset.id);
          closeModal();
          toast('Group deleted');
          onChange();
        } catch (err) {
          closeModal();
          toast(err.message || 'Could not delete group');
        }
      });
    });
  });
}
