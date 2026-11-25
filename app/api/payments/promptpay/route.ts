import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { maskPromptPayTarget, promptPayPayload, promptPayTargetValid } from "@/lib/promptpay";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

type PaymentRow = { paymentNo: string; amount: number; status: string; method: string; itemName?: string | null; slipUploadedAt?: string | null; bookingId?: number | null; bookingStatus?: string | null; holdSeconds?: number | null; qrSeconds?: number | null; original?: string | null };

// A QR shown for a package or coupon is valid for 15 minutes ("QR หมดอายุใน 14:59"); the member can ask
// for a fresh one (POST) while the request is open. A court or class booking shows its 15-minute hold.
export const QR_MINUTES = 15;
const paymentSql = `SELECT p.payment_no paymentNo, p.amount, p.status, p.method, JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.itemName')) itemName, JSON_VALUE(p.metadata, '$.discount.original') original, p.slip_uploaded_at slipUploadedAt, p.booking_id bookingId, b.status bookingStatus, TIMESTAMPDIFF(SECOND, NOW(), b.expires_at) holdSeconds, TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(COALESCE(CAST(JSON_VALUE(p.metadata, '$.qrIssuedAt') AS DATETIME), p.created_at), INTERVAL ${QR_MINUTES} MINUTE)) qrSeconds FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.payment_no = ? AND p.user_id = ? LIMIT 1`;

// PromptPay QR with the exact amount of the member's own unpaid payment.
export async function GET(req: NextRequest) {
  const limited = checkRateLimit({ key: `promptpay-qr:${await clientIp()}`, limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const target = process.env.PROMPTPAY_ID || "";
  if (!promptPayTargetValid(target)) {
    return secureResponse(NextResponse.json({ code: "PROMPTPAY_NOT_CONFIGURED", message: "ยังไม่ได้ตั้งค่าบัญชีพร้อมเพย์" }, { status: 404 }));
  }
  const paymentNo = req.nextUrl.searchParams.get("paymentNo") || "";
  if (!/^PAY[A-Z0-9]{6,60}$/.test(paymentNo)) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  const [payment] = await query<PaymentRow>(paymentSql, [paymentNo, user.id]);
  if (!payment || payment.method !== "promptpay") return secureResponse(NextResponse.json({ message: "ไม่พบรายการชำระเงิน" }, { status: 404 }));
  if (payment.status !== "created") return secureResponse(NextResponse.json({ status: payment.status, message: "รายการนี้ไม่ได้รอชำระแล้ว" }, { status: 409 }));
  // Court bookings are held for 15 minutes: show the deadline, and stop offering the QR once the
  // hold has lapsed (a member who already paid can still attach the slip, see /api/payments/slip).
  const awaitingSlip = Boolean(payment.bookingId) && !payment.slipUploadedAt;
  const holdSeconds = Number(payment.holdSeconds);
  if (awaitingSlip && !(["hold", "pending_payment"].includes(String(payment.bookingStatus)) && holdSeconds > 0)) {
    return secureResponse(NextResponse.json({ code: "BOOKING_EXPIRED", paymentNo: payment.paymentNo, message: "หมดเวลาชำระของการจองนี้แล้ว" }, { status: 409 }));
  }
  const amount = Number(payment.amount);
  if (!(amount > 0)) return secureResponse(NextResponse.json({ code: "NOTHING_TO_PAY", message: "รายการนี้ไม่มียอดที่ต้องชำระ" }, { status: 409 }));
  const qrSeconds = Number(payment.qrSeconds);
  // How long this QR may still be scanned: the booking hold, or the QR window of a package payment.
  const qrExpiresIn = awaitingSlip ? holdSeconds : !payment.bookingId && !payment.slipUploadedAt && Number.isFinite(qrSeconds) && payment.qrSeconds !== null ? qrSeconds : null;
  const qrExpired = qrExpiresIn !== null && qrExpiresIn <= 0;
  // PNG (not SVG) so members can long-press/save it and scan it from their banking app.
  const qr = qrExpired ? null : await QRCode.toDataURL(promptPayPayload(target, amount), { margin: 2, width: 480, errorCorrectionLevel: "M" });
  const original = Number(payment.original);
  return secureResponse(NextResponse.json({
    paymentNo: payment.paymentNo,
    amount,
    itemName: payment.itemName || null,
    qr,
    qrExpired,
    qrExpiresIn: qrExpired ? 0 : qrExpiresIn,
    payee: { name: process.env.PROMPTPAY_NAME || "PPA Power Play Sport Club", account: maskPromptPayTarget(target) },
    slipUploadedAt: payment.slipUploadedAt || null,
    holdSeconds: awaitingSlip ? holdSeconds : null,
    original: Number.isFinite(original) && original > amount ? original : null,
  }));
}

// "สร้าง QR ใหม่": a fresh 15-minute QR for the member's own open package or coupon payment (a booking's
// QR follows its hold and cannot be extended).
export async function POST(req: NextRequest) {
  const limited = checkRateLimit({ key: `promptpay-renew:${await clientIp()}`, limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const body = await req.json().catch(() => ({})) as { paymentNo?: unknown };
  const paymentNo = typeof body.paymentNo === "string" ? body.paymentNo : "";
  if (!/^PAY[A-Z0-9]{6,60}$/.test(paymentNo)) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  const result = await query(
    "UPDATE payments SET metadata = JSON_SET(COALESCE(metadata, JSON_OBJECT()), '$.qrIssuedAt', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s')) WHERE payment_no = ? AND user_id = ? AND status = 'created' AND method = 'promptpay' AND booking_id IS NULL",
    [paymentNo, user.id],
  ) as unknown as { affectedRows?: number };
  if (!Number(result.affectedRows || 0)) return secureResponse(NextResponse.json({ message: "รายการนี้ไม่ได้รอชำระแล้ว" }, { status: 409 }));
  return GET(new NextRequest(new URL(`/api/payments/promptpay?paymentNo=${paymentNo}`, req.url)));
}
