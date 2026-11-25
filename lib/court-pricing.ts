// Court prices, shared by the booking routes, the member app and the counter calendar (this module has
// no server imports). Every court has a day rate and a night rate (กลางวัน / กลางคืน); the night rate
// applies to each hour from `nightFrom` (16:00) until closing. A court without its own rates uses its
// sport's; a missing night rate is the day rate x 1.5.
export type RateCard = { dayRate: number; nightRate: number; nightFrom: number };
export type SportRates = { baseRate?: number | string | null; nightRate?: number | string | null; nightFrom?: number | string | null };
export type CourtRates = { hourlyRate?: number | string | null; nightRate?: number | string | null };

export const DEFAULT_NIGHT_FROM = 16;

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hourOf(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 24 ? number : fallback;
}

export function rateCard(sport: SportRates, court?: CourtRates | null): RateCard {
  const courtDay = positive(court?.hourlyRate);
  const dayRate = courtDay || positive(sport.baseRate);
  // A court with its own day price but no night price is priced from its own day rate, not the sport's.
  const nightRate = positive(court?.nightRate) || (courtDay ? Math.round(courtDay * 1.5) : positive(sport.nightRate) || Math.round(dayRate * 1.5));
  return { dayRate, nightRate, nightFrom: hourOf(sport.nightFrom, DEFAULT_NIGHT_FROM) };
}

export function isNightHour(card: Pick<RateCard, "nightFrom">, hour: number) {
  return hour >= card.nightFrom;
}

// Each booked hour is priced by its own period: 15:00-17:00 is one day hour plus one night hour.
export function rateForSlot(card: RateCard, time: string, durationHours = 1) {
  const start = Number(time.slice(0, 2));
  let total = 0;
  for (let hour = start; hour < start + durationHours; hour += 1) total += isNightHour(card, hour) ? card.nightRate : card.dayRate;
  return Math.round(total);
}

// "180–250" for a list of courts with different prices, "800" when they all cost the same.
export function rateRange(cards: RateCard[]) {
  const values = cards.flatMap((card) => [card.dayRate, card.nightRate]).filter((value) => value > 0);
  if (!values.length) return { min: 0, max: 0 };
  return { min: Math.min(...values), max: Math.max(...values) };
}
