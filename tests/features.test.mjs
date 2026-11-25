import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load, require } from "./load-ts.mjs";

// PPA app analysis (pages 1-13): Big Screen Live, Buffet Rank / Open Run with ELO and pairing, court
// booking with day/night prices and the shared indoor court, Fitness Package/Coupon, HYROX / Airfit /
// Pilates classes with coupons, member levels, skill ratings and transaction history.

const schema = readFileSync("database/schema.sql", "utf8");
const statements = schema.split(/;\s*\n/).map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);

// ---------- Court prices and shared space ----------

test("court prices: day rate until 16:00, night rate after, each booked hour priced on its own", () => {
  const { rateCard, rateForSlot } = load("lib/court-pricing.ts");
  const volleyball = rateCard({ baseRate: 800, nightRate: 1200, nightFrom: 16 });
  assert.deepEqual(volleyball, { dayRate: 800, nightRate: 1200, nightFrom: 16 });
  assert.equal(rateForSlot(volleyball, "15:00"), 800);
  assert.equal(rateForSlot(volleyball, "16:00"), 1200);
  assert.equal(rateForSlot(volleyball, "15:00", 2), 2000, "one day hour plus one night hour");
  const outdoor = rateCard({ baseRate: 800, nightRate: 1200 }, { hourlyRate: 200, nightRate: 400 });
  assert.equal(rateForSlot(outdoor, "19:00"), 400, "a court's own rates win over the sport's");
  assert.equal(rateCard({ baseRate: 200 }, { hourlyRate: 300 }).nightRate, 450, "a court day rate without a night rate: x1.5 of the court rate");
  assert.equal(rateCard({ baseRate: 200 }).nightRate, 300);
  assert.equal(rateCard({ baseRate: 200, nightFrom: "abc" }).nightFrom, 16);
});

test("shared space: the indoor basketball court, its halves and the volleyball court conflict across sports", () => {
  const { linkedCourtIds, normalizeSharedSpace, sharesSpace, spaceUnits } = load("lib/court-space.ts");
  const courts = [
    { id: 20, sharedSpace: "indoor-left,indoor-right" },
    { id: 21, sharedSpace: "indoor-left" },
    { id: 22, sharedSpace: "indoor-right" },
    { id: 30, sharedSpace: "indoor-left, INDOOR-RIGHT" },
    { id: 7, sharedSpace: null },
  ];
  assert.deepEqual(spaceUnits(courts[3]), ["indoor-left", "indoor-right"]);
  assert.deepEqual(spaceUnits(courts[4]), ["court:7"]);
  assert.equal(sharesSpace(courts[1], courts[2]), false, "the two halves can be booked at the same time");
  assert.equal(sharesSpace(courts[1], courts[3]), true);
  assert.deepEqual(linkedCourtIds([21], courts), [20, 21, 30], "half A conflicts with the full court and volleyball, not half B");
  assert.deepEqual(linkedCourtIds([30], courts), [20, 21, 22, 30]);
  assert.deepEqual(linkedCourtIds([7], courts), [7]);
  assert.equal(normalizeSharedSpace(" Indoor-Left , indoor-left "), "indoor-left");
  assert.equal(normalizeSharedSpace(""), null);
  assert.equal(normalizeSharedSpace("indoor left"), undefined, "invalid units are refused");
});

test("the counter calendar shows hours taken on the shared floor in the other sport's row", () => {
  const { rowCells } = load("components/admin-court-calendar.tsx");
  const day = {
    date: "2099-02-02",
    courts: [
      { id: 20, name: "อินดอร์ Full Court", sportId: 5, sportName: "บาสเกตบอล", status: "available", sharedSpace: "indoor-left,indoor-right" },
      { id: 30, name: "อินดอร์ (ใช้ร่วมกับบาส)", sportId: 6, sportName: "วอลเลย์บอล", status: "available", sharedSpace: "indoor-left,indoor-right" },
      { id: 7, name: "สนาม 7", sportId: 3, sportName: "แบดมินตัน", status: "available", sharedSpace: null },
    ],
    bookings: [{ bookingNo: "BK-V", courtId: 30, startsAt: "2099-02-02 18:00:00", endsAt: "2099-02-02 20:00:00", status: "paid", name: "A", phone: null, guest: false, amount: 2400, title: "Volleyball", seriesKey: null, paymentNo: null }],
    blocks: [],
  };
  const basketball = rowCells(20, day);
  const shared = basketball.filter((cell) => cell.kind === "shared");
  assert.equal(shared.length, 1);
  assert.deepEqual([shared[0].from, shared[0].to, shared[0].court.sportName], [18, 20, "วอลเลย์บอล"]);
  assert.equal(basketball.reduce((sum, cell) => sum + (cell.kind === "free" ? 1 : cell.to - cell.from), 0), 15, "the row still covers 08:00-23:00");
  assert.equal(rowCells(30, day).filter((cell) => cell.kind === "booking").length, 1, "the volleyball row shows its own booking");
  assert.equal(rowCells(7, day).some((cell) => cell.kind === "shared"), false, "other courts are not affected");
});

test("week strip dates and opening hours follow the sport's hours", () => {
  const { hourSlots, weekDates, courtLiveStatus } = load("lib/court-availability.ts");
  assert.deepEqual(hourSlots(8, 21).slice(-1), ["20:00"], "a sport closing at 21:00 offers 20:00 as its last hour");
  assert.equal(hourSlots(8, 21).length, 13);
  assert.deepEqual(weekDates("2026-12-30", 3), [{ date: "2026-12-30", weekday: 3 }, { date: "2026-12-31", weekday: 4 }, { date: "2027-01-01", weekday: 5 }]);
  const now = Date.parse("2026-11-14T18:30:00+07:00");
  const occupancy = [
    { courtId: 1, startsAt: "2026-11-14 18:00:00", endsAt: "2026-11-14 19:00:00", status: "checked_in" },
    { courtId: 2, startsAt: "2026-11-14 18:00:00", endsAt: "2026-11-14 20:00:00", status: "paid" },
    { courtId: 3, startsAt: "2026-11-14 17:00:00", endsAt: "2026-11-14 22:00:00", status: "blocked" },
  ];
  assert.deepEqual(courtLiveStatus(1, occupancy, now), { status: "in_use", until: "19:00", sportId: null });
  assert.equal(courtLiveStatus(2, occupancy, now).status, "booked");
  assert.equal(courtLiveStatus(3, occupancy, now).status, "closed");
  assert.equal(courtLiveStatus(4, occupancy, now).status, "free");
});

test("availability shows a basketball hour booked for volleyball as taken, with the other sport", async () => {
  const statements = [];
  const route = load("app/api/courts/availability/route.ts", {
    "@/lib/auth": { assertApiUser: async () => ({ id: 1 }) },
    "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", secureResponse: (response) => response, validationErrorResponse: () => Response.json({}, { status: 400 }) },
    "@/lib/db": { query: async (sql, params) => {
      statements.push([sql, params]);
      if (sql.includes("FROM sports")) return [{ id: 5, baseRate: 800, nightRate: 1200, nightFrom: 16, openHour: 8, closeHour: 21 }];
      if (sql.includes("FROM courts WHERE sport_id = ? AND status")) return [{ id: 20, name: "อินดอร์ Full Court", zone: "อินดอร์ (Indoor)", kind: "Full Court", capacity: 12, hourlyRate: 800, nightRate: 1200, sharedSpace: "indoor-left,indoor-right" }];
      if (sql.includes("shared_space IS NOT NULL AND shared_space <> '' AND sport_id <> ?")) return [{ id: 30, sportId: 6, sharedSpace: "indoor-left,indoor-right" }];
      return [{ courtId: 30, startsAt: "2099-02-02 08:00:00", endsAt: "2099-02-02 12:00:00", sportId: 6, status: "paid" }];
    } },
  });
  const body = await (await route.GET(new Request("http://localhost/api/courts/availability?sport=basketball&date=2099-02-02"))).json();
  const at = (time) => body.slots.find((slot) => slot.time === time);
  assert.equal(at("08:00").available, false);
  assert.equal(at("08:00").sharedWith, 6, "the app writes ไม่ว่าง · วอลเลย์บอล");
  assert.equal(at("12:00").available, true);
  assert.equal(at("12:00").rate, 800);
  assert.equal(at("16:00").rate, 1200);
  assert.equal(at("20:00").period, "night");
  assert.equal(at("21:00"), undefined, "closing at 21:00");
  assert.deepEqual(body.courts[0].sharedWith, [6]);
  const occupancy = statements.at(-1);
  assert.match(occupancy[0], /court_id IN \(\?, \?\)/, "bookings of the volleyball court are read too");
  assert.deepEqual(occupancy[1].slice(0, 2), [20, 30]);
});

function bookingConnection({ booked = [], blocked = [] } = {}) {
  const statements = [];
  let rolledBack = false;
  return {
    statements,
    get rolledBack() { return rolledBack; },
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => { rolledBack = true; }, release: () => {},
    execute: async (sql, params) => {
      statements.push([sql, params]);
      if (sql.includes("FROM courts WHERE id IN")) return [[{ id: 20, capacity: 12, hourlyRate: 800, nightRate: 1200 }, { id: 21, capacity: 6, hourlyRate: 400, nightRate: 600 }, { id: 22, capacity: 6, hourlyRate: 400, nightRate: 600 }, { id: 30, capacity: 12, hourlyRate: 800, nightRate: 1200 }]];
      if (sql.includes("FROM bookings WHERE court_id IN")) return [params.some((value) => booked.includes(value)) ? [{ id: 1 }] : []];
      if (sql.includes("FROM court_blocks")) return [params.some((value) => blocked.includes(value)) ? [{ id: 2 }] : []];
      if (sql.startsWith("INSERT")) return [{ affectedRows: 1, insertId: 99 }];
      return [[{ booking_no: "BK1", status: "pending_payment" }]];
    },
  };
}

function bookingRoute(conn, body) {
  return load("app/api/bookings/route.ts", {
    "@/lib/auth": { assertApiUser: async () => ({ id: 3 }) },
    "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", parseJsonBody: async () => body },
    "@/lib/db": {
      createPublicId: (prefix) => `${prefix}TEST`,
      pool: { getConnection: async () => conn },
      query: async (sql) => {
        if (sql.includes("FROM sports")) return [{ id: 5, requiresBooking: true, baseRate: 800, nightRate: 1200, nightFrom: 16, openHour: 8, closeHour: 21, name: "บาสเกตบอล", icon: "🏀" }];
        if (sql.includes("shared_space IS NOT NULL") || sql.includes("FROM courts WHERE id IN")) return [{ id: 20, sharedSpace: "indoor-left,indoor-right" }, { id: 21, sharedSpace: "indoor-left" }, { id: 22, sharedSpace: "indoor-right" }, { id: 30, sharedSpace: "indoor-left,indoor-right" }];
        if (sql.includes("WHERE id = ? AND sport_id = ?")) return [{ id: 20, name: "อินดอร์ Full Court", capacity: 12, hourlyRate: 800, nightRate: 1200, zone: "อินดอร์ (Indoor)", kind: "Full Court", sharedSpace: "indoor-left,indoor-right" }];
        return [
          { id: 20, name: "อินดอร์ Full Court", capacity: 12, hourlyRate: 800, nightRate: 1200, zone: "อินดอร์ (Indoor)", kind: "Full Court", sharedSpace: "indoor-left,indoor-right" },
          { id: 21, name: "อินดอร์ Half Court A", capacity: 6, hourlyRate: 400, nightRate: 600, zone: "อินดอร์ (Indoor)", kind: "Half Court", sharedSpace: "indoor-left" },
          { id: 22, name: "อินดอร์ Half Court B", capacity: 6, hourlyRate: 400, nightRate: 600, zone: "อินดอร์ (Indoor)", kind: "Half Court", sharedSpace: "indoor-right" },
        ];
      },
    },
  });
}

test("booking the indoor full court is refused while volleyball holds the shared floor", async () => {
  const conn = bookingConnection({ booked: [30] });
  const response = await bookingRoute(conn, { sportSlug: "basketball", courtId: 20, date: "2099-02-02", time: "18:00", durationHours: 1, players: 1 }).POST(new Request("http://localhost/api/bookings", { method: "POST" }));
  assert.equal(response.status, 409);
  assert.ok(conn.rolledBack);
  const lock = conn.statements.find(([sql]) => sql.includes("FROM courts WHERE id IN"));
  assert.match(lock[0], /ORDER BY id FOR UPDATE/, "linked courts are locked in id order, in one statement");
  assert.deepEqual(lock[1].slice(0, 4), [20, 21, 22, 30]);
  const check = conn.statements.find(([sql]) => sql.includes("FROM bookings WHERE court_id IN"));
  assert.ok(check[1].includes(30), "the volleyball court is checked with the basketball court");
  assert.equal(conn.statements.some(([sql]) => sql.startsWith("INSERT")), false);
});

test("half court: the first free half is booked at its own night price", async () => {
  const conn = bookingConnection({ booked: [] });
  // Half A conflicts (its linked set includes court 21), half B is free.
  conn.execute = (original => async (sql, params) => {
    if (sql.includes("FROM bookings WHERE court_id IN")) {
      conn.statements.push([sql, params]);
      return [params.includes(21) ? [{ id: 1 }] : []];
    }
    return original(sql, params);
  })(conn.execute);
  const response = await bookingRoute(conn, { sportSlug: "basketball", courtId: null, zone: "อินดอร์ (Indoor)", courtKind: "Half Court", date: "2099-02-02", time: "18:00", durationHours: 1, players: 1 }).POST(new Request("http://localhost/api/bookings", { method: "POST" }));
  assert.equal(response.status, 201);
  const insert = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.equal(insert[1][3], 22, "half court B");
  assert.equal(insert[1][8], 600, "night rate of the half court");
  assert.match(insert[1][4], /Half Court B/, "the title names the court that was assigned");
});

test("member bookings respect the sport's opening hours", async () => {
  const conn = bookingConnection();
  const response = await bookingRoute(conn, { sportSlug: "basketball", courtId: 20, date: "2099-02-02", time: "21:00", durationHours: 1, players: 1 }).POST(new Request("http://localhost/api/bookings", { method: "POST" }));
  assert.equal(response.status, 400, "closing at 21:00");
  assert.equal(conn.statements.length, 0);
});

// ---------- Buffet Rank: ELO, tiers, pairing, rotation, prizes ----------

test("ELO: an upset moves more points, provisional players move faster, teams play at their average", () => {
  const { expectedScore, gameDeltas, defaultRatingSettings } = load("lib/rank.ts");
  assert.ok(Math.abs(expectedScore(1000, 1000) - 0.5) < 1e-9);
  assert.ok(expectedScore(1200, 1000) > 0.75);
  const veteran = (userId, rating) => ({ userId, rating, games: 50 });
  const even = gameDeltas([veteran(1, 1000), veteran(2, 1000)], [veteran(3, 1000), veteran(4, 1000)], "a", defaultRatingSettings);
  assert.deepEqual([...even.values()], [16, 16, -16, -16]);
  const upset = gameDeltas([veteran(1, 1000), veteran(2, 1000)], [veteran(3, 1200), veteran(4, 1200)], "a", defaultRatingSettings);
  assert.ok(upset.get(1) > 16 && upset.get(3) < -16);
  const rookie = gameDeltas([{ userId: 1, rating: 1000, games: 0 }, veteran(2, 1000)], [veteran(3, 1000), veteran(4, 1000)], "a", defaultRatingSettings);
  assert.equal(rookie.get(1), 24, "provisional K 48 for the first 10 games");
});

test("skill tiers: 1,180 points is พอตัว, settings from the back office are validated", () => {
  const { ratingSettings, ratingSettingsProblem, tierFor } = load("lib/rank.ts");
  assert.equal(tierFor(1180).name, "พอตัว");
  assert.equal(tierFor(1000).name, "มือใหม่");
  assert.equal(tierFor(1000).next.name, "ฝึกหน้าบ้าน");
  assert.equal(tierFor(1400).next, null);
  const custom = ratingSettings('{"start":1200,"k":20,"tiers":[{"name":"A","min":0},{"name":"B","min":1300}]}');
  assert.equal(custom.start, 1200);
  assert.equal(custom.k, 20);
  assert.equal(custom.provisionalK, 48);
  assert.equal(tierFor(1350, custom.tiers).name, "B");
  assert.equal(ratingSettings("not json").start, 1000);
  assert.match(ratingSettingsProblem({ tiers: [] }), /tiers/);
  assert.match(ratingSettingsProblem({ tiers: [{ name: "A", min: 0 }, { name: "B", min: 0 }] }), /ไม่ซ้ำ/);
  assert.equal(ratingSettingsProblem({ start: 1000, tiers: [{ name: "A", min: 0 }] }), null);
});

test("pairing: payment order picks who plays, ratings balance the teams, the latest payer waits", () => {
  const { buildPairing } = load("lib/rank.ts");
  const players = [[1, 1300], [2, 1000], [3, 1200], [4, 1100], [5, 1250]].map(([userId, rating], queue) => ({ userId, rating, queue }));
  const pairing = buildPairing(players, 2);
  assert.deepEqual(pairing.reserves, [5], "the fifth payer is the reserve");
  assert.equal(pairing.teams.length, 2);
  const ratings = pairing.teams.map((team) => team.rating);
  assert.ok(Math.abs(ratings[0] - ratings[1]) <= 50, `balanced teams ${ratings}`);
  assert.deepEqual(pairing.teams[0].userIds, [1, 2], "strongest with weakest; the earliest payer's team plays first");
  assert.deepEqual(buildPairing(players.slice(0, 3), 2).teams, [], "fewer than two teams: no pairing");
  const open = buildPairing(Array.from({ length: 7 }, (_, index) => ({ userId: index + 1, rating: 1000 + index * 10, queue: index })), 3);
  assert.equal(open.teams.length, 2);
  assert.deepEqual(open.reserves, [7]);
});

test("king of the court: loser out, two wins in a row and both teams come off", () => {
  const { courtRotation } = load("lib/rank.ts");
  assert.deepEqual(courtRotation([1, 2, 3, 4], []).onCourt, [1, 2]);
  const afterOne = courtRotation([1, 2, 3, 4], [{ a: 1, b: 2, winner: "a" }]);
  assert.deepEqual(afterOne.onCourt, [1, 3], "team 1 stays, team 2 to the back");
  assert.deepEqual(afterOne.queue, [4, 2]);
  const afterTwo = courtRotation([1, 2, 3, 4], [{ a: 1, b: 2, winner: "a" }, { a: 1, b: 3, winner: "a" }]);
  assert.deepEqual(afterTwo.onCourt, [4, 2], "team 1 won twice: both teams leave, the next two play");
  assert.deepEqual(afterTwo.queue, [3, 1]);
});

test("standings and prizes: most wins first, only winners are paid, as many places as coins", () => {
  const { sessionStandings, prizeAwards, parseRoomSlots, sessionTimes } = load("lib/rank.ts");
  const games = [
    { teamA: [1, 2], teamB: [3, 4], winner: "a", ratingChanges: { 1: 16, 2: 16, 3: -16, 4: -16 } },
    { teamA: [1, 2], teamB: [5, 6], winner: "b", ratingChanges: { 1: -10, 2: -12, 5: 10, 6: 12 } },
    { teamA: [5, 6], teamB: [3, 4], winner: "a", ratingChanges: { 5: 14, 6: 14, 3: -14, 4: -14 } },
  ];
  const standings = sessionStandings(games);
  assert.deepEqual(standings.slice(0, 2).map((row) => row.userId), [6, 5]);
  const awards = prizeAwards(standings, "5,3,2");
  assert.deepEqual(awards.map((award) => [award.userId, award.place, award.coins]), [[6, 1, 5], [5, 2, 3], [1, 3, 2]]);
  assert.deepEqual(prizeAwards(standings, ""), []);
  assert.deepEqual(parseRoomSlots("18:00-20:00, 20:00-22:00,bad,23:00-22:00"), [{ from: "18:00", to: "20:00" }, { from: "20:00", to: "22:00" }]);
  const times = sessionTimes("2099-02-02 18:00:00", 60, 10);
  assert.equal(times.matchAt, Date.parse("2099-02-02T17:00:00+07:00"));
  assert.equal(times.closeAt, Date.parse("2099-02-02T17:50:00+07:00"));
});

// ---------- Buffet Rank on the server ----------

const room = { id: 4, sportId: 3, slug: "badminton-beginner", title: "มือใหม่", levelName: "มือใหม่", icon: "🌱", kind: "buffet", teamSize: 2, courtId: 17, courtName: "สนาม 7", price: 100, capacity: 16, minPlayers: 4, slots: "18:00-20:00,20:00-22:00", weekdays: "0123456", rules: null, prize: null, prizeCoins: "5,3,2", matchMinutes: 60, closeMinutes: 10, active: 1, sortOrder: 10, metadata: null };

function rankConnection(responder) {
  const statements = [];
  return {
    statements,
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql, params = []) => {
      statements.push([sql, params]);
      const answer = responder(sql, params);
      if (answer !== undefined) return answer;
      if (sql.startsWith("INSERT") || sql.startsWith("UPDATE")) return [{ affectedRows: 1, insertId: 70 }];
      return [[]];
    },
  };
}

const rankServer = (rows = {}) => load("lib/rank-server.ts", {
  "@/lib/db": { createPublicId: (prefix) => `${prefix}TEST`, query: async (sql) => { for (const [needle, value] of Object.entries(rows)) if (sql.includes(needle)) return value; return []; } },
  "@/lib/notify": { notifyMember: async (conn, userId, title, body) => { (rows.notices ||= []).push({ userId, title, body }); } },
});

test("the first player of a session blocks the room's court and gets a booking to pay", async () => {
  const { joinRankSession } = rankServer();
  const now = Date.parse("2099-02-02T10:00:00+07:00");
  const conn = rankConnection((sql) => {
    if (sql.includes("FROM rank_rooms r")) return [[room]];
    if (sql.includes("COUNT(*) taken")) return [[{ taken: 0 }]];
    if (sql.includes("SELECT booking_no, title")) return [[{ booking_no: "BKTEST", status: "pending_payment", amount: 100 }]];
    return undefined;
  });
  const result = await joinRankSession(conn, { userId: 9, roomId: 4, startsAt: "2099-02-02 18:00:00", now });
  assert.equal(result.existing, false);
  const block = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO court_blocks"));
  assert.deepEqual(block[1].slice(0, 3), [17, "2099-02-02 18:00:00", "2099-02-02 20:00:00"]);
  assert.match(block[1][3], /Buffet Rank · มือใหม่/);
  const booking = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.equal(booking[1][3], "rank:70", "a court-less booking of the session");
  assert.equal(booking[1][7], 100);
  assert.equal(booking[1][8], "pending_payment");
  assert.ok(conn.statements.findIndex(([sql]) => sql.includes("FROM rank_rooms r")) === 0, "the room row is locked first");
});

test("joining is refused when the room's court is taken, the session is full or closed", async () => {
  const { joinRankSession, RankError } = rankServer();
  const now = Date.parse("2099-02-02T10:00:00+07:00");
  const busy = rankConnection((sql) => {
    if (sql.includes("FROM rank_rooms r")) return [[room]];
    if (sql.includes("FROM bookings WHERE court_id IN")) return [[{ id: 5 }]];
    return undefined;
  });
  await assert.rejects(joinRankSession(busy, { userId: 9, roomId: 4, startsAt: "2099-02-02 18:00:00", now }), (error) => error instanceof RankError && /สนาม/.test(error.message));
  const full = rankConnection((sql) => {
    if (sql.includes("FROM rank_rooms r")) return [[room]];
    if (sql.includes("FROM rank_sessions WHERE room_id")) return [[{ id: 3, status: "open" }]];
    if (sql.includes("COUNT(*) taken")) return [[{ taken: 16 }]];
    return undefined;
  });
  await assert.rejects(joinRankSession(full, { userId: 9, roomId: 4, startsAt: "2099-02-02 18:00:00", now }), /เต็ม/);
  const late = rankConnection((sql) => (sql.includes("FROM rank_rooms r") ? [[room]] : undefined));
  await assert.rejects(joinRankSession(late, { userId: 9, roomId: 4, startsAt: "2099-02-02 18:00:00", now: Date.parse("2099-02-02T17:55:00+07:00") }), /ปิดรับ/);
});

test("closing a session short of players refunds every paid player to app credit and frees the court", async () => {
  const rows = {};
  const { runRankJobs } = rankServer(rows);
  const now = Date.parse("2099-02-02T17:52:00+07:00");
  const conn = rankConnection((sql) => {
    if (sql.includes("FROM rank_sessions s JOIN rank_rooms r")) return [[{ id: 3, matchedAt: null, matchMinutes: 60, closeMinutes: 10, minPlayers: 4, startsAt: "2099-02-02 18:00:00" }]];
    if (sql.includes("FROM rank_sessions WHERE id = ?")) return [[{ id: 3, roomId: 4, startsAt: "2099-02-02 18:00:00", endsAt: "2099-02-02 20:00:00", status: "open", courtBlockId: 81, matchedAt: null, pairing: null }]];
    if (sql.includes("FROM rank_rooms r")) return [[room]];
    if (sql.includes("JOIN users u ON u.id = e.user_id")) return [[{ entryId: 1, userId: 9, displayName: "A", rating: 1000, games: 0, status: "paid", paidAt: "2099-02-02 10:00:00" }, { entryId: 2, userId: 10, displayName: "B", rating: 1000, games: 0, status: "paid", paidAt: "2099-02-02 10:05:00" }]];
    if (sql.includes("SELECT e.user_id userId, b.id bookingId")) return [[{ userId: 9, bookingId: 50, status: "paid", amount: 100 }, { userId: 10, bookingId: 51, status: "pending_payment", amount: 100 }]];
    if (sql.includes("FROM payments WHERE booking_id = ? AND status = 'paid'")) return [[{ id: 600, amount: 100, metadata: "{\"itemType\":\"booking\"}" }]];
    return undefined;
  });
  const notices = await runRankJobs(conn, now);
  assert.equal(notices.length, 2);
  assert.ok(conn.statements.some(([sql, params]) => sql.startsWith("UPDATE wallet_accounts SET balance = balance + ?") && params[0] === 100 && params[1] === 9), "100 ฿ back to the paid player's credit");
  assert.ok(conn.statements.some(([sql]) => sql.includes("INSERT INTO wallet_ledger") && sql.includes("'refund'")));
  const payment = conn.statements.find(([sql]) => sql.startsWith("UPDATE payments SET status = 'refunded'"));
  assert.equal(JSON.parse(payment[1][0]).refund.to, "wallet");
  assert.ok(conn.statements.some(([sql, params]) => sql.startsWith("UPDATE court_blocks SET cancelled_at = NOW()") && params[0] === 81), "the court returns to normal rental");
  assert.ok(conn.statements.some(([sql]) => sql.startsWith("UPDATE rank_sessions SET status = 'cancelled'")));
  assert.match(notices[0].body, /คืน 100 ฿/);
});

test("from the pairing time a full enough session is paired, and closed with its final pairs", async () => {
  const { runRankJobs } = rankServer({});
  const players = [1, 2, 3, 4].map((userId, index) => ({ entryId: userId, userId, displayName: `P${userId}`, rating: 1000 + index * 50, games: 3, status: "paid", paidAt: `2099-02-02 10:0${index}:00` }));
  const make = () => rankConnection((sql) => {
    if (sql.includes("FROM rank_sessions s JOIN rank_rooms r")) return [[{ id: 3, matchedAt: null, matchMinutes: 60, closeMinutes: 10, minPlayers: 4, startsAt: "2099-02-02 18:00:00" }]];
    if (sql.includes("FROM rank_sessions WHERE id = ?")) return [[{ id: 3, roomId: 4, startsAt: "2099-02-02 18:00:00", endsAt: "2099-02-02 20:00:00", status: "open", courtBlockId: 81, matchedAt: null, pairing: null }]];
    if (sql.includes("FROM rank_rooms r")) return [[room]];
    if (sql.includes("JOIN users u ON u.id = e.user_id")) return [players];
    return undefined;
  });
  const early = make();
  await runRankJobs(early, Date.parse("2099-02-02T17:05:00+07:00"));
  const paired = early.statements.find(([sql]) => sql.startsWith("UPDATE rank_sessions SET pairing = ?"));
  assert.doesNotMatch(paired[0], /status = 'closed'/, "still open for players until 17:50");
  assert.equal(JSON.parse(paired[1][0]).teams.length, 2);
  const closing = make();
  await runRankJobs(closing, Date.parse("2099-02-02T17:51:00+07:00"));
  assert.match(closing.statements.find(([sql]) => sql.startsWith("UPDATE rank_sessions SET pairing = ?"))[0], /status = 'closed'/);
});

test("recording a game moves every player's rating and keeps the change for undo", async () => {
  const { recordRankGame } = rankServer({});
  const conn = rankConnection((sql) => {
    if (sql.includes("FROM rank_sessions WHERE id = ?")) return [[{ id: 3, roomId: 4, startsAt: "2099-02-02 18:00:00", endsAt: "2099-02-02 20:00:00", status: "closed", courtBlockId: 81, matchedAt: "x", pairing: null }]];
    if (sql.includes("FROM rank_rooms r")) return [[room]];
    if (sql.includes("JOIN users u ON u.id = e.user_id")) return [[1, 2, 3, 4].map((userId) => ({ entryId: userId, userId, displayName: `P${userId}`, rating: 1000, games: 20, status: "paid", paidAt: "x" }))];
    if (sql.includes("FROM player_ratings WHERE sport_id = ?")) return [[1, 2, 3, 4].map((userId) => ({ userId, rating: 1000, games: 20 }))];
    return undefined;
  });
  const changes = await recordRankGame(conn, { sessionId: 3, teamA: [1, 2], teamB: [3, 4], winner: "b", staffId: 7 });
  assert.deepEqual(changes, { 1: -16, 2: -16, 3: 16, 4: 16 });
  const update = conn.statements.filter(([sql]) => sql.startsWith("UPDATE player_ratings"));
  assert.equal(update.length, 4);
  assert.deepEqual(update[2][1], [16, 1, 0, 3, 3], "rating +16, a win for player 3");
  const game = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO rank_games"));
  assert.equal(game[1][3], "b");
  assert.deepEqual(JSON.parse(game[1][6]), { 1: -16, 2: -16, 3: 16, 4: 16 });
  await assert.rejects(recordRankGame(conn, { sessionId: 3, teamA: [1, 9], teamB: [3, 4], winner: "a", staffId: 7 }), /ชำระเงินแล้ว/, "only paid players of the session");
});

// ---------- Classes: HYROX, Airfit, Pilates ----------

const hyroxClass = { id: 31, slug: "hyrox-class", title: "HYROX Class", icon: "🔥", price: 0, metadata: JSON.stringify({ service: "hyrox", tab: "class", kind: "coupon", sport: "gym", times: ["09:00", "18:30"], minutes: 60, capacity: 12, couponCategories: ["hyrox-class", "hyrox"] }) };
const series = { id: 21, slug: "hyrox-series-8w", title: "HYROX Series 8 สัปดาห์", icon: "🔥", price: 6500, metadata: JSON.stringify({ service: "hyrox", tab: "series", kind: "series", sport: "gym", weeks: 8, simulations: 2, times: ["08:00", "09:00"], minutes: 60, capacity: 2 }) };

test("class programs are validated and give their times, instructors and coupon packs", () => {
  const { parseProgram, programProblem, classRange, instructorAt, packsForProgram } = load("lib/class-programs.ts");
  const program = parseProgram(hyroxClass);
  assert.equal(program.capacity, 12);
  assert.deepEqual(classRange(program, "2099-02-02", "18:30"), { startsAt: "2099-02-02 18:30:00", endsAt: "2099-02-02 19:30:00", endTime: "19:30" });
  assert.equal(classRange(program, "2099-02-02", "10:00"), null);
  assert.equal(programProblem(hyroxClass), null);
  assert.match(programProblem({ ...hyroxClass, metadata: JSON.stringify({ service: "hyrox", kind: "coupon", times: ["09:00"], capacity: 12 }) }), /couponCategories/);
  assert.match(programProblem({ ...series, price: 0 }), /ราคา/);
  const airfit = parseProgram({ id: 1, slug: "airfit-group", title: "Airfit", price: 0, metadata: JSON.stringify({ service: "airfit", kind: "coupon", times: ["08:00", "12:00", "16:00"], capacity: 12, couponCategories: ["airfit-group"], instructors: [{ name: "A", from: "08:00", to: "12:00" }, { name: "B", from: "12:00", to: "16:00" }, { name: "C", from: "16:00", to: "21:00" }] }) });
  assert.deepEqual(["08:00", "12:00", "16:00"].map((time) => instructorAt(airfit, time).name), ["A", "B", "C"]);
  const packs = packsForProgram(program, [{ id: 2, sortOrder: 2, metadata: '{"program":"hyrox-class"}' }, { id: 1, sortOrder: 1, metadata: '{"program":"hyrox-class"}' }, { id: 3, metadata: '{"program":"other"}' }, { id: 4, metadata: '{"program":"hyrox-class","grantOnly":true}' }]);
  assert.deepEqual(packs.map((coupon) => coupon.id), [1, 2]);
});

function classConnection({ taken = 0, coupon = { id: 77, remainingUses: 3, name: "HYROX Class 10 ครั้ง" }, program = hyroxClass, mine = [] } = {}) {
  return rankConnection((sql) => {
    if (sql.includes("FROM app_content_items WHERE id = ?")) return [[program]];
    if (sql.includes("FROM sports WHERE slug")) return [[{ id: 1 }]];
    if (sql.includes("SELECT id FROM bookings WHERE user_id = ? AND class_key")) return [mine];
    if (sql.includes("COUNT(*) taken")) return [[{ taken }]];
    if (sql.includes("FROM user_coupons uc")) return [coupon ? [coupon] : []];
    if (sql.includes("SELECT booking_no, title")) return [[{ booking_no: "BKTEST", status: "paid" }]];
    return undefined;
  });
}

test("a coupon class is booked with one coupon use and confirmed at once", async () => {
  const { reserveClass } = load("lib/class-booking.ts", { "@/lib/db": { createPublicId: (prefix) => `${prefix}TEST` } });
  const conn = classConnection();
  const now = Date.parse("2099-02-01T10:00:00+07:00");
  const result = await reserveClass(conn, { userId: 9, programId: 31, date: "2099-02-02", time: "18:30", now });
  assert.equal(result.paid, true);
  assert.deepEqual(result.coupon, { name: "HYROX Class 10 ครั้ง", remaining: 2 });
  assert.match(conn.statements[0][0], /FROM app_content_items WHERE id = \? AND content_type = 'class_program' AND active = TRUE LIMIT 1 FOR UPDATE/, "the program row serializes bookings of its places");
  const couponRead = conn.statements.find(([sql]) => sql.includes("FROM user_coupons uc"));
  assert.match(couponRead[0], /c\.category IN \(\?, \?\).*FOR UPDATE/);
  assert.ok(conn.statements.some(([sql, params]) => sql.startsWith("UPDATE user_coupons SET remaining_uses = remaining_uses - 1") && params[0] === 77));
  const booking = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.match(booking[0], /'paid'/);
  assert.deepEqual(booking[1].slice(3, 5), ["hyrox-class", 77]);
});

test("class booking refusals: no coupon, a full class, the same member twice, a past time", async () => {
  const { reserveClass, ClassBookingError } = load("lib/class-booking.ts", { "@/lib/db": { createPublicId: (prefix) => `${prefix}TEST` } });
  const now = Date.parse("2099-02-01T10:00:00+07:00");
  const input = { userId: 9, programId: 31, date: "2099-02-02", time: "18:30", now };
  await assert.rejects(reserveClass(classConnection({ coupon: null }), input), (error) => error instanceof ClassBookingError && error.code === "COUPON_REQUIRED");
  await assert.rejects(reserveClass(classConnection({ taken: 12 }), input), (error) => error.code === "FULL");
  await assert.rejects(reserveClass(classConnection({ mine: [{ id: 1 }] }), input), (error) => error.code === "ALREADY_BOOKED");
  await assert.rejects(reserveClass(classConnection(), { ...input, now: Date.parse("2099-02-02T19:00:00+07:00") }), /ผ่านไปแล้ว/);
});

test("a HYROX Series is held for payment with its terms, and paying it grants the program and Simulation credits", async () => {
  const { reserveClass } = load("lib/class-booking.ts", { "@/lib/db": { createPublicId: (prefix) => `${prefix}TEST` } });
  const conn = classConnection({ program: series });
  const result = await reserveClass(conn, { userId: 9, programId: 21, date: "2099-02-02", time: "09:00", now: Date.parse("2099-02-01T10:00:00+07:00") });
  assert.equal(result.paid, false);
  const booking = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.match(booking[0], /'pending_payment'/);
  assert.equal(booking[1][7], 6500);
  assert.deepEqual(JSON.parse(booking[1].at(-1)).series, { programId: 21, slug: "hyrox-series-8w", title: "HYROX Series 8 สัปดาห์", weeks: 8, simulations: 2 });

  const notices = [];
  const { afterBookingPaid } = load("lib/booking-paid.ts", { "@/lib/notify": { notifyMember: async (_conn, userId, title) => { notices.push({ userId, title }); } } });
  const paid = rankConnection((sql) => {
    if (sql.includes("FROM bookings WHERE id = ?")) return [[{ id: 55, userId: 9, sportId: 1, courtId: null, title: "HYROX Series", startsAt: "2099-02-02 09:00:00", metadata: booking[1].at(-1), guestName: null }]];
    if (sql.includes("FROM payments WHERE booking_id")) return [[{ id: 600 }]];
    if (sql.includes("FROM coupons WHERE code = 'HYROX-SIM-CREDIT'")) return [[{ id: 90 }]];
    return undefined;
  });
  await afterBookingPaid(paid, 55);
  const entitlement = paid.statements.find(([sql]) => sql.startsWith("INSERT INTO user_entitlements"));
  assert.match(entitlement[0], /'class_series'/);
  assert.equal(entitlement[1][5], 56, "8 weeks");
  const credits = paid.statements.find(([sql]) => sql.startsWith("INSERT INTO user_coupons"));
  assert.deepEqual(credits[1].slice(0, 5), [9, 90, 2, 600, 2], "two Simulation credits on the series payment");
  assert.equal(notices[0].title, "เริ่มโปรแกรม HYROX Series");
});

test("a court paid by a group owner tells the group's other members", async () => {
  const notices = [];
  const { afterBookingPaid } = load("lib/booking-paid.ts", { "@/lib/notify": { notifyMember: async (_conn, userId, title) => { notices.push({ userId, title }); } } });
  const conn = rankConnection((sql) => {
    if (sql.includes("FROM bookings WHERE id = ?")) return [[{ id: 56, userId: 9, sportId: 3, courtId: 17, title: "แบดมินตัน · สนาม 7", startsAt: "2099-02-02 19:00:00", metadata: null, guestName: null }]];
    if (sql.includes("FROM groups_clubs WHERE owner_user_id")) return [[{ id: 4, name: "ก๊วนเย็นวันจันทร์" }]];
    if (sql.includes("FROM group_members WHERE group_id")) return [[{ userId: 11 }, { userId: 12 }]];
    return undefined;
  });
  await afterBookingPaid(conn, 56);
  assert.deepEqual(notices.map((notice) => notice.userId), [11, 12]);
  assert.equal(notices[0].title, "ก๊วนนัดเล่นแล้ว");
  assert.match(conn.statements.find(([sql]) => sql.startsWith("UPDATE groups_clubs SET play_at"))[0], /play_at IS NULL OR play_at < NOW\(\)/, "a later planned game is not overwritten");
});

test("cancelling a class booked with a coupon gives the use back", async () => {
  const { restoreClassCoupon } = load("lib/class-booking.ts", { "@/lib/db": { createPublicId: () => "x" } });
  const conn = rankConnection(() => undefined);
  await restoreClassCoupon(conn, 77, 9);
  assert.match(conn.statements[0][0], /remaining_uses = remaining_uses \+ 1, status = 'active' WHERE id = \? AND user_id = \? AND expires_at > NOW\(\)/);
  assert.match(conn.statements[0][0], /remaining_uses < total_uses/, "never more than bought");
});

test("trial packs are sold once per member and grant-only credits are never sold", async () => {
  const route = (couponRow, owned) => load("app/api/coupons/buy/route.ts", {
    "@/lib/auth": { assertApiUser: async () => ({ id: 9 }) },
    "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", parseJsonBody: async () => ({ couponId: 5, method: "wallet" }) },
    "@/lib/db": { createPublicId: (prefix) => `${prefix}TEST`, pool: { getConnection: async () => rankConnection((sql) => {
      if (sql.includes("FROM coupons WHERE id = ?")) return [[couponRow]];
      if (sql.includes("FROM user_coupons WHERE user_id = ? AND coupon_id = ?")) return [owned];
      if (sql.includes("FROM payments WHERE user_id = ? AND request_id")) return [[]];
      return undefined;
    }) } },
  });
  const trial = { id: 5, price: 690, totalUses: 1, validityDays: 30, name: "HYROX Class ทดลองเล่น", metadata: '{"program":"hyrox-class","oncePerMember":true}' };
  const again = await route(trial, [{ id: 1 }]).POST(new Request("http://localhost/api/coupons/buy", { method: "POST" }));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).message, "แพ็กเกจทดลองนี้ซื้อได้คนละ 1 ครั้ง");
  const credit = await route({ ...trial, metadata: '{"grantOnly":true}' }, []).POST(new Request("http://localhost/api/coupons/buy", { method: "POST" }));
  assert.equal(credit.status, 404);
});

// ---------- Big Screen, member levels, group Coins ----------

test("Big Screen guide: today keeps what is on now, tomorrow its own day, finished programs drop off", () => {
  const { programsForDay, isLiveNow, clockText } = load("lib/screen-programs.ts");
  const now = Date.parse("2026-11-14T20:30:00+07:00");
  const programs = [
    { id: 1, startsAt: "2026-11-14 20:00:00", endsAt: "2026-11-14 22:00:00" },
    { id: 2, startsAt: "2026-11-14 18:00:00", endsAt: "2026-11-14 19:00:00" },
    { id: 3, startsAt: "2026-11-14 22:30:00", endsAt: "2026-11-15 00:30:00" },
    { id: 4, startsAt: "2026-11-15 14:00:00", endsAt: "2026-11-15 16:00:00" },
    { id: 5, startsAt: "2026-11-13 23:30:00", endsAt: "2026-11-14 21:00:00" },
  ];
  assert.deepEqual(programsForDay(programs, "today", now).map((program) => program.id), [5, 1, 3]);
  assert.deepEqual(programsForDay(programs, "tomorrow", now).map((program) => program.id), [4]);
  assert.equal(isLiveNow(programs[0], now), true);
  assert.equal(isLiveNow(programs[2], now), false);
  assert.equal(clockText("2026-11-14 22:30:00"), "22:30");
});

test("member levels: Visit, Gold, Platinum, Wisdom from 12-month spending, with the way to the next", () => {
  const { memberTierFor, memberTierSettings, memberTiersProblem } = load("lib/member-tier.ts");
  assert.equal(memberTierFor(0).name, "Visit");
  const gold = memberTierFor(30000);
  assert.equal(gold.name, "Gold");
  assert.deepEqual(gold.next, { name: "Platinum", min: 60000, remaining: 30000 });
  assert.equal(gold.progress, 25);
  assert.equal(memberTierFor(200000).next, null);
  const custom = memberTierSettings('{"tiers":[{"name":"Visit","min":0,"benefits":["A"]},{"name":"Gold","min":5000}]}');
  assert.equal(memberTierFor(6000, custom).name, "Gold");
  assert.deepEqual(custom[0].benefits, ["A"]);
  assert.match(memberTiersProblem({ tiers: [{ name: "Visit" }] }), /min/);
});

test("group Coins: the busiest group of each sport, and three days in a row, paid once", async () => {
  const { topGroups, awardGroupCoins } = load("lib/group-awards.ts", { "@/lib/notify": { notifyMember: async () => {} } });
  assert.deepEqual(topGroups([
    { id: 1, sportId: 3, members: 4, createdAt: "2026-01-02" },
    { id: 2, sportId: 3, members: 6, createdAt: "2026-01-03" },
    { id: 3, sportId: 5, members: 2, createdAt: "2026-01-01" },
    { id: 4, sportId: 5, members: 2, createdAt: "2025-12-01" },
  ]).sort(), [2, 4]);
  let awarded = 0;
  const conn = rankConnection((sql) => {
    if (sql.includes("FROM groups_clubs g WHERE g.status = 'active'")) return [[{ id: 2, sportId: 3, ownerUserId: 9, name: "ก๊วน", createdAt: "2026-01-03", members: 3, day1: 1, day2: 1 }]];
    if (sql.startsWith("INSERT IGNORE INTO group_awards")) return [{ affectedRows: awarded++ === 0 ? 1 : 1 }];
    if (sql.includes("FROM group_members WHERE group_id")) return [[{ userId: 9 }, { userId: 10 }, { userId: 11 }]];
    if (sql.includes("FROM group_awards WHERE kind = 'streak_3'")) return [[]];
    return undefined;
  });
  const notices = await awardGroupCoins(conn, "2026-11-13");
  // PPA app analysis V2, item 2: the Coins are received at the counter ("🎁 รับ Coin" shows a QR), so the
  // job writes a one-use claim per member and credits nothing itself.
  assert.equal(conn.statements.some(([sql]) => sql.startsWith("UPDATE wallet_accounts")), false, "nothing is credited before staff scan the claim");
  const claims = conn.statements.filter(([sql]) => sql.startsWith("INSERT INTO user_entitlements"));
  assert.ok(claims.every(([sql]) => /'group_coin', \?, 1, DATE_ADD\(NOW\(\), INTERVAL 30 DAY\)/.test(sql)), "one use, 30 days");
  assert.deepEqual(claims.map(([, params]) => { const meta = JSON.parse(params[2]); return [params[0], meta.coins, meta.kind, meta.role, meta.groupId, meta.awardDate]; }), [
    [9, 2, "top_of_day", "owner", 2, "2026-11-13"], [10, 1, "top_of_day", "member", 2, "2026-11-13"], [11, 1, "top_of_day", "member", 2, "2026-11-13"],
    [9, 3, "streak_3", "owner", 2, "2026-11-13"], [10, 2, "streak_3", "member", 2, "2026-11-13"], [11, 2, "streak_3", "member", 2, "2026-11-13"],
  ], "owner 2 / members 1, then owner 3 / members 2");
  assert.equal(notices.length, 6);
  assert.match(notices[0].body, /เคาน์เตอร์/, "the member is told where to collect the Coins");
  const played = conn.statements.find(([sql]) => sql.includes("FROM groups_clubs g WHERE g.status = 'active'"));
  assert.deepEqual(played[1], ["2026-11-12 00:00:00", "2026-11-13 00:00:00", "2026-11-11 00:00:00", "2026-11-12 00:00:00", "2026-11-13 00:00:00", "2026-11-14 00:00:00"]);
});

// ---------- Schema, permissions, i18n ----------

test("schema: new tables, one-time court changes behind markers and insert-only seeds at the design's prices", () => {
  for (const table of ["screen_programs", "rank_rooms", "rank_sessions", "rank_entries", "rank_games", "player_ratings", "group_awards"]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`), table);
  for (const column of ["sports ADD COLUMN IF NOT EXISTS night_rate", "sports ADD COLUMN IF NOT EXISTS night_from TINYINT UNSIGNED NOT NULL DEFAULT 16", "sports ADD COLUMN IF NOT EXISTS close_hour TINYINT UNSIGNED NOT NULL DEFAULT 21", "courts ADD COLUMN IF NOT EXISTS shared_space", "courts ADD COLUMN IF NOT EXISTS court_kind", "bookings ADD COLUMN IF NOT EXISTS class_key", "bookings ADD COLUMN IF NOT EXISTS user_coupon_id", "bookings ADD COLUMN IF NOT EXISTS metadata JSON NULL"]) {
    assert.ok(schema.includes(`ALTER TABLE ${column}`), column);
  }
  const courtsSeed = statements.find((statement) => statement.includes("CONCAT('สนาม ', n.n)"));
  assert.match(courtsSeed, /NOT EXISTS \(SELECT 1 FROM schema_markers WHERE name = 'seed-courts'\)/, "renamed courts are never re-created");
  assert.ok(schema.indexOf("CREATE TABLE IF NOT EXISTS schema_markers") < schema.indexOf("CONCAT('สนาม ', n.n)"));
  for (const marker of ["court-day-night-v1", "shared-indoor-court-v1"]) {
    const uses = statements.filter((statement) => statement.includes(`'${marker}'`));
    assert.ok(uses.length >= 2, marker);
    assert.ok(uses.slice(0, -1).every((statement) => statement.includes(`NOT EXISTS (SELECT 1 FROM schema_markers WHERE name = '${marker}')`)), `${marker} guarded`);
    assert.match(uses.at(-1), new RegExp(`^INSERT IGNORE INTO schema_markers \\(name\\) VALUES \\('${marker}'\\)`));
  }
  const fullCourt = statements.find((statement) => statement.includes("'อินดอร์ Full Court', c.zone"));
  assert.match(fullCourt, /c\.hourly_rate IS NULL AND c\.shared_space IS NULL/, "only courts still carrying their seeded values change");
  for (const [code, price, uses, days] of [["HYROX-CLASS-1", 590, 1, 30], ["HYROX-CLASS-TRIAL", 690, 1, 30], ["HYROX-CLASS-10", 4900, 10, 60], ["HYROX-CLASS-20", 8800, 20, 120], ["HYROX-CLASS-30", 11700, 30, 180], ["AIRFIT-P1-1", 1190, 1, 30], ["AIRFIT-P1-TRIAL", 1590, 2, 30], ["AIRFIT-P1-10", 10900, 10, 90], ["AIRFIT-GROUP-50", 22000, 50, 365], ["PILATES-PA-TRIAL", 990, 1, 30], ["PILATES-PA-30", 26700, 30, 270]]) {
    assert.match(schema, new RegExp(`\\('${code}', '[^']+', '[a-z0-9-]+', ${price}, ${uses}, ${days}, TRUE`), code);
  }
  for (const [slug, price] of [["hyrox-simulation", 1300], ["hyrox-series-4w", 3500], ["hyrox-series-8w", 6500], ["hyrox-series-12w", 9000]]) assert.match(schema, new RegExp(`'class_program', '${slug}', [^\\n]*, ${price}, '\\{`), slug);
  for (const marker of ["'HYROX-CLASS-1'", "'hyrox-simulation'", "'badminton-beginner'", "'skill-rating'"]) {
    assert.match(statements.find((statement) => statement.includes(marker)), /^INSERT IGNORE INTO/, `${marker} keeps admin edits`);
  }
  assert.match(schema, /'badminton-beginner' slug, 'มือใหม่' title, 'มือใหม่' level_name, '🌱' icon, 'buffet' kind, 2 team_size, 'สนาม 7' court, 100 price, 16 capacity, 4 min_players, '18:00-20:00,20:00-22:00' slots/, "มือใหม่ on court 7, 100 ฿, 16 places, at least 4");
  assert.match(schema, /'basketball-open-run-3x3', 'Open Run 3x3', NULL, '🏀', 'open_run', 3, 'เอาท์ดอร์ 3x3', 70, 18, 15/);
});

test("new back-office sections and resources are permission-gated", () => {
  const { requiredPermissions, canAccessSection } = load("lib/admin-permissions.ts");
  assert.deepEqual(requiredPermissions("rank", "POST"), ["bookings.manage"]);
  assert.deepEqual(requiredPermissions("screen-programs", "PUT"), ["content.manage"]);
  assert.deepEqual(requiredPermissions("sports", "PUT"), ["bookings.manage"]);
  assert.equal(canAccessSection("rank", (code) => code === "bookings.manage"), true);
  assert.equal(canAccessSection("bigscreen", (code) => code === "bookings.manage"), false);
  assert.equal(canAccessSection("bigscreen", (code) => code === "content.manage"), true);
});

test("the scheduled job pairs and closes Buffet Rank sessions and pays yesterday's group Coins", () => {
  const cron = readFileSync("app/api/cron/run/route.ts", "utf8");
  assert.match(cron, /runJob\(\(conn\) => runRankJobs\(conn\)\)/);
  assert.match(cron, /awardGroupCoins\(conn, previousDay\(bangkokToday\(\)\)\)/);
});

test("every Buffet Rank, class and group notice title has app translations", () => {
  const { allMessages } = load("lib/i18n/index.ts");
  const keys = new Set(allMessages.map(([key]) => key));
  const titles = new Set();
  for (const file of ["lib/rank-server.ts", "lib/booking-paid.ts", "lib/group-awards.ts"]) {
    for (const match of readFileSync(file, "utf8").matchAll(/title: (?:closing \? )?"([^"]+)"(?: : "([^"]+)")?/g)) {
      titles.add(match[1]);
      if (match[2]) titles.add(match[2]);
    }
  }
  assert.ok(titles.size >= 6, [...titles].join(", "));
  assert.deepEqual([...titles].filter((title) => !keys.has(title)), []);
  for (const file of ["lib/rank-server.ts", "lib/class-booking.ts"]) {
    for (const match of readFileSync(file, "utf8").matchAll(/new (?:RankError|ClassBookingError)\("([^"]+)"/g)) assert.ok(keys.has(match[1]), `${file}: ${match[1]}`);
  }
});

test("the member app has no court screen fetch of its own any more: the sport page loads the week", () => {
  const app = readFileSync("components/ppa-app.tsx", "utf8");
  assert.match(app, /<SportScreen/);
  assert.match(app, /<BigScreenScreen/);
  assert.match(app, /<ClassServiceScreen/);
  assert.match(app, /<MemberStatusScreen/);
  assert.match(app, /<TransactionHistoryScreen/);
  assert.doesNotMatch(app, /\["courts", "datetime", "summary"\]\.includes\(screen\)/);
  const { NextRequest } = require("next/server");
  assert.ok(NextRequest);
});
