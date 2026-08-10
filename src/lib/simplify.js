/**
 * Debt simplification -- turning a tangle of "who owes whom" into a short list
 * of payments that settles everyone at once.
 *
 * The idea
 * --------
 * The individual debts don't matter. If ana owes ben $10 and ben owes cleo
 * $10, nobody needs to make two payments -- ana can pay cleo $10 directly and
 * ben is untouched. What survives that cancellation is exactly each person's
 * *net* position, which computeNetPositions() already gives us. Those nets
 * always sum to zero, so the problem reduces to: given debtors and creditors
 * with equal totals, find a small set of payments between them that zeroes
 * everyone out.
 *
 * The algorithm
 * -------------
 * Greedy: repeatedly take the person who owes the most and the person who is
 * owed the most, and move min(debt, credit) between them. That payment always
 * zeroes at least one of the two, so each round permanently removes at least
 * one person from the problem -- which is both why it terminates and why it
 * produces at most n-1 payments for n unsettled people.
 *
 * How good is it?
 * ---------------
 * n-1 is a genuinely good bound; you can't beat it in the general case. It is
 * not guaranteed *minimal*, and it's worth being precise about why rather than
 * pretending otherwise: doing better requires finding subgroups whose balances
 * cancel exactly among themselves, which is the set-partition problem and
 * NP-hard. In practice this barely matters -- taking the two extremes each
 * round finds those exact-cancellation pairs whenever they are the extremes,
 * and at trip size the gap from optimal is typically zero.
 *
 * Note this deliberately ignores who transacted with whom: a suggested payment
 * may be between two people who never shared an expense. That is the point,
 * and it is what the raw pairwise view is still there for.
 */

/**
 * @param {Map<string, number>} net person id -> net cents (positive = is owed)
 * @returns {{from: string, to: string, amount_cents: number}[]} same shape as
 *   the pairwise balances, so either can feed the same UI
 */
export function simplifyDebts(net) {
  const entries = [...net.entries()];

  // Ties break by id so the same balances always produce the same plan --
  // otherwise the suggested payments would reshuffle between page loads.
  const byAmountThenId = (a, b) => b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const debtors = entries
    .filter(([, cents]) => cents < 0)
    .map(([id, cents]) => ({ id, amount: -cents }));
  const creditors = entries
    .filter(([, cents]) => cents > 0)
    .map(([id, cents]) => ({ id, amount: cents }));

  const owed = debtors.reduce((sum, d) => sum + d.amount, 0);
  const due = creditors.reduce((sum, c) => sum + c.amount, 0);
  if (owed !== due) {
    throw new Error(
      `Cannot simplify: debts (${owed}) and credits (${due}) disagree, so the balances are inconsistent`
    );
  }

  debtors.sort(byAmountThenId);
  creditors.sort(byAmountThenId);

  const payments = [];
  while (debtors.length && creditors.length) {
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.amount, creditor.amount);

    payments.push({ from: debtor.id, to: creditor.id, amount_cents: amount });

    debtor.amount -= amount;
    creditor.amount -= amount;

    // At least one of these is now zero, which is what guarantees termination.
    if (debtor.amount === 0) debtors.shift();
    if (creditor.amount === 0) creditors.shift();

    // Re-sort: whichever party survived is smaller now and may no longer lead.
    debtors.sort(byAmountThenId);
    creditors.sort(byAmountThenId);
  }

  return payments;
}
