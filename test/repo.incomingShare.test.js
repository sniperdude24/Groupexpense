import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, setGroupOrigin } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { exportGroup, exportTrip, importData } from '../src/repo/exportImport.js';
import { validateShare, previewShare, filterAcceptedShare } from '../src/repo/incomingShare.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { MAX_ENTRY_AMOUNT_CENTS } from '../src/lib/limits.js';
import { db } from '../src/db.js';

beforeEach(resetDb);

async function crewWithTrip() {
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
  await createSettlement({
    groupId: crew.id, tripId: boise.id,
    fromPerson: ben.id, toPerson: ana.id, amountCents: 1000
  });
  return { crew, boise, ana, ben };
}

describe('validateShare accepts what the app itself produces', () => {
  it('exportGroup and exportTrip round-trip through validation unchanged', async () => {
    const { crew, boise } = await crewWithTrip();

    const groupShare = await exportGroup(crew.id);
    const validatedGroup = await validateShare(groupShare);
    expect(validatedGroup.expenses).toEqual(groupShare.expenses);
    expect(validatedGroup.splits).toEqual(groupShare.splits);

    const tripShare = await exportTrip(boise.id);
    await expect(validateShare(tripShare)).resolves.toBeTruthy();

    // And on a completely fresh device (no local rows to resolve against).
    await resetDb();
    await expect(validateShare(groupShare)).resolves.toBeTruthy();
    await expect(validateShare(tripShare)).resolves.toBeTruthy();
  });

  it('strips is_me no matter what the sender claimed', async () => {
    const { crew } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    share.people = share.people.map((p, i) => (i === 0 ? { ...p, is_me: true } : p));

    const validated = await validateShare(share);
    expect(validated.people.every((p) => p.is_me === false)).toBe(true);
  });

  it('rewrites every incoming group to a copy, whatever origin the sender claimed', async () => {
    const { crew } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    // A crafted payload claiming to BE the master.
    share.groups = share.groups.map((g) => ({ ...g, origin: 'created' }));

    const validated = await validateShare(share);
    expect(validated.groups.every((g) => g.origin === 'received')).toBe(true);
  });

  it('a re-share back to the master leaves its own row marked created', async () => {
    const { crew } = await crewWithTrip();
    expect((await db.groups.get(crew.id)).origin).toBe('created');

    const share = await exportGroup(crew.id);
    const validated = await validateShare(share);
    await importData(validated, { mode: 'merge' }); // insert-only: our row wins
    expect((await db.groups.get(crew.id)).origin).toBe('created');
  });
});

describe('validateShare rejects rogue payloads', () => {
  it('splits that do not sum to their expense', async () => {
    const { crew } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    share.splits = share.splits.map((s, i) => (i === 0 ? { ...s, share_cents: s.share_cents + 1 } : s));
    await expect(validateShare(share)).rejects.toThrow(/don't add up/);
  });

  it('a split aimed at an expense already on this device', async () => {
    const { crew, ana } = await crewWithTrip();
    const localExpense = (await exportGroup(crew.id)).expenses[0];

    const share = await exportGroup(crew.id);
    share.expenses = [];
    share.splits = [{ id: 'rogue-split', expense_id: localExpense.id, person_id: ana.id, share_cents: 100 }];
    share.settlements = [];
    await expect(validateShare(share)).rejects.toThrow(/split without its expense/);
  });

  it('amounts that are over the cap, negative, or not integers', async () => {
    const { crew } = await crewWithTrip();
    for (const amount of [MAX_ENTRY_AMOUNT_CENTS + 1, -100, 12.5]) {
      const share = await exportGroup(crew.id);
      share.expenses = share.expenses.map((e) => ({ ...e, amount_cents: amount }));
      await expect(validateShare(share)).rejects.toThrow(/invalid expense amount|don't add up/);
    }
  });

  it('dangling references and self-payments', async () => {
    const { crew } = await crewWithTrip();

    let share = await exportGroup(crew.id);
    share.memberships = [...share.memberships, { id: 'm-x', group_id: crew.id, person_id: 'ghost' }];
    await expect(validateShare(share)).rejects.toThrow(/membership points at nothing/);

    share = await exportGroup(crew.id);
    share.settlements = share.settlements.map((s) => ({ ...s, to_person: s.from_person }));
    await expect(validateShare(share)).rejects.toThrow(/themselves/);

    share = await exportGroup(crew.id);
    share.expenses = share.expenses.map((e) => ({ ...e, trip_id: 'ghost-trip' }));
    await expect(validateShare(share)).rejects.toThrow(/expense without its trip|don't add up/);
  });

  it('duplicate ids and wrong schema versions', async () => {
    const { crew } = await crewWithTrip();

    let share = await exportGroup(crew.id);
    share.people = [...share.people, { ...share.people[0] }];
    await expect(validateShare(share)).rejects.toThrow(/duplicate/);

    share = await exportGroup(crew.id);
    share.schema_version = 2;
    await expect(validateShare(share)).rejects.toThrow(/incompatible/);
  });
});

describe('previewShare', () => {
  it('describes a brand-new group share', async () => {
    const { crew } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    await resetDb(); // receiving device is empty

    const preview = await previewShare(share);
    expect(preview.newGroups).toEqual(['Crew']);
    expect(preview.newTrips).toHaveLength(1);
    expect(preview.newTrips[0]).toMatchObject({ name: 'boise', expenses: 1, groupIsNew: true });
    expect(new Set(preview.newPeople)).toEqual(new Set(['ana', 'ben']));
    expect(preview.existingTripAdditions).toHaveLength(0);
    expect(preview.totalNewRows).toBeGreaterThan(0);
  });

  it('calls out additions aimed at an existing trip (on a copy: no approvals)', async () => {
    const { crew, boise, ana, ben } = await crewWithTrip();
    await setGroupOrigin(crew.id, 'received'); // this device holds a copy
    const share = await exportGroup(crew.id);
    // The sender has one expense and one payment we don't have, on OUR trip.
    share.expenses = [...share.expenses, {
      id: 'new-expense', trip_id: boise.id, payer_id: ana.id,
      amount_cents: 700, description: 'Their extra', spent_at: Date.now(), created_at: Date.now()
    }];
    share.splits = [...share.splits, { id: 'new-split', expense_id: 'new-expense', person_id: ben.id, share_cents: 700 }];
    share.settlements = [...share.settlements, {
      id: 'new-pay', group_id: crew.id, trip_id: boise.id,
      from_person: ben.id, to_person: ana.id, amount_cents: 300, settled_at: Date.now()
    }];

    await expect(validateShare(share)).resolves.toBeTruthy();
    const preview = await previewShare(share);
    expect(preview.newGroups).toHaveLength(0);
    expect(preview.existingTripAdditions).toEqual([{ name: 'boise', expenses: 1, settlements: 1 }]);
    expect(preview.approvals).toHaveLength(0);
  });

  it('offers each expense for approval when this device holds the master copy', async () => {
    const { crew, boise, ana, ben } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    share.expenses = [...share.expenses, {
      id: 'new-expense', trip_id: boise.id, payer_id: ana.id,
      amount_cents: 700, description: 'Their extra', spent_at: Date.now(), created_at: Date.now()
    }];
    share.splits = [...share.splits, { id: 'new-split', expense_id: 'new-expense', person_id: ben.id, share_cents: 700 }];

    const preview = await previewShare(await validateShare(share));
    expect(preview.approvals).toEqual([{
      id: 'new-expense', groupName: 'Crew', tripName: 'boise',
      description: 'Their extra', amount_cents: 700
    }]);
    // Not double-reported as an aggregate red line.
    expect(preview.existingTripAdditions).toHaveLength(0);
  });
});

describe('filterAcceptedShare', () => {
  it('rejecting an expense drops its splits too, and the rest still validates', async () => {
    const { crew, boise, ana, ben } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    share.expenses = [...share.expenses, {
      id: 'e-a', trip_id: boise.id, payer_id: ana.id,
      amount_cents: 700, description: 'A', spent_at: Date.now(), created_at: Date.now()
    }, {
      id: 'e-b', trip_id: boise.id, payer_id: ana.id,
      amount_cents: 900, description: 'B', spent_at: Date.now(), created_at: Date.now()
    }];
    share.splits = [...share.splits,
      { id: 's-a', expense_id: 'e-a', person_id: ben.id, share_cents: 700 },
      { id: 's-b', expense_id: 'e-b', person_id: ben.id, share_cents: 900 }
    ];
    const validated = await validateShare(share);

    const filtered = filterAcceptedShare(validated, ['e-a']);
    expect(filtered.expenses.map((e) => e.id)).not.toContain('e-a');
    expect(filtered.expenses.map((e) => e.id)).toContain('e-b');
    expect(filtered.splits.map((s) => s.id)).not.toContain('s-a');
    expect(filtered.splits.map((s) => s.id)).toContain('s-b');
    // No orphan splits: the filtered payload passes the same gate.
    await expect(validateShare(filtered)).resolves.toBeTruthy();

    // Rejecting nothing hands back the payload untouched.
    expect(filterAcceptedShare(validated, [])).toBe(validated);
  });

  it('a new trip whose every expense was rejected is dropped; one with a payment stays', async () => {
    const { crew, ana, ben } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    share.trips = [...share.trips,
      { id: 'trip-x', group_id: crew.id, name: 'husk', status: 'open', created_at: Date.now() },
      { id: 'trip-y', group_id: crew.id, name: 'paid', status: 'open', created_at: Date.now() }
    ];
    share.expenses = [...share.expenses, {
      id: 'e-x', trip_id: 'trip-x', payer_id: ana.id,
      amount_cents: 500, description: 'X', spent_at: Date.now(), created_at: Date.now()
    }, {
      id: 'e-y', trip_id: 'trip-y', payer_id: ana.id,
      amount_cents: 600, description: 'Y', spent_at: Date.now(), created_at: Date.now()
    }];
    share.splits = [...share.splits,
      { id: 's-x', expense_id: 'e-x', person_id: ben.id, share_cents: 500 },
      { id: 's-y', expense_id: 'e-y', person_id: ben.id, share_cents: 600 }
    ];
    share.settlements = [...share.settlements, {
      id: 'pay-y', group_id: crew.id, trip_id: 'trip-y',
      from_person: ben.id, to_person: ana.id, amount_cents: 100, settled_at: Date.now()
    }];
    const validated = await validateShare(share);

    const filtered = filterAcceptedShare(validated, ['e-x', 'e-y']);
    // trip-x came only for its now-rejected expense: gone. trip-y still
    // carries a payment: kept, so the settlement doesn't dangle.
    expect(filtered.trips.map((t) => t.id)).not.toContain('trip-x');
    expect(filtered.trips.map((t) => t.id)).toContain('trip-y');
    await expect(validateShare(filtered)).resolves.toBeTruthy();
  });

  it('reports nothing new for a share we already have', async () => {
    const { crew } = await crewWithTrip();
    const share = await exportGroup(crew.id);
    const preview = await previewShare(share);
    expect(preview.totalNewRows).toBe(0);
  });
});
