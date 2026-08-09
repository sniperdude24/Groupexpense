import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip, settleTrip, reopenTrip } from '../src/repo/trips.js';
import {
  createSettlement,
  listSettlementsForTrip,
  listGroupLevelSettlements,
  deleteSettlement
} from '../src/repo/settlements.js';
import { SettledTripError } from '../src/repo/tripLock.js';
import { computeTripBalance, computeGroupBalance } from '../src/repo/queries.js';

beforeEach(resetDb);

describe('deleteSettlement', () => {
  it('deletes a trip-scoped settlement while the trip is open, updating balances immediately', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    const settlement = await createSettlement({ groupId: group.id, tripId: trip.id, fromPerson: b.id, toPerson: a.id, amountCents: 500 });

    let { net } = await computeTripBalance(trip.id);
    expect(net.get(a.id)).toBe(-500);

    await deleteSettlement(settlement.id);

    ({ net } = await computeTripBalance(trip.id));
    expect(net.get(a.id) || 0).toBe(0);
    expect(await listSettlementsForTrip(trip.id)).toEqual([]);
  });

  it('blocks deleting a trip-scoped settlement once the trip is settled', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    const settlement = await createSettlement({ groupId: group.id, tripId: trip.id, fromPerson: b.id, toPerson: a.id, amountCents: 500 });
    await settleTrip(trip.id);

    await expect(deleteSettlement(settlement.id)).rejects.toThrow(SettledTripError);

    await reopenTrip(trip.id);
    await deleteSettlement(settlement.id);
    expect(await listSettlementsForTrip(trip.id)).toEqual([]);
  });

  it('deletes a group-level settlement regardless of any trip status', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await settleTrip(trip.id);
    const settlement = await createSettlement({ groupId: group.id, tripId: null, fromPerson: b.id, toPerson: a.id, amountCents: 500 });

    let { net } = await computeGroupBalance(group.id);
    expect(net.get(a.id)).toBe(-500);

    await deleteSettlement(settlement.id);

    ({ net } = await computeGroupBalance(group.id));
    expect(net.get(a.id) || 0).toBe(0);
    expect(await listGroupLevelSettlements(group.id)).toEqual([]);
  });
});

describe('listGroupLevelSettlements', () => {
  it('excludes trip-scoped settlements, even within the same group', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createSettlement({ groupId: group.id, tripId: trip.id, fromPerson: b.id, toPerson: a.id, amountCents: 300 });
    const groupLevel = await createSettlement({ groupId: group.id, tripId: null, fromPerson: b.id, toPerson: a.id, amountCents: 700 });

    const result = await listGroupLevelSettlements(group.id);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(groupLevel.id);
  });
});
