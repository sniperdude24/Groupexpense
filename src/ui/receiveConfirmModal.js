import { importData } from '../repo/exportImport.js';
import { previewShare, filterAcceptedShare } from '../repo/incomingShare.js';
import { openModal, closeModal } from './modal.js';
import { escapeHtml, toast } from './helpers.js';
import { formatCents } from '../lib/money.js';
import { navigate } from '../router.js';

/**
 * The confirmation sheet between a scanned share and the ledger. Nothing is
 * written until "Add to my ledger" -- and the sheet spells out exactly what
 * would be added, with additions to trips that already exist on this device
 * called out loudest, because that's what a rogue share would aim for.
 */
export async function offerReceivedShare(payload, { onDone } = {}) {
  const preview = await previewShare(payload);

  if (preview.totalNewRows === 0) {
    openModal(`
      <h2>Already up to date</h2>
      <p style="color:var(--text-dim); font-size:14px;">
        Everything in that share is already on this device. Nothing to add.
      </p>
      <button class="btn secondary" id="rx-close">Close</button>
    `);
    document.getElementById('modal-overlay').querySelector('#rx-close').addEventListener('click', () => {
      closeModal();
      onDone?.('nothing-new');
    });
    return;
  }

  const lines = [];
  for (const name of preview.newGroups) {
    lines.push(`New group: <strong>${escapeHtml(name)}</strong>`);
  }
  for (const trip of preview.newTrips) {
    lines.push(
      `New trip <strong>${escapeHtml(trip.name)}</strong>` +
        `${trip.groupIsNew ? '' : ` in your existing group <strong>${escapeHtml(trip.groupName)}</strong>`}` +
        ` &mdash; ${trip.expenses} expense${trip.expenses === 1 ? '' : 's'}`
    );
  }
  for (const t of preview.existingTripAdditions) {
    const parts = [];
    if (t.expenses) parts.push(`${t.expenses} expense${t.expenses === 1 ? '' : 's'}`);
    if (t.settlements) parts.push(`${t.settlements} payment${t.settlements === 1 ? '' : 's'}`);
    lines.push(
      `<span style="color:var(--negative);">Adds to your existing trip
        <strong>${escapeHtml(t.name)}</strong>: ${parts.join(', ')}</span>`
    );
  }
  if (preview.newPeople.length) {
    lines.push(`New people: ${preview.newPeople.map((n) => escapeHtml(n)).join(', ')}`);
  }

  // This phone holds the master copy of the group these expenses target, so
  // each one is approved on its own line rather than riding a bulk accept.
  // Grouped under "group › trip" headings, checked by default.
  let approvalsHtml = '';
  if (preview.approvals.length) {
    const byHeading = new Map();
    for (const a of preview.approvals) {
      const heading = `${escapeHtml(a.groupName)} &rsaquo; ${escapeHtml(a.tripName)}`;
      if (!byHeading.has(heading)) byHeading.set(heading, []);
      byHeading.get(heading).push(a);
    }
    approvalsHtml = `
      <div id="rx-approvals" style="margin:0 0 6px;">
        <div class="section-title" style="margin-bottom:6px;">Approve each expense</div>
        ${[...byHeading.entries()]
          .map(
            ([heading, items]) => `
              <div style="color:var(--text-dim); font-size:12px; margin:6px 0 2px;">${heading}</div>
              ${items
                .map(
                  (a) => `
                    <label style="display:flex; align-items:center; gap:8px; font-size:14px; padding:4px 0; cursor:pointer;">
                      <input type="checkbox" class="rx-approve" data-id="${escapeHtml(a.id)}" checked />
                      <span style="flex:1;">${escapeHtml(a.description)}</span>
                      <span class="amount">${formatCents(a.amount_cents)}</span>
                    </label>`
                )
                .join('')}`
          )
          .join('')}
      </div>`;
  }

  openModal(`
    <h2>Add this share?</h2>
    <ul style="color:var(--text-dim); font-size:14px; margin:0 0 6px; padding-left:18px; line-height:1.6;">
      ${lines.map((l) => `<li>${l}</li>`).join('')}
    </ul>
    ${approvalsHtml}
    <p style="color:var(--text-dim); font-size:13px;">
      Nothing already on this device changes &mdash; adding can only add.
    </p>
    <div class="btn-row">
      <button class="btn secondary" id="rx-cancel">Cancel</button>
      <button class="btn" id="rx-accept">${preview.approvals.length ? 'Add checked to my ledger' : 'Add to my ledger'}</button>
    </div>
  `);

  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('#rx-cancel').addEventListener('click', () => {
    closeModal();
    onDone?.('cancelled');
  });
  overlay.querySelector('#rx-accept').addEventListener('click', async () => {
    try {
      const rejectedIds = [...overlay.querySelectorAll('.rx-approve')]
        .filter((cb) => !cb.checked)
        .map((cb) => cb.dataset.id);
      const accepted = filterAcceptedShare(payload, rejectedIds);
      const summary = await importData(accepted, { mode: 'merge' });
      const added = Object.values(summary).reduce((s, t) => s + t.imported, 0);
      closeModal();
      toast(`Share received — ${added} new record${added === 1 ? '' : 's'}`);
      const groupId = payload.groups && payload.groups[0] && payload.groups[0].id;
      navigate(groupId ? `/groups/${groupId}` : '/');
      onDone?.('added');
    } catch (err) {
      closeModal();
      toast(err.message || 'Could not add that share');
      onDone?.('failed');
    }
  });
}
