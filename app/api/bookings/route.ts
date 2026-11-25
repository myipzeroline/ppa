import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { createPublicId, pool, query } from "@/lib/db";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";
import { buildSlotRange, expirePendingBookings, isPastSlot } from "@/lib/booking-rules";
import { DEFAULT_CLOSE_HOUR, DEFAULT_OPEN_HOUR } from "@/lib/court-availability";
import { rateCard, rateForSlot } from "@/lib/court-pricing";
import { courtConflict, linkedCourts, placeholders } from "@/lib/court-schedule";
import { linkedCourtIds, type SpaceCourt } from "@/lib/court-space";
import { restoreClassCoupon } from "@/lib/class-booking";

const schema = z.object({
  sportSlug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  // A court, or null to book the first free court of the sport (of the chosen zone / kind when given:
  // Half Court A or B).
  courtId: z.coerce.number().int().positive().nullable(),
  zone: z.string().trim().max(80).optional(),
  courtKind: z.string().trim().max(40).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationHours: z.coerce.number().int().min(1).max(4).default(1),
  players: z.coerce.number().int().min(1).max(20).default(1),
  title: z.string().trim().min(1).max(180).optional(),
});
const cancelSchema = z.object({
  bookingNo: z.string().trim().min(4).max(32),
  reason: z.string().trim().max(255).optional().or(z.literal("")),
});

type SportRow = { id: number; baseRate: number; nightRate?: number | null; nightFrom?: number | null; openHour?: number | null; closeHour?: number | null; name: string; icon?: string; requiresBooking: number | boolean };
type CourtRow = { id: number; name: string; capacity: number; hourlyRate?: number | null; nightRate?: number | null; zone?: string | null; kind?: string | null; sharedSpace?: string | null };

function hour(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 24 ? number : fallback;
}

export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `booking:${await clientIp()}`, limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  let input: z.infer<typeof schema>;
  try {
    input = await parseJsonBody(req, schema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  await expirePendingBookings();
  const sports = await query<SportRow>(
    "SELECT id, base_rate baseRate, night_rate nightRate, night_from nightFrom, open_hour openHour, close_hour closeHour, name_th name, icon, requires_booking requiresBooking FROM sports WHERE slug = ? AND active = TRUE LIMIT 1",
    [input.sportSlug],
  );
  const sport = sports[0];
  if (!sport) return NextResponse.json({ message: "ไม่พบกีฬา" }, { status: 404 });
  if (isPastSlot(input.date, input.time)) return NextResponse.json({ message: "ไม่สามารถจองเวลาย้อนหลังได้" }, { status: 400 });

  const range = buildSlotRange(input.date, input.time, input.durationHours);
  const startHour = Number(input.time.slice(0, 2));
  const openHour = hour(sport.openHour, DEFAULT_OPEN_HOUR);
  const closeHour = hour(sport.closeHour, DEFAULT_CLOSE_HOUR);
  if (!range || startHour < openHour || startHour + input.durationHours > closeHour) return NextResponse.json({ message: "ช่วงเวลานี้ไม่เปิดให้จอง" }, { status: 400 });

  // Courts the member may get: the chosen court, or every court of the chosen zone / kind (first free wins).
  const candidates = sport.requiresBooking ? await query<CourtRow>(
    input.courtId
      ? "SELECT id, name, capacity, hourly_rate hourlyRate, night_rate nightRate, zone, court_kind kind, shared_space sharedSpace FROM courts WHERE id = ? AND sport_id = ? AND status = 'available' LIMIT 1"
      : "SELECT id, name, capacity, hourly_rate hourlyRate, night_rate nightRate, zone, court_kind kind, shared_space sharedSpace FROM courts WHERE sport_id = ? AND status = 'available' ORDER BY sort_order, id",
    input.courtId ? [input.courtId, sport.id] : [sport.id],
  ) : [];
  const matching = input.courtId ? candidates : candidates.filter((court) => (!input.zone || (court.zone || "") === input.zone) && (!input.courtKind || (court.kind || "") === input.courtKind));
  if (sport.requiresBooking && !matching.length) return NextResponse.json({ message: "ไม่พบคอร์ทที่เปิดให้จองสำหรับกีฬานี้" }, { status: 404 });
  if (matching.length && matching.every((court) => input.players > Number(court.capacity))) return NextResponse.json({ message: "จำนวนผู้เล่นเกินความจุสนาม" }, { status: 400 });
  // Shared floor space (lib/court-space.ts): the courts locked and checked with each candidate.
  const candidateIds = matching.map((court) => Number(court.id));
  const allLinked = candidateIds.length ? await linkedCourts((sql, params) => query(sql, params), candidateIds) : [];
  const spaceMap = await sharedMap(allLinked, matching);

  const { startsAt, endsAt } = range;
  const bookingNo = createPublicId("BK");
  const qrSecret = createPublicId("QR");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let court: CourtRow | null = null;
    let amount = rateForSlot(rateCard(sport), input.time, input.durationHours);
    if (candidateIds.length) {
      // One statement locks the candidates (only while still bookable) and every court sharing their
      // floor, in id order, so two bookings of the same space never deadlock.
      const [lockedRows] = await conn.execute(
        `SELECT id, capacity, hourly_rate hourlyRate, night_rate nightRate FROM courts WHERE id IN (${placeholders(allLinked.length)}) AND (id NOT IN (${placeholders(candidateIds.length)}) OR (sport_id = ? AND status = 'available')) ORDER BY id FOR UPDATE`,
        [...allLinked, ...candidateIds, sport.id],
      );
      const locked = lockedRows as { id: number; capacity: number; hourlyRate: number | null; nightRate?: number | null }[];
      let conflict: "booked" | "blocked" | null = null;
      for (const candidate of matching) {
        const row = locked.find((item) => Number(item.id) === Number(candidate.id));
        if (!row || input.players > Number(row.capacity) || isPastSlot(input.date, input.time)) continue;
        const verdict = await courtConflict(conn, linkedCourtIds([Number(candidate.id)], spaceMap), startsAt, endsAt);
        if (verdict) {
          conflict = conflict || verdict;
          continue;
        }
        court = { ...candidate, ...row };
        break;
      }
      if (!court) {
        await conn.rollback();
        if (conflict) return NextResponse.json({ message: conflict === "blocked" && matching.length === 1 ? "ช่วงเวลานี้ไม่เปิดให้จอง" : "ช่วงเวลานี้ถูกจองแล้ว" }, { status: 409 });
        return NextResponse.json({ message: "สนามหรือช่วงเวลานี้ไม่พร้อมให้จอง กรุณาเลือกใหม่" }, { status: 409 });
      }
      amount = rateForSlot(rateCard(sport, court), input.time, input.durationHours);
    }
    const autoAssigned = Boolean(court && !input.courtId);
    const place = court ? (court.kind && court.zone ? `${court.zone} · ${court.name}` : court.name) : "";
    const title = !autoAssigned && input.title?.trim() ? input.title.trim() : `${sport.icon ? `${sport.icon} ` : ""}${sport.name}${place ? ` · ${place}` : ""}`;
    await conn.execute(
      "INSERT INTO bookings (booking_no, user_id, sport_id, court_id, title, starts_at, ends_at, players, amount, status, qr_secret, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))",
      [bookingNo, user.id, sport.id, court?.id ?? null, title.slice(0, 180), startsAt, endsAt, input.players, amount, qrSecret],
    );
    // Explicit columns: the check-in secret and internal ids never leave the server.
    const [booking] = await conn.execute("SELECT booking_no, title, starts_at, ends_at, players, amount, status, expires_at FROM bookings WHERE booking_no = ? LIMIT 1", [bookingNo]);
    await conn.commit();
    return NextResponse.json({ booking: (booking as unknown[])[0] }, { status: 201 });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Courts that share space, for the per-candidate conflict check (the candidates themselves included).
async function sharedMap(ids: number[], candidates: CourtRow[]): Promise<SpaceCourt[]> {
  const shared = candidates.filter((court) => court.sharedSpace).map((court) => ({ id: Number(court.id), sharedSpace: court.sharedSpace }));
  if (!shared.length || ids.length <= candidates.length) return [...candidates.map((court) => ({ id: Number(court.id), sharedSpace: court.sharedSpace }))];
  const rows = await query<SpaceCourt>(`SELECT id, shared_space sharedSpace FROM courts WHERE id IN (${placeholders(ids.length)})`, ids);
  return rows.map((row) => ({ id: Number(row.id), sharedSpace: row.sharedSpace }));
}

export async function DELETE(req: Request) {
  const limited = checkRateLimit({ key: `booking-cancel:${await clientIp()}`, limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  let input: z.infer<typeof cancelSchema>;
  try {
    input = await parseJsonBody(req, cancelSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const booking = (
    await query<{ id: number; status: string; startsAt: string; userCouponId?: number | null }>(
      "SELECT id, status, starts_at startsAt, user_coupon_id userCouponId FROM bookings WHERE booking_no = ? AND user_id = ? LIMIT 1",
      [input.bookingNo, user.id],
    )
  )[0];
  if (!booking) return NextResponse.json({ message: "ไม่พบรายการจอง" }, { status: 404 });
  if (["checked_in", "cancelled", "expired"].includes(booking.status)) return NextResponse.json({ message: "รายการนี้ยกเลิกไม่ได้" }, { status: 409 });
  if (new Date(booking.startsAt).getTime() < Date.now() + 30 * 60 * 1000) return NextResponse.json({ message: "ยกเลิกได้ก่อนเวลาใช้งานอย่างน้อย 30 นาที" }, { status: 409 });
  if (!booking.userCouponId) {
    const result = await query("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ? AND status IN ('hold','pending_payment','paid') AND starts_at >= DATE_ADD(NOW(), INTERVAL 30 MINUTE)", [input.reason || "member cancelled", booking.id]);
    if (!(result as unknown as { affectedRows: number }).affectedRows) return NextResponse.json({ message: "Booking state changed" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  // A class booked with a coupon: cancelling returns the coupon use, in the same transaction.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ? AND status IN ('hold','pending_payment','paid') AND starts_at >= DATE_ADD(NOW(), INTERVAL 30 MINUTE)", [input.reason || "member cancelled", booking.id]);
    if (!(result as { affectedRows?: number }).affectedRows) {
      await conn.rollback();
      return NextResponse.json({ message: "Booking state changed" }, { status: 409 });
    }
    await restoreClassCoupon(conn, Number(booking.userCouponId), user.id);
    await conn.commit();
    return NextResponse.json({ ok: true, couponRestored: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
