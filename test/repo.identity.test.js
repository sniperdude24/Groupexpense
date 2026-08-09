import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, listPeople } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { createExpense } from '../src/repo/expenses.js';
import { computeTripBalance } from '../src/repo/queries.js';

beforeEach(resetDb);

describe('identity', () => {
  it('acceptance: two people named Bob added separately stay distinct with independent balances', async () => {
    const group = await createGroup('Poker night');
    const trip = await createTrip({ groupId: group.id, name: 'Weekly game' });
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob', note: 'from work' });

    expect(bob1.id).not.toBe(bob2.id);
    const all = await listPeople();
    expect(all.filter((p) => p.name === 'Bob')).toHaveLength(2);

    await createExpense({
      tripId: trip.id,
      payerId: bob1.id,
      amountCents: 1000,
      description: 'Chips',
      spentAt: Date.now(),
      splits: [
        { person_id: bob1.id, share_cents: 500 },
        { person_id: bob2.id, share_cents: 500 }
      ]
    });

    const { net } = await computeTripBalance(trip.id);
    expect(net.get(bob1.id)).toBe(500);
    expect(net.get(bob2.id)).toBe(-500);
  });

  it('only allows one person marked as "me"', async () => {
    await createPerson({ name: 'David', is_me: true });
    await expect(createPerson({ name: 'Someone else', is_me: true })).rejects.toThrow();
  });
});
