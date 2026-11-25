import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { pool } from "@/lib/db";
import { ClassBookingError, reserveClass } from "@/lib/class-booking";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";

const schema = z.object({
  programId: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  // Pay a paid session with a coupon of the class (a Simulation credit from a HYROX Series).
  useCoupon: z.boolean().optional(),
  userCouponId: z.number().int().positive().optional(),
  // A private class: the instructor the member chose; a rental: the room or machine.
  trainerId: z.number().int().positive().optional(),
  resource: z.string().trim().min(1).max(40).optional(),
});

// Books a class time: free (Service Class for an Active Member, or a class an unlimited Member package
// includes) or with a coupon it is confirmed at once, otherwise it is held 15 minutes for payment and the
// app opens the payment screen with the booking.
export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `class-reserve:${await clientIp()}`, limit: 20, windowMs: 60_000 });
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
    const result = await reserveClass(conn, { userId: user.id, ...input });
    await conn.commit();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    await conn.rollback().catch(() => {});
    if (error instanceof ClassBookingError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
    throw error;
  } finally {
    conn.release();
  }
}
