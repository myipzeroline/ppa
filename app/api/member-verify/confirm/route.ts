import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool } from "@/lib/db";
import { confirmOtp, MemberVerifyError } from "@/lib/ppa-member";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";

const schema = z.object({ memberNo: z.string().regex(/^\d{6}$/), code: z.string().regex(/^\d{4}$/) });

// Promotion › Member, step 3: the code from the member's phone. Confirmed, this app account may buy
// Member-price packages for 30 minutes (the payment route checks it).
export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `member-otp-confirm:${await clientIp()}`, limit: 20, windowMs: 60_000 });
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
    const result = await confirmOtp(conn, user.id, input.memberNo, input.code);
    await conn.commit();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // A wrong code still counts as a try: keep the counter.
    if (error instanceof MemberVerifyError && (error.code === "WRONG" || error.code === "TOO_MANY")) await conn.commit().catch(() => {});
    else await conn.rollback().catch(() => {});
    if (error instanceof MemberVerifyError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
    throw error;
  } finally {
    conn.release();
  }
}
