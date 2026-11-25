import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminRequest, getAdminIdentity, adminSessionCookieName } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { dealProblem, parseDeal, weekOf } from "@/lib/promotions";
import { parseJsonBody, validationErrorResponse } from "@/lib/security";
import { clearSharedCache } from "@/lib/shared-cache";

type Row = { id: number; contentType: string; slug: string; title: string; subtitle: string | null; icon: string; actionLabel: string | null; targetScreen: string | null; price: number; metadata: string | null; active: number; sortOrder: number };

const saveSchema = z.object({
  id: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(180),
  subtitle: z.string().trim().max(255).optional().or(z.literal("")),
  icon: z.string().trim().min(1).max(16),
  actionLabel: z.string().trim().max(80).optional().or(z.literal("")),
  price: z.coerce.number().min(0).max(9999999).default(0),
  active: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
});

// Back office · Promotion: the weekly deals with this week's and last week's claims, and the
// Member-price packages (membership plans with metadata.tab "member").
export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const week = weekOf();
  const lastWeek = weekOf(Date.now() - 7 * 86_400_000);
  const [items, claims, verified] = await Promise.all([
    query<Row>("SELECT id, content_type contentType, slug, title, subtitle, icon, action_label actionLabel, target_screen targetScreen, price, CAST(metadata AS CHAR) metadata, active, sort_order sortOrder FROM app_content_items WHERE content_type = 'promotion_deal' OR (content_type = 'membership_plan' AND JSON_VALUE(metadata, '$.tab') = 'member') ORDER BY content_type DESC, sort_order, id LIMIT 100"),
    query<{ dealSlug: string; periodKey: string; claims: number }>("SELECT deal_slug dealSlug, period_key periodKey, COUNT(*) claims FROM promotion_claims WHERE period_key IN (?, ?) GROUP BY deal_slug, period_key", [week.key, lastWeek.key]),
    query<{ verified: number; buyers: number }>("SELECT COUNT(DISTINCT o.user_id) verified, (SELECT COUNT(*) FROM payments WHERE status = 'paid' AND JSON_VALUE(metadata, '$.ppaMemberNo') IS NOT NULL AND paid_at >= ?) buyers FROM member_otps o WHERE o.verified_at >= ?", [week.from, week.from]),
  ]);
  const count = (slug: string, key: string) => Number(claims.find((row) => row.dealSlug === slug && row.periodKey === key)?.claims || 0);
  return NextResponse.json({
    week: { key: week.key, lastDay: week.lastDay },
    deals: items.filter((row) => row.contentType === "promotion_deal").map((row) => ({ ...row, active: Boolean(Number(row.active)), deal: parseDeal(row), claimsThisWeek: count(row.slug, week.key), claimsLastWeek: count(row.slug, lastWeek.key) })),
    packages: items.filter((row) => row.contentType === "membership_plan").map((row) => ({ ...row, active: Boolean(Number(row.active)) })),
    memberStats: { verifiedThisWeek: Number(verified[0]?.verified || 0), paidThisWeek: Number(verified[0]?.buyers || 0) },
  });
}

// Saves a deal (checked like the member app reads it) or a Member package.
export async function PUT(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  let body: z.infer<typeof saveSchema>;
  try {
    body = await parseJsonBody(request, saveSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const [current] = await query<{ contentType: string; slug: string; metadata: string | null }>("SELECT content_type contentType, slug, CAST(metadata AS CHAR) metadata FROM app_content_items WHERE id = ? AND (content_type = 'promotion_deal' OR (content_type = 'membership_plan' AND JSON_VALUE(metadata, '$.tab') = 'member')) LIMIT 1", [body.id]);
  if (!current) return NextResponse.json({ message: "ไม่พบรายการนี้" }, { status: 404 });
  if (current.contentType === "promotion_deal") {
    const problem = dealProblem(body.metadata);
    if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  } else {
    // A Member package stays a Member package: the OTP check depends on these two keys.
    body.metadata = { ...body.metadata, tab: "member", memberOnly: true };
    if (!(body.price > 0)) return NextResponse.json({ message: "แพ็กเกจต้องมีราคามากกว่า 0" }, { status: 400 });
  }
  await query(
    "UPDATE app_content_items SET title = ?, subtitle = ?, icon = ?, action_label = ?, price = ?, metadata = ?, active = ? WHERE id = ?",
    [body.title, body.subtitle || null, body.icon, body.actionLabel || null, current.contentType === "promotion_deal" ? 0 : body.price, JSON.stringify(body.metadata), body.active, body.id],
  );
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'promotion.update', 'app_content_items', ?, JSON_OBJECT('slug', ?, 'active', ?, 'price', ?))", [admin?.id || null, String(body.id), current.slug, body.active, body.price]);
  clearSharedCache();
  return GET(request);
}
