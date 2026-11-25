import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool } from "@/lib/db";
import { createOtp, MemberVerifyError } from "@/lib/ppa-member";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";
import { sendSms, smsProvider } from "@/lib/sms";

const schema = z.object({ memberNo: z.string().regex(/^\d{6}$/) });

// Promotion › Member, step 2-3: the 6-digit PPA member number → a 4-digit code to that member's phone.
export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `member-otp:${await clientIp()}`, limit: 6, windowMs: 60_000 });
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
  const production = process.env.NODE_ENV === "production";
  if (production && !smsProvider()) {
    return NextResponse.json({ code: "SMS_NOT_CONFIGURED", message: "ระบบส่ง OTP ยังไม่พร้อม กรุณาซื้อแพ็กเกจ Member ที่เคาน์เตอร์" }, { status: 503 });
  }
  const conn = await pool.getConnection();
  let otp: Awaited<ReturnType<typeof createOtp>>;
  try {
    await conn.beginTransaction();
    otp = await createOtp(conn, user.id, input.memberNo);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error instanceof MemberVerifyError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
    throw error;
  } finally {
    conn.release();
  }
  const sent = await sendSms(otp.phone, `PPA Power Play รหัส OTP ของคุณคือ ${otp.code} (ใช้ได้ 5 นาที) ห้ามบอกรหัสนี้กับผู้อื่น`);
  if (!sent.sent && (production || sent.reason === "failed")) {
    return NextResponse.json({ code: "SMS_FAILED", message: "ส่ง SMS ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" }, { status: 502 });
  }
  return NextResponse.json({
    phone: otp.phoneMasked,
    expiresIn: otp.expiresIn,
    // Development without an SMS provider: the code is shown so the flow can be tried end to end.
    ...(!sent.sent && !production ? { devCode: otp.code } : {}),
  }, { status: 201 });
}
