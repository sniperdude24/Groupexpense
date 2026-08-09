export class SettledTripError extends Error {
  constructor() {
    super('This trip is settled and read-only. Reopen it to make changes.');
    this.name = 'SettledTripError';
  }
}

export async function assertTripOpen(tx, tripId) {
  const trip = await tx.trips.get(tripId);
  if (!trip) throw new Error('Trip not found');
  if (trip.status === 'settled') throw new SettledTripError();
  return trip;
}
