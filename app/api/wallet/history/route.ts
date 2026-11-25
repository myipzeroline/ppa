import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

const PAGE = 30;
const filters: Record<string, string> = {
  // Payments of every channel (app credit, PromptPay, counter), with their state.
  payments: "p.status IN ('paid','created','cancelled','refunded') AND COALESCE(JSON_VALUE(p.metadata, '$.kind'), '') <> 'wallet_topup'",
  topups: "COALESCE(JSON_VALUE(p.metadata, '$.kind'), '') = 'wallet_topup'",
  refunds: "p.status = 'refunded'",
};

// Transaction history (ประวัติธุรกรรมย้อนหลัง): the member's payments, newest first, 30 per page; and
// with kind=coins the Coin ledger (earned and spent). Older pages via ?before=<id>.
export async function GET(req: Request) {
  const limited = checkRateLimit({ key: `wallet-history:${await clientIp()}`, limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "all";
  const before = Number(url.searchParams.get("before") || 0);
  const cursor = Number.isSafeInteger(before) && before > 0 ? before : null;
  if (kind === "coins") {
    const rows = await query<{ id: number }>(
      `SELECT id, kind, coin_delta coinDelta, note, created_at createdAt FROM wallet_ledger WHERE user_id = ? AND coin_delta <> 0${cursor ? " AND id < ?" : ""} ORDER BY id DESC LIMIT ${PAGE + 1}`,
      cursor ? [user.id, cursor] : [user.id],
    );
    return secureResponse(NextResponse.json({ kind, coins: rows.slice(0, PAGE), next: rows.length > PAGE ? rows[PAGE - 1].id : null }));
  }
  const filter = filters[kind] || "p.status IN ('paid','created','cancelled','refunded')";
  const rows = await query<{ id: number }>(
    "SELECT p.id, p.payment_no paymentNo, p.method, p.amount, p.status, p.created_at createdAt, p.paid_at paidAt, " +
      "COALESCE(JSON_VALUE(p.metadata, '$.itemName'), b.title) itemName, COALESCE(JSON_VALUE(p.metadata, '$.itemType'), JSON_VALUE(p.metadata, '$.kind')) itemType, " +
      "JSON_VALUE(p.metadata, '$.refund.status') refundStatus, JSON_VALUE(p.metadata, '$.refund.to') refundTo, JSON_VALUE(p.metadata, '$.cancelReason') cancelReason " +
      `FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE p.user_id = ? AND ${filter}${cursor ? " AND p.id < ?" : ""} ORDER BY p.id DESC LIMIT ${PAGE + 1}`,
    cursor ? [user.id, cursor] : [user.id],
  );
  return secureResponse(NextResponse.json({ kind, payments: rows.slice(0, PAGE), next: rows.length > PAGE ? rows[PAGE - 1].id : null }));
}
