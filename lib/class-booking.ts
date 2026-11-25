import type mysql from "mysql2/promise";
import { createPublicId } from "@/lib/db";
import { placeholders, takenBookingAs, takenBookingSql } from "@/lib/court-schedule";
import { classRange, instructorAt, parseProgram, timesOn, type ClassProgram } from "@/lib/class-programs";

type Connection = Pick<mysql.PoolConnection, "execute">;
type Reader = (sql: string, params?: unknown[]) => Promise<unknown[]>;

// Classes are bookable up to 30 days ahead; joining closes when the class starts.
export const CLASS_DAYS_AHEAD = 30;

export class ClassBookingError extends Error {
  constructor(message: string, readonly status = 409, readonly code?: string) {
    super(message);
  }
}

export const programColumns = "id, slug, title, subtitle, body, icon, price, CAST(metadata AS CHAR) metadata, sort_order sortOrder";

export async function loadProgram(conn: Connection, programId: number, lock = false) {
  const [rows] = await conn.execute(
    `SELECT ${programColumns} FROM app_content_items WHERE id = ? AND content_type = 'class_program' AND active = TRUE LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [programId],
  );
  const row = (rows as Parameters<typeof parseProgram>[0][])[0];
  return row ? parseProgram(row) : null;
}

export function bangkokNowWall(now = Date.now()) {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function servicesOf(metadata: unknown) {
  let parsed = metadata;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  const services = parsed && typeof parsed === "object" ? (parsed as { services?: unknown }).services : undefined;
  return Array.isArray(services) ? services.map(String) : null;
}

export type CoveringPackage = { kind: "membership" | "time_pass"; id: number; title: string };

// The member's package in force at a class time: any active package for a free Service Class
// (services = null), or a package that includes one of the services (an unlimited Member package).
// A paused membership does not count.
export async function packageCovering(conn: Connection, userId: number, at: string, services: string[] | null): Promise<CoveringPackage | null> {
  const [memberships] = await conn.execute(
    "SELECT id, plan_name title, CAST(metadata AS CHAR) metadata FROM memberships WHERE user_id = ? AND status = 'active' AND starts_at <= ? AND ends_at > ? AND NOT EXISTS (SELECT 1 FROM membership_pauses mp WHERE mp.membership_id = memberships.id AND mp.status = 'active' AND mp.starts_at <= ? AND mp.ends_at > ?) ORDER BY ends_at DESC LIMIT 10",
    [userId, at, at, at, at],
  );
  for (const row of memberships as { id: number; title: string; metadata: string | null }[]) {
    if (!services) return { kind: "membership", id: Number(row.id), title: row.title };
    const included = servicesOf(row.metadata);
    if (included?.some((service) => services.includes(service))) return { kind: "membership", id: Number(row.id), title: row.title };
  }
  if (services) return null;
  const [passes] = await conn.execute(
    "SELECT id, title FROM user_entitlements WHERE user_id = ? AND entitlement_type = 'time_pass' AND status = 'active' AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) AND (remaining_uses IS NULL OR remaining_uses > 0) ORDER BY ends_at DESC LIMIT 1",
    [userId, at, at],
  );
  const pass = (passes as { id: number; title: string }[])[0];
  return pass ? { kind: "time_pass", id: Number(pass.id), title: pass.title } : null;
}

export type ReservedClass = { booking: Record<string, unknown>; paid: boolean; coupon?: { name: string; remaining: number }; included?: string };
type ReserveInput = { userId: number; programId: number; date: string; time: string; useCoupon?: boolean; userCouponId?: number; trainerId?: number; resource?: string; now?: number };

// Books one class time for a member:
//   a free Service Class, or a class an unlimited Member package includes: confirmed at once, free;
//   a coupon class (or a session paid with a Simulation credit): one coupon use, confirmed at once;
//   a paid session or a HYROX Series: held 15 minutes for payment like a court booking.
// The program row lock serializes bookings of the program, so a class time is never oversold; a
// private class locks its instructor too (one instructor teaches one class at a time), and a room or
// machine is booked once per time.
export async function reserveClass(conn: Connection, input: ReserveInput): Promise<ReservedClass> {
  const now = input.now ?? Date.now();
  const program = await loadProgram(conn, input.programId, true);
  if (!program) throw new ClassBookingError("ไม่พบคลาสนี้", 404);
  const range = classRange(program, input.date, input.time);
  if (!range) throw new ClassBookingError("เวลานี้ไม่เปิดให้จอง", 400);
  const startsAtTime = Date.parse(`${range.startsAt.replace(" ", "T")}+07:00`);
  if (startsAtTime <= now) throw new ClassBookingError("เวลานี้ผ่านไปแล้ว", 400);
  if (daysBetween(bangkokNowWall(now).slice(0, 10), input.date) > CLASS_DAYS_AHEAD) throw new ClassBookingError("จองล่วงหน้าได้ไม่เกิน 30 วัน", 400);

  const [sports] = await conn.execute("SELECT id FROM sports WHERE slug = ? LIMIT 1", [program.sport]);
  const sportId = Number((sports as { id: number }[])[0]?.id || 0);
  if (!sportId) throw new ClassBookingError("ไม่พบบริการของคลาสนี้", 404);

  let trainer: { id: number; name: string } | null = null;
  if (program.trainerLink) {
    if (!input.trainerId) throw new ClassBookingError("เลือกผู้สอนก่อนจองเวลา", 400, "TRAINER_REQUIRED");
    const [trainers] = await conn.execute("SELECT id, name FROM trainers WHERE id = ? AND active = TRUE LIMIT 1 FOR UPDATE", [input.trainerId]);
    trainer = (trainers as { id: number; name: string }[])[0] || null;
    if (!trainer) throw new ClassBookingError("ไม่พบผู้สอนที่เลือก", 404, "TRAINER_NOT_FOUND");
  }
  const resource = program.resources.length ? (input.resource && program.resources.includes(input.resource) ? input.resource : null) : null;
  if (program.resources.length && !resource) throw new ClassBookingError("เลือกห้องหรือเครื่องก่อนจองเวลา", 400, "RESOURCE_REQUIRED");

  const [mine] = await conn.execute(
    `SELECT id FROM bookings WHERE user_id = ? AND class_key = ? AND starts_at = ? AND (${takenBookingSql}) LIMIT 1 FOR UPDATE`,
    [input.userId, program.slug, range.startsAt],
  );
  if ((mine as unknown[]).length) throw new ClassBookingError("คุณจองรอบนี้แล้ว", 409, "ALREADY_BOOKED");
  if (trainer) {
    const [busy] = await conn.execute(
      `SELECT id FROM bookings WHERE trainer_id = ? AND starts_at < ? AND ends_at > ? AND (${takenBookingSql}) LIMIT 1`,
      [trainer.id, range.endsAt, range.startsAt],
    );
    if ((busy as unknown[]).length) throw new ClassBookingError("ผู้สอนไม่ว่างเวลานี้ เลือกเวลาอื่นหรือผู้สอนท่านอื่น", 409, "TRAINER_BUSY");
  }
  const [counted] = await conn.execute(
    `SELECT COUNT(*) taken FROM bookings WHERE class_key = ? AND starts_at = ?${resource ? " AND resource_code = ?" : ""}${trainer ? " AND trainer_id = ?" : ""} AND (${takenBookingSql})`,
    [program.slug, range.startsAt, ...(resource ? [resource] : []), ...(trainer ? [trainer.id] : [])],
  );
  const taken = Number((counted as { taken: number }[])[0]?.taken || 0);
  if (taken >= program.capacity) throw new ClassBookingError(resource ? "ห้องหรือเครื่องนี้ไม่ว่างเวลานี้" : "รอบนี้เต็มแล้ว", 409, "FULL");
  // A class that opens only with enough people stops taking bookings that cannot reach the minimum
  // once its confirmation time has come (the scheduled job cancels it then).
  if (program.minPeople > 0 && taken + 1 < program.minPeople && startsAtTime - now <= program.confirmHours * 3_600_000) {
    throw new ClassBookingError("ปิดรับจองรอบนี้แล้ว ผู้เรียนไม่ถึงขั้นต่ำ", 409, "CLOSED");
  }

  const instructor = trainer?.name || instructorAt(program, input.time, input.date)?.name || null;
  // A Series names what it includes ("HYROX Series 4 สัปดาห์ + Simulation 1 ครั้ง"), as on the QR payment.
  const name = program.kind === "series" && program.simulations ? `${program.title} + Simulation ${program.simulations} ครั้ง` : program.title;
  const title = `${program.icon} ${name} · ${input.time}–${range.endTime}${resource ? ` · ${resource}` : ""}${instructor ? ` · ${instructor}` : ""}`.slice(0, 180);
  const bookingNo = createPublicId("BK");
  const extras = [trainer?.id ?? null, resource];

  // Free for an Active Member (Service Class), or included in an unlimited Member package.
  if (program.kind === "free" || program.membershipServices.length) {
    const cover = await packageCovering(conn, input.userId, range.startsAt, program.kind === "free" ? null : program.membershipServices);
    if (program.kind === "free" && !cover) throw new ClassBookingError("เฉพาะสมาชิกที่มีสถานะ (Active Member) เท่านั้นจึงจะจองได้", 403, "MEMBER_REQUIRED");
    if (cover) {
      await conn.execute(
        "INSERT INTO bookings (booking_no, user_id, sport_id, court_id, class_key, title, starts_at, ends_at, players, amount, status, qr_secret, expires_at, trainer_id, resource_code, metadata) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1, 0, 'paid', ?, NULL, ?, ?, ?)",
        [bookingNo, input.userId, sportId, program.slug, title, range.startsAt, range.endsAt, createPublicId("QR"), ...extras, JSON.stringify({ programId: program.id, package: cover })],
      );
      return { booking: await bookingRow(conn, bookingNo), paid: true, included: cover.title };
    }
  }

  const withCoupon = program.kind === "coupon" || (Boolean(input.useCoupon) && program.couponCategories.length > 0 && program.kind === "session");
  if (withCoupon) {
    const [coupons] = await conn.execute(
      `SELECT uc.id, uc.remaining_uses remainingUses, c.name FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.user_id = ? AND uc.status = 'active' AND uc.remaining_uses > 0 AND uc.expires_at > ? AND c.category IN (${placeholders(program.couponCategories.length)})${input.userCouponId ? " AND uc.id = ?" : ""} ORDER BY uc.expires_at, uc.id LIMIT 1 FOR UPDATE`,
      [input.userId, range.startsAt, ...program.couponCategories, ...(input.userCouponId ? [input.userCouponId] : [])],
    );
    const coupon = (coupons as { id: number; remainingUses: number; name: string }[])[0];
    if (!coupon) throw new ClassBookingError("ต้องมีคูปองของคลาสนี้ก่อนจองเวลา", 409, "COUPON_REQUIRED");
    await conn.execute("UPDATE user_coupons SET remaining_uses = remaining_uses - 1, status = IF(remaining_uses <= 0, 'used', status) WHERE id = ? AND remaining_uses > 0", [coupon.id]);
    await conn.execute(
      "INSERT INTO bookings (booking_no, user_id, sport_id, court_id, class_key, user_coupon_id, title, starts_at, ends_at, players, amount, status, qr_secret, expires_at, trainer_id, resource_code) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, 0, 'paid', ?, NULL, ?, ?)",
      [bookingNo, input.userId, sportId, program.slug, coupon.id, title, range.startsAt, range.endsAt, createPublicId("QR"), ...extras],
    );
    return { booking: await bookingRow(conn, bookingNo), paid: true, coupon: { name: coupon.name, remaining: Math.max(0, Number(coupon.remainingUses) - 1) } };
  }
  if (!(program.price > 0)) throw new ClassBookingError("ต้องมีคูปองของคลาสนี้ก่อนจองเวลา", 409, "COUPON_REQUIRED");
  // A Series keeps its terms on the booking: what is granted once paid never follows later edits.
  const metadata = program.kind === "series" ? { series: { programId: program.id, slug: program.slug, title: program.title, weeks: program.weeks, simulations: program.simulations } } : { programId: program.id };
  await conn.execute(
    "INSERT INTO bookings (booking_no, user_id, sport_id, court_id, class_key, title, starts_at, ends_at, players, amount, status, qr_secret, expires_at, trainer_id, resource_code, metadata) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, 'pending_payment', ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE), ?, ?, ?)",
    [bookingNo, input.userId, sportId, program.slug, title, range.startsAt, range.endsAt, program.price, createPublicId("QR"), ...extras, JSON.stringify(metadata)],
  );
  return { booking: await bookingRow(conn, bookingNo), paid: false };
}

async function bookingRow(conn: Connection, bookingNo: string) {
  // Explicit columns: the check-in secret and internal ids never leave the server.
  const [rows] = await conn.execute("SELECT booking_no, title, starts_at, ends_at, players, amount, status, expires_at FROM bookings WHERE booking_no = ? LIMIT 1", [bookingNo]);
  return (rows as Record<string, unknown>[])[0] || { booking_no: bookingNo };
}

// Cancelling a class booked with a coupon gives the use back (while the coupon is still valid).
export async function restoreClassCoupon(conn: Connection, userCouponId: number, userId: number) {
  await conn.execute(
    "UPDATE user_coupons SET remaining_uses = remaining_uses + 1, status = 'active' WHERE id = ? AND user_id = ? AND expires_at > NOW() AND status IN ('active','used') AND (total_uses IS NULL OR remaining_uses < total_uses)",
    [userCouponId, userId],
  );
}

export type ClassSlot = { time: string; endTime: string; taken: number; capacity: number; status: "available" | "full" | "past" | "closed"; mine: boolean; instructor: string | null; resource: string | null };
export type SlotFocus = { trainerId?: number; resources?: Record<string, string> };

// Places of every time of the programs on one day (read only). A private class with an instructor
// chosen shows the times that instructor is free; a room or machine shows its own bookings.
export async function classSlots(read: Reader, programs: ClassProgram[], date: string, userId: number, now = Date.now(), focus: SlotFocus = {}) {
  const keys = programs.map((program) => program.slug);
  const dayStart = `${date} 00:00:00`;
  const dayEnd = `${date} 23:59:59`;
  const counts = keys.length
    ? (await read(
      `SELECT b.class_key classKey, DATE_FORMAT(b.starts_at, '%H:%i') time, b.resource_code resource, b.trainer_id trainerId, COUNT(*) taken, SUM(b.user_id = ?) mine FROM bookings b WHERE b.class_key IN (${placeholders(keys.length)}) AND b.starts_at >= ? AND b.starts_at < ? AND (${takenBookingAs("b")}) GROUP BY b.class_key, b.starts_at, b.resource_code, b.trainer_id`,
      [userId, ...keys, dayStart, dayEnd],
    )) as { classKey: string; time: string; resource: string | null; trainerId: number | null; taken: number; mine: number }[]
    : [];
  const trainerBusy = focus.trainerId && programs.some((program) => program.trainerLink)
    ? (await read(
      `SELECT DATE_FORMAT(b.starts_at, '%H:%i') fromTime, DATE_FORMAT(b.ends_at, '%H:%i') toTime FROM bookings b WHERE b.trainer_id = ? AND b.starts_at < ? AND b.ends_at > ? AND (${takenBookingAs("b")})`,
      [focus.trainerId, dayEnd, dayStart],
    )) as { fromTime: string; toTime: string }[]
    : [];
  return programs.map((program) => {
    const resource = program.resources.length ? (focus.resources?.[program.slug] && program.resources.includes(focus.resources[program.slug]) ? focus.resources[program.slug] : program.resources[0]) : null;
    const times = timesOn(program, date);
    return {
      programId: program.id,
      open: times.length > 0,
      resource,
      trainerId: program.trainerLink ? focus.trainerId ?? null : null,
      slots: times.map((time): ClassSlot => {
        const range = classRange(program, date, time)!;
        const rows = counts.filter((item) => item.classKey === program.slug && item.time === time);
        const counted = rows.filter((row) => (!resource || row.resource === resource) && (!program.trainerLink || !focus.trainerId || Number(row.trainerId) === Number(focus.trainerId)));
        const taken = counted.reduce((sum, row) => sum + Number(row.taken || 0), 0);
        const startsAt = Date.parse(`${range.startsAt.replace(" ", "T")}+07:00`);
        const past = startsAt <= now;
        const busy = program.trainerLink && trainerBusy.some((row) => row.fromTime < range.endTime && (row.toTime > time || row.toTime === "00:00"));
        const closing = program.minPeople > 0 && taken + 1 < program.minPeople && startsAt - now <= program.confirmHours * 3_600_000;
        return {
          time,
          endTime: range.endTime,
          taken,
          capacity: program.capacity,
          status: past ? "past" : taken >= program.capacity || busy ? "full" : closing ? "closed" : "available",
          mine: rows.some((row) => Number(row.mine || 0) > 0),
          instructor: instructorAt(program, time, date)?.name || null,
          resource,
        };
      }),
    };
  });
}
