import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminSessionCookieName, assertAdminRequest, getAdminIdentity } from "@/lib/admin-auth";
import { pool } from "@/lib/db";
import { pushAfterResponse, pushText } from "@/lib/notify";
import { cancelRankSession, finishRankSession, loadSessionDetail, pairSession, RankError, recordRankGame, undoLastRankGame, type RankNotice } from "@/lib/rank-server";
import { parseJsonBody, secureResponse, validationErrorResponse } from "@/lib/security";

const json = (body: unknown, status = 200) => secureResponse(NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }));
const ids = z.array(z.number().int().positive()).min(1).max(11);

// Staff actions on one session: pair again, record a game (winner of team A against team B), undo the
// last game, finish (pays the day's winners their Coins) or cancel (refunds every paid player).
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pair"), sessionId: z.number().int().positive() }),
  z.object({ action: z.literal("record"), sessionId: z.number().int().positive(), teamA: ids, teamB: ids, winner: z.enum(["a", "b"]), scoreA: z.number().int().min(0).max(99).nullable().optional(), scoreB: z.number().int().min(0).max(99).nullable().optional() }),
  z.object({ action: z.literal("undo"), sessionId: z.number().int().positive() }),
  z.object({ action: z.literal("finish"), sessionId: z.number().int().positive() }),
  z.object({ action: z.literal("cancel"), sessionId: z.number().int().positive(), reason: z.string().trim().min(1).max(160) }),
]);

export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, 400);
  const detail = await loadSessionDetail(id, true);
  return detail ? json(detail) : json({ message: "ไม่พบรอบนี้" }, 404);
}

export async function POST(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  if (!admin) return json({ message: "Admin access denied" }, 401);
  let input: z.infer<typeof actionSchema>;
  try {
    input = await parseJsonBody(request, actionSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const conn = await pool.getConnection();
  let notices: RankNotice[] = [];
  try {
    await conn.beginTransaction();
    if (input.action === "pair") await pairSession(conn, input.sessionId);
    if (input.action === "record") await recordRankGame(conn, { sessionId: input.sessionId, teamA: input.teamA, teamB: input.teamB, winner: input.winner, scoreA: input.scoreA ?? null, scoreB: input.scoreB ?? null, staffId: admin.id });
    if (input.action === "undo") await undoLastRankGame(conn, input.sessionId);
    if (input.action === "finish") notices = await finishRankSession(conn, input.sessionId, admin.id);
    if (input.action === "cancel") notices = await cancelRankSession(conn, input.sessionId, input.reason, admin.id);
    if (["pair", "record", "undo"].includes(input.action)) {
      await conn.execute("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, ?, 'rank_session', ?, ?)", [admin.id, `rank.${input.action}`, String(input.sessionId), JSON.stringify(input.action === "record" ? { teamA: input.teamA, teamB: input.teamB, winner: input.winner } : {})]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error instanceof RankError) return json({ message: error.message }, error.status);
    throw error;
  } finally {
    conn.release();
  }
  for (const notice of notices) pushAfterResponse(notice.userId, pushText(notice.title, notice.body));
  return json(await loadSessionDetail(input.sessionId, true));
}
