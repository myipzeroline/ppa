import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { memberVerification } from "@/lib/ppa-member";
import { activeDiscount, parseDeal, weekOf, type Deal } from "@/lib/promotions";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";
import { sharedCache } from "@/lib/shared-cache";
import { smsProvider } from "@/lib/sms";

type DealRow = { id: number; slug: string; title: string; subtitle: string | null; icon: string; actionLabel: string | null; targetScreen: string | null; metadata: string | null };

// Promotion (Hot Deals): this week's deals with what the member already claimed or may claim, the
// discount in force and the PPA Member verification of this account (for the Member tab).
export async function GET() {
  const limited = checkRateLimit({ key: `promotions:${await clientIp()}`, limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const week = weekOf();
  const read = (sql: string, params?: unknown[]) => query(sql, params);
  const [rows, claims, checkins, trainerRights, discount, verified] = await Promise.all([
    sharedCache("catalog:promotion-deals", 60_000, () => query<DealRow>("SELECT id, slug, title, subtitle, icon, action_label actionLabel, target_screen targetScreen, CAST(metadata AS CHAR) metadata FROM app_content_items WHERE content_type = 'promotion_deal' AND active = TRUE ORDER BY sort_order, id LIMIT 20")),
    query<{ dealSlug: string }>("SELECT deal_slug dealSlug FROM promotion_claims WHERE user_id = ? AND period_key = ?", [user.id, week.key]),
    query<{ days: number }>("SELECT COUNT(DISTINCT DATE(created_at)) days FROM member_visits WHERE user_id = ? AND created_at >= ? AND created_at < ?", [user.id, week.from, week.to]),
    query<{ entitlementType: string }>("SELECT entitlement_type entitlementType FROM user_entitlements WHERE user_id = ? AND entitlement_type IN ('trainer','trainer_bonus') LIMIT 5", [user.id]),
    activeDiscount(read, user.id),
    memberVerification(read, user.id),
  ]);
  const claimed = new Set(claims.map((row) => row.dealSlug));
  const days = Number(checkins[0]?.days || 0);
  const kinds = new Set(trainerRights.map((row) => row.entitlementType));
  const deals = rows.map(parseDeal).filter((deal): deal is Deal => Boolean(deal)).map((deal) => ({
    ...deal,
    claimed: claimed.has(deal.slug),
    ...(deal.kind === "weekly_coupon" ? { checkins: days, eligible: days >= deal.checkinDays } : {}),
    ...(deal.kind === "trainer_bonus" ? { bonus: kinds.has("trainer_bonus") ? "received" : kinds.has("trainer") ? "not_first" : "available" } : {}),
  }));
  return secureResponse(NextResponse.json({
    week: { key: week.key, lastDay: week.lastDay },
    deals,
    discount,
    verification: verified ? { memberNo: verified.memberNo, name: verified.name, verifiedAt: verified.verifiedAt } : null,
    // One-time codes reach the member's phone only with an SMS provider (development shows the code).
    otpDelivery: smsProvider() ? "sms" : process.env.NODE_ENV === "production" ? "unavailable" : "screen",
  }, { headers: { "Cache-Control": "private, no-store" } }));
}
