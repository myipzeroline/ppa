import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminSessionCookieName, assertAdminRequest, getAdminIdentity } from "@/lib/admin-auth";
import { isCalendarDate, nextDay } from "@/lib/court-blocks";
import { bangkokToday } from "@/lib/court-availability";
import { takenBookingAs } from "@/lib/court-schedule";
import { query } from "@/lib/db";
import { parseRoomSlots } from "@/lib/rank";
import { roomColumns } from "@/lib/rank-server";
import { runRankSweep } from "@/lib/rank-sweep";
import { parseJsonBody, secureResponse, validationErrorResponse } from "@/lib/security";

const json = (body: unknown, status = 200) => secureResponse(NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }));

// A Buffet Rank / Open Run room: slots "18:00-20:00,20:00-22:00", weekdays "0123456" (0 = Sunday),
// prize coins "5,3,2" for places 1-3. Joining closes close_minutes before the start; pairing starts
// match_minutes before it.
const roomSchema = z.object({
  sportId: z.number().int().positive(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  title: z.string().trim().min(1).max(120),
  levelName: z.string().trim().max(40).optional().or(z.literal("")),
  icon: z.string().trim().min(1).max(16).default("🏸"),
  kind: z.enum(["buffet", "open_run"]),
  teamSize: z.number().int().min(1).max(11),
  courtId: z.number().int().positive().nullable(),
  price: z.number().min(0).max(100000),
  capacity: z.number().int().min(2).max(200),
  minPlayers: z.number().int().min(2).max(200),
  slots: z.string().trim().min(11).max(255),
  weekdays: z.string().trim().regex(/^[0-6]{1,7}$/),
  rules: z.string().trim().max(255).optional().or(z.literal("")),
  prize: z.string().trim().max(255).optional().or(z.literal("")),
  prizeCoins: z.string().trim().regex(/^(\d{1,4}(,\d{1,4}){0,9})?$/).optional().or(z.literal("")),
  matchMinutes: z.number().int().min(0).max(600),
  closeMinutes: z.number().int().min(0).max(300),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(999999).default(0),
}).refine((room) => room.minPlayers <= room.capacity, { message: "จำนวนขั้นต่ำต้องไม่เกินจำนวนที่รับ" })
  .refine((room) => room.closeMinutes <= room.matchMinutes, { message: "ปิดรับสมัครต้องไม่ก่อนเวลาจัดคู่" })
  .refine((room) => parseRoomSlots(room.slots).length === room.slots.split(",").filter((part) => part.trim()).length && parseRoomSlots(room.slots).length > 0, { message: "รอบเวลาต้องเป็นรูปแบบ 18:00-20:00,20:00-22:00" })
  .refine((room) => room.minPlayers >= room.teamSize * 2, { message: "จำนวนขั้นต่ำต้องพอสำหรับอย่างน้อย 2 ทีม" });

async function snapshot(date: string, sportId: number | null) {
  const [rooms, sessions, sports, courts, leaders] = await Promise.all([
    query(`SELECT ${roomColumns}, s.name_th sportName FROM rank_rooms r JOIN sports s ON s.id = r.sport_id LEFT JOIN courts c ON c.id = r.court_id ORDER BY s.sort_order, r.sort_order, r.id LIMIT 200`),
    query(
      "SELECT s.id, s.room_id roomId, DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(s.ends_at, '%Y-%m-%d %H:%i:%s') endsAt, s.status, s.matched_at matchedAt, s.cancel_reason cancelReason, " +
        `(SELECT COUNT(*) FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = s.id AND (${takenBookingAs("b")})) taken, ` +
        "(SELECT COUNT(*) FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = s.id AND b.status IN ('paid','checked_in')) paid, " +
        "(SELECT COUNT(*) FROM rank_games g WHERE g.session_id = s.id) games " +
        "FROM rank_sessions s WHERE s.starts_at >= ? AND s.starts_at < ? ORDER BY s.starts_at, s.id",
      [`${date} 00:00:00`, `${nextDay(date)} 00:00:00`],
    ),
    query("SELECT id, slug, name_th name, icon FROM sports ORDER BY sort_order, id"),
    query("SELECT c.id, c.sport_id sportId, c.name, c.status FROM courts c WHERE c.status <> 'hidden' ORDER BY c.sport_id, c.sort_order, c.id"),
    sportId
      ? query("SELECT pr.user_id userId, u.display_name name, u.member_code memberCode, pr.rating, pr.games, pr.wins, pr.losses FROM player_ratings pr JOIN users u ON u.id = pr.user_id WHERE pr.sport_id = ? ORDER BY pr.rating DESC, pr.games DESC LIMIT 30", [sportId])
      : Promise.resolve([]),
  ]);
  return { date, rooms, sessions, sports, courts, leaders };
}

export async function GET(request: NextRequest) {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const date = request.nextUrl.searchParams.get("date") || bangkokToday();
  if (!isCalendarDate(date)) return json({ message: "วันที่ไม่ถูกต้อง" }, 400);
  const sport = Number(request.nextUrl.searchParams.get("sport") || 0);
  // Pairing and closing also run here where no cron job is set up (at most once a minute).
  try {
    after(runRankSweep);
  } catch {
    // Outside a request (tests).
  }
  return json(await snapshot(date, Number.isSafeInteger(sport) && sport > 0 ? sport : null));
}

async function saveRoom(request: NextRequest, method: "POST" | "PUT") {
  const denied = await assertAdminRequest(request);
  if (denied) return denied;
  const admin = await getAdminIdentity(request.cookies.get(adminSessionCookieName())?.value || "");
  let input: z.infer<typeof roomSchema> & { id?: number };
  try {
    input = await parseJsonBody(request, method === "PUT" ? roomSchema.and(z.object({ id: z.number().int().positive() })) : roomSchema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  if (input.courtId) {
    const [court] = await query<{ id: number }>("SELECT id FROM courts WHERE id = ? AND sport_id = ? LIMIT 1", [input.courtId, input.sportId]);
    if (!court) return json({ message: "สนามต้องเป็นของกีฬาเดียวกับห้อง" }, 400);
  }
  const values = [input.sportId, input.slug, input.title, input.levelName || null, input.icon, input.kind, input.teamSize, input.courtId, input.price, input.capacity, input.minPlayers, input.slots.replace(/\s+/g, ""), input.weekdays, input.rules || null, input.prize || null, input.prizeCoins || null, input.matchMinutes, input.closeMinutes, input.active, input.sortOrder];
  try {
    if (method === "POST") {
      await query("INSERT INTO rank_rooms (sport_id, slug, title, level_name, icon, kind, team_size, court_id, price, capacity, min_players, slots, weekdays, rules, prize, prize_coins, match_minutes, close_minutes, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values);
    } else {
      const result = await query("UPDATE rank_rooms SET sport_id = ?, slug = ?, title = ?, level_name = ?, icon = ?, kind = ?, team_size = ?, court_id = ?, price = ?, capacity = ?, min_players = ?, slots = ?, weekdays = ?, rules = ?, prize = ?, prize_coins = ?, match_minutes = ?, close_minutes = ?, active = ?, sort_order = ? WHERE id = ?", [...values, input.id]);
      if (!Number((result as unknown as { affectedRows?: number }).affectedRows)) return json({ message: "ไม่พบห้องนี้" }, 404);
    }
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return json({ message: "Slug นี้ถูกใช้แล้ว" }, 409);
    throw error;
  }
  await query("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, ?, 'rank_room', ?, ?)", [admin?.id ?? null, method === "POST" ? "rank.room_create" : "rank.room_update", input.id ? String(input.id) : input.slug, JSON.stringify({ title: input.title, price: input.price, capacity: input.capacity, active: input.active })]);
  return json(await snapshot(bangkokToday(), null), method === "POST" ? 201 : 200);
}

export const POST = (request: NextRequest) => saveRoom(request, "POST");
export const PUT = (request: NextRequest) => saveRoom(request, "PUT");
