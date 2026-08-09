import { describe, it, expect } from 'vitest';
import { computeNetPositions, computePairwiseBalances } from '../src/lib/balances.js';

describe('computeNetPositions', () => {
  it('spec sanity check: Dave pays $100 split with Bob, Bob repays $50', () => {
    const expenses = [{ id: 'e1', payer_id: 'dave', amount_cents: 10000 }];
    const splits = [
      { expense_id: 'e1', person_id: 'dave', share_cents: 5000 },
      { expense_id: 'e1', person_id: 'bob', share_cents: 5000 }
    ];
    let settlements = [];
    let net = computeNetPositions(expenses, splits, settlements);
    expect(net.get('dave')).toBe(5000);
    expect(net.get('bob')).toBe(-5000);

    settlements = [{ from_person: 'bob', to_person: 'dave', amount_cents: 5000 }];
    net = computeNetPositions(expenses, splits, settlements);
    expect(net.get('dave')).toBe(0);
    expect(net.get('bob')).toBe(0);
  });

  it('net positions always sum to zero', () => {
    const expenses = [
      { id: 'e1', payer_id: 'a', amount_cents: 3000 },
      { id: 'e2', payer_id: 'b', amount_cents: 1250 }
    ];
    const splits = [
      { expense_id: 'e1', person_id: 'a', share_cents: 1000 },
      { expense_id: 'e1', person_id: 'b', share_cents: 1000 },
      { expense_id: 'e1', person_id: 'c', share_cents: 1000 },
      { expense_id: 'e2', person_id: 'a', share_cents: 625 },
      { expense_id: 'e2', person_id: 'b', share_cents: 625 }
    ];
    const settlements = [{ from_person: 'c', to_person: 'a', amount_cents: 500 }];
    const net = computeNetPositions(expenses, splits, settlements);
    const total = [...net.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(0);
  });
});

describe('computePairwiseBalances', () => {
  it('nets a pair against its reverse', () => {
    const expenses = [
      { id: 'e1', payer_id: 'a', amount_cents: 3000 },
      { id: 'e2', payer_id: 'b', amount_cents: 1000 }
    ];
    const splits = [
      { expense_id: 'e1', person_id: 'b', share_cents: 3000 },
      { expense_id: 'e2', person_id: 'a', share_cents: 1000 }
    ];
    const balances = computePairwiseBalances(expenses, splits, []);
    expect(balances).toEqual([{ from: 'b', to: 'a', amount_cents: 2000 }]);
  });

  it('applies a settlement and can flip direction', () => {
    const expenses = [{ id: 'e1', payer_id: 'a', amount_cents: 1000 }];
    const splits = [{ expense_id: 'e1', person_id: 'b', share_cents: 1000 }];
    let balances = computePairwiseBalances(expenses, splits, [
      { from_person: 'b', to_person: 'a', amount_cents: 400 }
    ]);
    expect(balances).toEqual([{ from: 'b', to: 'a', amount_cents: 600 }]);

    balances = computePairwiseBalances(expenses, splits, [
      { from_person: 'b', to_person: 'a', amount_cents: 1500 }
    ]);
    expect(balances).toEqual([{ from: 'a', to: 'b', amount_cents: 500 }]);
  });

  it('omits a pair that nets to exactly zero', () => {
    const expenses = [{ id: 'e1', payer_id: 'a', amount_cents: 1000 }];
    const splits = [{ expense_id: 'e1', person_id: 'b', share_cents: 1000 }];
    const balances = computePairwiseBalances(expenses, splits, [
      { from_person: 'b', to_person: 'a', amount_cents: 1000 }
    ]);
    expect(balances).toEqual([]);
  });
});
