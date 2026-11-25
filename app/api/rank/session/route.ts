import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { loadSessionDetail } from "@/lib/rank-server";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// Players, pairing, games and the day's winners of one session (names only, no member ids).
export async function GET(req: Request) {
  const limited = checkRateLimit({ key: `rank-session:${await clientIp()}`, limit: 90, windowMs: 60_000 });
  if (limited) return limited;
  try {
    await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  const detail = await loadSessionDetail(id, false);
  if (!detail) return secureResponse(NextResponse.json({ message: "ไม่พบรอบนี้" }, { status: 404 }));
  return secureResponse(NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } }));
}
