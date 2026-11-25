import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool, query } from "@/lib/db";
import { GROUP_MAX_INVITES, GROUP_MAX_MEMBERS, groupPlayAt, listGroups, normalizeMemberCode } from "@/lib/groups";
import { notifyMember, pushAfterResponse, pushText } from "@/lib/notify";
import { assertSameOrigin, checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";
import { notWalkIn } from "@/lib/walk-in";

// A standing group (ก๊วน): name, level, description and the members the owner adds by member ID.
// The photo is uploaded after the group exists (app/api/groups/photo). playAt / maxPlayers are still
// accepted from older app versions; the app sets play times by booking a court for the group.
const schema = z.object({
  sportSlug: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(160),
  levelName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  memberCodes: z.array(z.string().trim().min(3).max(40)).max(GROUP_MAX_INVITES).optional(),
  maxPlayers: z.number().int().min(2).max(GROUP_MAX_MEMBERS).optional(),
  playAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
});

type Invitee = { id: number; memberCode: string; displayName: string };

export async function GET() {
  const limited = checkRateLimit({ key: `groups-get:${await clientIp()}`, limit: 90, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  return NextResponse.json({ groups: await listGroups(user.id, 50) });
}

export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `groups-post:${await clientIp()}`, limit: 12, windowMs: 60_000 });
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
  const playAt = input.playAt ? groupPlayAt(input.playAt) : null;
  if (input.playAt && !playAt) return NextResponse.json({ message: "เวลานัดเล่นต้องอยู่ในอนาคตและไม่เกิน 60 วัน" }, { status: 400 });
  const sport = (await query<{ id: number; name: string }>("SELECT id, name_th name FROM sports WHERE slug = ? AND active = TRUE LIMIT 1", [input.sportSlug]))[0];
  if (!sport) return NextResponse.json({ message: "ไม่พบกีฬา" }, { status: 404 });

  // Members added by ID: each code once, never the owner, every one an active member.
  const codes = [...new Set((input.memberCodes || []).map(normalizeMemberCode))];
  if (codes.some((code) => !code)) return NextResponse.json({ message: "รูปแบบ ID สมาชิกไม่ถูกต้อง" }, { status: 400 });
  const wanted = (codes as string[]).filter((code) => code !== String(user.memberCode).toUpperCase());
  const invitees = wanted.length ? await query<Invitee>(
    `SELECT u.id, u.member_code memberCode, u.display_name displayName FROM users u WHERE u.member_code IN (${wanted.map(() => "?").join(", ")}) AND u.status = 'active' AND ${notWalkIn("u")} AND u.id <> ?`,
    [...wanted, user.id],
  ) : [];
  const found = new Set(invitees.map((member) => String(member.memberCode).toUpperCase()));
  const missing = wanted.filter((code) => !found.has(code));
  if (missing.length) return NextResponse.json({ message: "ไม่พบ ID สมาชิกบางรายการ กรุณาตรวจสอบอีกครั้ง", codes: missing }, { status: 404 });
  const maxPlayers = Math.max(input.maxPlayers ?? GROUP_MAX_MEMBERS, invitees.length + 1);

  const conn = await pool.getConnection();
  const notices: { userId: number; title: string; body: string }[] = [];
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "INSERT INTO groups_clubs (owner_user_id, sport_id, name, level_name, max_players, play_at, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user.id, sport.id, input.name, input.levelName, maxPlayers, playAt, input.description || null],
    );
    const groupId = Number((result as { insertId?: number }).insertId || 0);
    // The owner takes the first player spot.
    await conn.execute("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, user.id]);
    for (const member of invitees) {
      await conn.execute("INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)", [groupId, member.id]);
      const notice = { userId: Number(member.id), title: "คุณถูกเพิ่มเข้าก๊วน", body: `${user.displayName} เพิ่มคุณเข้าก๊วน ${input.name} · ${sport.name} · ออกจากก๊วนได้ที่หน้าก๊วน` };
      await notifyMember(conn, notice.userId, notice.title, notice.body);
      notices.push(notice);
    }
    await conn.commit();
    for (const notice of notices) pushAfterResponse(notice.userId, pushText(notice.title, notice.body));
    return NextResponse.json({ ok: true, groupId, added: invitees.length }, { status: 201 });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Owner closes a group so it no longer appears in the club's lists.
export async function DELETE(req: NextRequest) {
  // No JSON body here, so check the origin explicitly (parseJsonBody does it for other mutations).
  const crossOrigin = assertSameOrigin(req);
  if (crossOrigin) return crossOrigin;
  const limited = checkRateLimit({ key: `groups-delete:${await clientIp()}`, limit: 12, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  const result = (await query("UPDATE groups_clubs SET status = 'archived' WHERE id = ? AND owner_user_id = ? AND status = 'active'", [id, user.id])) as unknown as { affectedRows?: number };
  if (!result.affectedRows) return NextResponse.json({ message: "ปิดได้เฉพาะก๊วนที่คุณสร้าง" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
