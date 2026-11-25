import { after, NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { loadRankView } from "@/lib/rank-server";
import { runRankSweep } from "@/lib/rank-sweep";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// Buffet Rank / Open Run tab of a sport: the member's level and the rooms with their session times.
export async function GET(req: Request) {
  const limited = checkRateLimit({ key: `rank:${await clientIp()}`, limit: 90, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const sport = new URL(req.url).searchParams.get("sport") || "";
  if (!/^[a-z0-9-]{1,64}$/.test(sport)) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  // Pairing and closing also run here (at most once a minute per server) where no cron job is set up.
  try {
    after(runRankSweep);
  } catch {
    // Outside a request (tests): nothing to schedule.
  }
  const view = await loadRankView(user.id, sport);
  if (!view) return secureResponse(NextResponse.json({ message: "ไม่พบกีฬา" }, { status: 404 }));
  return secureResponse(NextResponse.json(view, { headers: { "Cache-Control": "private, no-store" } }));
}
