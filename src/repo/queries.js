import { db } from '../db.js';
import { computeNetPositions, computePairwiseBalances } from '../lib/balances.js';
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
  return {
    net: computeNetPositions(expenses, splits, settlements),
    pairwise: computePairwiseBalances(expenses, splits, settlements)
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

export async function computeGroupBalance(groupId) {
  const { expenses, splits, settlements } = await getGroupScopeData(groupId);
  return {
    net: computeNetPositions(expenses, splits, settlements),
    pairwise: computePairwiseBalances(expenses, splits, settlements)
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
