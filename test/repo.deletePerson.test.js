import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, listPeople } from '../src/repo/people.js';
import { addMember, listMembersOfGroup } from '../src/repo/memberships.js';
import { createTrip, settleTrip, reopenTrip } from '../src/repo/trips.js';
import { createExpense, getExpenseWithSplits } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { computeTripBalance } from '../src/repo/queries.js';
import { previewDeletePerson, deletePerson } from '../src/repo/deletePerson.js';

beforeEach(resetDb);

async function threeWaySplitTrip() {
  const group = await createGroup('Trip');
  const trip = await createTrip({ groupId: group.id, name: 'Trip' });
  const a = await createPerson({ name: 'Alice' });
  const b = await createPerson({ name: 'Bob' });
  const c = await createPerson({ name: 'Carl' });
  await addMember(group.id, a.id);
  await addMember(group.id, b.id);
  await addMember(group.id, c.id);
  const expense = await createExpense({
    tripId: trip.id,
    payerId: a.id,
    amountCents: 1000,
    description: 'Dinner',
    spentAt: Date.now(),
    splits: [
      { person_id: a.id, share_cents: 334 },
      { person_id: b.id, share_cents: 333 },
      { person_id: c.id, share_cents: 333 }
    ]
  });
  return { group, trip, a, b, c, expense };
}

describe('deletePerson', () => {
  it('redistributes the deleted person\'s share evenly among the others on each expense', async () => {
    const { trip, a, b, c, expense } = await threeWaySplitTrip();

    await deletePerson(c.id);

    const { splits } = await getExpenseWithSplits(expense.id);
    expect(splits).toHaveLength(2);
    const total = splits.reduce((s, x) => s + x.share_cents, 0);
    expect(total).toBe(1000);
    // Carl's 333 cents split evenly across Alice and Bob: +167/+166 (deterministic by id).
    const byId = Object.fromEntries(splits.map((s) => [s.person_id, s.share_cents]));
    expect(byId[a.id] + byId[b.id]).toBe(1000);

    expect(await listPeople()).toHaveLength(2);
  });

  it('leaves other balances correct after redistribution', async () => {
    const { trip, a, b, c } = await threeWaySplitTrip();
    await deletePerson(c.id);
    const { net } = await computeTripBalance(trip.id);
    // Alice paid 1000 total, still owes her (now larger) share; Bob owes his.
    const total = [...net.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
    expect(net.get(a.id)).toBeGreaterThan(0);
  });

  it('removes the deleted person\'s group memberships', async () => {
    const group = await createGroup('Trip');
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await addMember(group.id, a.id);
    await addMember(group.id, b.id);

    await deletePerson(b.id);

    const members = await listMembersOfGroup(group.id);
    expect(members.map((m) => m.person.id)).toEqual([a.id]);
  });

  it('blocks deleting yourself', async () => {
    const me = await createPerson({ name: 'David', is_me: true });
    await expect(deletePerson(me.id)).rejects.toThrow(/yourself/);
    const preview = await previewDeletePerson(me.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.isMe).toBe(true);
  });

  it('blocks deleting someone who is the payer on an expense', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Gas',
      spentAt: Date.now(),
      splits: [{ person_id: b.id, share_cents: 1000 }]
    });

    await expect(deletePerson(a.id)).rejects.toThrow(/payer/);
    const preview = await previewDeletePerson(a.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.payerCount).toBe(1);
  });

  it('blocks deleting someone with recorded settlements', async () => {
    const group = await createGroup('Trip');
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createSettlement({ groupId: group.id, fromPerson: b.id, toPerson: a.id, amountCents: 500 });

    await expect(deletePerson(b.id)).rejects.toThrow(/payment/);
    const preview = await previewDeletePerson(b.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.settlementCount).toBe(1);
  });

  it('blocks deleting someone with a split in a settled trip until reopened', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Gas',
      spentAt: Date.now(),
      splits: [
        { person_id: a.id, share_cents: 500 },
        { person_id: b.id, share_cents: 500 }
      ]
    });
    await settleTrip(trip.id);

    await expect(deletePerson(b.id)).rejects.toThrow(/settled/);
    const preview = await previewDeletePerson(b.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.settledTripExpense).toBeTruthy();

    await reopenTrip(trip.id);
    await deletePerson(b.id);
    expect(await listPeople()).toHaveLength(1);
  });

  it('blocks deleting someone who is the sole participant on an expense', async () => {
    const group = await createGroup('Trip');
    const trip = await createTrip({ groupId: group.id, name: 'Trip' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Just for Bob',
      spentAt: Date.now(),
      splits: [{ person_id: b.id, share_cents: 1000 }]
    });

    await expect(deletePerson(b.id)).rejects.toThrow(/only person/);
    const preview = await previewDeletePerson(b.id);
    expect(preview.canDelete).toBe(false);
    expect(preview.soleParticipantExpense).toBeTruthy();
  });

  it('allows deleting someone with no financial footprint at all', async () => {
    const a = await createPerson({ name: 'Ghost' });
    const preview = await previewDeletePerson(a.id);
    expect(preview.canDelete).toBe(true);
    await deletePerson(a.id);
    expect(await listPeople()).toEqual([]);
  });
});
