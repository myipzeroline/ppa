import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { allPrograms, timetableOf } from "@/lib/class-programs";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";
import { classCatalog } from "@/lib/class-catalog";

// The weekly class timetable (Service Class › ตารางคลาส 30 วัน): every group class with its days, times
// and instructors. The pattern repeats every week; classes are bookable 30 days ahead.
export async function GET() {
  const limited = checkRateLimit({ key: `class-timetable:${await clientIp()}`, limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  try {
    await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const rows = timetableOf(allPrograms(await classCatalog()));
  return secureResponse(NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } }));
}
