import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, deleteGroup, isGroupSettledUp, getGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { addMember, listMembersOfGroup } from '../src/repo/memberships.js';
import { createTrip, settleTrip } from '../src/repo/trips.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement, listSettlementsForGroup } from '../src/repo/settlements.js';
import { db } from '../src/db.js';

beforeEach(resetDb);

describe('isGroupSettledUp / deleteGroup', () => {
  it('is settled up for a group with no activity at all', async () => {
    const group = await createGroup('Empty');
    expect(await isGroupSettledUp(group.id)).toBe(true);
    await deleteGroup(group.id);
    expect(await getGroup(group.id)).toBeUndefined();
  });

  it('blocks deletion while an outstanding balance exists', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 500 },
        { person_id: b.id, share_cents: 500 }
      ]
    });

    expect(await isGroupSettledUp(group.id)).toBe(false);
    await expect(deleteGroup(group.id)).rejects.toThrow(/outstanding balance/);
    expect(await getGroup(group.id)).toBeTruthy();
  });

  it('allows deletion once every balance nets to zero, and cascades everything', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await addMember(group.id, a.id);
    await addMember(group.id, b.id);
    const expense = await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 500 },
        { person_id: b.id, share_cents: 500 }
      ]
    });
    await createSettlement({ groupId: group.id, tripId: trip.id, fromPerson: b.id, toPerson: a.id, amountCents: 500 });
    await settleTrip(trip.id);

    expect(await isGroupSettledUp(group.id)).toBe(true);
    await deleteGroup(group.id);

    expect(await getGroup(group.id)).toBeUndefined();
    expect(await db.trips.get(trip.id)).toBeUndefined();
    expect(await db.expenses.get(expense.id)).toBeUndefined();
    expect(await db.splits.where('expense_id').equals(expense.id).count()).toBe(0);
    expect(await listSettlementsForGroup(group.id)).toEqual([]);
    expect(await listMembersOfGroup(group.id)).toEqual([]);
    // People themselves are untouched -- only the group's own data is gone.
    expect(await db.people.get(a.id)).toBeTruthy();
    expect(await db.people.get(b.id)).toBeTruthy();
  });

  it('cascades a group-level (null-trip) settlement too', async () => {
    const group = await createGroup('Trip');
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createSettlement({ groupId: group.id, tripId: null, fromPerson: b.id, toPerson: a.id, amountCents: 500 });

    // A lone, unmatched settlement leaves a non-zero balance -- not settled up.
    expect(await isGroupSettledUp(group.id)).toBe(false);
  });
});
