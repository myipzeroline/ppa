import type mysql from "mysql2/promise";

// Promotion (Hot Deals), part 12: weekly deals members claim in the app (app_content_items
// content_type "promotion_deal") and the claims of each week (promotion_claims).
//   kind "discount":       percent off every package of the services in scope (Fitness, Swim, Pilates,
//                          Airfit) bought in the week it was claimed;
//   kind "weekly_coupon":  a free coupon each week for members who checked in on enough days that week;
//   kind "trainer_bonus":  free training hours with the member's first Personal Trainer purchase.
// A week runs Monday to Sunday, Bangkok time; period_key is its Monday.

type Connection = Pick<mysql.PoolConnection, "execute">;
export type DealKind = "discount" | "weekly_coupon" | "trainer_bonus";
export type Deal = {
  id: number;
  slug: string;
  kind: DealKind;
  title: string;
  subtitle: string | null;
  icon: string;
  actionLabel: string | null;
  targetScreen: string | null;
  percent: number;
  scope: string[];
  checkinDays: number;
  couponCode: string | null;
  validityDays: number;
  hours: number;
  value: number;
  tone: string;
};
type DealRow = { id: number; slug: string; title: string; subtitle?: string | null; icon?: string | null; actionLabel?: string | null; targetScreen?: string | null; metadata?: unknown };

const kinds: DealKind[] = ["discount", "weekly_coupon", "trainer_bonus"];
export const DISCOUNT_SCOPES = ["fitness", "swim", "pilates", "airfit", "hyrox"];

function record(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseDeal(row: DealRow): Deal | null {
  const meta = record(row.metadata);
  const kind = kinds.find((value) => value === meta.kind);
  if (!kind) return null;
  const deal: Deal = {
    id: Number(row.id),
    slug: row.slug,
    kind,
    title: row.title,
    subtitle: row.subtitle || null,
    icon: row.icon || "🎁",
    actionLabel: row.actionLabel || null,
    targetScreen: row.targetScreen || null,
    percent: integer(meta.percent, 1, 90) ?? 0,
    scope: Array.isArray(meta.scope) ? meta.scope.filter((value): value is string => typeof value === "string" && DISCOUNT_SCOPES.includes(value)) : [],
    checkinDays: integer(meta.checkinDays, 1, 7) ?? 3,
    couponCode: typeof meta.couponCode === "string" && /^[A-Z0-9-]{2,40}$/.test(meta.couponCode) ? meta.couponCode : null,
    validityDays: integer(meta.validityDays, 1, 90) ?? 7,
    hours: integer(meta.hours, 1, 20) ?? 2,
    value: integer(meta.value, 0, 1_000_000) ?? 0,
    tone: typeof meta.tone === "string" && /^[a-z]{1,12}$/.test(meta.tone) ? meta.tone : "orange",
  };
  if (kind === "discount" && (!deal.percent || !deal.scope.length)) return null;
  if (kind === "weekly_coupon" && !deal.couponCode) return null;
  return deal;
}

// Back-office save check for content type promotion_deal (null = fine).
export function dealProblem(metadata: Record<string, unknown>) {
  if (!kinds.includes(metadata.kind as DealKind)) return "promotion_deal: metadata.kind ต้องเป็น discount, weekly_coupon หรือ trainer_bonus";
  const deal = parseDeal({ id: 0, slug: "check", title: "check", metadata });
  if (!deal && metadata.kind === "discount") return "promotion_deal: ส่วนลดต้องมี metadata.percent 1-90 และ metadata.scope เช่น [\"fitness\",\"swim\",\"pilates\",\"airfit\"]";
  if (!deal && metadata.kind === "weekly_coupon") return "promotion_deal: แถมคูปองต้องมี metadata.couponCode (รหัสคูปองตัวพิมพ์ใหญ่) และ checkinDays 1-7";
  return null;
}

// Monday of the Bangkok week holding `now`, and the week's bounds as Bangkok wall-clock times.
export function weekOf(now = Date.now()) {
  const local = new Date(now + 7 * 3_600_000);
  const offset = (local.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - offset));
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  return { key: date(monday), from: `${date(monday)} 00:00:00`, to: `${date(nextMonday)} 00:00:00`, lastDay: date(new Date(nextMonday.getTime() - 86_400_000)) };
}

export function discounted(price: number, percent: number) {
  return Math.max(0, Math.round((Number(price) * (100 - percent)) / 100));
}

// Which service's packages an item is, for a discount deal's scope. Package catalog items belong to the
// page they are sold on (metadata.page, Fitness by default); Member-price packages never get a deal.
export function contentScope(item: { contentType?: string | null; metadata?: unknown }) {
  if (item.contentType !== "membership_plan" && item.contentType !== "time_pass") return null;
  const meta = record(item.metadata);
  if (meta.memberOnly === true) return null;
  return typeof meta.page === "string" && meta.page ? meta.page : "fitness";
}

// Coupon packs: the Fitness/Swim coupon tab (metadata.page, Fitness by default), or the class program's
// service for class coupons (programService, read by the caller).
export function couponScope(coupon: { metadata?: unknown }, programService?: string | null) {
  const meta = record(coupon.metadata);
  if (meta.grantOnly === true) return null;
  if (meta.tab === "coupon") return typeof meta.page === "string" && meta.page ? meta.page : "fitness";
  if (typeof meta.program === "string") return programService || null;
  return null;
}

export type ActiveDiscount = { slug: string; title: string; percent: number; scope: string[]; until: string };

// The discount deal the member claimed this week, while the deal is still on.
export async function activeDiscount(read: (sql: string, params?: unknown[]) => Promise<unknown[]>, userId: number, now = Date.now()): Promise<ActiveDiscount | null> {
  const week = weekOf(now);
  const rows = (await read(
    "SELECT d.id, d.slug, d.title, d.subtitle, d.icon, d.action_label actionLabel, d.target_screen targetScreen, CAST(d.metadata AS CHAR) metadata FROM promotion_claims pc JOIN app_content_items d ON d.content_type = 'promotion_deal' AND d.slug = pc.deal_slug AND d.active = TRUE WHERE pc.user_id = ? AND pc.period_key = ? LIMIT 10",
    [userId, week.key],
  )) as DealRow[];
  if (!Array.isArray(rows)) return null;
  const deal = rows.map(parseDeal).filter((item): item is Deal => Boolean(item && item.kind === "discount")).sort((a, b) => b.percent - a.percent)[0];
  return deal ? { slug: deal.slug, title: deal.title, percent: deal.percent, scope: deal.scope, until: week.lastDay } : null;
}

export function priceWithDiscount(price: number, scope: string | null, discount: ActiveDiscount | null) {
  if (!discount || !scope || !discount.scope.includes(scope) || !(price > 0)) return { amount: Number(price), discount: null };
  const amount = discounted(price, discount.percent);
  return { amount, discount: { deal: discount.slug, percent: discount.percent, original: Number(price) } };
}

export async function checkinDaysThisWeek(conn: Connection, userId: number, now = Date.now()) {
  const week = weekOf(now);
  const [rows] = await conn.execute(
    "SELECT COUNT(DISTINCT DATE(created_at)) days FROM member_visits WHERE user_id = ? AND created_at >= ? AND created_at < ?",
    [userId, week.from, week.to],
  );
  return Number((rows as { days: number }[])[0]?.days || 0);
}

export class PromotionError extends Error {
  constructor(message: string, readonly status = 409, readonly code?: string) {
    super(message);
  }
}

export async function loadDeal(conn: Connection, slug: string) {
  const [rows] = await conn.execute(
    "SELECT id, slug, title, subtitle, icon, action_label actionLabel, target_screen targetScreen, CAST(metadata AS CHAR) metadata FROM app_content_items WHERE content_type = 'promotion_deal' AND slug = ? AND active = TRUE LIMIT 1",
    [slug],
  );
  const row = (rows as DealRow[])[0];
  return row ? parseDeal(row) : null;
}

// "รับดีล": a discount is noted for this week (checkout takes it off), a weekly coupon is granted at
// once to a member with enough check-in days this week. Each deal once per member per week.
export async function claimDeal(conn: Connection, userId: number, slug: string, now = Date.now()) {
  const deal = await loadDeal(conn, slug);
  if (!deal) throw new PromotionError("ดีลนี้หมดเวลาแล้ว", 404, "DEAL_NOT_FOUND");
  if (deal.kind === "trainer_bonus") throw new PromotionError("ดีลนี้ได้รับอัตโนมัติเมื่อซื้อแพ็กเกจเทรนเนอร์ครั้งแรก", 400, "AUTOMATIC");
  const week = weekOf(now);
  const [existing] = await conn.execute("SELECT id FROM promotion_claims WHERE user_id = ? AND deal_slug = ? AND period_key = ? LIMIT 1 FOR UPDATE", [userId, deal.slug, week.key]);
  if ((existing as unknown[]).length) throw new PromotionError("คุณรับดีลนี้แล้วในสัปดาห์นี้", 409, "ALREADY_CLAIMED");
  let coupon: { name: string; expiresInDays: number } | null = null;
  if (deal.kind === "weekly_coupon") {
    const days = await checkinDaysThisWeek(conn, userId, now);
    if (days < deal.checkinDays) throw new PromotionError("ต้องเช็คอินให้ครบตามจำนวนวันในสัปดาห์นี้ก่อนจึงจะรับคูปองได้", 409, "NOT_ELIGIBLE");
    const [coupons] = await conn.execute("SELECT id, name, total_uses totalUses FROM coupons WHERE code = ? LIMIT 1", [deal.couponCode]);
    const free = (coupons as { id: number; name: string; totalUses: number }[])[0];
    if (!free) throw new PromotionError("ยังไม่ได้ตั้งค่าคูปองของดีลนี้ กรุณาติดต่อเจ้าหน้าที่", 503, "COUPON_MISSING");
    const [claim] = await conn.execute("INSERT INTO promotion_claims (user_id, deal_slug, period_key) VALUES (?, ?, ?)", [userId, deal.slug, week.key]);
    const uses = Math.max(1, Number(free.totalUses || 1));
    const [granted] = await conn.execute(
      "INSERT INTO user_coupons (user_id, coupon_id, total_uses, payment_id, remaining_uses, expires_at) VALUES (?, ?, ?, NULL, ?, DATE_ADD(NOW(), INTERVAL ? DAY))",
      [userId, free.id, uses, uses, deal.validityDays],
    );
    await conn.execute("UPDATE promotion_claims SET user_coupon_id = ? WHERE id = ?", [(granted as { insertId: number }).insertId, (claim as { insertId: number }).insertId]);
    coupon = { name: free.name, expiresInDays: deal.validityDays };
  } else {
    await conn.execute("INSERT INTO promotion_claims (user_id, deal_slug, period_key) VALUES (?, ?, ?)", [userId, deal.slug, week.key]);
  }
  return { deal, week, coupon };
}

export const TRAINER_BONUS_TYPE = "trainer_bonus";

// The member's first Personal Trainer purchase while the trainer deal is on comes with free training
// hours (an entitlement the trainer redeems by scanning it). Called inside the transaction that grants
// the purchase, before the purchase's own entitlement is written.
export async function grantTrainerBonus(conn: Connection, userId: number, paymentId: number | null) {
  const [deals] = await conn.execute(
    "SELECT id, slug, title, subtitle, icon, action_label actionLabel, target_screen targetScreen, CAST(metadata AS CHAR) metadata FROM app_content_items WHERE content_type = 'promotion_deal' AND active = TRUE AND JSON_VALUE(metadata, '$.kind') = 'trainer_bonus' ORDER BY sort_order, id LIMIT 1",
  );
  const deal = (deals as DealRow[]).map(parseDeal)[0];
  if (!deal) return null;
  const [before] = await conn.execute(
    "SELECT id FROM user_entitlements WHERE user_id = ? AND entitlement_type IN ('trainer', ?) LIMIT 1 FOR UPDATE",
    [userId, TRAINER_BONUS_TYPE],
  );
  if ((before as unknown[]).length) return null;
  const title = `เทรนฟรี ${deal.hours} ชม. (${deal.title})`.slice(0, 180);
  await conn.execute(
    "INSERT INTO user_entitlements (user_id, payment_id, entitlement_type, title, remaining_uses, ends_at, status, metadata) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 180 DAY), 'active', ?)",
    [userId, paymentId, TRAINER_BONUS_TYPE, title, deal.hours, JSON.stringify({ source: "promotion", deal: deal.slug, hours: deal.hours, value: deal.value })],
  );
  return { title, hours: deal.hours };
}
