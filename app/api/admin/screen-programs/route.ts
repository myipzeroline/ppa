import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminSessionCookieName, assertAdminRequest, getAdminIdentity } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { sqlWallClock, wallTime } from "@/lib/screen-programs";
import { parseJsonBody, secureResponse, validationErrorResponse } from "@/lib/security";
import { clearSharedCache } from "@/lib/shared-cache";

const json = (body: unknown, status = 200) => secureResponse(NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }));
const wall = z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

// A program on the big screens: start and end in Bangkok wall clock, at most 12 hours long. The
// optional English title/subtitle reach members who use the app in English (metadata.i18n).
const programSchema = z.object({
  title: z.string().trim().min(2).max(180),
  subtitle: z.string().trim().max(255).optional().or(z.literal("")),
  icon: z.string().trim().min(1).max(16).default("📺"),
  zone: z.string().trim().min(1).max(40),
  startsAt: wall,
  endsAt: wall,
  titleEn: z.string().trim().max(180).optional().or(z.literal("")),
  subtitleEn: z.string().trim().max(255).optional().or(z.literal("")),
}).refine((input) => {
  const start = wallTime(sqlWallClock(input.startsAt));
  const end = wallTime(sqlWallClock(input.endsAt));
  return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 12 * 3_600_000;
}, { message: "เวลาจบต้องหลังเวลาเริ่ม และยาวไม่เกิน 12 ชั่วโมง" });

function load() {
  return query(
    "SELECT id, title, subtitle, icon, zone, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i') endsAt, status, CAST(metadata AS CHAR) metadata FROM screen_programs WHERE ends_at > NOW() - INTERVAL 7 DAY ORDER BY starts_at, id LIMIT 400",
  );
}

function metadataOf(input: z.infer<typeof programSchema>) {
  const en = { ...(input.titleEn ? { title: input.titleEn } : {}), ...(input.subtitleEn ? { subtitle: input.subtitleEn } : {}) };
  return JSON.stringify(Object.keys(en).length ? { i18n: { en } } : {});
}

export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  return json({ programs: await load() });
}

export async function POST(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  let input: z.infer<typeof programSchema>;
  try {
    input = await parseJsonBody(request, programSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const result = await query(
    "INSERT INTO screen_programs (title, subtitle, icon, zone, starts_at, ends_at, metadata, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [input.title, input.subtitle || null, input.icon, input.zone.toUpperCase(), sqlWallClock(input.startsAt), sqlWallClock(input.endsAt), metadataOf(input), admin?.id ?? null],
  );
  const id = Number((result as unknown as { insertId?: number }).insertId || 0);
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'screen.create', 'screen_program', ?, ?)", [admin?.id ?? null, String(id), JSON.stringify({ title: input.title, zone: input.zone, startsAt: input.startsAt })]);
  clearSharedCache();
  return json({ programs: await load() }, 201);
}

export async function PUT(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  let input: z.infer<typeof programSchema> & { id: number; status?: "active" | "cancelled" };
  try {
    input = await parseJsonBody(request, programSchema.and(z.object({ id: z.number().int().positive(), status: z.enum(["active", "cancelled"]).optional() })));
  } catch (error) {
    return validationErrorResponse(error);
  }
  const result = await query(
    "UPDATE screen_programs SET title = ?, subtitle = ?, icon = ?, zone = ?, starts_at = ?, ends_at = ?, metadata = ?, status = COALESCE(?, status) WHERE id = ?",
    [input.title, input.subtitle || null, input.icon, input.zone.toUpperCase(), sqlWallClock(input.startsAt), sqlWallClock(input.endsAt), metadataOf(input), input.status ?? null, input.id],
  );
  if (!Number((result as unknown as { affectedRows?: number }).affectedRows)) return json({ message: "ไม่พบรายการนี้" }, 404);
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'screen.update', 'screen_program', ?, ?)", [admin?.id ?? null, String(input.id), JSON.stringify({ title: input.title, zone: input.zone, startsAt: input.startsAt, status: input.status ?? null })]);
  clearSharedCache();
  return json({ programs: await load() });
}

// Takes a program off the guide (kept for the audit trail).
export async function DELETE(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400);
  await query("UPDATE screen_programs SET status = 'cancelled' WHERE id = ?", [id]);
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id) VALUES (?, 'screen.cancel', 'screen_program', ?)", [admin?.id ?? null, String(id)]);
  clearSharedCache();
  return json({ programs: await load() });
}
