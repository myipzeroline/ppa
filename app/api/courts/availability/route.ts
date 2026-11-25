import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildSlotRange } from "@/lib/booking-rules";
import { bangkokToday, courtLiveStatus, datesInMonth, DEFAULT_CLOSE_HOUR, DEFAULT_OPEN_HOUR, hourSlots, slotStatus, summarizeDay, takenBy, type Court, type Occupancy } from "@/lib/court-availability";
import { rateCard, rateForSlot } from "@/lib/court-pricing";
import { linkedCourtIds, spaceUnits, type SpaceCourt } from "@/lib/court-space";
import { placeholders } from "@/lib/court-schedule";
import { checkRateLimit, clientIp, secureResponse, validationErrorResponse } from "@/lib/security";

const schema = z.object({
  sport: z.string().min(1).max(80),
  date: z.string().optional(),
  month: z.string().optional(),
  durationHours: z.coerce.number().int().min(1).max(4).default(1),
}).refine((input) => Boolean(input.date) !== Boolean(input.month), "Provide date or month")
  .refine((input) => input.date ? Boolean(buildSlotRange(input.date, "08:00")) : datesInMonth(input.month || "").length > 0, "Invalid calendar date");

type SportRow = { id: number; name?: string; baseRate: number; nightRate?: number | null; nightFrom?: number | null; openHour?: number | null; closeHour?: number | null };
type LinkedRow = SpaceCourt & { sportId?: number | null };

function hour(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 24 ? number : fallback;
}

export async function GET(req: Request) {
  const limited = checkRateLimit({ key: `availability:${await clientIp()}`, limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  try {
    await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const url = new URL(req.url);
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(Object.fromEntries(url.searchParams));
  } catch (error) {
    return validationErrorResponse(error);
  }
  const dates = input.date ? [input.date] : datesInMonth(input.month!);
  const sports = await query<SportRow>(
    "SELECT id, name_th name, base_rate baseRate, night_rate nightRate, night_from nightFrom, open_hour openHour, close_hour closeHour FROM sports WHERE (slug = ? OR name_th = ?) AND active = TRUE LIMIT 1",
    [input.sport, input.sport],
  );
  const sport = sports[0];
  if (!sport) return secureResponse(NextResponse.json({ message: "ไม่พบกีฬาที่เปิดให้จอง" }, { status: 404 }));
  const openHour = hour(sport.openHour, DEFAULT_OPEN_HOUR);
  const closeHour = Math.max(openHour + 1, hour(sport.closeHour, DEFAULT_CLOSE_HOUR));

  const courts = await query<Court>(
    "SELECT id, name, zone, court_kind kind, capacity, hourly_rate hourlyRate, night_rate nightRate, shared_space sharedSpace FROM courts WHERE sport_id = ? AND status = 'available' ORDER BY sort_order, id",
    [sport.id],
  );
  // Courts of other sports on the same floor (the indoor basketball court for volleyball): their
  // bookings and blocks take this sport's court too. Read only when one of the courts shares space.
  const sharing = courts.some((court) => !spaceUnits(court)[0].startsWith("court:"));
  const others = sharing
    ? await query<LinkedRow>("SELECT id, sport_id sportId, shared_space sharedSpace FROM courts WHERE shared_space IS NOT NULL AND shared_space <> '' AND sport_id <> ?", [sport.id])
    : [];
  const spaceMap: SpaceCourt[] = [...courts, ...others];
  const linkedOf = new Map(courts.map((court) => [court.id, linkedCourtIds([court.id], spaceMap)]));
  const occupiedIds = [...new Set([...linkedOf.values()].flat())];

  // Read only, with one bounded range query and no expired holds blocking dates. Active court blocks
  // (maintenance, events, Buffet Rank sessions) occupy their slots exactly like bookings.
  const range = [`${dates.at(-1)} 23:59:59`, `${dates[0]} 00:00:00`];
  const booked = occupiedIds.length ? await query<Occupancy>(
    `SELECT court_id courtId, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt, sport_id sportId, status FROM bookings WHERE court_id IN (${placeholders(occupiedIds.length)}) AND starts_at < ? AND ends_at > ? AND (status IN ('paid','checked_in') OR (status IN ('hold','pending_payment') AND (expires_at IS NULL OR expires_at > NOW())))`
    + ` UNION ALL SELECT court_id courtId, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt, NULL sportId, 'blocked' status FROM court_blocks WHERE court_id IN (${placeholders(occupiedIds.length)}) AND cancelled_at IS NULL AND starts_at < ? AND ends_at > ?`,
    [...occupiedIds, ...range, ...occupiedIds, ...range],
  ) : [];
  const now = Date.now();
  const times = hourSlots(openHour, closeHour);
  const slotsFor = (date: string) => courts.flatMap((court) => {
    const card = rateCard(sport, court);
    const linked = linkedOf.get(court.id) || [court.id];
    return times.map((time) => {
      const status = slotStatus(date, time, input.durationHours, court.id, booked, now, { closeHour, linked });
      const taker = status === "full" ? takenBy(date, time, input.durationHours, court.id, booked, linked) : undefined;
      // Taken through the shared floor by another sport: the app shows "ไม่ว่าง · วอลเลย์บอล".
      const sharedWith = taker && taker.sportId && Number(taker.sportId) !== Number(sport.id) ? Number(taker.sportId) : undefined;
      return {
        courtId: court.id, courtName: court.name, zone: court.zone, kind: court.kind, capacity: court.capacity, time, status,
        available: status === "available", rate: rateForSlot(card, time, input.durationHours),
        period: Number(time.slice(0, 2)) >= card.nightFrom ? "night" : "day",
        ...(sharedWith ? { sharedWith } : {}),
      };
    });
  });
  if (input.month) {
    const days = dates.map((date) => summarizeDay(date, slotsFor(date).map((slot) => slot.status), now));
    return secureResponse(NextResponse.json({ month: input.month, days }));
  }
  const today = input.date === bangkokToday(now);
  const courtRows = courts.map((court) => {
    const card = rateCard(sport, court);
    const linked = linkedOf.get(court.id) || [court.id];
    return {
      id: court.id, name: court.name, zone: court.zone || null, kind: court.kind || null, capacity: court.capacity,
      dayRate: card.dayRate, nightRate: card.nightRate,
      // Shares its floor with a court of another sport (the price card says so).
      sharedWith: [...new Set(others.filter((other) => linked.includes(Number(other.id))).map((other) => Number(other.sportId)))],
      ...(today ? { live: courtLiveStatus(court.id, booked, now, linked) } : {}),
    };
  });
  return secureResponse(NextResponse.json({
    date: input.date,
    hours: { open: openHour, close: closeHour, nightFrom: rateCard(sport).nightFrom },
    rates: { dayRate: rateCard(sport).dayRate, nightRate: rateCard(sport).nightRate },
    courts: courtRows,
    slots: slotsFor(input.date!),
  }));
}
