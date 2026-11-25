import { randomInt, timingSafeEqual } from "node:crypto";
import type mysql from "mysql2/promise";
import { keyedHash } from "@/lib/session";

// PPA Member prices (Promotion › Member, part 12): a package sold at the Member price is bought only
// after the buyer proves they are the PPA member: the 6-digit member number (ppa_members, kept by
// staff), then a 4-digit code sent to that member's phone. A confirmed code lets the app account buy
// Member packages for 30 minutes.

type Connection = Pick<mysql.PoolConnection, "execute">;

export const OTP_SECONDS = 300;
export const OTP_TRIES = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_PER_HOUR = 5;
export const VERIFIED_MINUTES = 30;

export class MemberVerifyError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}

export function memberNoOf(value: unknown) {
  return typeof value === "string" && /^\d{6}$/.test(value) ? value : null;
}

// 081-xxx-5678: enough for the member to recognise the number, not enough to read it.
export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "xxx";
  const local = digits.startsWith("66") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  return `${local.slice(0, 3)}-xxx-${local.slice(-4)}`;
}

function otpHash(memberId: number, userId: number, code: string) {
  return keyedHash("member-otp", `${memberId}:${userId}:${code}`);
}

type MemberRow = { id: number; memberNo: string; fullName: string; phone: string; status: string; current: number };

async function memberByNo(conn: Connection, memberNo: string) {
  const [rows] = await conn.execute(
    "SELECT id, member_no memberNo, full_name fullName, phone, status, (expires_on IS NULL OR expires_on >= CURDATE()) current FROM ppa_members WHERE member_no = ? LIMIT 1 FOR UPDATE",
    [memberNo],
  );
  const member = (rows as MemberRow[])[0];
  if (!member || member.status !== "active" || !Number(member.current)) throw new MemberVerifyError("ไม่พบรหัสสมาชิกนี้ หรือสถานะสมาชิกไม่พร้อมใช้งาน", 404, "NOT_FOUND");
  return member;
}

// Creates a code for the member's phone. At most one a minute and five an hour per member number.
export async function createOtp(conn: Connection, userId: number, memberNo: string) {
  const member = await memberByNo(conn, memberNo);
  const [recent] = await conn.execute(
    "SELECT TIMESTAMPDIFF(SECOND, MAX(created_at), NOW()) sinceLast, COUNT(*) lastHour FROM member_otps WHERE ppa_member_id = ? AND created_at > NOW() - INTERVAL 1 HOUR",
    [member.id],
  );
  const usage = (recent as { sinceLast: number | null; lastHour: number }[])[0] || { sinceLast: null, lastHour: 0 };
  if (usage.sinceLast !== null && Number(usage.sinceLast) < OTP_RESEND_SECONDS) {
    throw new MemberVerifyError("กรุณารอ 1 นาทีก่อนขอรหัสใหม่", 429, "WAIT");
  }
  if (Number(usage.lastHour) >= OTP_PER_HOUR) throw new MemberVerifyError("ขอรหัสครบจำนวนต่อชั่วโมงแล้ว กรุณาลองใหม่ภายหลัง", 429, "LIMIT");
  const code = String(randomInt(0, 10_000)).padStart(4, "0");
  await conn.execute(
    "INSERT INTO member_otps (ppa_member_id, user_id, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))",
    [member.id, userId, otpHash(Number(member.id), userId, code), OTP_SECONDS],
  );
  return { code, phone: member.phone, phoneMasked: maskPhone(member.phone), expiresIn: OTP_SECONDS };
}

// Checks the code of the member's latest request from this app account. Five wrong tries end it.
export async function confirmOtp(conn: Connection, userId: number, memberNo: string, code: string) {
  const member = await memberByNo(conn, memberNo);
  const [rows] = await conn.execute(
    "SELECT id, code_hash codeHash, attempts, expires_at > NOW() valid, verified_at verifiedAt FROM member_otps WHERE ppa_member_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE",
    [member.id, userId],
  );
  const otp = (rows as { id: number; codeHash: string; attempts: number; valid: number; verifiedAt: string | null }[])[0];
  if (!otp || otp.verifiedAt || !Number(otp.valid)) throw new MemberVerifyError("รหัส OTP หมดอายุ กรุณากดขอรหัสใหม่", 410, "EXPIRED");
  if (Number(otp.attempts) >= OTP_TRIES) throw new MemberVerifyError("ใส่รหัสผิดครบ 5 ครั้งแล้ว กรุณากดขอรหัสใหม่", 429, "TOO_MANY");
  const expected = Buffer.from(String(otp.codeHash), "hex");
  const given = Buffer.from(otpHash(Number(member.id), userId, /^\d{4}$/.test(code) ? code : "x"), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    await conn.execute("UPDATE member_otps SET attempts = attempts + 1 WHERE id = ?", [otp.id]);
    const left = OTP_TRIES - Number(otp.attempts) - 1;
    throw new MemberVerifyError(left > 0 ? "รหัส OTP ไม่ถูกต้อง ลองอีกครั้ง" : "ใส่รหัสผิดครบ 5 ครั้งแล้ว กรุณากดขอรหัสใหม่", 400, left > 0 ? "WRONG" : "TOO_MANY");
  }
  await conn.execute("UPDATE member_otps SET verified_at = NOW() WHERE id = ?", [otp.id]);
  await conn.execute("UPDATE ppa_members SET user_id = ?, verified_at = NOW() WHERE id = ?", [userId, member.id]);
  return { memberNo: member.memberNo, name: member.fullName, minutes: VERIFIED_MINUTES };
}

// The PPA member this app account confirmed in the last 30 minutes (still active), or null.
export async function memberVerification(read: (sql: string, params?: unknown[]) => Promise<unknown[]>, userId: number) {
  const rows = (await read(
    `SELECT m.id, m.member_no memberNo, m.full_name name, o.verified_at verifiedAt FROM member_otps o JOIN ppa_members m ON m.id = o.ppa_member_id WHERE o.user_id = ? AND o.verified_at IS NOT NULL AND o.verified_at > NOW() - INTERVAL ${VERIFIED_MINUTES} MINUTE AND m.status = 'active' AND (m.expires_on IS NULL OR m.expires_on >= CURDATE()) ORDER BY o.verified_at DESC LIMIT 1`,
    [userId],
  )) as { id: number; memberNo: string; name: string; verifiedAt: string }[];
  return rows[0] || null;
}
