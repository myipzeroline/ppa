import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminRequest, getAdminIdentity, adminSessionCookieName } from "@/lib/admin-auth";
import { pool, query } from "@/lib/db";
import { cancelClassSession, runClassSweep } from "@/lib/class-jobs";
import { classRange, parseProgram, programProblem } from "@/lib/class-programs";
import { bangkokToday } from "@/lib/court-availability";
import { pushAfterResponse, pushText } from "@/lib/notify";
import { parseJsonBody, validationErrorResponse } from "@/lib/security";
import { clearSharedCache } from "@/lib/shared-cache";

type ProgramRow = { id: number; slug: string; title: string; subtitle: string | null; body: string | null; icon: string; price: number; metadata: string | null; sortOrder: number; active: number };

const programSelect = "SELECT id, slug, title, subtitle, body, icon, price, CAST(metadata AS CHAR) metadata, sort_order sortOrder, active FROM app_content_items WHERE content_type = 'class_program'";
const screenOf: Record<string, string> = { hyrox: "hyrox", pilates: "pilates", airfit: "airfit", service: "svcclass" };

const fields = {
  title: z.string().trim().min(2).max(180),
  subtitle: z.string().trim().max(255).optional().or(z.literal("")),
  body: z.string().trim().max(3000).optional().or(z.literal("")),
  icon: z.string().trim().min(1).max(16).default("🗓️"),
  price: z.coerce.number().min(0).max(9999999).default(0),
  active: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(999999).default(0),
  metadata: z.record(z.string(), z.unknown()),
};
const saveSchema = z.object({ id: z.coerce.number().int().positive(), ...fields });
const createSchema = z.object({ action: z.literal("create"), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,95}$/), ...fields });
const cancelSchema = z.object({ action: z.literal("cancel_session"), programId: z.coerce.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), reason: z.string().trim().min(2).max(200) });

// Back office · Classes: every class program (times, places, instructors, rooms) and the class times of
// a day with who booked them and how they paid.
export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const asked = request.nextUrl.searchParams.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : bangkokToday();
  const [programs, bookings] = await Promise.all([
    query<ProgramRow>(`${programSelect} ORDER BY active DESC, sort_order, id LIMIT 300`),
    query(
      "SELECT b.id, b.booking_no bookingNo, b.class_key classKey, DATE_FORMAT(b.starts_at, '%H:%i') time, b.status, b.amount, b.user_coupon_id userCouponId, b.resource_code resource, t.name trainerName, u.display_name displayName, u.member_code memberCode, u.phone, CAST(b.metadata AS CHAR) metadata, b.checked_in_at checkedInAt, b.cancel_reason cancelReason, (b.status IN ('paid','checked_in') OR (b.status IN ('hold','pending_payment') AND (b.expires_at IS NULL OR b.expires_at > NOW()))) taken FROM bookings b JOIN users u ON u.id = b.user_id LEFT JOIN trainers t ON t.id = b.trainer_id WHERE b.class_key IS NOT NULL AND b.class_key NOT LIKE 'rank:%' AND b.starts_at >= ? AND b.starts_at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY b.starts_at, b.id LIMIT 1500",
      [`${date} 00:00:00`, `${date} 00:00:00`],
    ),
  ]);
  after(runClassSweep);
  return NextResponse.json({
    date,
    programs: programs.map((row) => ({ ...row, active: Boolean(Number(row.active)), program: parseProgram(row), problem: programProblem(row) })),
    bookings,
  });
}

async function staffId(request: NextRequest) {
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  return admin?.id ? Number(admin.id) : null;
}

// Saves a class program edited in the form (its metadata is checked like every class program).
export async function PUT(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  let body: z.infer<typeof saveSchema>;
  try {
    body = await parseJsonBody(request, saveSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const [current] = await query<{ slug: string }>("SELECT slug FROM app_content_items WHERE id = ? AND content_type = 'class_program' LIMIT 1", [body.id]);
  if (!current) return NextResponse.json({ message: "ไม่พบคลาสนี้" }, { status: 404 });
  const problem = programProblem({ id: body.id, slug: current.slug, title: body.title, price: body.price, metadata: body.metadata });
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  const service = String(body.metadata.service || "");
  await query(
    "UPDATE app_content_items SET title = ?, subtitle = ?, body = ?, icon = ?, price = ?, metadata = ?, active = ?, sort_order = ?, target_screen = ? WHERE id = ? AND content_type = 'class_program'",
    [body.title, body.subtitle || null, body.body || null, body.icon, body.price, JSON.stringify(body.metadata), body.active, body.sortOrder, screenOf[service] || service, body.id],
  );
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'class.update', 'app_content_items', ?, JSON_OBJECT('slug', ?, 'title', ?, 'active', ?))", [await staffId(request), String(body.id), current.slug, body.title, body.active]);
  clearSharedCache();
  return GET(request);
}

// Adds a class, or cancels one class time for everyone booked on it.
export async function POST(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const raw = await request.clone().json().catch(() => ({})) as { action?: unknown };
  if (raw.action === "cancel_session") {
    let body: z.infer<typeof cancelSchema>;
    try {
      body = await parseJsonBody(request, cancelSchema);
    } catch (error) {
      return validationErrorResponse(error);
    }
    const [row] = await query<ProgramRow>(`${programSelect} AND id = ? LIMIT 1`, [body.programId]);
    const program = row ? parseProgram(row) : null;
    const range = program ? classRange(program, body.date, body.time) : null;
    if (!program || !range) return NextResponse.json({ message: "ไม่พบรอบเรียนนี้" }, { status: 404 });
    const staff = await staffId(request);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // The program row lock keeps new bookings of this time out while it is cancelled.
      await conn.execute("SELECT id FROM app_content_items WHERE id = ? FOR UPDATE", [program.id]);
      const notices = await cancelClassSession(conn, { program, startsAt: range.startsAt, reason: body.reason, staffId: staff });
      await conn.commit();
      for (const notice of notices) pushAfterResponse(notice.userId, pushText(notice.title, notice.body));
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
    return GET(request);
  }
  let body: z.infer<typeof createSchema>;
  try {
    body = await parseJsonBody(request, createSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const problem = programProblem({ id: 0, slug: body.slug, title: body.title, price: body.price, metadata: body.metadata });
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  const service = String(body.metadata.service || "");
  try {
    await query(
      "INSERT INTO app_content_items (content_type, slug, title, subtitle, body, icon, action_label, target_screen, price, metadata, active, sort_order) VALUES ('class_program', ?, ?, ?, ?, ?, 'จอง', ?, ?, ?, ?, ?)",
      [body.slug, body.title, body.subtitle || null, body.body || null, body.icon, screenOf[service] || service, body.price, JSON.stringify(body.metadata), body.active, body.sortOrder],
    );
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ message: "Slug นี้ถูกใช้งานแล้ว" }, { status: 409 });
    throw error;
  }
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'class.create', 'app_content_items', ?, JSON_OBJECT('title', ?))", [await staffId(request), body.slug, body.title]);
  clearSharedCache();
  return GET(request);
}
