import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";
import { sharedCache } from "@/lib/shared-cache";

// Big Screen Live program guide: what is on now and what starts today and tomorrow (Bangkok), with the
// zone of the screen. The same for every member: read once a minute per server.
export async function GET() {
  const limited = checkRateLimit({ key: `screen-programs:${await clientIp()}`, limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  try {
    await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const programs = await sharedCache("catalog:screen-programs", 60_000, () => query(
    "SELECT id, title, subtitle, icon, zone, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt, CAST(metadata AS CHAR) metadata FROM screen_programs WHERE status = 'active' AND ends_at > NOW() AND starts_at < DATE_ADD(CURDATE(), INTERVAL 2 DAY) ORDER BY starts_at, id LIMIT 80",
  ));
  return secureResponse(NextResponse.json({ programs }, { headers: { "Cache-Control": "private, no-store" } }));
}
