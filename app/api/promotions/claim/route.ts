import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool } from "@/lib/db";
import { claimDeal, PromotionError } from "@/lib/promotions";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";

const schema = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,96}$/) });

// "รับดีล": note this week's discount for the member, or give the weekly coupon to a member with enough
// check-in days. Once per member, deal and week (promotion_claims is unique on the three).
export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `promotion-claim:${await clientIp()}`, limit: 20, windowMs: 60_000 });
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await claimDeal(conn, user.id, input.slug);
    await conn.commit();
    return NextResponse.json({ ok: true, slug: result.deal.slug, kind: result.deal.kind, percent: result.deal.percent, until: result.week.lastDay, coupon: result.coupon }, { status: 201 });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error instanceof PromotionError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ message: "คุณรับดีลนี้แล้วในสัปดาห์นี้", code: "ALREADY_CLAIMED" }, { status: 409 });
    throw error;
  } finally {
    conn.release();
  }
}
