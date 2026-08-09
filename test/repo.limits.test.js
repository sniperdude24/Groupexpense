import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember, listMembersOfGroup } from '../src/repo/memberships.js';
import { createExpense, updateExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { MAX_GROUP_MEMBERS, MAX_ENTRY_AMOUNT_CENTS } from '../src/lib/limits.js';

beforeEach(resetDb);

/** A group already holding `count` members. */
async function groupOfSize(count) {
  const group = await createGroup('Big crew');
  const people = [];
  for (let i = 0; i < count; i++) {
    const person = await createPerson({ name: `p${String(i + 1).padStart(2, '0')}` });
    await addMember(group.id, person.id);
    people.push(person);
  }
  return { group, people };
}

describe('the group-size limit', () => {
  it(`holds ${MAX_GROUP_MEMBERS} people and refuses one more`, async () => {
    const { group } = await groupOfSize(MAX_GROUP_MEMBERS - 1);

    const lastIn = await createPerson({ name: 'last one in' });
    await expect(addMember(group.id, lastIn.id)).resolves.toBeTruthy();

    const overflow = await createPerson({ name: 'one too many' });
    await expect(addMember(group.id, overflow.id)).rejects.toThrow(/at most 25 people/);

    const members = await listMembersOfGroup(group.id);
    expect(members).toHaveLength(MAX_GROUP_MEMBERS);
  });

  it('re-adding someone already in a full group is still a no-op, not a failure', async () => {
    const { group, people } = await groupOfSize(MAX_GROUP_MEMBERS);
    await expect(addMember(group.id, people[0].id)).resolves.toBeTruthy();
    expect(await listMembersOfGroup(group.id)).toHaveLength(MAX_GROUP_MEMBERS);
  });
});

describe('the per-entry amount limit', () => {
  async function tripWithTwo() {
    const group = await createGroup('Weekenders');
    const trip = await createTrip({ groupId: group.id, name: 'Cabin' });
    const a = await createPerson({ name: 'Ana' });
    const b = await createPerson({ name: 'Ben' });
    await addMember(group.id, a.id);
    await addMember(group.id, b.id);
    return { group, trip, a, b };
  }

  const expenseAt = (amountCents, { trip, a, b }) => ({
    tripId: trip.id,
    payerId: a.id,
    amountCents,
    description: 'Entry',
    spentAt: Date.now(),
    splits: computeEvenSplit(amountCents, [a.id, b.id])
  });

  it('accepts an expense exactly at the cap', async () => {
    const ctx = await tripWithTwo();
    const created = await createExpense(expenseAt(MAX_ENTRY_AMOUNT_CENTS, ctx));
    expect(created.amount_cents).toBe(MAX_ENTRY_AMOUNT_CENTS);
  });

  it('refuses an expense one cent over the cap', async () => {
    const ctx = await tripWithTwo();
    await expect(createExpense(expenseAt(MAX_ENTRY_AMOUNT_CENTS + 1, ctx))).rejects.toThrow(
      /at most \$10,000\.00/
    );
  });

  it('holds an edit to the same cap as a create', async () => {
    const ctx = await tripWithTwo();
    const created = await createExpense(expenseAt(5000, ctx));

    await expect(
      updateExpense(created.id, {
        payerId: ctx.a.id,
        amountCents: MAX_ENTRY_AMOUNT_CENTS + 1,
        description: 'Entry',
        category: null,
        spentAt: Date.now(),
        splits: computeEvenSplit(MAX_ENTRY_AMOUNT_CENTS + 1, [ctx.a.id, ctx.b.id])
      })
    ).rejects.toThrow(/at most \$10,000\.00/);
  });

  it('refuses a settlement over the cap', async () => {
    const { group, trip, a, b } = await tripWithTwo();
    await expect(
      createSettlement({
        groupId: group.id,
        tripId: trip.id,
        fromPerson: a.id,
        toPerson: b.id,
        amountCents: MAX_ENTRY_AMOUNT_CENTS + 1
      })
    ).rejects.toThrow(/at most \$10,000\.00/);
  });
});
