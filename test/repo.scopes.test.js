import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip, settleTrip } from '../src/repo/trips.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { computeTripBalance, computeGroupBalance, computeGroupTripSummaries } from '../src/repo/queries.js';

beforeEach(resetDb);

describe('settling a trip', () => {
  it('acceptance: after settling, trip balance is zero and group total drops by exactly the settled amount', async () => {
    const group = await createGroup('Roomies');
    const trip = await createTrip({ groupId: group.id, name: 'March rent' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });

    await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 10000,
      description: 'Rent',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 5000 },
        { person_id: b.id, share_cents: 5000 }
      ]
    });

    let { net: groupNetBefore } = await computeGroupBalance(group.id);
    expect(groupNetBefore.get(a.id)).toBe(5000);

    await createSettlement({ groupId: group.id, tripId: trip.id, fromPerson: b.id, toPerson: a.id, amountCents: 5000 });
    await settleTrip(trip.id);

    const { net: tripNet } = await computeTripBalance(trip.id);
    expect(tripNet.get(a.id) || 0).toBe(0);
    expect(tripNet.get(b.id) || 0).toBe(0);

    const { net: groupNetAfter } = await computeGroupBalance(group.id);
    expect(groupNetAfter.get(a.id) || 0).toBe(0);
    expect((groupNetBefore.get(a.id) || 0) - (groupNetAfter.get(a.id) || 0)).toBe(5000);
  });
});

describe('group-level settlement', () => {
  it('acceptance: zeroes the group balance while underlying trips remain individually non-zero', async () => {
    const group = await createGroup('Ski house');
    const tripA = await createTrip({ groupId: group.id, name: 'Groceries' });
    const tripB = await createTrip({ groupId: group.id, name: 'Lift tickets' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });

    await createExpense({
      tripId: tripA.id,
      payerId: a.id,
      amountCents: 4000,
      description: 'Groceries',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 2000 },
        { person_id: b.id, share_cents: 2000 }
      ]
    });
    await createExpense({
      tripId: tripB.id,
      payerId: a.id,
      amountCents: 6000,
      description: 'Lift tickets',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 3000 },
        { person_id: b.id, share_cents: 3000 }
      ]
    });

    // Alice is owed 2000+3000 = 5000 across the group; settle at group level (trip_id null).
    await createSettlement({ groupId: group.id, tripId: null, fromPerson: b.id, toPerson: a.id, amountCents: 5000 });

    const { net: groupNet } = await computeGroupBalance(group.id);
    expect(groupNet.get(a.id) || 0).toBe(0);
    expect(groupNet.get(b.id) || 0).toBe(0);

    const summaries = await computeGroupTripSummaries(group.id);
    const tripANet = summaries.find((s) => s.trip.id === tripA.id).net;
    const tripBNet = summaries.find((s) => s.trip.id === tripB.id).net;
    expect(tripANet.get(a.id)).toBe(2000);
    expect(tripBNet.get(a.id)).toBe(3000);
  });
});
