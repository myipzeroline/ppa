import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminSessionCookieName, assertAdminRequest, getAdminIdentity } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { parseJsonBody, secureResponse, validationErrorResponse } from "@/lib/security";
import { clearSharedCache } from "@/lib/shared-cache";

const json = (body: unknown, status = 200) => secureResponse(NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }));

// Court prices and member booking hours of a sport: the day rate (base_rate) from opening, the night
// rate from night_from to closing (empty = day rate x 1.5). Courts may have their own rates.
const sportSchema = z.object({
  id: z.number().int().positive(),
  baseRate: z.number().min(0).max(999999),
  nightRate: z.number().min(0).max(999999).nullable(),
  nightFrom: z.number().int().min(0).max(23),
  openHour: z.number().int().min(0).max(23),
  closeHour: z.number().int().min(1).max(24),
}).refine((sport) => sport.openHour < sport.closeHour, { message: "เวลาปิดต้องหลังเวลาเปิด" })
  .refine((sport) => sport.nightFrom >= sport.openHour && sport.nightFrom <= sport.closeHour, { message: "เวลาเริ่มราคากลางคืนต้องอยู่ระหว่างเวลาเปิดและปิด" });

const load = () => query("SELECT id, slug, name_th name, icon, requires_booking requiresBooking, base_rate baseRate, night_rate nightRate, night_from nightFrom, open_hour openHour, close_hour closeHour, active FROM sports ORDER BY sort_order, id");

export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  return json({ sports: await load() });
}

export async function PUT(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  let input: z.infer<typeof sportSchema>;
  try {
    input = await parseJsonBody(request, sportSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const result = await query("UPDATE sports SET base_rate = ?, night_rate = ?, night_from = ?, open_hour = ?, close_hour = ? WHERE id = ?", [input.baseRate, input.nightRate && input.nightRate > 0 ? input.nightRate : null, input.nightFrom, input.openHour, input.closeHour, input.id]);
  if (!Number((result as unknown as { affectedRows?: number }).affectedRows)) return json({ message: "ไม่พบกีฬานี้" }, 404);
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'sport.rates', 'sport', ?, ?)", [admin?.id ?? null, String(input.id), JSON.stringify(input)]);
  clearSharedCache();
  return json({ sports: await load() });
}
