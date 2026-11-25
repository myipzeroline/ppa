import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool } from "@/lib/db";
import { joinRankSession, RankError } from "@/lib/rank-server";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";

const schema = z.object({
  roomId: z.number().int().positive(),
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/),
});

// Joins a Buffet Rank / Open Run session. The answer is a booking the app pays like a court booking.
export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `rank-join:${await clientIp()}`, limit: 20, windowMs: 60_000 });
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await joinRankSession(conn, { userId: user.id, roomId: input.roomId, startsAt: input.startsAt });
    await conn.commit();
    return NextResponse.json(result, { status: result.existing ? 200 : 201 });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error instanceof RankError) return NextResponse.json({ message: error.message }, { status: error.status });
    throw error;
  } finally {
    conn.release();
  }
}
