import { after, NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { loadLiveGames } from "@/lib/rank-server";
import { runRankSweep } from "@/lib/rank-sweep";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// Find Your Game on the home screen: Buffet Rank and Open Run sessions of every sport, places left now.
export async function GET() {
  // Members at the club share one Wi-Fi address: a loose limit per address, the real one per member.
  const crowded = checkRateLimit({ key: `rank-live:${await clientIp()}`, limit: 600, windowMs: 60_000 });
  if (crowded) return crowded;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const limited = checkRateLimit({ key: `rank-live:member:${user.id}`, limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  // Pairing and closing also run here (at most once a minute per server) where no cron job is set up.
  try {
    after(runRankSweep);
  } catch {
    // Outside a request (tests): nothing to schedule.
  }
  return secureResponse(NextResponse.json(await loadLiveGames(user.id), { headers: { "Cache-Control": "private, no-store" } }));
}
