import { after, NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { runGroupAwardSweep } from "@/lib/group-award-sweep";
import { loadGroupRanking } from "@/lib/group-server";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// 🏆 อันดับก๊วนวันนี้ of a sport, and the member's group Coins waiting at the counter.
export async function GET(req: Request) {
  // Members at the club share one Wi-Fi address: a loose limit per address, the real one per member.
  const crowded = checkRateLimit({ key: `group-ranking:${await clientIp()}`, limit: 600, windowMs: 60_000 });
  if (crowded) return crowded;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const limited = checkRateLimit({ key: `group-ranking:member:${user.id}`, limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const sport = new URL(req.url).searchParams.get("sport") || "";
  if (!/^[a-z0-9-]{1,64}$/.test(sport)) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  // Settles finished days where no cron job runs (at most once a minute per server).
  try {
    after(runGroupAwardSweep);
  } catch {
    // Outside a request (tests): nothing to schedule.
  }
  const ranking = await loadGroupRanking(user.id, sport);
  if (!ranking) return secureResponse(NextResponse.json({ message: "ไม่พบกีฬา" }, { status: 404 }));
  return secureResponse(NextResponse.json(ranking));
}
