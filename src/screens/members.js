import { getGroup } from '../repo/groups.js';
import { listMembersOfGroup, addMember, removeMember } from '../repo/memberships.js';
import { listPeople, createPerson } from '../repo/people.js';
import { escapeHtml, toast, onActivate } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';

export async function render(container, { groupId }) {
  const group = await getGroup(groupId);
  const members = await listMembersOfGroup(groupId);
  const memberPersonIds = new Set(members.map((m) => m.person.id));
  const allPeople = await listPeople();
  const nonMembers = allPeople.filter((p) => !memberPersonIds.has(p.id));

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/groups/${groupId}">&larr;</a>
      <h1>Members</h1>
    </div>
    <div class="screen">
      <div>
        <div class="section-title" style="margin-bottom:8px;">In this group</div>
        <div class="list">
          ${
            members.length === 0
              ? '<p class="empty">No members yet.</p>'
              : members
                  .map(
                    (m) => `<div class="row" style="cursor:default;">
                      <div>
                        <div class="row-title">${escapeHtml(m.person.name)}</div>
                        ${m.person.note ? `<div class="row-sub">${escapeHtml(m.person.note)}</div>` : ''}
                      </div>
                      <button class="icon-btn remove-btn" data-membership="${m.membership.id}">&times;</button>
                    </div>`
                  )
                  .join('')
          }
        </div>
      </div>

      <div>
        <div class="section-title" style="margin-bottom:8px;">Add from roster</div>
        <div class="list">
          ${
            nonMembers.length === 0
              ? '<p class="empty">Everyone in your roster is already in this group.</p>'
              : nonMembers
                  .map(
                    (p) => `<div class="row add-existing" data-person="${p.id}" role="button" tabindex="0">
                      <div>
                        <div class="row-title">${escapeHtml(p.name)}</div>
                        ${p.note ? `<div class="row-sub">${escapeHtml(p.note)}</div>` : ''}
                      </div>
                      <span class="nav-link">Add</span>
                    </div>`
                  )
                  .join('')
          }
        </div>
      </div>

      <button class="btn ghost" id="add-new-person">+ Add someone new</button>
    </div>
  `;

  container.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await removeMember(btn.dataset.membership);
      render(container, { groupId });
    });
  });

  container.querySelectorAll('.add-existing').forEach((row) => {
    onActivate(row, async () => {
      await addMember(groupId, row.dataset.person);
      render(container, { groupId });
    });
  });

  container.querySelector('#add-new-person').addEventListener('click', () => {
    openModal(`
      <h2>Add someone new</h2>
      <p style="color:var(--text-dim); font-size:13px; margin-top:-8px;">
        If this might be the same person as someone already in your roster, add them from the
        roster above instead — Split never merges people automatically.
      </p>
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
      const person = await createPerson({ name, note });
      await addMember(groupId, person.id);
      closeModal();
      toast('Person added');
      render(container, { groupId });
    });
  });
}
