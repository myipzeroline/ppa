import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertAdminRequest, getAdminIdentity, adminSessionCookieName } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { parseJsonBody, validationErrorResponse } from "@/lib/security";
import { thaiMobile } from "@/lib/sms";

const memberSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  memberNo: z.string().trim().regex(/^\d{6}$/),
  fullName: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(9).max(32),
  status: z.enum(["active", "inactive"]).default("active"),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  note: z.string().trim().max(255).optional().or(z.literal("")),
});
const importSchema = z.object({ action: z.literal("import"), lines: z.string().max(200_000) });

// Back office · PPA members (Promotion › Member prices): the member numbers that may buy Member-price
// packages and the phone each one-time code is sent to. Staff add, edit, switch off or paste a list.
export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const search = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 60);
  const like = `%${search.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
  const members = await query(
    `SELECT m.id, m.member_no memberNo, m.full_name fullName, m.phone, m.status, DATE_FORMAT(m.expires_on, '%Y-%m-%d') expiresOn, m.note, m.verified_at verifiedAt, u.display_name appName, u.member_code appCode FROM ppa_members m LEFT JOIN users u ON u.id = m.user_id${search ? " WHERE m.member_no LIKE ? OR m.full_name LIKE ? OR m.phone LIKE ?" : ""} ORDER BY m.updated_at DESC, m.id DESC LIMIT 300`,
    search ? [like, like, like] : [],
  );
  const [totals] = await query<{ total: number; active: number }>("SELECT COUNT(*) total, COALESCE(SUM(status = 'active' AND (expires_on IS NULL OR expires_on >= CURDATE())), 0) active FROM ppa_members");
  return NextResponse.json({ members, totals: { total: Number(totals?.total || 0), active: Number(totals?.active || 0) } });
}

async function audit(request: NextRequest, action: string, target: string, metadata: Record<string, unknown>) {
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, ?, 'ppa_members', ?, ?)", [admin?.id || null, action, target, JSON.stringify(metadata)]);
}

function phoneProblem(phone: string) {
  return thaiMobile(phone) ? null : "เบอร์โทรต้องเป็นเบอร์มือถือไทย 10 หลัก เช่น 0812345678";
}

export async function POST(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const raw = await request.clone().json().catch(() => ({})) as { action?: unknown };
  if (raw.action === "import") {
    let body: z.infer<typeof importSchema>;
    try {
      body = await parseJsonBody(request, importSchema);
    } catch (error) {
      return validationErrorResponse(error);
    }
    // One member a line: member number, name, phone[, expiry YYYY-MM-DD]. Existing numbers are updated.
    const rows: string[][] = [];
    const problems: string[] = [];
    body.lines.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2000).forEach((line, index) => {
      const cells = line.split(/[,\t;]/).map((cell) => cell.trim());
      const [memberNo, fullName, phone, expiresOn = ""] = cells;
      if (!/^\d{6}$/.test(memberNo || "") || !fullName || !thaiMobile(phone || "") || (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn))) {
        if (index > 0 || /^\d/.test(memberNo || "")) problems.push(`${index + 1}: ${line.slice(0, 60)}`);
        return;
      }
      rows.push([memberNo, fullName.slice(0, 160), thaiMobile(phone)!, expiresOn]);
    });
    for (const [memberNo, fullName, phone, expiresOn] of rows) {
      await query(
        "INSERT INTO ppa_members (member_no, full_name, phone, status, expires_on) VALUES (?, ?, ?, 'active', ?) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone = VALUES(phone), expires_on = VALUES(expires_on), status = 'active'",
        [memberNo, fullName, phone, expiresOn || null],
      );
    }
    await audit(request, "ppa_member.import", "import", { saved: rows.length, skipped: problems.length });
    return NextResponse.json({ saved: rows.length, skipped: problems.slice(0, 50) });
  }
  let body: z.infer<typeof memberSchema>;
  try {
    body = await parseJsonBody(request, memberSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const problem = phoneProblem(body.phone);
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  try {
    await query("INSERT INTO ppa_members (member_no, full_name, phone, status, expires_on, note) VALUES (?, ?, ?, ?, ?, ?)", [body.memberNo, body.fullName, thaiMobile(body.phone), body.status, body.expiresOn || null, body.note || null]);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ message: "รหัสสมาชิกนี้มีอยู่แล้ว" }, { status: 409 });
    throw error;
  }
  await audit(request, "ppa_member.create", body.memberNo, { fullName: body.fullName });
  return GET(request);
}

export async function PUT(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  let body: z.infer<typeof memberSchema>;
  try {
    body = await parseJsonBody(request, memberSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  if (!body.id) return NextResponse.json({ message: "ไม่พบสมาชิก" }, { status: 400 });
  const problem = phoneProblem(body.phone);
  if (problem) return NextResponse.json({ message: problem }, { status: 400 });
  try {
    await query("UPDATE ppa_members SET member_no = ?, full_name = ?, phone = ?, status = ?, expires_on = ?, note = ? WHERE id = ?", [body.memberNo, body.fullName, thaiMobile(body.phone), body.status, body.expiresOn || null, body.note || null, body.id]);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY") return NextResponse.json({ message: "รหัสสมาชิกนี้มีอยู่แล้ว" }, { status: 409 });
    throw error;
  }
  await audit(request, "ppa_member.update", body.memberNo, { status: body.status });
  return GET(request);
}
