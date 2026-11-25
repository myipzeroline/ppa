import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminSessionCookieName, assertAdminRequest, getAdminIdentity } from "@/lib/admin-auth";
import { pool, query } from "@/lib/db";
import { removeUploadedImage } from "@/lib/image-upload";
import { notifyMember } from "@/lib/notify";
import { parseJsonBody, secureResponse, validationErrorResponse } from "@/lib/security";

// Back office · Groups (ก๊วน): the club's groups made by members, with their members, photos and
// descriptions (staff remove what is not suitable), closing a group, and the group Coins: who won them
// and who has received them at the counter (lib/group-awards.ts).
const json = (body: unknown, status = 200) => secureResponse(NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }));

const actionSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["archive", "restore", "remove_photo", "clear_description"]),
  reason: z.string().trim().max(255).optional().or(z.literal("")),
});
const removeMemberSchema = z.object({ id: z.number().int().positive(), userId: z.number().int().positive() });

type GroupRow = { id: number; name: string; levelName: string; description: string | null; photoUrl: string | null; status: string; createdAt: string; sportSlug: string; sportName: string; sportIcon: string; ownerUserId: number; ownerName: string; ownerCode: string; members: number; awards: number; unclaimed: number };

const listSql =
  "SELECT g.id, g.name, g.level_name levelName, g.description, g.photo_url photoUrl, g.status, DATE_FORMAT(g.created_at, '%Y-%m-%d %H:%i') createdAt, " +
  "s.slug sportSlug, s.name_th sportName, s.icon sportIcon, g.owner_user_id ownerUserId, u.display_name ownerName, u.member_code ownerCode, " +
  "(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) members, " +
  "(SELECT COUNT(*) FROM group_awards ga WHERE ga.group_id = g.id) awards, " +
  "(SELECT COUNT(*) FROM user_entitlements ue WHERE ue.entitlement_type = 'group_coin' AND ue.status = 'active' AND (ue.ends_at IS NULL OR ue.ends_at > NOW()) AND JSON_VALUE(ue.metadata, '$.groupId') = g.id) unclaimed " +
  "FROM groups_clubs g JOIN sports s ON s.id = g.sport_id JOIN users u ON u.id = g.owner_user_id";

export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const id = Number(params.get("id") || 0);
  if (id > 0 && Number.isSafeInteger(id)) {
    const [group] = await query<GroupRow>(`${listSql} WHERE g.id = ? LIMIT 1`, [id]);
    if (!group) return json({ message: "Group not found" }, 404);
    const [members, awards, claims] = await Promise.all([
      query("SELECT gm.user_id userId, u.display_name displayName, u.member_code memberCode, u.status, DATE_FORMAT(gm.joined_at, '%Y-%m-%d %H:%i') joinedAt FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.user_id = ? DESC, gm.joined_at LIMIT 100", [id, group.ownerUserId]),
      query("SELECT kind, DATE_FORMAT(award_date, '%Y-%m-%d') awardDate, coins_owner coinsOwner, coins_member coinsMember, members, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') createdAt FROM group_awards WHERE group_id = ? ORDER BY award_date DESC, kind LIMIT 30", [id]),
      query("SELECT ue.id, u.display_name displayName, u.member_code memberCode, CAST(JSON_VALUE(ue.metadata, '$.coins') AS UNSIGNED) coins, JSON_VALUE(ue.metadata, '$.kind') kind, JSON_VALUE(ue.metadata, '$.awardDate') awardDate, ue.status, (ue.ends_at IS NOT NULL AND ue.ends_at <= NOW()) expired, DATE_FORMAT(ue.ends_at, '%Y-%m-%d') endsAt, DATE_FORMAT(ue.updated_at, '%Y-%m-%d %H:%i') updatedAt FROM user_entitlements ue JOIN users u ON u.id = ue.user_id WHERE ue.entitlement_type = 'group_coin' AND JSON_VALUE(ue.metadata, '$.groupId') = ? ORDER BY ue.created_at DESC LIMIT 60", [String(id)]),
    ]);
    return json({ group, members, awards, claims });
  }
  const status = params.get("status") === "archived" ? "archived" : params.get("status") === "all" ? "all" : "active";
  const sport = /^[a-z0-9-]{1,64}$/.test(params.get("sport") || "") ? String(params.get("sport")) : "";
  const search = (params.get("q") || "").trim().slice(0, 80);
  const where: string[] = [];
  const values: unknown[] = [];
  if (status !== "all") { where.push("g.status = ?"); values.push(status); }
  if (sport) { where.push("s.slug = ?"); values.push(sport); }
  if (search) { where.push("(g.name LIKE ? OR u.display_name LIKE ? OR u.member_code LIKE ?)"); values.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const groups = await query<GroupRow>(`${listSql}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY g.status = 'active' DESC, g.created_at DESC LIMIT 200`, values);
  const [totals] = await query<{ active: number; withPhoto: number; unclaimedCoins: number }>(
    "SELECT (SELECT COUNT(*) FROM groups_clubs WHERE status = 'active') active, (SELECT COUNT(*) FROM groups_clubs WHERE status = 'active' AND photo_url IS NOT NULL) withPhoto, " +
      "(SELECT COALESCE(SUM(CAST(JSON_VALUE(metadata, '$.coins') AS UNSIGNED)), 0) FROM user_entitlements WHERE entitlement_type = 'group_coin' AND status = 'active' AND (ends_at IS NULL OR ends_at > NOW())) unclaimedCoins",
  );
  const sports = await query("SELECT slug, name_th name, icon FROM sports WHERE active = TRUE ORDER BY sort_order, id");
  return json({ groups, sports, totals: totals || { active: 0, withPhoto: 0, unclaimedCoins: 0 } });
}

async function staffId(request: NextRequest) {
  return (await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || ""))?.id ?? null;
}

export async function PATCH(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  let input: z.infer<typeof actionSchema>;
  try {
    input = await parseJsonBody(request, actionSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const staff = await staffId(request);
  const conn = await pool.getConnection();
  let removedPhoto: string | null = null;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute("SELECT id, name, owner_user_id ownerUserId, status, photo_url photoUrl FROM groups_clubs WHERE id = ? FOR UPDATE", [input.id]);
    const group = (rows as { id: number; name: string; ownerUserId: number; status: string; photoUrl: string | null }[])[0];
    if (!group) {
      await conn.rollback();
      return json({ message: "Group not found" }, 404);
    }
    const reason = input.reason ? ` · ${input.reason}` : "";
    if (input.action === "archive") {
      await conn.execute("UPDATE groups_clubs SET status = 'archived' WHERE id = ?", [group.id]);
      await notifyMember(conn, group.ownerUserId, "ก๊วนถูกปิดโดยเจ้าหน้าที่", `ก๊วน ${group.name}${reason}`);
    } else if (input.action === "restore") {
      await conn.execute("UPDATE groups_clubs SET status = 'active' WHERE id = ?", [group.id]);
    } else if (input.action === "remove_photo") {
      await conn.execute("UPDATE groups_clubs SET photo_url = NULL WHERE id = ?", [group.id]);
      removedPhoto = group.photoUrl;
      await notifyMember(conn, group.ownerUserId, "เจ้าหน้าที่นำรูปก๊วนออก", `ก๊วน ${group.name}${reason} · ใส่รูปใหม่ได้ที่หน้าก๊วน`);
    } else {
      await conn.execute("UPDATE groups_clubs SET description = NULL WHERE id = ?", [group.id]);
      await notifyMember(conn, group.ownerUserId, "เจ้าหน้าที่ลบคำอธิบายก๊วน", `ก๊วน ${group.name}${reason}`);
    }
    await conn.execute("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, ?, 'group', ?, ?)", [staff, `group.${input.action}`, group.id, JSON.stringify({ name: group.name, reason: input.reason || null })]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  if (removedPhoto) await removeUploadedImage("groups", removedPhoto);
  return json({ ok: true });
}

// Takes a member out of a group (the owner stays; staff close the group instead).
export async function DELETE(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  let input: z.infer<typeof removeMemberSchema>;
  try {
    input = await parseJsonBody(request, removeMemberSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const staff = await staffId(request);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute("SELECT id, name, owner_user_id ownerUserId FROM groups_clubs WHERE id = ? FOR UPDATE", [input.id]);
    const group = (rows as { id: number; name: string; ownerUserId: number }[])[0];
    if (!group) {
      await conn.rollback();
      return json({ message: "Group not found" }, 404);
    }
    if (Number(group.ownerUserId) === input.userId) {
      await conn.rollback();
      return json({ message: "The owner cannot be removed; close the group instead" }, 409);
    }
    const [result] = await conn.execute("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [group.id, input.userId]);
    if (Number((result as { affectedRows?: number }).affectedRows)) {
      await notifyMember(conn, input.userId, "ออกจากก๊วนแล้ว", `เจ้าหน้าที่นำคุณออกจากก๊วน ${group.name}`);
      await conn.execute("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'group.remove_member', 'group', ?, ?)", [staff, group.id, JSON.stringify({ userId: input.userId })]);
    }
    await conn.commit();
    return json({ ok: true });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
