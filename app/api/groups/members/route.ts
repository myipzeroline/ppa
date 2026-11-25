import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool } from "@/lib/db";
import { normalizeMemberCode } from "@/lib/groups";
import { notifyMember, pushAfterResponse, pushText } from "@/lib/notify";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";
import { notWalkIn } from "@/lib/walk-in";

// The group owner adds a member by member ID or takes a member out. The group row lock serializes
// changes, so the group never holds more members than max_players.
const addSchema = z.object({ groupId: z.number().int().positive(), code: z.string().trim().min(3).max(40) });
const removeSchema = z.object({ groupId: z.number().int().positive(), userId: z.number().int().positive() });

type GroupLock = { id: number; ownerUserId: number; maxPlayers: number; name: string };

async function begin(req: Request, key: string) {
  const limited = checkRateLimit({ key: `${key}:${await clientIp()}`, limit: 30, windowMs: 60_000 });
  if (limited) return { response: limited };
  try {
    return { user: await assertApiUser() };
  } catch (error) {
    return { response: authErrorResponse(error) };
  }
}

async function lockOwnGroup(conn: Awaited<ReturnType<typeof pool.getConnection>>, groupId: number, userId: number) {
  const [rows] = await conn.execute("SELECT id, owner_user_id ownerUserId, max_players maxPlayers, name FROM groups_clubs WHERE id = ? AND status = 'active' FOR UPDATE", [groupId]);
  const group = (rows as GroupLock[])[0];
  return group && Number(group.ownerUserId) === userId ? group : null;
}

export async function POST(req: Request) {
  const { response, user } = await begin(req, "group-members-add");
  if (response) return response;
  let input: z.infer<typeof addSchema>;
  try {
    input = await parseJsonBody(req, addSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const code = normalizeMemberCode(input.code);
  if (!code) return NextResponse.json({ message: "รูปแบบ ID สมาชิกไม่ถูกต้อง" }, { status: 400 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const group = await lockOwnGroup(conn, input.groupId, user.id);
    if (!group) {
      await conn.rollback();
      return NextResponse.json({ message: "เพิ่มสมาชิกได้เฉพาะผู้จัดก๊วน" }, { status: 403 });
    }
    const [found] = await conn.execute(`SELECT u.id, u.member_code memberCode, u.display_name displayName FROM users u WHERE u.member_code = ? AND u.status = 'active' AND ${notWalkIn("u")} LIMIT 1`, [code]);
    const member = (found as { id: number; memberCode: string; displayName: string }[])[0];
    if (!member) {
      await conn.rollback();
      return NextResponse.json({ message: "ไม่พบ ID สมาชิกนี้" }, { status: 404 });
    }
    const [current] = await conn.execute("SELECT user_id userId FROM group_members WHERE group_id = ?", [group.id]);
    const members = current as { userId: number }[];
    if (members.some((row) => Number(row.userId) === Number(member.id))) {
      await conn.rollback();
      return NextResponse.json({ ok: true, added: false, member: { displayName: member.displayName } });
    }
    if (members.length >= Number(group.maxPlayers)) {
      await conn.rollback();
      return NextResponse.json({ message: "ก๊วนนี้เต็มแล้ว" }, { status: 409 });
    }
    await conn.execute("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [group.id, member.id]);
    const notice = { userId: Number(member.id), title: "คุณถูกเพิ่มเข้าก๊วน", body: `${user.displayName} เพิ่มคุณเข้าก๊วน ${group.name} · ออกจากก๊วนได้ที่หน้าก๊วน` };
    await notifyMember(conn, notice.userId, notice.title, notice.body);
    await conn.commit();
    pushAfterResponse(notice.userId, pushText(notice.title, notice.body));
    return NextResponse.json({ ok: true, added: true, member: { displayName: member.displayName } }, { status: 201 });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function DELETE(req: Request) {
  const { response, user } = await begin(req, "group-members-remove");
  if (response) return response;
  let input: z.infer<typeof removeSchema>;
  try {
    input = await parseJsonBody(req, removeSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  if (input.userId === user.id) return NextResponse.json({ message: "เจ้าของก๊วนออกจากก๊วนไม่ได้ ใช้ปุ่มปิดก๊วนแทน" }, { status: 409 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const group = await lockOwnGroup(conn, input.groupId, user.id);
    if (!group) {
      await conn.rollback();
      return NextResponse.json({ message: "นำสมาชิกออกได้เฉพาะผู้จัดก๊วน" }, { status: 403 });
    }
    const [result] = await conn.execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [group.id, input.userId]);
    if (Number((result as { affectedRows?: number }).affectedRows)) {
      await notifyMember(conn, input.userId, "ออกจากก๊วนแล้ว", `ผู้จัดก๊วนนำคุณออกจากก๊วน ${group.name}`);
    }
    await conn.commit();
    return NextResponse.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
