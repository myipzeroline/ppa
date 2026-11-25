export type AvailabilityStatus = "available" | "full" | "past" | "closed";
export type CalendarDay = { date: string; status: AvailabilityStatus; availableSlots: number };
export type Court = { id: number; name: string; capacity: number; hourlyRate?: number | null; nightRate?: number | null; zone?: string | null; kind?: string | null; sharedSpace?: string | null; sportId?: number | null };
// A taken time on a court: a booking (with its sport and status) or a block (status "blocked").
export type Occupancy = { courtId: number; startsAt: string; endsAt: string; sportId?: number | null; status?: string | null };
// Right now on a court, for the status lights: free, booked (reserved, players not checked in yet),
// in use (checked in) or closed (maintenance or an event block).
export type CourtLiveStatus = "free" | "booked" | "in_use" | "closed";

// Members book until 23:00 unless the sport says otherwise (sports.open_hour / close_hour).
export const DEFAULT_OPEN_HOUR = 8;
export const DEFAULT_CLOSE_HOUR = 23;

export function bangkokToday(now = Date.now()) {
  return new Date(now + 7 * 3600000).toISOString().slice(0, 10);
}

export function datesInMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1000) return [];
  const start = new Date(`${month}-01T00:00:00Z`);
  const result: string[] = [];
  for (let day = 0; day < 31; day++) {
    const date = new Date(start.getTime() + day * 86400000).toISOString().slice(0, 10);
    if (!date.startsWith(month)) break;
    result.push(date);
  }
  return result;
}

// Start times "HH:00" from opening up to the last hour that ends by closing.
export function hourSlots(openHour = DEFAULT_OPEN_HOUR, closeHour = DEFAULT_CLOSE_HOUR) {
  const open = Math.max(0, Math.min(23, Math.trunc(Number(openHour)) || 0));
  const close = Math.max(open, Math.min(24, Math.trunc(Number(closeHour)) || 0));
  return Array.from({ length: close - open }, (_, index) => `${String(open + index).padStart(2, "0")}:00`);
}

// The 7 days shown in the week strip, from `from` (Bangkok calendar date); weekday 0 = Sunday.
export function weekDates(from: string, days = 7) {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const value = new Date(start + index * 86_400_000);
    return { date: value.toISOString().slice(0, 10), weekday: value.getUTCDay() };
  });
}

function overlaps(start: string, end: string, occupancy: Occupancy) {
  return start < occupancy.endsAt && end > occupancy.startsAt;
}

// The occupancy that takes this court at this time (on the court itself or on a court sharing its
// floor space, `linked`), or undefined.
export function takenBy(date: string, time: string, duration: number, courtId: number, bookings: Occupancy[], linked: number[] = [courtId]) {
  const hour = Number(time.slice(0, 2));
  const start = `${date} ${time}:00`;
  const end = `${date} ${String(hour + duration).padStart(2, "0")}:00:00`;
  const courts = new Set(linked.map(Number));
  return bookings.find((booking) => courts.has(Number(booking.courtId)) && overlaps(start, end, booking));
}

// SQL DATETIME is a Bangkok wall-clock value, not a browser-local timestamp.
export function slotStatus(date: string, time: string, duration: number, courtId: number, bookings: Occupancy[], now = Date.now(), options: { closeHour?: number; linked?: number[] } = {}): AvailabilityStatus {
  const hour = Number(time.slice(0, 2));
  if (hour + duration > (options.closeHour ?? DEFAULT_CLOSE_HOUR)) return "closed";
  if (new Date(`${date}T${time}:00+07:00`).getTime() < now) return "past";
  return takenBy(date, time, duration, courtId, bookings, options.linked) ? "full" : "available";
}

export function summarizeDay(date: string, statuses: AvailabilityStatus[], now = Date.now()): CalendarDay {
  const availableSlots = statuses.filter((status) => status === "available").length;
  const status = date < bangkokToday(now) ? "past" : availableSlots ? "available"
    : statuses.includes("full") ? "full" : statuses.includes("past") ? "past" : "closed";
  return { date, status, availableSlots };
}

// Bangkok wall-clock "YYYY-MM-DD HH:MM:SS" for an instant.
export function wallClock(now = Date.now()) {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

export function courtLiveStatus(courtId: number, occupancy: Occupancy[], now = Date.now(), linked: number[] = [courtId]): { status: CourtLiveStatus; until?: string; sportId?: number | null } {
  const moment = wallClock(now);
  const courts = new Set(linked.map(Number));
  const current = occupancy.filter((item) => courts.has(Number(item.courtId)) && item.startsAt <= moment && item.endsAt > moment);
  const block = current.find((item) => item.status === "blocked");
  if (block) return { status: "closed", until: block.endsAt.slice(11, 16) };
  const playing = current.find((item) => item.status === "checked_in");
  if (playing) return { status: "in_use", until: playing.endsAt.slice(11, 16), sportId: playing.sportId ?? null };
  const booked = current[0];
  if (booked) return { status: "booked", until: booked.endsAt.slice(11, 16), sportId: booked.sportId ?? null };
  return { status: "free" };
}
