import { NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { lookupMember } from "@/lib/group-server";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// "ใส่ ID สมาชิก" when creating a group: the name of the member with that member ID. Limited per member
// so IDs cannot be tried in bulk.
export async function GET(req: Request) {
  const crowded = checkRateLimit({ key: `member-lookup:${await clientIp()}`, limit: 600, windowMs: 60_000 });
  if (crowded) return crowded;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const limited = checkRateLimit({ key: `member-lookup:member:${user.id}`, limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const result = await lookupMember(new URL(req.url).searchParams.get("code") || "", user.id);
  if (result === "invalid") return secureResponse(NextResponse.json({ message: "รูปแบบ ID สมาชิกไม่ถูกต้อง" }, { status: 400 }));
  if (result === "self") return secureResponse(NextResponse.json({ message: "นี่คือ ID ของคุณ คุณอยู่ในก๊วนอยู่แล้วในฐานะผู้จัดก๊วน" }, { status: 409 }));
  if (!result) return secureResponse(NextResponse.json({ message: "ไม่พบ ID สมาชิกนี้" }, { status: 404 }));
  return secureResponse(NextResponse.json({ member: result }));
}
