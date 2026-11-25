import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminRequest } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { parseJsonBody, validationErrorResponse } from "@/lib/security";
import { normalizeSharedSpace } from "@/lib/court-space";
import { clearSharedCache } from "@/lib/shared-cache";

const courtSchema = z.object({
  id: z.coerce.number().optional(),
  sportId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  zone: z.string().trim().max(80).optional().or(z.literal("")),
  capacity: z.coerce.number().int().min(1).max(40).default(4),
  surface: z.string().trim().max(80).optional().or(z.literal("")),
  hourlyRate: z.coerce.number().min(0).max(999999).optional().nullable(),
  // Night price (from the sport's night hour); empty = day price x 1.5.
  nightRate: z.coerce.number().min(0).max(999999).optional().nullable(),
  // Option members pick inside a zone (Full Court / Half Court): courts of one kind are interchangeable.
  courtKind: z.string().trim().max(40).optional().or(z.literal("")),
  // Floor space shared with other courts, e.g. "indoor-left,indoor-right" (lib/court-space.ts).
  sharedSpace: z.string().trim().max(120).optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(999999).default(0),
  notes: z.string().trim().max(1200).optional().or(z.literal("")),
  status: z.enum(["available", "maintenance", "hidden"]),
});

export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;

  return NextResponse.json({ courts: await loadCourts() });
}

export async function POST(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;

  let body: z.infer<typeof courtSchema>;
  try {
    body = await parseJsonBody(request, courtSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  if (normalizeSharedSpace(body.sharedSpace) === undefined) return NextResponse.json({ message: "พื้นที่ใช้ร่วมต้องเป็นตัวพิมพ์เล็ก a-z 0-9 - คั่นด้วยจุลภาค เช่น indoor-left,indoor-right" }, { status: 400 });
  try {
    await query(
      "INSERT INTO courts (sport_id, name, zone, capacity, surface, hourly_rate, sort_order, notes, status, night_rate, court_kind, shared_space) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      courtParams(body),
    );
  } catch (error) {
    if (isDuplicateCourt(error)) return NextResponse.json({ message: "ชื่อสนามนี้มีแล้วในกีฬานี้" }, { status: 409 });
    throw error;
  }
  await query("INSERT INTO admin_audit_logs (action, target_type, target_id, metadata) VALUES ('court.create', 'courts', ?, JSON_OBJECT('sportId', ?, 'name', ?))", [
    body.name,
    body.sportId,
    body.name,
  ]);
  return GET(request);
}

export async function PUT(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;

  let body: z.infer<typeof courtSchema> & { id: number };
  try {
    body = await parseJsonBody(request, courtSchema.extend({ id: z.coerce.number().positive() }));
  } catch (error) {
    return validationErrorResponse(error);
  }
  if (normalizeSharedSpace(body.sharedSpace) === undefined) return NextResponse.json({ message: "พื้นที่ใช้ร่วมต้องเป็นตัวพิมพ์เล็ก a-z 0-9 - คั่นด้วยจุลภาค เช่น indoor-left,indoor-right" }, { status: 400 });
  try {
    await query(
      "UPDATE courts SET sport_id = ?, name = ?, zone = ?, capacity = ?, surface = ?, hourly_rate = ?, sort_order = ?, notes = ?, status = ?, night_rate = ?, court_kind = ?, shared_space = ? WHERE id = ?",
      [...courtParams(body), body.id],
    );
  } catch (error) {
    if (isDuplicateCourt(error)) return NextResponse.json({ message: "ชื่อสนามนี้มีแล้วในกีฬานี้" }, { status: 409 });
    throw error;
  }
  await query("INSERT INTO admin_audit_logs (action, target_type, target_id, metadata) VALUES ('court.update', 'courts', ?, JSON_OBJECT('sportId', ?, 'name', ?, 'status', ?))", [
    String(body.id),
    body.sportId,
    body.name,
    body.status,
  ]);
  return GET(request);
}

export async function DELETE(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;

  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ message: "Missing court id" }, { status: 400 });

  await query("UPDATE courts SET status = 'hidden' WHERE id = ?", [id]);
  await query("INSERT INTO admin_audit_logs (action, target_type, target_id) VALUES ('court.delete', 'courts', ?)", [String(id)]);
  return GET(request);
}

function loadCourts() {
  clearSharedCache();
  return query(
    "SELECT c.id, c.sport_id sportId, s.name_th sportName, c.name, c.zone, c.court_kind courtKind, c.shared_space sharedSpace, c.capacity, c.surface, c.hourly_rate hourlyRate, c.night_rate nightRate, c.sort_order sortOrder, c.notes, c.status FROM courts c JOIN sports s ON s.id = c.sport_id ORDER BY s.sort_order, c.sort_order, c.id LIMIT 300",
  );
}

function courtParams(body: z.infer<typeof courtSchema>) {
  return [
    body.sportId,
    body.name,
    body.zone || null,
    body.capacity,
    body.surface || null,
    body.hourlyRate || null,
    body.sortOrder,
    body.notes || null,
    body.status,
    body.nightRate || null,
    body.courtKind || null,
    normalizeSharedSpace(body.sharedSpace) ?? null,
  ];
}

function isDuplicateCourt(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
}
