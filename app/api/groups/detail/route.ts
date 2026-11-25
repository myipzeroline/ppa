import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { loadGroupDetail } from "@/lib/group-server";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// One group's page: photo, level, description, members and (for its members) the courts booked for it.
export async function GET(req: Request) {
  // Members at the club share one Wi-Fi address: a loose limit per address, the real one per member.
  const crowded = checkRateLimit({ key: `group-detail:${await clientIp()}`, limit: 600, windowMs: 60_000 });
  if (crowded) return crowded;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const limited = checkRateLimit({ key: `group-detail:member:${user.id}`, limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  const detail = await loadGroupDetail(user.id, id);
  if (!detail) return secureResponse(NextResponse.json({ message: "ไม่พบก๊วนนี้ หรือก๊วนถูกปิดแล้ว" }, { status: 404 }));
  return secureResponse(NextResponse.json(detail));
}
