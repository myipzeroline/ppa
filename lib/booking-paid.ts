import type mysql from "mysql2/promise";
import { notifyMember } from "@/lib/notify";

type Connection = Pick<mysql.PoolConnection, "execute">;
export type PaidNotice = { userId: number; title: string; body: string };

type PaidBooking = { id: number; userId: number; sportId: number; courtId: number | null; title: string; startsAt: string; metadata: string | null; guestName: string | null };

function record(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : 0;
}

const slotLabel = (startsAt: string) => new Date(`${startsAt.replace(" ", "T")}+07:00`).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

// Everything that follows a booking becoming paid (member wallet payment, staff-confirmed PromptPay,
// payment at the counter), inside the caller's transaction:
//   a HYROX Series grants its program right and Simulation credits (terms copied at booking time);
//   a court booked by the owner of a group (ก๊วน) of that sport tells every member of the group.
// Returns the notices to push to LINE after the commit.
export async function afterBookingPaid(conn: Connection, bookingId: number): Promise<PaidNotice[]> {
  const [rows] = await conn.execute(
    "SELECT id, user_id userId, sport_id sportId, court_id courtId, title, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, CAST(metadata AS CHAR) metadata, guest_name guestName FROM bookings WHERE id = ? LIMIT 1",
    [bookingId],
  );
  const booking = (rows as PaidBooking[])[0];
  if (!booking) return [];
  const notices: PaidNotice[] = [];
  const series = record(booking.metadata).series;
  if (series && typeof series === "object") notices.push(...await grantSeries(conn, booking, series as Record<string, unknown>));
  if (booking.courtId && !booking.guestName) notices.push(...await notifyGroupsOfBooking(conn, booking));
  return notices;
}

async function grantSeries(conn: Connection, booking: PaidBooking, series: Record<string, unknown>): Promise<PaidNotice[]> {
  const weeks = integer(series.weeks, 1, 52);
  const simulations = integer(series.simulations, 0, 50);
  if (!weeks) return [];
  const [already] = await conn.execute(
    "SELECT id FROM user_entitlements WHERE user_id = ? AND entitlement_type = 'class_series' AND JSON_VALUE(metadata, '$.bookingId') = ? LIMIT 1",
    [booking.userId, String(booking.id)],
  );
  if ((already as unknown[]).length) return [];
  const [payments] = await conn.execute("SELECT id FROM payments WHERE booking_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1", [booking.id]);
  const paymentId = Number((payments as { id: number }[])[0]?.id || 0) || null;
  const title = typeof series.title === "string" && series.title.trim() ? series.title.trim().slice(0, 180) : "HYROX Series";
  const days = weeks * 7;
  await conn.execute(
    "INSERT INTO user_entitlements (user_id, payment_id, entitlement_type, title, remaining_uses, starts_at, ends_at, status, metadata) VALUES (?, ?, 'class_series', ?, NULL, ?, DATE_ADD(?, INTERVAL ? DAY), 'active', ?)",
    [booking.userId, paymentId, title, booking.startsAt, booking.startsAt, days, JSON.stringify({ source: "booking", bookingId: String(booking.id), weeks, simulations })],
  );
  if (simulations > 0) {
    const [coupons] = await conn.execute("SELECT id FROM coupons WHERE code = 'HYROX-SIM-CREDIT' LIMIT 1");
    const couponId = Number((coupons as { id: number }[])[0]?.id || 0);
    // Credits last for the program plus two weeks.
    if (couponId) {
      await conn.execute(
        "INSERT INTO user_coupons (user_id, coupon_id, total_uses, payment_id, remaining_uses, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY))",
        [booking.userId, couponId, simulations, paymentId, simulations, booking.startsAt, days + 14],
      );
    }
  }
  const notice = { userId: booking.userId, title: "เริ่มโปรแกรม HYROX Series", body: `${title} · เริ่ม ${slotLabel(booking.startsAt)}${simulations ? ` · ได้สิทธิ์ Simulation ${simulations} ครั้ง` : ""}` };
  await notifyMember(conn, notice.userId, notice.title, notice.body);
  return [notice];
}

// "เมื่อผู้จัดก๊วนชำระเงินจองสนามแล้ว ระบบแจ้งเวลานัดให้สมาชิกทุกคนในกลุ่มอัตโนมัติ": the group's next play
// time becomes the booking when it has none (or it has passed), and every other member is told.
async function notifyGroupsOfBooking(conn: Connection, booking: PaidBooking): Promise<PaidNotice[]> {
  const [groups] = await conn.execute(
    "SELECT id, name FROM groups_clubs WHERE owner_user_id = ? AND sport_id = ? AND status = 'active' ORDER BY id LIMIT 5",
    [booking.userId, booking.sportId],
  );
  const notices: PaidNotice[] = [];
  for (const group of groups as { id: number; name: string }[]) {
    await conn.execute("UPDATE groups_clubs SET play_at = ? WHERE id = ? AND (play_at IS NULL OR play_at < NOW())", [booking.startsAt, group.id]);
    const [members] = await conn.execute("SELECT user_id userId FROM group_members WHERE group_id = ? AND user_id <> ?", [group.id, booking.userId]);
    for (const member of members as { userId: number }[]) {
      const notice = { userId: Number(member.userId), title: "ก๊วนนัดเล่นแล้ว", body: `${group.name} · ${booking.title} · ${slotLabel(booking.startsAt)}` };
      await notifyMember(conn, notice.userId, notice.title, notice.body);
      notices.push(notice);
    }
  }
  return notices;
}
