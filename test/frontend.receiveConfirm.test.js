// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, setGroupOrigin } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { exportGroup } from '../src/repo/exportImport.js';
import { validateShare } from '../src/repo/incomingShare.js';
import { offerReceivedShare } from '../src/ui/receiveConfirmModal.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { closeModal } from '../src/ui/modal.js';
import { db } from '../src/db.js';

beforeEach(resetDb);
afterEach(closeModal);

async function crewShare() {
  const crew = await createGroup('Crew');
  const boise = await createTrip({ groupId: crew.id, name: 'boise' });
  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  await setIsMe(ana.id);
  await addMember(crew.id, ana.id);
  await addMember(crew.id, ben.id);
  await createExpense({
    tripId: boise.id, payerId: ana.id, amountCents: 5000,
    description: 'Dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  return { crew, boise, ana, ben, share: await validateShare(await exportGroup(crew.id)) };
}

const counts = async () => ({
  groups: await db.groups.count(),
  people: await db.people.count(),
  expenses: await db.expenses.count(),
  splits: await db.splits.count()
});

describe('the receive confirmation sheet', () => {
  it('nothing is written until Add, and Cancel writes nothing at all', async () => {
    const { share } = await crewShare();
    await resetDb(); // receiving device is empty

    let outcome = null;
    await offerReceivedShare(share, { onDone: (o) => (outcome = o) });

    const overlay = document.getElementById('modal-overlay');
    expect(overlay.textContent).toContain('Add this share?');
    expect(overlay.textContent).toContain('New group');
    expect(overlay.textContent).toContain('Crew');
    // The sheet itself must not have imported anything.
    expect(await counts()).toMatchObject({ groups: 0, people: 0, expenses: 0, splits: 0 });

    overlay.querySelector('#rx-cancel').click();
    await new Promise((r) => setTimeout(r, 50));
    expect(outcome).toBe('cancelled');
    expect(await counts()).toMatchObject({ groups: 0, people: 0, expenses: 0, splits: 0 });
    expect(document.getElementById('modal-overlay')).toBeNull();
  });

  it('Add lands exactly the share, and the toast reports it', async () => {
    const { share } = await crewShare();
    await resetDb();

    let outcome = null;
    await offerReceivedShare(share, { onDone: (o) => (outcome = o) });
    document.getElementById('modal-overlay').querySelector('#rx-accept').click();
    await new Promise((r) => setTimeout(r, 100));

    expect(outcome).toBe('added');
    expect(await counts()).toMatchObject({ groups: 1, people: 2, expenses: 1, splits: 2 });
    expect(document.getElementById('toast')?.textContent).toMatch(/Share received/);
  });

  it('on a copy, an addition aimed at an existing trip is called out in red, with no checkboxes', async () => {
    const { crew, boise, ana, ben, share } = await crewShare();
    await setGroupOrigin(crew.id, 'received'); // this device holds a copy
    share.expenses = [...share.expenses, {
      id: 'their-extra', trip_id: boise.id, payer_id: ana.id,
      amount_cents: 700, description: 'Their extra', spent_at: Date.now(), created_at: Date.now()
    }];
    share.splits = [...share.splits, { id: 'their-split', expense_id: 'their-extra', person_id: ben.id, share_cents: 700 }];
    const validated = await validateShare(share);

    await offerReceivedShare(validated, {});
    const overlay = document.getElementById('modal-overlay');
    expect(overlay.textContent.replace(/\s+/g, ' ')).toContain('Adds to your existing trip boise: 1 expense');
    expect(overlay.textContent).not.toContain('New group');
    expect(overlay.querySelector('.rx-approve')).toBeNull();
    expect(crew.id).toBeTruthy();
  });

  it('on the master, each incoming expense gets its own checkbox with trip and cost', async () => {
    const { boise, ana, ben, share } = await crewShare();
    share.expenses = [...share.expenses,
      { id: 'x-1', trip_id: boise.id, payer_id: ana.id, amount_cents: 700, description: 'Their taco', spent_at: Date.now(), created_at: Date.now() },
      { id: 'x-2', trip_id: boise.id, payer_id: ana.id, amount_cents: 12500, description: 'Their hotel', spent_at: Date.now(), created_at: Date.now() }
    ];
    share.splits = [...share.splits,
      { id: 'sx-1', expense_id: 'x-1', person_id: ben.id, share_cents: 700 },
      { id: 'sx-2', expense_id: 'x-2', person_id: ben.id, share_cents: 12500 }
    ];
    const validated = await validateShare(share);

    await offerReceivedShare(validated, {});
    const overlay = document.getElementById('modal-overlay');
    const boxes = [...overlay.querySelectorAll('.rx-approve')];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((cb) => cb.checked)).toBe(true);
    const approvalsText = overlay.querySelector('#rx-approvals').textContent.replace(/\s+/g, ' ');
    expect(approvalsText).toContain('Crew › boise');
    expect(approvalsText).toContain('Their taco');
    expect(approvalsText).toContain('$7.00');
    expect(approvalsText).toContain('Their hotel');
    expect(approvalsText).toContain('$125.00');
    expect(overlay.querySelector('#rx-accept').textContent).toContain('Add checked to my ledger');
  });

  it('unchecking an expense keeps it (and its splits) out of the ledger', async () => {
    const { boise, ana, ben, share } = await crewShare();
    share.expenses = [...share.expenses,
      { id: 'x-1', trip_id: boise.id, payer_id: ana.id, amount_cents: 700, description: 'Their taco', spent_at: Date.now(), created_at: Date.now() },
      { id: 'x-2', trip_id: boise.id, payer_id: ana.id, amount_cents: 12500, description: 'Their hotel', spent_at: Date.now(), created_at: Date.now() }
    ];
    share.splits = [...share.splits,
      { id: 'sx-1', expense_id: 'x-1', person_id: ben.id, share_cents: 700 },
      { id: 'sx-2', expense_id: 'x-2', person_id: ben.id, share_cents: 12500 }
    ];
    const validated = await validateShare(share);
    const before = await counts();

    let outcome = null;
    await offerReceivedShare(validated, { onDone: (o) => (outcome = o) });
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('.rx-approve[data-id="x-2"]').checked = false;
    overlay.querySelector('#rx-accept').click();
    await new Promise((r) => setTimeout(r, 100));

    expect(outcome).toBe('added');
    const after = await counts();
    expect(after.expenses).toBe(before.expenses + 1); // taco yes, hotel no
    expect(after.splits).toBe(before.splits + 1);
    expect(await db.expenses.get('x-1')).toBeTruthy();
    expect(await db.expenses.get('x-2')).toBeUndefined();
    expect(await db.splits.get('sx-2')).toBeUndefined();
  });

  it('unchecking everything still lands nothing but the benign rows', async () => {
    const { boise, ana, ben, share } = await crewShare();
    share.expenses = [...share.expenses,
      { id: 'x-1', trip_id: boise.id, payer_id: ana.id, amount_cents: 700, description: 'Their taco', spent_at: Date.now(), created_at: Date.now() }
    ];
    share.splits = [...share.splits, { id: 'sx-1', expense_id: 'x-1', person_id: ben.id, share_cents: 700 }];
    const validated = await validateShare(share);
    const before = await counts();

    await offerReceivedShare(validated, {});
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('.rx-approve[data-id="x-1"]').checked = false;
    overlay.querySelector('#rx-accept').click();
    await new Promise((r) => setTimeout(r, 100));

    const after = await counts();
    expect(after.expenses).toBe(before.expenses);
    expect(after.splits).toBe(before.splits);
  });

  it('a share with nothing new collapses to Already up to date', async () => {
    const { share } = await crewShare();
    let outcome = null;
    await offerReceivedShare(share, { onDone: (o) => (outcome = o) });

    const overlay = document.getElementById('modal-overlay');
    expect(overlay.textContent).toContain('Already up to date');
    expect(overlay.querySelector('#rx-accept')).toBeNull();
    overlay.querySelector('#rx-close').click();
    expect(outcome).toBe('nothing-new');
  });
});
