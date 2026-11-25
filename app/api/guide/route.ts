import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";

// The member finished or skipped the guide (คู่มือการใช้งาน): it no longer opens by itself for this
// version, on any phone. Profile › คู่มือการใช้งาน still opens it at any time.
const schema = z.object({ version: z.string().regex(/^[A-Za-z0-9.-]{1,20}$/) });

export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `guide:${await clientIp()}`, limit: 30, windowMs: 60_000 });
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
  await query("UPDATE users SET guide_version = ? WHERE id = ?", [input.version, user.id]);
  return NextResponse.json({ ok: true, version: input.version });
}
