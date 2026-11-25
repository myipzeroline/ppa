import type mysql from "mysql2/promise";
import { takenBookingSql } from "@/lib/court-schedule";
import { parseProgram, type ClassProgram } from "@/lib/class-programs";
import { bangkokNowWall, programColumns, restoreClassCoupon } from "@/lib/class-booking";
import { notifyMember, pushLineMessage, pushText } from "@/lib/notify";
import { runJob, type JobNotice } from "@/lib/scheduled-jobs";

type Connection = Pick<mysql.PoolConnection, "execute">;

export const UNDERFILLED_TITLE = "คลาสถูกยกเลิก";

// A group class that opens only with enough people (metadata.minPeople, e.g. Pilates Reformer Group
// "ขั้นต่ำ 3 คน คลาสจึงจะเปิด"): when its confirmation time comes (confirmHours before the start) with
// fewer bookings than the minimum, every booking of that time is cancelled, coupons go back to their
// owners and each member is told. Free and coupon classes only (nothing was paid in money).
export async function cancelUnderfilledClasses(conn: Connection, now = Date.now()): Promise<JobNotice[]> {
  const [rows] = await conn.execute(`SELECT ${programColumns} FROM app_content_items WHERE content_type = 'class_program' AND active = TRUE ORDER BY id LIMIT 200`);
  const programs = (rows as Parameters<typeof parseProgram>[0][])
    .map(parseProgram)
    .filter((program): program is ClassProgram => Boolean(program && program.minPeople > 0));
  const notices: JobNotice[] = [];
  const nowWall = bangkokNowWall(now);
  for (const program of programs) {
    const [sessions] = await conn.execute(
      `SELECT starts_at startsAt, COUNT(*) taken FROM bookings WHERE class_key = ? AND starts_at > ? AND starts_at <= ? AND (${takenBookingSql}) GROUP BY starts_at HAVING COUNT(*) < ?`,
      [program.slug, nowWall, bangkokNowWall(now + program.confirmHours * 3_600_000), program.minPeople],
    );
    for (const session of sessions as { startsAt: string | Date; taken: number }[]) {
      const [bookings] = await conn.execute(
        `SELECT id, user_id userId, user_coupon_id userCouponId, amount, DATE_FORMAT(starts_at, '%d/%m %H:%i') startText FROM bookings WHERE class_key = ? AND starts_at = ? AND (${takenBookingSql}) FOR UPDATE`,
        [program.slug, session.startsAt],
      );
      for (const booking of bookings as { id: number; userId: number; userCouponId: number | null; amount: number | string; startText: string }[]) {
        if (Number(booking.amount) > 0) continue;
        const [result] = await conn.execute(
          "UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ? AND status IN ('hold','pending_payment','paid')",
          [`ผู้เรียนไม่ถึง ${program.minPeople} คน`, booking.id],
        );
        if (!Number((result as { affectedRows?: number }).affectedRows || 0)) continue;
        if (booking.userCouponId) await restoreClassCoupon(conn, Number(booking.userCouponId), Number(booking.userId));
        const body = `${program.title} รอบ ${booking.startText} มีผู้จองไม่ถึง ${program.minPeople} คน จึงไม่เปิดคลาส${booking.userCouponId ? " คืนคูปองให้แล้ว" : ""} เลือกรอบอื่นได้ในแอป`;
        await notifyMember(conn, Number(booking.userId), UNDERFILLED_TITLE, body);
        notices.push({ userId: Number(booking.userId), title: UNDERFILLED_TITLE, body });
      }
    }
  }
  return notices;
}

// Runs the check even where no cron job calls /api/cron/run: the class pages and the back office
// call this after their response, at most once a minute per server.
let lastSweep = 0;
export async function runClassSweep() {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  try {
    const notices = await runJob((conn) => cancelUnderfilledClasses(conn));
    for (const notice of notices) void pushLineMessage(notice.userId, pushText(notice.title, notice.body));
  } catch (error) {
    console.error("Class minimum check failed", error);
  }
}

export const SESSION_CANCELLED_TITLE = "ยกเลิกรอบเรียน";

// Staff cancel one class time (instructor ill, room closed): every booking of it is cancelled; a coupon
// use goes back, money paid goes back as app credit (an automatic refund), a request still waiting for
// payment is cancelled (one with a slip waits for a staff refund). Each member is told.
export async function cancelClassSession(conn: Connection, input: { program: ClassProgram; startsAt: string; reason: string; staffId: number | null }): Promise<JobNotice[]> {
  const { program, startsAt, reason } = input;
  const [rows] = await conn.execute(
    `SELECT id, user_id userId, user_coupon_id userCouponId, status, amount, DATE_FORMAT(starts_at, '%d/%m %H:%i') startText FROM bookings WHERE class_key = ? AND starts_at = ? AND (${takenBookingSql}) FOR UPDATE`,
    [program.slug, startsAt],
  );
  const notices: JobNotice[] = [];
  for (const booking of rows as { id: number; userId: number; userCouponId: number | null; status: string; amount: number | string; startText: string }[]) {
    let refunded = 0;
    if (["paid", "checked_in"].includes(booking.status) && Number(booking.amount) > 0) {
      const [payments] = await conn.execute("SELECT id, amount, CAST(metadata AS CHAR) metadata FROM payments WHERE booking_id = ? AND status = 'paid' FOR UPDATE", [booking.id]);
      for (const payment of payments as { id: number; amount: number; metadata: string | null }[]) {
        const amount = Number(payment.amount);
        if (!(amount > 0)) continue;
        await conn.execute("INSERT IGNORE INTO wallet_accounts (user_id) VALUES (?)", [booking.userId]);
        await conn.execute("UPDATE wallet_accounts SET balance = balance + ? WHERE user_id = ?", [amount, booking.userId]);
        await conn.execute("INSERT INTO wallet_ledger (user_id, kind, amount, ref_type, ref_id, note) VALUES (?, 'refund', ?, 'payment', ?, ?)", [booking.userId, amount, payment.id, `คืนเงิน ${program.title} ${booking.startText}`.slice(0, 255)]);
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(payment.metadata || "{}"); } catch { metadata = {}; }
        metadata.refund = { status: "done", to: "wallet", auto: true, at: new Date().toISOString(), ...(input.staffId ? { by: input.staffId } : {}) };
        metadata.cancelReason = reason;
        await conn.execute("UPDATE payments SET status = 'refunded', metadata = ? WHERE id = ?", [JSON.stringify(metadata), payment.id]);
        refunded += amount;
      }
    } else if (["hold", "pending_payment"].includes(booking.status)) {
      const [pending] = await conn.execute("SELECT id, slip_path slipPath, CAST(metadata AS CHAR) metadata FROM payments WHERE booking_id = ? AND status = 'created' FOR UPDATE", [booking.id]);
      for (const payment of pending as { id: number; slipPath: string | null; metadata: string | null }[]) {
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(payment.metadata || "{}"); } catch { metadata = {}; }
        metadata.cancelReason = reason;
        if (payment.slipPath) metadata.refund = { status: "pending" };
        await conn.execute("UPDATE payments SET status = 'cancelled', metadata = ? WHERE id = ?", [JSON.stringify(metadata), payment.id]);
      }
    }
    await conn.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?", [reason.slice(0, 255), booking.id]);
    if (booking.userCouponId) await restoreClassCoupon(conn, Number(booking.userCouponId), Number(booking.userId));
    const body = `${program.title} รอบ ${booking.startText} · ${reason}${booking.userCouponId ? " · คืนคูปองให้แล้ว" : ""}${refunded ? ` · คืน ${refunded.toLocaleString("en-US")} ฿ เข้าเครดิตในแอปแล้ว` : ""}`;
    await notifyMember(conn, Number(booking.userId), SESSION_CANCELLED_TITLE, body);
    notices.push({ userId: Number(booking.userId), title: SESSION_CANCELLED_TITLE, body });
  }
  if (input.staffId) {
    await conn.execute("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'class.cancel', 'class_session', ?, ?)", [input.staffId, `${program.slug}@${startsAt}`, JSON.stringify({ reason, bookings: notices.length })]);
  }
  return notices;
}
