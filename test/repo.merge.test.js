import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, getPerson, listPeople, getMe } from '../src/repo/people.js';
import { addMember, listMembersOfGroup } from '../src/repo/memberships.js';
import { createTrip } from '../src/repo/trips.js';
import { createExpense, getExpenseWithSplits } from '../src/repo/expenses.js';
import { createSettlement, listSettlementsForGroup } from '../src/repo/settlements.js';
import { computeGroupBalance } from '../src/repo/queries.js';
import { mergePeople, previewMerge } from '../src/repo/merge.js';

beforeEach(resetDb);

describe('mergePeople', () => {
  it('rejects merging a person into themselves', async () => {
    const a = await createPerson({ name: 'Alice' });
    await expect(mergePeople(a.id, a.id)).rejects.toThrow();
  });

  it('reassigns expense payer and deletes the source person', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob', note: 'the real one' });
    const expense = await createExpense({
      tripId: trip.id,
      payerId: bob1.id,
      amountCents: 1000,
      description: 'Gas',
      spentAt: Date.now(),
      splits: [{ person_id: bob1.id, share_cents: 1000 }]
    });

    await mergePeople(bob1.id, bob2.id);

    expect(await getPerson(bob1.id)).toBeUndefined();
    const { expense: reloaded, splits } = await getExpenseWithSplits(expense.id);
    expect(reloaded.payer_id).toBe(bob2.id);
    expect(splits).toHaveLength(1);
    expect(splits[0].person_id).toBe(bob2.id);
    expect(splits[0].share_cents).toBe(1000);
  });

  it('sums split shares instead of duplicating when both people are on the same expense', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob' });
    const expense = await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 400 },
        { person_id: bob1.id, share_cents: 300 },
        { person_id: bob2.id, share_cents: 300 }
      ]
    });

    await mergePeople(bob1.id, bob2.id);

    const { splits } = await getExpenseWithSplits(expense.id);
    expect(splits).toHaveLength(2);
    const total = splits.reduce((s, x) => s + x.share_cents, 0);
    expect(total).toBe(1000);
    const bobSplit = splits.find((s) => s.person_id === bob2.id);
    expect(bobSplit.share_cents).toBe(600);
  });

  it('drops the duplicate membership when both people are already in the same group', async () => {
    const group = await createGroup('Trip');
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob' });
    await addMember(group.id, bob1.id);
    await addMember(group.id, bob2.id);

    await mergePeople(bob1.id, bob2.id);

    const members = await listMembersOfGroup(group.id);
    expect(members).toHaveLength(1);
    expect(members[0].person.id).toBe(bob2.id);
  });

  it('reassigns a membership the target did not already have', async () => {
    const groupA = await createGroup('A');
    const groupB = await createGroup('B');
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob' });
    await addMember(groupA.id, bob1.id);
    await addMember(groupB.id, bob2.id);

    await mergePeople(bob1.id, bob2.id);

    expect(await listMembersOfGroup(groupA.id)).toHaveLength(1);
    expect(await listMembersOfGroup(groupB.id)).toHaveLength(1);
  });

  it('collapses a settlement between the two merged people instead of turning it into a self-payment', async () => {
    const group = await createGroup('Trip');
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob' });
    await createSettlement({ groupId: group.id, fromPerson: bob1.id, toPerson: bob2.id, amountCents: 500 });

    await mergePeople(bob1.id, bob2.id);

    const settlements = await listSettlementsForGroup(group.id);
    expect(settlements).toHaveLength(0);
  });

  it('reassigns settlements against other people without collapsing them', async () => {
    const group = await createGroup('Trip');
    const a = await createPerson({ name: 'Alice' });
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob' });
    await createSettlement({ groupId: group.id, fromPerson: bob1.id, toPerson: a.id, amountCents: 500 });

    await mergePeople(bob1.id, bob2.id);

    const settlements = await listSettlementsForGroup(group.id);
    expect(settlements).toHaveLength(1);
    expect(settlements[0].from_person).toBe(bob2.id);
    expect(settlements[0].to_person).toBe(a.id);
  });

  it('carries the is_me flag to the target when the source was "me"', async () => {
    const me = await createPerson({ name: 'David', is_me: true });
    const dupe = await createPerson({ name: 'Dave' });

    await mergePeople(me.id, dupe.id);

    expect(await getMe()).toMatchObject({ id: dupe.id, is_me: true });
  });

  it('produces the same group balance as if the two people were always one', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const bob1 = await createPerson({ name: 'Bob' });
    const bob2 = await createPerson({ name: 'Bob' });
    await addMember(group.id, a.id);
    await addMember(group.id, bob1.id);
    await addMember(group.id, bob2.id);

    await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 900,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 300 },
        { person_id: bob1.id, share_cents: 300 },
        { person_id: bob2.id, share_cents: 300 }
      ]
    });
    await createSettlement({ groupId: group.id, fromPerson: bob1.id, toPerson: a.id, amountCents: 100 });

    await mergePeople(bob1.id, bob2.id);

    const { net } = await computeGroupBalance(group.id);
    // Bob (combined) owed 600 total, paid back 100 -> owes 500 net.
    expect(net.get(bob2.id)).toBe(-500);
    expect(net.get(a.id)).toBe(500);
    expect(await listPeople()).toHaveLength(2);
  });
});

describe('previewMerge', () => {
  it('counts every row that would be touched', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const bob = await createPerson({ name: 'Bob' });
    await addMember(group.id, bob.id);
    await createExpense({
      tripId: trip.id,
      payerId: bob.id,
      amountCents: 1000,
      description: 'Gas',
      spentAt: Date.now(),
      splits: [{ person_id: bob.id, share_cents: 1000 }]
    });
    await createSettlement({ groupId: group.id, fromPerson: bob.id, toPerson: a.id, amountCents: 100 });

    const counts = await previewMerge(bob.id);
    expect(counts).toEqual({ expenses: 1, splits: 1, memberships: 1, settlements: 1 });
  });
});
