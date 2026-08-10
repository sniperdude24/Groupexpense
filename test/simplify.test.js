import { describe, it, expect, beforeEach } from 'vitest';
import { simplifyDebts } from '../src/lib/simplify.js';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { computeTripBalance } from '../src/repo/queries.js';
import { computeEvenSplit } from '../src/lib/splits.js';

const net = (obj) => new Map(Object.entries(obj));
const totalMoved = (payments) => payments.reduce((s, p) => s + p.amount_cents, 0);

/** Apply a payment plan to the starting net positions; everyone should land on 0. */
function applyPlan(startingNet, payments) {
  const result = new Map(startingNet);
  for (const p of payments) {
    result.set(p.from, (result.get(p.from) || 0) + p.amount_cents);
    result.set(p.to, (result.get(p.to) || 0) - p.amount_cents);
  }
  return result;
}

describe('simplifyDebts', () => {
  it('collapses a chain: ana owes ben, ben owes cleo, so ana just pays cleo', () => {
    const positions = net({ ana: -1000, ben: 0, cleo: 1000 });
    const plan = simplifyDebts(positions);

    expect(plan).toEqual([{ from: 'ana', to: 'cleo', amount_cents: 1000 }]);
    expect([...applyPlan(positions, plan).values()].every((v) => v === 0)).toBe(true);
  });

  it('settles the worked example in 3 payments, not 4', () => {
    const positions = net({ ana: -3000, ben: -500, cleo: 2000, dana: 1500 });
    const plan = simplifyDebts(positions);

    expect(plan).toHaveLength(3);
    expect(totalMoved(plan)).toBe(3500);
    expect([...applyPlan(positions, plan).values()].every((v) => v === 0)).toBe(true);
  });

  it('pairs the largest debtor with the largest creditor each round', () => {
    // Pinned deliberately. Settling everyone and the n-1 bound both hold for
    // *any* order that moves min(debt, credit), so the property tests above
    // cannot see the greedy choice being dropped -- only the resulting plan
    // can. Taking the extremes first is what lets exact cancellations fall
    // out, and it keeps the largest, most-worth-doing payment at the top of
    // the list. Update these amounts only alongside a deliberate change.
    expect(simplifyDebts(net({ ana: -3000, ben: -500, cleo: 2000, dana: 1500 }))).toEqual([
      { from: 'ana', to: 'cleo', amount_cents: 2000 },
      { from: 'ana', to: 'dana', amount_cents: 1000 },
      { from: 'ben', to: 'dana', amount_cents: 500 }
    ]);
  });

  it('leaves nothing to do when everyone is already settled', () => {
    expect(simplifyDebts(net({ ana: 0, ben: 0 }))).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it('never suggests a payment to yourself, or a zero/negative amount', () => {
    const plan = simplifyDebts(net({ a: -700, b: -300, c: 250, d: 750 }));
    for (const p of plan) {
      expect(p.from).not.toBe(p.to);
      expect(p.amount_cents).toBeGreaterThan(0);
    }
  });

  it('is deterministic: identical balances give an identical plan', () => {
    const positions = net({ ana: -1234, ben: -4321, cleo: 3000, dana: 2555 });
    expect(simplifyDebts(positions)).toEqual(simplifyDebts(new Map([...positions.entries()].reverse())));
  });

  it('refuses to simplify balances that do not net to zero', () => {
    expect(() => simplifyDebts(net({ ana: -1000, ben: 500 }))).toThrow(/inconsistent/);
  });

  it('holds the n-1 bound and full settlement across many random cases', () => {
    // Deterministic PRNG so a failure is reproducible.
    let seed = 20260809;
    const rand = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    for (let trial = 0; trial < 300; trial++) {
      const count = 2 + rand(9);
      const ids = Array.from({ length: count }, (_, i) => `p${String(i).padStart(2, '0')}`);
      const positions = new Map();
      let running = 0;
      for (let i = 0; i < count - 1; i++) {
        const cents = rand(40001) - 20000;
        positions.set(ids[i], cents);
        running += cents;
      }
      // Last person absorbs the remainder so the set always nets to zero.
      positions.set(ids[count - 1], -running);

      const plan = simplifyDebts(positions);
      const unsettled = [...positions.values()].filter((v) => v !== 0).length;

      expect([...applyPlan(positions, plan).values()].every((v) => v === 0)).toBe(true);
      if (unsettled > 0) expect(plan.length).toBeLessThanOrEqual(unsettled - 1);
      for (const p of plan) expect(p.amount_cents).toBeGreaterThan(0);
    }
  });

  it('never suggests more payments than the raw pairwise list would', () => {
    const positions = net({ a: -5000, b: -3000, c: -1000, d: 4000, e: 5000 });
    const plan = simplifyDebts(positions);
    // 5 unsettled people -> at most 4 payments, versus up to 3x2 = 6 pairwise.
    expect(plan.length).toBeLessThanOrEqual(4);
    expect([...applyPlan(positions, plan).values()].every((v) => v === 0)).toBe(true);
  });
});

describe('simplification through the query layer', () => {
  beforeEach(resetDb);

  it('cuts a real trip down to fewer payments and still settles it', async () => {
    const group = await createGroup('Weekenders');
    const trip = await createTrip({ groupId: group.id, name: 'Cabin' });
    const people = [];
    for (const name of ['ana', 'ben', 'cleo', 'dave', 'edie']) {
      const person = await createPerson({ name });
      await addMember(group.id, person.id);
      people.push(person.id);
    }

    // Everyone pays for something, so the raw pairwise graph is dense.
    const rounds = [
      [1450, 0], [8631, 3], [5275, 1], [31200, 2], [4163, 4], [2700, 1], [9372, 3]
    ];
    for (const [cents, payerIdx] of rounds) {
      await createExpense({
        tripId: trip.id,
        payerId: people[payerIdx],
        amountCents: cents,
        description: `Expense ${cents}`,
        spentAt: Date.now(),
        splits: computeEvenSplit(cents, people)
      });
    }

    const { net: positions, pairwise, simplified } = await computeTripBalance(trip.id);

    expect(simplified.length).toBeLessThan(pairwise.length);
    expect(simplified.length).toBeLessThanOrEqual(people.length - 1);

    // The plan must actually zero everyone out.
    const settled = applyPlan(positions, simplified);
    expect([...settled.values()].every((v) => v === 0)).toBe(true);

    // And it must move no more money than the debts genuinely require.
    const owed = [...positions.values()].filter((v) => v < 0).reduce((s, v) => s - v, 0);
    expect(totalMoved(simplified)).toBe(owed);
  });
});
