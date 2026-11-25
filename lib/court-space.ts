// Courts that share floor space (Cross-Sport Conflict Check). The indoor basketball court is also the
// volleyball court, and its two halves can be booked on their own. A court's `shared_space` lists the
// space units it occupies ("indoor-left,indoor-right" for the whole floor, "indoor-left" for one half);
// two courts can never be booked at the same time when they occupy a common unit. A court without
// units occupies only itself. No server imports: used by routes and the member app alike.
export type SpaceCourt = { id: number; sharedSpace?: string | null };

const unitPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function spaceUnits(court: SpaceCourt): string[] {
  const units = String(court.sharedSpace || "")
    .split(",")
    .map((unit) => unit.trim().toLowerCase())
    .filter((unit) => unitPattern.test(unit));
  return units.length ? [...new Set(units)] : [`court:${Number(court.id)}`];
}

// Normalised value to store, or null when the text holds no valid unit.
export function normalizeSharedSpace(value: string | null | undefined) {
  const units = String(value || "").split(",").map((unit) => unit.trim().toLowerCase()).filter(Boolean);
  if (!units.length) return null;
  if (units.some((unit) => !unitPattern.test(unit)) || units.length > 6) return undefined;
  return [...new Set(units)].join(",");
}

export function sharesSpace(a: SpaceCourt, b: SpaceCourt) {
  if (Number(a.id) === Number(b.id)) return true;
  const units = new Set(spaceUnits(a));
  return spaceUnits(b).some((unit) => units.has(unit));
}

// Ids of every court that conflicts with one of `ids` (the courts themselves included), ascending:
// the order in which booking paths lock court rows, so two bookings of shared space never deadlock.
export function linkedCourtIds(ids: number[], courts: SpaceCourt[]) {
  const linked = new Set(ids.map(Number));
  for (const id of ids) {
    const court = courts.find((item) => Number(item.id) === Number(id)) || { id };
    for (const other of courts) if (sharesSpace(court, other)) linked.add(Number(other.id));
  }
  return [...linked].sort((a, b) => a - b);
}
