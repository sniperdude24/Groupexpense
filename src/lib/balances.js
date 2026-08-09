export function computeNetPositions(expenses, splits, settlements) {
  const net = new Map();
  const add = (personId, delta) => net.set(personId, (net.get(personId) || 0) + delta);

  for (const e of expenses) add(e.payer_id, e.amount_cents);
  for (const s of splits) add(s.person_id, -s.share_cents);
  for (const st of settlements) {
    add(st.from_person, st.amount_cents);
    add(st.to_person, -st.amount_cents);
  }
  return net;
}

export function computePairwiseBalances(expenses, splits, settlements) {
  const expenseById = new Map(expenses.map((e) => [e.id, e]));
  const pair = new Map();

  const addDebt = (debtor, creditor, amount) => {
    if (debtor === creditor || amount === 0) return;
    const [a, b] = [debtor, creditor].sort();
    const key = `${a}|${b}`;
    const sign = debtor === a ? 1 : -1;
    pair.set(key, (pair.get(key) || 0) + sign * amount);
  };

  for (const s of splits) {
    const e = expenseById.get(s.expense_id);
    if (!e) continue;
    if (s.person_id === e.payer_id) continue;
    addDebt(s.person_id, e.payer_id, s.share_cents);
  }

  for (const st of settlements) {
    addDebt(st.from_person, st.to_person, -st.amount_cents);
  }

  const result = [];
  for (const [key, amount] of pair.entries()) {
    if (amount === 0) continue;
    const [a, b] = key.split('|');
    if (amount > 0) result.push({ from: a, to: b, amount_cents: amount });
    else result.push({ from: b, to: a, amount_cents: -amount });
  }
  return result;
}
