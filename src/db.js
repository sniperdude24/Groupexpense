import Dexie from 'dexie';

export const db = new Dexie('group-expense-tracker');

db.version(1).stores({
  // archived and is_me are booleans, which IndexedDB cannot use as index
  // keys; both tables are small rosters, so these are filtered in memory.
  groups: 'id',
  people: 'id',
  memberships: 'id, group_id, person_id',
  trips: 'id, group_id, status',
  expenses: 'id, trip_id, payer_id, [trip_id+spent_at]',
  splits: 'id, expense_id, person_id',
  settlements: 'id, group_id, trip_id',
  meta: 'key'
});

export const SCHEMA_VERSION = 1;

export const TABLES = [
  'groups',
  'people',
  'memberships',
  'trips',
  'expenses',
  'splits',
  'settlements'
];
