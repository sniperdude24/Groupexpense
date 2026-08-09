import { listArchivedGroups } from '../repo/groups.js';
import { getMe } from '../repo/people.js';
import { computeGroupBalance } from '../repo/queries.js';
import { groupRowHtml, wireGroupRowActions } from '../ui/groupRow.js';

export async function render(container) {
  const me = await getMe();
  const groups = await listArchivedGroups();
  const rows = await Promise.all(
    groups.map(async (g) => {
      const { net } = await computeGroupBalance(g.id);
      const mine = me ? net.get(me.id) || 0 : 0;
      return { group: g, mine };
    })
  );

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>Archived groups</h1>
    </div>
    <div class="screen">
      ${
        rows.length === 0
          ? '<p class="empty">No archived groups yet. Tap the star on a group to archive it.</p>'
          : `<div class="list">${rows.map(groupRowHtml).join('')}</div>`
      }
    </div>
  `;

  wireGroupRowActions(container, () => render(container));
}
