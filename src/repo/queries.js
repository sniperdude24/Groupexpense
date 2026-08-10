import { db } from '../db.js';
import { computeNetPositions, computePairwiseBalances } from '../lib/balances.js';
import { simplifyDebts } from '../lib/simplify.js';
import { listTripsOfGroup } from './trips.js';
import { listSettlementsForGroup, listSettlementsForTrip } from './settlements.js';

async function splitsForExpenses(expenseIds) {
  if (!expenseIds.length) return [];
  return db.splits.where('expense_id').anyOf(expenseIds).toArray();
}

export async function getTripScopeData(tripId) {
  const expenses = await db.expenses.where('trip_id').equals(tripId).toArray();
  const splits = await splitsForExpenses(expenses.map((e) => e.id));
  const settlements = await listSettlementsForTrip(tripId);
  return { expenses, splits, settlements };
}

export async function computeTripBalance(tripId) {
  const { expenses, splits, settlements } = await getTripScopeData(tripId);
  const net = computeNetPositions(expenses, splits, settlements);
  return {
    net,
    pairwise: computePairwiseBalances(expenses, splits, settlements),
    simplified: simplifyDebts(net)
  };
}

export async function getGroupScopeData(groupId) {
  const trips = await listTripsOfGroup(groupId);
  const tripIds = trips.map((t) => t.id);
  const expenses = tripIds.length
    ? await db.expenses.where('trip_id').anyOf(tripIds).toArray()
    : [];
  const splits = await splitsForExpenses(expenses.map((e) => e.id));
  const settlements = await listSettlementsForGroup(groupId);
  return { trips, expenses, splits, settlements };
}

export async function computeGroupBalance(groupId, { includeExcluded = false } = {}) {
  const { trips, expenses, splits, settlements } = await getGroupScopeData(groupId);

  // An excluded trip keeps its own books but stays out of the group ledger:
  // its expenses, its splits and its trip-scoped settlements all drop out.
  // Group-level settlements (trip_id null) always count. includeExcluded is
  // for the deletion safety check, which must see every debt regardless.
  const excludedIds = new Set(
    includeExcluded ? [] : trips.filter((t) => t.excluded).map((t) => t.id)
  );
  const keptExpenses = expenses.filter((e) => !excludedIds.has(e.trip_id));
  const keptExpenseIds = new Set(keptExpenses.map((e) => e.id));
  const keptSplits = splits.filter((s) => keptExpenseIds.has(s.expense_id));
  const keptSettlements = settlements.filter((s) => !s.trip_id || !excludedIds.has(s.trip_id));

  const net = computeNetPositions(keptExpenses, keptSplits, keptSettlements);
  return {
    net,
    pairwise: computePairwiseBalances(keptExpenses, keptSplits, keptSettlements),
    simplified: simplifyDebts(net)
  };
}

export async function computeGroupTripSummaries(groupId) {
  const { trips, expenses, splits, settlements } = await getGroupScopeData(groupId);
  return trips.map((trip) => {
    const tripExpenses = expenses.filter((e) => e.trip_id === trip.id);
    const tripExpenseIds = new Set(tripExpenses.map((e) => e.id));
    const tripSplits = splits.filter((s) => tripExpenseIds.has(s.expense_id));
    const tripSettlements = settlements.filter((s) => s.trip_id === trip.id);
    return {
      trip,
      net: computeNetPositions(tripExpenses, tripSplits, tripSettlements),
      pairwise: computePairwiseBalances(tripExpenses, tripSplits, tripSettlements)
    };
  });
}
