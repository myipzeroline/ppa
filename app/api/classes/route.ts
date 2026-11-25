import { after, NextResponse } from "next/server";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { query } from "@/lib/db";
import { classSlots } from "@/lib/class-booking";
import { classCatalog } from "@/lib/class-catalog";
import { runClassSweep } from "@/lib/class-jobs";
import { programsOf } from "@/lib/class-programs";
import { checkRateLimit, clientIp, secureResponse } from "@/lib/security";

// Class times of one service (hyrox, airfit, pilates, service) on one day with the places taken. A
// private class shows the chosen instructor's free times (trainer=<id>); a rental shows the chosen room
// or machine (resource=<program slug>|<room>).
export async function GET(req: Request) {
  const limited = checkRateLimit({ key: `classes:${await clientIp()}`, limit: 90, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const url = new URL(req.url);
  const service = url.searchParams.get("service") || "";
  const date = url.searchParams.get("date") || "";
  const calendar = new Date(`${date}T00:00:00Z`);
  if (!/^[a-z0-9-]{1,32}$/.test(service) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) {
    return secureResponse(NextResponse.json({ message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 }));
  }
  const trainerId = Number(url.searchParams.get("trainer") || 0);
  const resources: Record<string, string> = {};
  for (const value of url.searchParams.getAll("resource").slice(0, 10)) {
    const [slug, ...rest] = value.split("|");
    if (/^[a-z0-9-]{1,96}$/.test(slug) && rest.join("|").trim()) resources[slug] = rest.join("|").trim().slice(0, 40);
  }
  const programs = programsOf(await classCatalog(), service);
  const days = await classSlots((sql, params) => query(sql, params), programs, date, user.id, Date.now(), { trainerId: Number.isInteger(trainerId) && trainerId > 0 ? trainerId : undefined, resources });
  // Classes short of their minimum are cancelled when their confirmation time comes, cron or not.
  after(runClassSweep);
  return secureResponse(NextResponse.json({ service, date, programs, days }, { headers: { "Cache-Control": "private, no-store" } }));
}
