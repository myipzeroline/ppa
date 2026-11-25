import type mysql from "mysql2/promise";
import { createPublicId, query } from "@/lib/db";
import { courtConflict, linkedCourts, placeholders, takenBookingAs } from "@/lib/court-schedule";
import { bangkokToday, weekDates } from "@/lib/court-availability";
import { linkedCourtIds } from "@/lib/court-space";
import { notifyMember } from "@/lib/notify";
import { sharedCache } from "@/lib/shared-cache";
import {
  buildPairing, courtRotation, gameDeltas, parseRoomSlots, prizeAwards, ratingSettings, sessionStandings, sessionTimes, teamNumberOf, tierFor,
  type CourtResult, type GameRecord, type Pairing, type RatingSettings,
} from "@/lib/rank";

type Connection = Pick<mysql.PoolConnection, "execute">;
export type RankNotice = { userId: number; title: string; body: string };

// Buffet Rank / Open Run on the server. Rules are in lib/rank.ts and database/schema.sql (rank_rooms).
export const RANK_DAYS_AHEAD = 7;

export class RankError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export type RoomRow = {
  id: number; sportId: number; slug: string; title: string; levelName: string | null; icon: string; kind: "buffet" | "open_run"; teamSize: number;
  courtId: number | null; courtName: string | null; price: number; capacity: number; minPlayers: number; slots: string; weekdays: string;
  rules: string | null; prize: string | null; prizeCoins: string | null; matchMinutes: number; closeMinutes: number; active: number | boolean; sortOrder: number; metadata: string | null;
};

export const roomColumns = "r.id, r.sport_id sportId, r.slug, r.title, r.level_name levelName, r.icon, r.kind, r.team_size teamSize, r.court_id courtId, c.name courtName, r.price, r.capacity, r.min_players minPlayers, r.slots, r.weekdays, r.rules, r.prize, r.prize_coins prizeCoins, r.match_minutes matchMinutes, r.close_minutes closeMinutes, r.active, r.sort_order sortOrder, CAST(r.metadata AS CHAR) metadata";

export async function loadRatingSettings(): Promise<RatingSettings> {
  return sharedCache("settings:skill-rating", 60_000, async () => {
    const rows = await query<{ metadata: string | null }>("SELECT CAST(metadata AS CHAR) metadata FROM app_content_items WHERE content_type = 'site_setting' AND slug = 'skill-rating' LIMIT 1");
    return ratingSettings(rows[0]?.metadata);
  });
}

const wall = (time: number) => new Date(time + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
const clock = (value: string) => value.slice(11, 16);

// Session times of a room on the coming days (Bangkok), as wall-clock strings.
export function roomSlotsAhead(room: Pick<RoomRow, "slots" | "weekdays">, today: string, days = RANK_DAYS_AHEAD) {
  const slots = parseRoomSlots(room.slots);
  const weekdays = String(room.weekdays || "0123456");
  return weekDates(today, days).flatMap(({ date, weekday }) => (weekdays.includes(String(weekday)) ? slots.map((slot) => ({
    date, from: slot.from, to: slot.to, startsAt: `${date} ${slot.from}:00`, endsAt: `${date} ${slot.to === "24:00" ? "23:59" : slot.to}:00`,
  })) : []));
}

type SessionRow = { id: number; roomId: number; startsAt: string; endsAt: string; status: string; matchedAt: string | null; cancelReason: string | null; taken: number; paid: number; myBookingNo: string | null; myStatus: string | null };
type Occupied = { courtId: number; startsAt: string; endsAt: string };

export type RankSlotView = {
  date: string; from: string; to: string; startsAt: string; sessionId: number | null;
  status: "open" | "closed" | "cancelled" | "finished" | "none"; taken: number; paid: number; left: number;
  joinable: boolean; courtBusy: boolean; matched: boolean; closesAt: string; matchAt: string;
  mine: { bookingNo: string; status: string } | null; cancelReason: string | null;
};

type RoomView = ReturnType<typeof roomView>;

function roomView(room: RoomRow, slots: RankSlotView[]) {
  return {
    id: Number(room.id), slug: room.slug, title: room.title, levelName: room.levelName, icon: room.icon, kind: room.kind, teamSize: Number(room.teamSize),
    courtName: room.courtName, price: Number(room.price), capacity: Number(room.capacity), minPlayers: Number(room.minPlayers),
    rules: room.rules, prize: room.prize, prizeCoins: room.prizeCoins, matchMinutes: Number(room.matchMinutes), closeMinutes: Number(room.closeMinutes),
    metadata: room.metadata, slots,
  };
}

// The session times of the rooms on the coming `days` days with places left in real time, the member's
// own entries, and whether the room's court is taken by someone else where no session exists yet.
async function roomViews(userId: number, rooms: RoomRow[], now: number, days: number): Promise<RoomView[]> {
  if (!rooms.length) return [];
  const today = bangkokToday(now);
  const from = `${today} 00:00:00`;
  const to = `${weekDates(today, days + 1).at(-1)!.date} 00:00:00`;
  const roomIds = rooms.map((room) => room.id);
  const sessions = await query<SessionRow>(
    `SELECT s.id, s.room_id roomId, DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(s.ends_at, '%Y-%m-%d %H:%i:%s') endsAt, s.status, s.matched_at matchedAt, s.cancel_reason cancelReason, ` +
      `(SELECT COUNT(*) FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = s.id AND (${takenBookingAs("b")})) taken, ` +
      "(SELECT COUNT(*) FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = s.id AND b.status IN ('paid','checked_in')) paid, " +
      `(SELECT b.booking_no FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = s.id AND e.user_id = ? AND (${takenBookingAs("b")}) LIMIT 1) myBookingNo, ` +
      `(SELECT b.status FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = s.id AND e.user_id = ? AND (${takenBookingAs("b")}) LIMIT 1) myStatus ` +
      `FROM rank_sessions s WHERE s.room_id IN (${placeholders(roomIds.length)}) AND s.starts_at >= ? AND s.starts_at < ?`,
    [userId, userId, ...roomIds, from, to],
  );
  // A room's court taken by someone else, where no session exists yet: that time cannot run.
  const courtIds = [...new Set(rooms.map((room) => Number(room.courtId)).filter(Boolean))];
  const linked = courtIds.length ? await linkedCourts((sql, params) => query(sql, params), courtIds) : [];
  const occupied = linked.length ? await query<Occupied>(
    `SELECT court_id courtId, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt FROM bookings WHERE court_id IN (${placeholders(linked.length)}) AND starts_at < ? AND ends_at > ? AND (${takenBookingAs("bookings")})` +
      ` UNION ALL SELECT court_id courtId, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt FROM court_blocks WHERE court_id IN (${placeholders(linked.length)}) AND cancelled_at IS NULL AND starts_at < ? AND ends_at > ?`,
    [...linked, to, from, ...linked, to, from],
  ) : [];
  const sharedRows = linked.length ? await query<{ id: number; sharedSpace: string | null }>("SELECT id, shared_space sharedSpace FROM courts WHERE shared_space IS NOT NULL AND shared_space <> ''") : [];
  return rooms.map((room) => {
    const courtSet = room.courtId ? new Set(linkedCourtIds([Number(room.courtId)], sharedRows)) : new Set<number>();
    const slots = roomSlotsAhead(room, today, days).map((slot): RankSlotView => {
      const session = sessions.find((item) => Number(item.roomId) === Number(room.id) && item.startsAt === slot.startsAt);
      const times = sessionTimes(slot.startsAt, Number(room.matchMinutes), Number(room.closeMinutes));
      const taken = Number(session?.taken || 0);
      const left = Math.max(0, Number(room.capacity) - taken);
      const courtBusy = !session && room.courtId ? occupied.some((item) => courtSet.has(Number(item.courtId)) && slot.startsAt < item.endsAt && slot.endsAt > item.startsAt) : false;
      const status = (session?.status || "none") as RankSlotView["status"];
      return {
        ...slot, sessionId: session ? Number(session.id) : null, status, taken, paid: Number(session?.paid || 0), left,
        joinable: now < times.closeAt && (status === "open" || status === "none") && left > 0 && !courtBusy,
        courtBusy, matched: Boolean(session?.matchedAt), closesAt: clock(wall(times.closeAt)), matchAt: clock(wall(times.matchAt)),
        mine: session?.myBookingNo ? { bookingNo: session.myBookingNo, status: String(session.myStatus) } : null,
        cancelReason: session?.cancelReason || null,
      };
    }).filter((slot) => sessionTimes(slot.startsAt, 0, 0).start + 2 * 3_600_000 > now);
    return roomView(room, slots);
  });
}

// What the member app shows in the Buffet Rank / Open Run tab of a sport: the member's level and the
// rooms with their session times of the coming week, places left and the member's own entries.
export async function loadRankView(userId: number, sportSlug: string, now = Date.now()) {
  const [sport] = await query<{ id: number; slug: string; name: string }>("SELECT id, slug, name_th name FROM sports WHERE slug = ? AND active = TRUE LIMIT 1", [sportSlug]);
  if (!sport) return null;
  const settings = await loadRatingSettings();
  const [ratingRow] = await query<{ rating: number; games: number; wins: number; losses: number }>("SELECT rating, games, wins, losses FROM player_ratings WHERE user_id = ? AND sport_id = ? LIMIT 1", [userId, sport.id]);
  const rating = Number(ratingRow?.rating ?? settings.start);
  const tier = tierFor(rating, settings.tiers);
  const rooms = await query<RoomRow>(`SELECT ${roomColumns} FROM rank_rooms r LEFT JOIN courts c ON c.id = r.court_id WHERE r.sport_id = ? AND r.active = TRUE ORDER BY r.sort_order, r.id`, [sport.id]);
  return {
    sport: { id: Number(sport.id), slug: sport.slug, name: sport.name },
    rating: { rating, games: Number(ratingRow?.games || 0), wins: Number(ratingRow?.wins || 0), losses: Number(ratingRow?.losses || 0), tier: tier.name, tierMin: tier.min, next: tier.next },
    tiers: settings.tiers,
    rooms: await roomViews(userId, rooms, now, RANK_DAYS_AHEAD),
  };
}

const slotEnd = (slot: Pick<RankSlotView, "date" | "to">) => sessionTimes(`${slot.date} ${slot.to === "24:00" ? "23:59" : slot.to}:00`, 0, 0).start;

type LiveRoomRow = RoomRow & { sportSlug: string; sportName: string; sportIcon: string; sportOrder: number };

export type LiveGame = {
  sportSlug: string; sportName: string; sportIcon: string; roomId: number; roomTitle: string; roomIcon: string; kind: "buffet" | "open_run";
  levelName: string | null; teamSize: number; capacity: number; minPlayers: number; price: number;
  date: string; from: string; to: string; startsAt: string; day: "today" | "tomorrow";
  taken: number; left: number; joinable: boolean; live: boolean; mine: boolean;
};

// Find Your Game (PPA app analysis V2, item 4): the club's Buffet Rank and Open Run sessions of every
// sport that members can still join or that are being played now, with places left in real time. Each
// room shows its next time of today (or tomorrow once today's are over); in-progress games come first.
export async function loadLiveGames(userId: number, now = Date.now()) {
  const rooms = await query<LiveRoomRow>(
    `SELECT ${roomColumns}, s.slug sportSlug, s.name_th sportName, s.icon sportIcon, s.sort_order sportOrder FROM rank_rooms r JOIN sports s ON s.id = r.sport_id AND s.active = TRUE LEFT JOIN courts c ON c.id = r.court_id WHERE r.active = TRUE ORDER BY s.sort_order, r.sort_order, r.id LIMIT 40`,
  );
  const views = await roomViews(userId, rooms, now, 2);
  const today = bangkokToday(now);
  const games: LiveGame[] = [];
  views.forEach((view, index) => {
    const room = rooms[index];
    const slot = view.slots.find((item) => {
      if (item.status === "cancelled" || item.status === "finished") return false;
      const start = sessionTimes(item.startsAt, 0, 0).start;
      const end = slotEnd(item);
      const live = Boolean(item.sessionId) && item.status !== "none" && now >= start && now < end;
      return live || item.joinable;
    });
    if (!slot) return;
    const start = sessionTimes(slot.startsAt, 0, 0).start;
    const end = slotEnd(slot);
    games.push({
      sportSlug: room.sportSlug, sportName: room.sportName, sportIcon: room.sportIcon, roomId: view.id, roomTitle: view.title, roomIcon: view.icon, kind: view.kind,
      levelName: view.levelName, teamSize: view.teamSize, capacity: view.capacity, minPlayers: view.minPlayers, price: view.price,
      date: slot.date, from: slot.from, to: slot.to, startsAt: slot.startsAt, day: slot.date === today ? "today" : "tomorrow",
      taken: slot.taken, left: slot.left, joinable: slot.joinable, live: Boolean(slot.sessionId) && now >= start && now < end, mine: Boolean(slot.mine),
    });
  });
  games.sort((a, b) => Number(b.live) - Number(a.live) || a.startsAt.localeCompare(b.startsAt) || 0);
  const sports = [...new Map(rooms.map((room) => [room.sportSlug, { slug: room.sportSlug, name: room.sportName, icon: room.sportIcon }])).values()];
  return { games, sports };
}

async function lockRoom(conn: Connection, roomId: number) {
  const [rows] = await conn.execute(`SELECT ${roomColumns} FROM rank_rooms r LEFT JOIN courts c ON c.id = r.court_id WHERE r.id = ? LIMIT 1 FOR UPDATE`, [roomId]);
  return (rows as RoomRow[])[0] || null;
}

const kindLabel = (room: Pick<RoomRow, "kind">) => (room.kind === "open_run" ? "Open Run" : "Buffet Rank");

// One player joins a session: the first player creates the session and blocks the room's court; each
// player gets a court-less booking (class_key rank:<session>) paid like any booking. The room row lock
// serializes joins, so a session never takes more players than its places.
export async function joinRankSession(conn: Connection, input: { userId: number; roomId: number; startsAt: string; now?: number }) {
  const now = input.now ?? Date.now();
  const room = await lockRoom(conn, input.roomId);
  if (!room || !Number(room.active)) throw new RankError("ไม่พบห้อง Buffet Rank นี้", 404);
  const slot = roomSlotsAhead(room, bangkokToday(now)).find((item) => item.startsAt === input.startsAt);
  if (!slot) throw new RankError("รอบนี้ไม่เปิดรับ", 400);
  const times = sessionTimes(slot.startsAt, Number(room.matchMinutes), Number(room.closeMinutes));
  if (now >= times.closeAt) throw new RankError("ปิดรับสมัครรอบนี้แล้ว");

  const [sessionRows] = await conn.execute("SELECT id, status FROM rank_sessions WHERE room_id = ? AND starts_at = ? LIMIT 1 FOR UPDATE", [room.id, slot.startsAt]);
  let session = (sessionRows as { id: number; status: string }[])[0];
  if (session && session.status !== "open") throw new RankError("ปิดรับสมัครรอบนี้แล้ว");
  if (!session) {
    let blockId: number | null = null;
    if (room.courtId) {
      const linked = await linkedCourts(async (sql, params) => (await conn.execute(sql, params as never[]))[0] as unknown[], [Number(room.courtId)]);
      await conn.execute(`SELECT id FROM courts WHERE id IN (${placeholders(linked.length)}) ORDER BY id FOR UPDATE`, linked);
      if (await courtConflict(conn, linked, slot.startsAt, slot.endsAt)) throw new RankError("สนามของรอบนี้ไม่ว่าง เลือกรอบอื่น");
      const [block] = await conn.execute("INSERT INTO court_blocks (court_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?)", [room.courtId, slot.startsAt, slot.endsAt, `${kindLabel(room)} · ${room.title}`.slice(0, 160)]);
      blockId = Number((block as { insertId?: number }).insertId || 0) || null;
    }
    const [created] = await conn.execute("INSERT INTO rank_sessions (room_id, starts_at, ends_at, court_block_id) VALUES (?, ?, ?, ?)", [room.id, slot.startsAt, slot.endsAt, blockId]);
    session = { id: Number((created as { insertId?: number }).insertId || 0), status: "open" };
  }
  const [existing] = await conn.execute(
    `SELECT b.booking_no, b.title, b.starts_at, b.ends_at, b.players, b.amount, b.status, b.expires_at FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = ? AND e.user_id = ? AND (${takenBookingAs("b")}) LIMIT 1 FOR UPDATE`,
    [session.id, input.userId],
  );
  if ((existing as unknown[]).length) return { booking: (existing as Record<string, unknown>[])[0], existing: true, sessionId: session.id };
  const [counted] = await conn.execute(`SELECT COUNT(*) taken FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = ? AND (${takenBookingAs("b")})`, [session.id]);
  if (Number((counted as { taken: number }[])[0]?.taken || 0) >= Number(room.capacity)) throw new RankError("รอบนี้เต็มแล้ว");

  const bookingNo = createPublicId("BK");
  const free = !(Number(room.price) > 0);
  const title = `${room.icon} ${kindLabel(room)} · ${room.title} · ${slot.from}–${slot.to}`.slice(0, 180);
  // An unpaid place is held 15 minutes, never past the moment joining closes.
  const holdUntil = wall(Math.min(now + 15 * 60_000, times.closeAt));
  const [inserted] = await conn.execute(
    "INSERT INTO bookings (booking_no, user_id, sport_id, court_id, class_key, title, starts_at, ends_at, players, amount, status, qr_secret, expires_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
    [bookingNo, input.userId, room.sportId, `rank:${session.id}`, title, slot.startsAt, slot.endsAt, Number(room.price), free ? "paid" : "pending_payment", createPublicId("QR"), free ? null : holdUntil],
  );
  const bookingId = Number((inserted as { insertId?: number }).insertId || 0);
  await conn.execute("INSERT INTO rank_entries (session_id, user_id, booking_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE booking_id = VALUES(booking_id), created_at = CURRENT_TIMESTAMP", [session.id, input.userId, bookingId]);
  const [booking] = await conn.execute("SELECT booking_no, title, starts_at, ends_at, players, amount, status, expires_at FROM bookings WHERE booking_no = ? LIMIT 1", [bookingNo]);
  return { booking: (booking as Record<string, unknown>[])[0], existing: false, sessionId: session.id };
}

type PlayerRow = { userId: number; displayName: string; rating: number; games: number; paidAt: string; status: string; entryId: number };

async function sessionPlayers(conn: Connection, sessionId: number, sportId: number, start: number, paidOnly = true) {
  const [rows] = await conn.execute(
    "SELECT e.id entryId, e.user_id userId, u.display_name displayName, COALESCE(pr.rating, ?) rating, COALESCE(pr.games, 0) games, b.status, " +
      "DATE_FORMAT(COALESCE((SELECT MIN(p.paid_at) FROM payments p WHERE p.booking_id = b.id AND p.status = 'paid'), b.created_at), '%Y-%m-%d %H:%i:%s') paidAt " +
      "FROM rank_entries e JOIN bookings b ON b.id = e.booking_id JOIN users u ON u.id = e.user_id LEFT JOIN player_ratings pr ON pr.user_id = e.user_id AND pr.sport_id = ? " +
      `WHERE e.session_id = ? AND ${paidOnly ? "b.status IN ('paid','checked_in')" : `(${takenBookingAs("b")})`} ORDER BY paidAt, e.id`,
    [start, sportId, sessionId],
  );
  return (rows as PlayerRow[]).map((row) => ({ ...row, userId: Number(row.userId), rating: Number(row.rating), games: Number(row.games) }));
}

function pairingFor(players: PlayerRow[], teamSize: number): Pairing {
  return buildPairing(players.map((player, index) => ({ userId: player.userId, rating: player.rating, queue: index })), teamSize);
}

type LockedSession = { id: number; roomId: number; startsAt: string; endsAt: string; status: string; courtBlockId: number | null; matchedAt: string | null; pairing: string | null };

async function lockSession(conn: Connection, sessionId: number) {
  const [rows] = await conn.execute(
    "SELECT id, room_id roomId, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt, status, court_block_id courtBlockId, matched_at matchedAt, CAST(pairing AS CHAR) pairing FROM rank_sessions WHERE id = ? LIMIT 1 FOR UPDATE",
    [sessionId],
  );
  return (rows as LockedSession[])[0] || null;
}

async function roomOf(conn: Connection, roomId: number) {
  const [rows] = await conn.execute(`SELECT ${roomColumns} FROM rank_rooms r LEFT JOIN courts c ON c.id = r.court_id WHERE r.id = ? LIMIT 1`, [roomId]);
  return (rows as RoomRow[])[0] || null;
}

const sessionLabel = (room: RoomRow, session: Pick<LockedSession, "startsAt" | "endsAt">) => `${kindLabel(room)} ${room.title} · ${new Date(`${session.startsAt.replace(" ", "T")}+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" })} ${clock(session.startsAt)}–${clock(session.endsAt)}`;

// Cancels a session: every paid player gets the money back as app credit (automatic refund), unpaid
// places are released, the court block is lifted so the court returns to normal rental.
export async function cancelRankSession(conn: Connection, sessionId: number, reason: string, staffId: number | null = null): Promise<RankNotice[]> {
  const session = await lockSession(conn, sessionId);
  if (!session || ["cancelled", "finished"].includes(session.status)) return [];
  const room = await roomOf(conn, Number(session.roomId));
  if (!room) return [];
  const [entries] = await conn.execute(
    `SELECT e.user_id userId, b.id bookingId, b.status, b.amount FROM rank_entries e JOIN bookings b ON b.id = e.booking_id WHERE e.session_id = ? AND (${takenBookingAs("b")}) FOR UPDATE`,
    [sessionId],
  );
  const notices: RankNotice[] = [];
  const label = sessionLabel(room, session);
  for (const entry of entries as { userId: number; bookingId: number; status: string; amount: number }[]) {
    let refunded = 0;
    if (["paid", "checked_in"].includes(entry.status)) {
      const [payments] = await conn.execute("SELECT id, amount, CAST(metadata AS CHAR) metadata FROM payments WHERE booking_id = ? AND status = 'paid' FOR UPDATE", [entry.bookingId]);
      for (const payment of payments as { id: number; amount: number; metadata: string | null }[]) {
        const amount = Number(payment.amount);
        if (!(amount > 0)) continue;
        await conn.execute("INSERT IGNORE INTO wallet_accounts (user_id) VALUES (?)", [entry.userId]);
        await conn.execute("UPDATE wallet_accounts SET balance = balance + ? WHERE user_id = ?", [amount, entry.userId]);
        await conn.execute("INSERT INTO wallet_ledger (user_id, kind, amount, ref_type, ref_id, note) VALUES (?, 'refund', ?, 'payment', ?, ?)", [entry.userId, amount, payment.id, `คืนเงิน ${label}`.slice(0, 255)]);
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(payment.metadata || "{}"); } catch { metadata = {}; }
        metadata.refund = { status: "done", to: "wallet", auto: true, at: new Date().toISOString(), ...(staffId ? { by: staffId } : {}) };
        metadata.cancelReason = reason;
        await conn.execute("UPDATE payments SET status = 'refunded', metadata = ? WHERE id = ?", [JSON.stringify(metadata), payment.id]);
        refunded += amount;
      }
    } else {
      // A request still waiting for payment is cancelled; one with a slip waits for a staff refund.
      const [pending] = await conn.execute("SELECT id, slip_path slipPath, CAST(metadata AS CHAR) metadata FROM payments WHERE booking_id = ? AND status = 'created' FOR UPDATE", [entry.bookingId]);
      for (const payment of pending as { id: number; slipPath: string | null; metadata: string | null }[]) {
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(payment.metadata || "{}"); } catch { metadata = {}; }
        metadata.cancelReason = reason;
        if (payment.slipPath) metadata.refund = { status: "pending" };
        await conn.execute("UPDATE payments SET status = 'cancelled', metadata = ? WHERE id = ?", [JSON.stringify(metadata), payment.id]);
      }
    }
    await conn.execute("UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?", [reason.slice(0, 255), entry.bookingId]);
    const notice = { userId: Number(entry.userId), title: "ยกเลิกรอบ Buffet Rank", body: `${label} · ${reason}${refunded ? ` · คืน ${refunded.toLocaleString("th-TH")} ฿ เข้าเครดิตในแอปแล้ว` : ""}` };
    await notifyMember(conn, notice.userId, notice.title, notice.body);
    notices.push(notice);
  }
  if (session.courtBlockId) await conn.execute("UPDATE court_blocks SET cancelled_at = NOW() WHERE id = ? AND cancelled_at IS NULL", [session.courtBlockId]);
  await conn.execute("UPDATE rank_sessions SET status = 'cancelled', cancel_reason = ?, closed_at = COALESCE(closed_at, NOW()) WHERE id = ?", [reason.slice(0, 160), sessionId]);
  if (staffId) {
    await conn.execute("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'rank.cancel', 'rank_session', ?, ?)", [staffId, String(sessionId), JSON.stringify({ reason, players: (entries as unknown[]).length })]);
  }
  return notices;
}

// Pairs the paid players now (staff "จัดคู่ใหม่", and the scheduled job). Returns the pairing.
export async function pairSession(conn: Connection, sessionId: number) {
  const session = await lockSession(conn, sessionId);
  if (!session) throw new RankError("ไม่พบรอบนี้", 404);
  const room = await roomOf(conn, Number(session.roomId));
  if (!room) throw new RankError("ไม่พบห้องของรอบนี้", 404);
  const [games] = await conn.execute("SELECT COUNT(*) total FROM rank_games WHERE session_id = ?", [sessionId]);
  if (Number((games as { total: number }[])[0]?.total || 0) > 0) throw new RankError("รอบนี้บันทึกผลแล้ว จัดคู่ใหม่ไม่ได้");
  const settings = await loadRatingSettings();
  const players = await sessionPlayers(conn, sessionId, Number(room.sportId), settings.start);
  const pairing = pairingFor(players, Number(room.teamSize));
  await conn.execute("UPDATE rank_sessions SET pairing = ?, matched_at = NOW() WHERE id = ?", [JSON.stringify(pairing), sessionId]);
  return { pairing, players, room, session };
}

// Scheduled job (every few minutes): from match_minutes before the start, sessions with enough paid
// players are paired (and re-paired as players join); when joining closes, a session short of
// min_players is cancelled and refunded, the others are closed with their final pairing.
export async function runRankJobs(conn: Connection, now = Date.now()): Promise<RankNotice[]> {
  const [due] = await conn.execute(
    "SELECT s.id, s.matched_at matchedAt, r.match_minutes matchMinutes, r.close_minutes closeMinutes, r.min_players minPlayers, DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') startsAt " +
      "FROM rank_sessions s JOIN rank_rooms r ON r.id = s.room_id WHERE s.status = 'open' AND s.starts_at <= DATE_ADD(NOW(), INTERVAL r.match_minutes MINUTE) AND s.starts_at > NOW() - INTERVAL 1 DAY ORDER BY s.starts_at LIMIT 100",
  );
  const notices: RankNotice[] = [];
  for (const row of due as { id: number; matchedAt: string | null; matchMinutes: number; closeMinutes: number; minPlayers: number; startsAt: string }[]) {
    const times = sessionTimes(row.startsAt, Number(row.matchMinutes), Number(row.closeMinutes));
    const settings = await loadRatingSettings();
    const session = await lockSession(conn, Number(row.id));
    if (!session || session.status !== "open") continue;
    const room = await roomOf(conn, Number(session.roomId));
    if (!room) continue;
    const players = await sessionPlayers(conn, Number(session.id), Number(room.sportId), settings.start);
    const closing = now >= times.closeAt;
    if (closing && players.length < Number(room.minPlayers)) {
      notices.push(...await cancelRankSession(conn, Number(session.id), `ผู้เล่นไม่ครบ ${room.minPlayers} คน`));
      continue;
    }
    if (players.length < Number(room.minPlayers)) continue;
    const pairing = pairingFor(players, Number(room.teamSize));
    await conn.execute(`UPDATE rank_sessions SET pairing = ?, matched_at = NOW()${closing ? ", status = 'closed', closed_at = NOW()" : ""} WHERE id = ?`, [JSON.stringify(pairing), session.id]);
    if (!session.matchedAt || closing) {
      for (const player of players) {
        const team = pairing.teams.find((item) => item.userIds.includes(player.userId));
        const notice = { userId: player.userId, title: closing ? "ยืนยันการจัดคู่ Buffet Rank" : "จัดคู่ Buffet Rank แล้ว", body: `${sessionLabel(room, session)} · ${team ? `ทีม ${team.no}` : "ตัวสำรอง"}` };
        await notifyMember(conn, notice.userId, notice.title, notice.body);
        notices.push(notice);
      }
    }
  }
  return notices;
}

type GameRow = { id: number; teamA: string | number[]; teamB: string | number[]; winner: "a" | "b"; scoreA: number | null; scoreB: number | null; ratingChanges: string | Record<string, number> | null; createdAt: string };

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function gameRecords(rows: GameRow[]): (GameRecord & { id: number; scoreA: number | null; scoreB: number | null })[] {
  return rows.map((row) => ({
    id: Number(row.id),
    teamA: parseJson<number[]>(row.teamA, []).map(Number),
    teamB: parseJson<number[]>(row.teamB, []).map(Number),
    winner: row.winner,
    scoreA: row.scoreA === null ? null : Number(row.scoreA),
    scoreB: row.scoreB === null ? null : Number(row.scoreB),
    ratingChanges: parseJson<Record<string, number> | null>(row.ratingChanges, null),
  }));
}

// Staff record one game: the winner of team A against team B. Every player's rating moves (ELO).
export async function recordRankGame(conn: Connection, input: { sessionId: number; teamA: number[]; teamB: number[]; winner: "a" | "b"; scoreA?: number | null; scoreB?: number | null; staffId: number | null }) {
  const session = await lockSession(conn, input.sessionId);
  if (!session || !["open", "closed"].includes(session.status)) throw new RankError("รอบนี้บันทึกผลไม่ได้");
  const room = await roomOf(conn, Number(session.roomId));
  if (!room) throw new RankError("ไม่พบห้องของรอบนี้", 404);
  const teamA = [...new Set(input.teamA.map(Number))];
  const teamB = [...new Set(input.teamB.map(Number))];
  if (!teamA.length || !teamB.length || teamA.some((id) => teamB.includes(id))) throw new RankError("ทีมของเกมไม่ถูกต้อง", 400);
  const settings = await loadRatingSettings();
  const players = await sessionPlayers(conn, input.sessionId, Number(room.sportId), settings.start);
  const inSession = new Set(players.map((player) => player.userId));
  if ([...teamA, ...teamB].some((id) => !inSession.has(id))) throw new RankError("ผู้เล่นต้องอยู่ในรอบนี้และชำระเงินแล้ว", 400);
  const everyone = [...teamA, ...teamB];
  for (const userId of everyone) await conn.execute("INSERT IGNORE INTO player_ratings (user_id, sport_id, rating) VALUES (?, ?, ?)", [userId, room.sportId, settings.start]);
  const [ratingRows] = await conn.execute(`SELECT user_id userId, rating, games FROM player_ratings WHERE sport_id = ? AND user_id IN (${placeholders(everyone.length)}) FOR UPDATE`, [room.sportId, ...everyone]);
  const rated = new Map((ratingRows as { userId: number; rating: number; games: number }[]).map((row) => [Number(row.userId), { userId: Number(row.userId), rating: Number(row.rating), games: Number(row.games) }]));
  const team = (ids: number[]) => ids.map((id) => rated.get(id) || { userId: id, rating: settings.start, games: 0 });
  const deltas = gameDeltas(team(teamA), team(teamB), input.winner, settings);
  for (const userId of everyone) {
    const won = (input.winner === "a" && teamA.includes(userId)) || (input.winner === "b" && teamB.includes(userId));
    await conn.execute("UPDATE player_ratings SET rating = rating + ?, games = games + 1, wins = wins + ?, losses = losses + ? WHERE user_id = ? AND sport_id = ?", [deltas.get(userId) || 0, won ? 1 : 0, won ? 0 : 1, userId, room.sportId]);
  }
  const changes = Object.fromEntries([...deltas.entries()].map(([userId, delta]) => [String(userId), delta]));
  await conn.execute(
    "INSERT INTO rank_games (session_id, team_a, team_b, winner, score_a, score_b, rating_changes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [input.sessionId, JSON.stringify(teamA), JSON.stringify(teamB), input.winner, input.scoreA ?? null, input.scoreB ?? null, JSON.stringify(changes), input.staffId],
  );
  return changes;
}

// Removes the last recorded game of a session and takes its rating changes back.
export async function undoLastRankGame(conn: Connection, sessionId: number) {
  const session = await lockSession(conn, sessionId);
  if (!session || !["open", "closed"].includes(session.status)) throw new RankError("รอบนี้แก้ผลไม่ได้");
  const room = await roomOf(conn, Number(session.roomId));
  if (!room) throw new RankError("ไม่พบห้องของรอบนี้", 404);
  const [rows] = await conn.execute("SELECT id, team_a teamA, team_b teamB, winner, score_a scoreA, score_b scoreB, rating_changes ratingChanges FROM rank_games WHERE session_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE", [sessionId]);
  const [game] = gameRecords(rows as GameRow[]);
  if (!game) throw new RankError("ยังไม่มีผลให้ยกเลิก");
  for (const userId of [...game.teamA, ...game.teamB]) {
    const won = (game.winner === "a" && game.teamA.includes(userId)) || (game.winner === "b" && game.teamB.includes(userId));
    await conn.execute("UPDATE player_ratings SET rating = rating - ?, games = GREATEST(games - 1, 0), wins = GREATEST(wins - ?, 0), losses = GREATEST(losses - ?, 0) WHERE user_id = ? AND sport_id = ?", [Number(game.ratingChanges?.[String(userId)] || 0), won ? 1 : 0, won ? 0 : 1, userId, room.sportId]);
  }
  await conn.execute("DELETE FROM rank_games WHERE id = ?", [game.id]);
}

// Ends a session: the day's winners get their Coins (room prize_coins, e.g. 5,3,2 for places 1-3).
export async function finishRankSession(conn: Connection, sessionId: number, staffId: number | null): Promise<RankNotice[]> {
  const session = await lockSession(conn, sessionId);
  if (!session || !["open", "closed"].includes(session.status)) throw new RankError("รอบนี้จบไปแล้วหรือถูกยกเลิก");
  if (Date.parse(`${session.startsAt.replace(" ", "T")}+07:00`) > Date.now()) throw new RankError("รอบนี้ยังไม่เริ่ม");
  const room = await roomOf(conn, Number(session.roomId));
  if (!room) throw new RankError("ไม่พบห้องของรอบนี้", 404);
  const [rows] = await conn.execute("SELECT id, team_a teamA, team_b teamB, winner, score_a scoreA, score_b scoreB, rating_changes ratingChanges FROM rank_games WHERE session_id = ? ORDER BY id", [sessionId]);
  const awards = prizeAwards(sessionStandings(gameRecords(rows as GameRow[])), room.prizeCoins);
  const notices: RankNotice[] = [];
  const label = sessionLabel(room, session);
  for (const award of awards) {
    await conn.execute("INSERT IGNORE INTO wallet_accounts (user_id) VALUES (?)", [award.userId]);
    await conn.execute("UPDATE wallet_accounts SET coin_balance = coin_balance + ? WHERE user_id = ?", [award.coins, award.userId]);
    await conn.execute("INSERT INTO wallet_ledger (user_id, kind, coin_delta, ref_type, ref_id, note) VALUES (?, 'coin_earn', ?, 'rank_session', ?, ?)", [award.userId, award.coins, sessionId, `รางวัลอันดับ ${award.place} ${label}`.slice(0, 255)]);
    const notice = { userId: award.userId, title: "รางวัลผู้ชนะ Buffet Rank", body: `อันดับ ${award.place} · ชนะ ${award.wins} เกม · +${award.coins} Coin · ${label}` };
    await notifyMember(conn, notice.userId, notice.title, notice.body);
    notices.push(notice);
  }
  await conn.execute("UPDATE rank_sessions SET status = 'finished', finished_at = NOW(), closed_at = COALESCE(closed_at, NOW()) WHERE id = ?", [sessionId]);
  await conn.execute("INSERT INTO admin_audit_logs (staff_id, action, target_type, target_id, metadata) VALUES (?, 'rank.finish', 'rank_session', ?, ?)", [staffId, String(sessionId), JSON.stringify({ awards: awards.map((award) => ({ userId: award.userId, place: award.place, coins: award.coins })) })]);
  return notices;
}

// Everything about one session: players (paid ones in payment order), pairing, games, who is on
// court now and the day's standings. Members see names only; staff also get the member ids.
export async function loadSessionDetail(sessionId: number, forStaff = false) {
  const [session] = await query<LockedSession & { cancelReason: string | null; finishedAt: string | null }>(
    "SELECT id, room_id roomId, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt, status, court_block_id courtBlockId, matched_at matchedAt, CAST(pairing AS CHAR) pairing, cancel_reason cancelReason, finished_at finishedAt FROM rank_sessions WHERE id = ? LIMIT 1",
    [sessionId],
  );
  if (!session) return null;
  const [room] = await query<RoomRow>(`SELECT ${roomColumns} FROM rank_rooms r LEFT JOIN courts c ON c.id = r.court_id WHERE r.id = ? LIMIT 1`, [session.roomId]);
  if (!room) return null;
  const settings = await loadRatingSettings();
  const players = (await query<PlayerRow>(
    "SELECT e.id entryId, e.user_id userId, u.display_name displayName, COALESCE(pr.rating, ?) rating, COALESCE(pr.games, 0) games, b.status, " +
      "DATE_FORMAT(COALESCE((SELECT MIN(p.paid_at) FROM payments p WHERE p.booking_id = b.id AND p.status = 'paid'), b.created_at), '%Y-%m-%d %H:%i:%s') paidAt " +
      "FROM rank_entries e JOIN bookings b ON b.id = e.booking_id JOIN users u ON u.id = e.user_id LEFT JOIN player_ratings pr ON pr.user_id = e.user_id AND pr.sport_id = ? " +
      `WHERE e.session_id = ? AND (${takenBookingAs("b")}) ORDER BY b.status NOT IN ('paid','checked_in'), paidAt, e.id`,
    [settings.start, room.sportId, sessionId],
  )).map((row) => ({ ...row, userId: Number(row.userId), rating: Number(row.rating) }));
  const games = gameRecords(await query<GameRow>("SELECT id, team_a teamA, team_b teamB, winner, score_a scoreA, score_b scoreB, rating_changes ratingChanges FROM rank_games WHERE session_id = ? ORDER BY id", [sessionId]));
  const pairing = parseJson<Pairing>(session.pairing, { teams: [], reserves: [] });
  const results: CourtResult[] = games.map((game) => ({ a: teamNumberOf(pairing, game.teamA) || 0, b: teamNumberOf(pairing, game.teamB) || 0, winner: game.winner })).filter((result) => result.a && result.b);
  const rotation = courtRotation(pairing.teams.map((team) => team.no), results);
  const names = new Map(players.map((player) => [player.userId, player.displayName]));
  const person = (userId: number) => ({ ...(forStaff ? { userId } : {}), name: names.get(userId) || "-", tier: tierFor(players.find((player) => player.userId === userId)?.rating ?? settings.start, settings.tiers).name });
  const standings = sessionStandings(games);
  const awards = prizeAwards(standings, room.prizeCoins);
  return {
    session: { id: Number(session.id), startsAt: session.startsAt, endsAt: session.endsAt, status: session.status, matched: Boolean(session.matchedAt), cancelReason: session.cancelReason },
    room: { id: Number(room.id), title: room.title, icon: room.icon, kind: room.kind, teamSize: Number(room.teamSize), courtName: room.courtName, capacity: Number(room.capacity), minPlayers: Number(room.minPlayers), price: Number(room.price), rules: room.rules, prize: room.prize, prizeCoins: room.prizeCoins, sportId: Number(room.sportId) },
    players: players.map((player, index) => ({ ...person(player.userId), rating: player.rating, paid: ["paid", "checked_in"].includes(player.status), checkedIn: player.status === "checked_in", queue: index + 1 })),
    pairing: { teams: pairing.teams.map((team) => ({ no: team.no, rating: team.rating, players: team.userIds.map(person) })), reserves: pairing.reserves.map(person) },
    games: games.map((game) => ({ id: game.id, teamA: game.teamA.map(person), teamB: game.teamB.map(person), winner: game.winner, scoreA: game.scoreA, scoreB: game.scoreB, teamANo: teamNumberOf(pairing, game.teamA), teamBNo: teamNumberOf(pairing, game.teamB) })),
    onCourt: rotation.onCourt ? rotation.onCourt.map((no) => ({ no, players: (pairing.teams.find((team) => team.no === no)?.userIds || []).map(person) })) : null,
    queue: rotation.queue,
    standings: standings.slice(0, 10).map((row) => ({ ...person(row.userId), wins: row.wins, played: row.played, gain: row.gain })),
    awards: awards.map((award) => ({ ...person(award.userId), place: award.place, coins: award.coins, wins: award.wins })),
  };
}
