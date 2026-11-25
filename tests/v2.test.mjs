import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load, require } from "./load-ts.mjs";

// PPA app analysis V2 (items 1–5 and the brand colours): what the LINE app must do like the PPA app.

const schema = readFileSync("database/schema.sql", "utf8");
const render = (element) => require("react-dom/server").renderToStaticMarkup(element);
const h = (...args) => require("react").createElement(...args);
// Member screens import "@/lib/i18n" (a folder): give them the real catalog (Thai, the server language).
const i18n = load("lib/i18n/index.ts");
const ui = (file, mocks = {}) => load(file, { "@/lib/i18n": i18n, ...mocks });

function connection(rows = [], writes = []) {
  let committed = false;
  let rolledBack = false;
  return {
    writes,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => { rolledBack = true; }, release: () => {},
    execute: async (sql, params = []) => {
      writes.push([sql, params]);
      for (const [needle, value] of rows) if (sql.includes(needle)) return typeof value === "function" ? value(sql, params) : value;
      if (sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.startsWith("DELETE")) return [{ affectedRows: 1, insertId: 77 }];
      return [[]];
    },
  };
}

const memberRoute = (file, body, { conn, query = async () => [], user = { id: 2, displayName: "พลอย", memberCode: "PPA-AAAA0001" } } = {}) => load(file, {
  "@/lib/auth": { assertApiUser: async () => user, authErrorResponse: () => Response.json({}, { status: 401 }) },
  "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", parseJsonBody: async () => body, validationErrorResponse: () => Response.json({}, { status: 400 }), secureResponse: (response) => response, assertSameOrigin: () => null, readRequestBody: async (request) => Buffer.from(await request.arrayBuffer()) },
  "@/lib/db": { query, pool: { getConnection: async () => conn } },
  "@/lib/notify": { notifyMember: async (c, userId, title, text) => { c.execute("INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)", [userId, title, text]); }, pushAfterResponse: () => {}, pushText: (title, text) => `${title}\n${text}` },
});

// ---------- Schema ----------

test("migration: group photo, guide version and the Pickleball Buffet Rank room, all re-runnable", () => {
  assert.match(schema, /ALTER TABLE groups_clubs ADD COLUMN IF NOT EXISTS photo_url VARCHAR\(255\) NULL/);
  assert.match(schema, /ALTER TABLE users ADD COLUMN IF NOT EXISTS guide_version VARCHAR\(20\) NULL/);
  const rooms = schema.slice(schema.indexOf("INSERT IGNORE INTO rank_rooms"), schema.indexOf("LEFT JOIN courts c ON c.sport_id = s.id AND c.name = r.court;"));
  assert.match(rooms, /'pickleball', 'pickleball-beginner', 'มือใหม่', 'มือใหม่', '🥒', 'buffet', 2, 'สนาม 6', 100, 12, 4, '18:00-20:00,20:00-22:00'/);
  assert.match(rooms, /^INSERT IGNORE INTO rank_rooms/, "insert-only: rooms edited in the back office are kept");
});

// ---------- Item 2: groups ----------

test("member IDs are read with or without PPA-, in any case and with spaces", () => {
  const { normalizeMemberCode } = load("lib/groups.ts", { "@/lib/db": { query: async () => [] } });
  assert.equal(normalizeMemberCode("PPA-B8046257"), "PPA-B8046257");
  assert.equal(normalizeMemberCode(" ppa-b8046257 "), "PPA-B8046257");
  assert.equal(normalizeMemberCode("b8046257"), "PPA-B8046257");
  assert.equal(normalizeMemberCode("PPAB8046257"), "PPA-B8046257");
  assert.equal(normalizeMemberCode("ppa - b804 6257"), "PPA-B8046257");
  for (const wrong of ["", "1234", "hello world", "PPA-", "'; DROP TABLE users; --"]) assert.equal(normalizeMemberCode(wrong), null, wrong);
});

test("creating a group adds the members found by ID, tells them, and refuses unknown IDs", async () => {
  const create = (body, found) => {
    const conn = connection([["INSERT INTO groups_clubs", [{ insertId: 55 }]]]);
    const route = memberRoute("app/api/groups/route.ts", body, { conn, query: async (sql) => (sql.includes("FROM sports") ? [{ id: 3, name: "แบดมินตัน" }] : sql.includes("FROM users u") ? found : []) });
    return { conn, response: route.POST(new Request("http://localhost/api/groups", { method: "POST" })) };
  };
  const ok = create({ sportSlug: "badminton", name: "ก๊วนพี่น้องแบด", levelName: "พอตัว", description: "ตีทุกอังคาร", memberCodes: ["b0000001", "PPA-B0000002", "ppa-aaaa0001"] }, [{ id: 11, memberCode: "PPA-B0000001", displayName: "ตูน" }, { id: 12, memberCode: "PPA-B0000002", displayName: "แนน" }]);
  const response = await ok.response;
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, groupId: 55, added: 2 });
  const [groupSql, groupParams] = ok.conn.writes.find(([sql]) => sql.startsWith("INSERT INTO groups_clubs"));
  assert.match(groupSql, /description/);
  assert.deepEqual(groupParams, [2, 3, "ก๊วนพี่น้องแบด", "พอตัว", 30, null, "ตีทุกอังคาร"], "a standing group: no play time, room for 30");
  assert.deepEqual(ok.conn.writes.filter(([sql]) => sql.includes("INTO group_members")).map(([, params]) => params), [[55, 2], [55, 11], [55, 12]], "owner first, then the invited members");
  assert.deepEqual(ok.conn.writes.filter(([sql]) => sql.startsWith("INSERT INTO notifications")).map(([, params]) => [params[0], params[1]]), [[11, "คุณถูกเพิ่มเข้าก๊วน"], [12, "คุณถูกเพิ่มเข้าก๊วน"]]);
  assert.equal(ok.conn.committed, true);

  const unknown = create({ sportSlug: "badminton", name: "ก๊วน", levelName: "มือใหม่", memberCodes: ["B0000001", "B0000009"] }, [{ id: 11, memberCode: "PPA-B0000001", displayName: "ตูน" }]);
  const refused = await unknown.response;
  assert.equal(refused.status, 404);
  assert.deepEqual((await refused.json()).codes, ["PPA-B0000009"]);
  assert.equal(unknown.conn.writes.length, 0, "nothing is created when an ID is wrong");

  const invalid = create({ sportSlug: "badminton", name: "ก๊วน", levelName: "มือใหม่", memberCodes: ["not an id"] }, []);
  assert.equal((await invalid.response).status, 400);
});

test("member lookup by ID: never the member themself, the walk-in account or suspended accounts", async () => {
  const seen = [];
  const lookup = (rows) => memberRoute("app/api/members/lookup/route.ts", null, { query: async (sql, params) => { seen.push([sql, params]); return rows; } });
  const get = (route, code) => route.GET(new Request(`http://localhost/api/members/lookup?code=${encodeURIComponent(code)}`));
  assert.equal((await get(lookup([]), "hello")).status, 400);
  assert.equal((await get(lookup([]), "B0000009")).status, 404);
  assert.equal((await get(lookup([{ id: 2, memberCode: "PPA-AAAA0001", displayName: "พลอย" }]), "aaaa0001")).status, 409, "your own ID");
  const found = await get(lookup([{ id: 11, memberCode: "PPA-B0000001", displayName: "ตูน", avatar: "🏸", avatarTier: "พอตัว" }]), "ppa-b0000001");
  assert.equal(found.status, 200);
  assert.deepEqual((await found.json()).member, { memberCode: "PPA-B0000001", displayName: "ตูน", avatar: "🏸", level: "พอตัว" });
  const [sql, params] = seen.at(-1);
  assert.match(sql, /u\.status = 'active' AND u\.line_user_id <> 'system:walk-in'/);
  assert.deepEqual(params, ["PPA-B0000001"]);
});

test("only the owner adds or removes group members, within the group's places, under the group row lock", async () => {
  const add = (group, members, found = [{ id: 11, memberCode: "PPA-B0000001", displayName: "ตูน" }]) => {
    const conn = connection([["FROM groups_clubs", [group ? [group] : []]], ["FROM users u", [found]], ["FROM group_members", [members]]]);
    return { conn, response: memberRoute("app/api/groups/members/route.ts", { groupId: 5, code: "b0000001" }, { conn }).POST(new Request("http://localhost/api/groups/members", { method: "POST" })) };
  };
  const notOwner = add({ id: 5, ownerUserId: 9, maxPlayers: 30, name: "ก๊วน" }, [{ userId: 9 }]);
  assert.equal((await notOwner.response).status, 403);
  const owner = add({ id: 5, ownerUserId: 2, maxPlayers: 30, name: "ก๊วน" }, [{ userId: 2 }]);
  assert.equal((await owner.response).status, 201);
  assert.match(owner.conn.writes[0][0], /FROM groups_clubs WHERE id = \? AND status = 'active' FOR UPDATE/);
  assert.deepEqual(owner.conn.writes.find(([sql]) => sql.startsWith("INSERT INTO group_members"))[1], [5, 11]);
  const full = add({ id: 5, ownerUserId: 2, maxPlayers: 2, name: "ก๊วน" }, [{ userId: 2 }, { userId: 3 }]);
  assert.equal((await full.response).status, 409);
  const again = add({ id: 5, ownerUserId: 2, maxPlayers: 30, name: "ก๊วน" }, [{ userId: 2 }, { userId: 11 }]);
  const repeat = await again.response;
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).added, false);
  const missing = add({ id: 5, ownerUserId: 2, maxPlayers: 30, name: "ก๊วน" }, [{ userId: 2 }], []);
  assert.equal((await missing.response).status, 404);

  const remove = (body, group) => {
    const conn = connection([["FROM groups_clubs", [[group]]]]);
    return { conn, response: memberRoute("app/api/groups/members/route.ts", body, { conn }).DELETE(new Request("http://localhost/api/groups/members", { method: "DELETE" })) };
  };
  assert.equal((await remove({ groupId: 5, userId: 2 }, { id: 5, ownerUserId: 2 }).response).status, 409, "the owner closes the group instead");
  const removed = remove({ groupId: 5, userId: 11 }, { id: 5, ownerUserId: 2, name: "ก๊วน" });
  assert.equal((await removed.response).status, 200);
  assert.deepEqual(removed.conn.writes.find(([sql]) => sql.startsWith("DELETE FROM group_members"))[1], [5, 11]);
});

test("group photos: owner only, real JPG/PNG/WebP up to 3 MB, saved under a new name, the old one removed", async () => {
  const files = new Map();
  const removed = [];
  const queries = [];
  const route = (owned) => load("app/api/groups/photo/route.ts", {
    "@/lib/auth": { assertApiUser: async () => ({ id: 2 }), authErrorResponse: () => Response.json({}, { status: 401 }) },
    "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", assertSameOrigin: () => null, secureResponse: (response) => response, validationErrorResponse: () => Response.json({}, { status: 400 }), readRequestBody: async (request) => Buffer.from(await request.arrayBuffer()) },
    "@/lib/db": { query: async (sql, params) => { queries.push([sql, params]); return sql.startsWith("SELECT") ? (owned ? [{ id: 5, photoUrl: "/uploads/groups/1-old.jpg" }] : []) : { affectedRows: 1 }; } },
    "@/lib/image-upload": { ...load("lib/image-upload.ts"), saveUploadedImage: async (folder, bytes) => { const url = `/uploads/${folder}/2-new.jpg`; files.set(url, bytes); return url; }, removeUploadedImage: async (folder, url) => { removed.push(url); } },
  });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32), Buffer.from([0xff, 0xd9])]);
  const upload = (owned, bytes, type = "image/jpeg") => {
    const form = new FormData();
    form.set("groupId", "5");
    form.set("file", new File([bytes], "photo.jpg", { type }));
    return route(owned).POST(new Request("http://localhost/api/groups/photo", { method: "POST", body: form }));
  };
  assert.equal((await upload(false, jpeg)).status, 403, "not the owner");
  assert.equal(files.size, 0);
  assert.equal((await upload(true, Buffer.from("<svg onload=alert(1)>"), "image/jpeg")).status, 415, "the bytes must be a real image");
  assert.equal((await upload(true, jpeg, "image/svg+xml")).status, 415);
  const saved = await upload(true, jpeg);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { photoUrl: "/uploads/groups/2-new.jpg" });
  assert.deepEqual(queries.find(([sql]) => sql.startsWith("UPDATE groups_clubs SET photo_url"))[1], ["/uploads/groups/2-new.jpg", 5, 2]);
  assert.deepEqual(removed, ["/uploads/groups/1-old.jpg"]);
  const { groupPhotoPattern } = load("lib/groups.ts", { "@/lib/db": { query: async () => [] } });
  assert.match("/uploads/groups/1730000000000-0b8e2a4c-1f2d-4c3b-9a8e-7d6c5b4a3f21.jpg", groupPhotoPattern);
  assert.doesNotMatch("/uploads/groups/../../.env", groupPhotoPattern);
});

test("today's group ranking: groups whose owner booked a court of the sport today, most members first, top three", async () => {
  const seen = [];
  const { loadGroupRanking } = load("lib/group-server.ts", {
    "@/lib/db": { query: async (sql, params) => {
      seen.push([sql, params]);
      if (sql.includes("FROM sports")) return [{ id: 3, slug: "badminton", name: "แบดมินตัน", icon: "🏸" }];
      if (sql.includes("FROM groups_clubs g")) return [{ id: 1, name: "ก๊วนพี่น้องแบด", levelName: "พอตัว", photoUrl: null, createdAt: "2026-01-01", members: 8, mine: 1 }, { id: 2, name: "ก๊วนไฟลุก", levelName: "แข่งขัน", photoUrl: "/uploads/groups/a.jpg", createdAt: "2026-01-02", members: 6, mine: 0 }];
      if (sql.includes("entitlement_type = 'group_coin'")) return [{ id: 40, title: "🎁 2 Coin", endsAt: "2026-12-18 10:00:00", metadata: '{"coins":2,"kind":"top_of_day","groupId":1,"groupName":"ก๊วนพี่น้องแบด","awardDate":"2026-11-18","role":"owner"}' }];
      return [];
    } },
    "@/lib/rank-server": { loadRatingSettings: async () => ({ tiers: [] }) },
  });
  const result = await loadGroupRanking(2, "badminton", Date.parse("2026-11-19T15:00:00+07:00"));
  assert.equal(result.date, "2026-11-19");
  assert.deepEqual(result.ranking.map((row) => [row.place, row.id, row.memberCount, row.mine]), [[1, 1, 8, true], [2, 2, 6, false]]);
  const [sql, params] = seen.find(([text]) => text.includes("FROM groups_clubs g"));
  assert.match(sql, /b\.user_id = g\.owner_user_id AND b\.sport_id = g\.sport_id AND b\.court_id IS NOT NULL AND b\.status IN \('paid','checked_in'\)/);
  assert.match(sql, /ORDER BY members DESC, g\.created_at, g\.id LIMIT 3$/, "the same rule as the day's award: most members, then the group made first");
  assert.deepEqual(params, [2, 3, "2026-11-19 00:00:00", "2026-11-20 00:00:00"]);
  assert.deepEqual(result.claims, [{ entitlementId: 40, title: "🎁 2 Coin", coins: 2, kind: "top_of_day", groupId: 1, groupName: "ก๊วนพี่น้องแบด", awardDate: "2026-11-18", role: "owner", endsAt: "2026-12-18 10:00:00" }]);
});

test("staff scanning a group Coin claim adds the Coins to the member's wallet, once, in the same transaction", async () => {
  const token = "Ab3_x-9QrStUvWxYz0123456789abcdefghijkLMNOP";
  const scan = (type, meta) => {
    const conn = connection([
      ["FROM qr_tokens", [[{ id: 11, userId: 2, purpose: "entitlement", refId: "40", usedAt: null, expired: 0, consumeExpired: 0, displayName: "พลอย", memberCode: "PPA-1" }]]],
      ["SELECT entitlement_type entitlementType", [[{ entitlementType: type, title: "🎁 2 Coin · ก๊วน ก๊วนพี่น้องแบด", metadata: JSON.stringify(meta) }]]],
      ["FROM user_entitlements WHERE id = ? AND user_id = ? AND status = 'active'", [[{ id: 40 }]]],
    ]);
    const route = load("app/api/admin/qr/verify/route.ts", {
      "@/lib/admin-auth": { assertAdminRequest: async () => null, getAdminIdentity: async () => ({ id: 7 }), adminSessionCookieName: () => "session", hasAdminPermission: () => true },
      "@/lib/db": { pool: { getConnection: async () => conn } },
    });
    const { NextRequest } = require("next/server");
    return { conn, response: route.POST(new NextRequest("http://localhost/api/admin/qr/verify", { method: "POST", body: JSON.stringify({ token, consume: true }) })) };
  };
  const claim = scan("group_coin", { coins: 2, groupId: 1, groupName: "ก๊วนพี่น้องแบด" });
  assert.equal((await claim.response).status, 200);
  const writes = claim.conn.writes.map(([sql, params]) => [sql.split(" ").slice(0, 3).join(" "), params]);
  const used = writes.findIndex(([sql]) => sql === "UPDATE user_entitlements SET");
  const credited = writes.findIndex(([sql]) => sql === "UPDATE wallet_accounts SET");
  assert.ok(used >= 0 && credited > used, "the right is used first, then the Coins are added");
  assert.deepEqual(claim.conn.writes[credited][1], [2, 2]);
  assert.deepEqual(claim.conn.writes.find(([sql]) => sql.startsWith("INSERT INTO wallet_ledger"))[1], [2, 2, 1, "รับ Coin ก๊วน ก๊วนพี่น้องแบด"]);
  assert.ok(claim.conn.writes.some(([sql, params]) => sql.startsWith("INSERT INTO notifications") && params[1] === "ได้รับ Coin แล้ว"));
  assert.equal(claim.conn.committed, true);

  const reward = scan("reward", { cost: 50 });
  assert.equal((await reward.response).status, 200);
  assert.equal(reward.conn.writes.some(([sql]) => sql.startsWith("UPDATE wallet_accounts")), false, "other rights add no Coins");
});

test("the scanner says Group Coins and how many before staff confirm", () => {
  const source = readFileSync("components/admin-qr-scanner.tsx", "utf8");
  assert.match(source, /detail\?\.entitlementType === "group_coin"/);
  assert.match(source, /Coin รางวัลก๊วน/);
  assert.match(readFileSync("app/api/admin/qr/verify/route.ts", "utf8"), /entitlement_type entitlementType, CAST\(JSON_VALUE\(metadata, '\$\.coins'\) AS UNSIGNED\) coins/);
});

test("group pages: create with photo, description, four level buttons and members by ID; no play time or head count", () => {
  const { GroupCreateScreen, SportGroupsPanel, GROUP_RULES, LEVEL_BUTTONS } = ui("components/member-groups.tsx");
  const sport = { id: 3, slug: "badminton", name: "แบดมินตัน", icon: "🏸", description: "", requiresBooking: true, baseRate: 200 };
  const create = render(h(GroupCreateScreen, { sport, me: { displayName: "พลอย", memberCode: "PPA-AAAA0001", level: "พอตัว" }, busy: false, onBack: () => {}, onCreate: async () => true }));
  for (const text of ["สร้างกลุ่มก๊วน", "แตะเพื่อใส่รูปกลุ่ม", "ชื่อกลุ่ม", "คำอธิบายกลุ่ม", "ระดับของกลุ่ม", "สมาชิก (1 คน)", "ผู้จัดก๊วน", "สร้างกลุ่ม"]) assert.ok(create.includes(text), text);
  assert.match(create, /<textarea/);
  assert.match(create, /type="file" accept="image\/jpeg,image\/png,image\/webp/);
  assert.deepEqual(LEVEL_BUTTONS.map(([, icon, label]) => `${icon} ${label}`), ["🌱 มือใหม่", "🏸 หน้าบ้าน", "💪 พอตัว", "🔥 แข่งขัน"]);
  assert.equal((create.match(/aria-pressed=/g) || []).length, 4, "four level buttons, not a dropdown");
  assert.doesNotMatch(create, /datetime-local|<select/, "no play time and no dropdown on the create page");
  assert.match(create, /placeholder="ใส่ ID สมาชิก เช่น PPA-1A2B3C4D"/);

  const groups = [
    { id: 1, name: "ก๊วนพี่น้องแบด", levelName: "พอตัว", sportName: "แบดมินตัน", sportSlug: "badminton", memberCount: 8, maxPlayers: 30, joined: 1, isOwner: 0 },
    { id: 2, name: "ก๊วนไฟลุก", levelName: "แข่งขัน", sportName: "แบดมินตัน", sportSlug: "badminton", memberCount: 6, maxPlayers: 30, joined: 0, isOwner: 0 },
  ];
  const panel = render(h(SportGroupsPanel, { sport, groups, onCreate: () => {}, onRanking: () => {}, onOpen: () => {} }));
  const order = ["สร้างกลุ่มก๊วนแบดมินตัน", "อันดับก๊วนแบดมินตันประจำวัน", "กลุ่มก๊วนแบดมินตันของฉัน", "ก๊วนพี่น้องแบด", "กลุ่มก๊วนแบดมินตันอื่นๆ ในคลับ", "ก๊วนไฟลุก", "กติกากลุ่มก๊วนแบดมินตัน"].map((text) => panel.indexOf(text));
  assert.ok(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1])), `sections in the PPA order: ${order}`);
  assert.equal((panel.match(/<li>/g) || []).length, 5, "the five group rules");
  assert.doesNotMatch(panel, /rank-list group-ranking/, "the ranking has its own page (no '1. Ppa' box)");
  assert.equal(GROUP_RULES.top.owner, 2);
});

// ---------- Item 4: Find Your Game ----------

test("Find Your Game cards say what each session needs, from real places", () => {
  const { gameNeed, feedIsLive, homeGames, sportsByUse } = load("lib/find-your-game.ts");
  const base = { kind: "buffet", teamSize: 2, minPlayers: 4, live: false, joinable: true };
  assert.deepEqual(gameNeed({ ...base, taken: 3, left: 13 }), { text: "ขาดคู่ตีเบิ้ลอีก {{value0}} คน", values: { value0: 1 }, tone: "need" });
  assert.deepEqual(gameNeed({ ...base, taken: 0, left: 16 }), { text: "ขาดอีก {{value0}} คนจะเปิดรอบ", values: { value0: 4 }, tone: "need" });
  assert.deepEqual(gameNeed({ ...base, taken: 8, left: 4 }), { text: "เปิดรับเพิ่มอีก {{value0}} คน", values: { value0: 4 }, tone: "open" });
  assert.deepEqual(gameNeed({ ...base, kind: "open_run", teamSize: 3, minPlayers: 15, taken: 16, left: 2 }), { text: "เหลือ {{value0}} ที่เท่านั้น", values: { value0: 2 }, tone: "need" });
  assert.deepEqual(gameNeed({ ...base, kind: "open_run", teamSize: 3, minPlayers: 15, taken: 5, left: 13 }), { text: "ขาดอีก {{value0}} คนจะเปิดรอบ", values: { value0: 10 }, tone: "need" });
  assert.equal(gameNeed({ ...base, taken: 16, left: 0 }).text, "เต็มแล้ว");
  assert.equal(gameNeed({ ...base, taken: 12, left: 4, live: true, joinable: false }).tone, "live");
  assert.equal(feedIsLive([{ live: false, joinable: true, day: "tomorrow" }]), false);
  assert.equal(feedIsLive([{ live: false, joinable: true, day: "today" }]), true);
  const games = [
    { roomId: 1, live: false, joinable: true, day: "tomorrow", startsAt: "2026-11-20 18:00:00", left: 3 },
    { roomId: 2, live: false, joinable: true, day: "today", startsAt: "2026-11-19 20:00:00", left: 3 },
    { roomId: 3, live: true, joinable: false, day: "today", startsAt: "2026-11-19 18:00:00", left: 0 },
    { roomId: 4, live: false, joinable: false, day: "today", startsAt: "2026-11-19 18:00:00", left: 0 },
  ];
  assert.deepEqual(homeGames(games).map((game) => game.roomId), [3, 2, 1], "playing now, then today, then tomorrow; closed ones drop off");
  const sports = [{ slug: "badminton" }, { slug: "tennis" }, { slug: "pickleball" }];
  assert.deepEqual(sportsByUse(sports, [{ sportSlug: "pickleball", status: "paid" }, { sportSlug: "pickleball", status: "checked_in" }, { sportSlug: "tennis", status: "cancelled" }]).map((sport) => sport.slug), ["pickleball", "badminton", "tennis"], "Quick Booking: most booked first, cancelled ones do not count");
});

test("the live feed lists each room's next joinable or in-progress time of every sport", async () => {
  const now = Date.parse("2026-11-19T18:30:00+07:00");
  const rooms = [
    { id: 1, sportId: 3, slug: "badminton-beginner", title: "มือใหม่", levelName: "มือใหม่", icon: "🌱", kind: "buffet", teamSize: 2, courtId: null, courtName: null, price: 100, capacity: 16, minPlayers: 4, slots: "18:00-20:00,20:00-22:00", weekdays: "0123456", rules: null, prize: null, prizeCoins: null, matchMinutes: 60, closeMinutes: 10, active: 1, sortOrder: 10, metadata: null, sportSlug: "badminton", sportName: "แบดมินตัน", sportIcon: "🏸", sportOrder: 30 },
    { id: 2, sportId: 5, slug: "basketball-open-run-3x3", title: "Open Run 3x3", levelName: null, icon: "🏀", kind: "open_run", teamSize: 3, courtId: null, courtName: null, price: 70, capacity: 18, minPlayers: 15, slots: "18:00-20:00,20:00-22:00", weekdays: "0123456", rules: null, prize: null, prizeCoins: null, matchMinutes: 60, closeMinutes: 10, active: 1, sortOrder: 10, metadata: null, sportSlug: "basketball", sportName: "บาสเกตบอล", sportIcon: "🏀", sportOrder: 50 },
  ];
  const { loadLiveGames } = load("lib/rank-server.ts", {
    "@/lib/db": { createPublicId: () => "x", query: async (sql) => {
      if (sql.includes("FROM rank_rooms r JOIN sports s")) return rooms;
      if (sql.includes("FROM rank_sessions s")) return [{ id: 9, roomId: 1, startsAt: "2026-11-19 18:00:00", endsAt: "2026-11-19 20:00:00", status: "closed", matchedAt: "x", cancelReason: null, taken: 12, paid: 12, myBookingNo: null, myStatus: null }];
      return [];
    } },
  });
  const { games, sports } = await loadLiveGames(2, now);
  assert.deepEqual(games.map((game) => [game.roomId, game.from, game.live, game.joinable, game.taken, game.left, game.day]), [
    [1, "18:00", true, false, 12, 4, "today"],
    [2, "20:00", false, true, 0, 18, "today"],
  ], "badminton is being played now; basketball's next open time is 20:00 today");
  assert.deepEqual(sports.map((sport) => sport.slug), ["badminton", "basketball"]);
});

test("home Find Your Game shows the club's sessions (not member groups) and opens the sport's Buffet Rank tab", () => {
  const app = readFileSync("components/ppa-app.tsx", "utf8");
  assert.match(app, /<FindYourGameRow feed=\{liveFeed\} onOpen=\{openGame\} onAll=\{\(\) => go\("groups"\)\} \/>/);
  assert.match(app, /pickSport\(sport, "rank", \{ roomId: game\.roomId, date: game\.date, startsAt: game\.startsAt \}\)/);
  const { FindYourGameRow } = ui("components/member-groups.tsx");
  const feed = { sports: [], games: [
    { sportSlug: "basketball", sportName: "บาสเกตบอล", sportIcon: "🏀", roomId: 2, roomTitle: "Open Run 3x3", roomIcon: "🏀", kind: "open_run", levelName: null, teamSize: 3, capacity: 18, minPlayers: 15, price: 70, date: "2026-11-19", from: "18:00", to: "20:00", startsAt: "2026-11-19 18:00:00", day: "today", taken: 16, left: 2, joinable: true, live: false, mine: false },
    { sportSlug: "badminton", sportName: "แบดมินตัน", sportIcon: "🏸", roomId: 1, roomTitle: "มือใหม่", roomIcon: "🌱", kind: "buffet", levelName: "มือใหม่", teamSize: 2, capacity: 16, minPlayers: 4, price: 100, date: "2026-11-19", from: "18:00", to: "20:00", startsAt: "2026-11-19 18:00:00", day: "today", taken: 3, left: 13, joinable: true, live: false, mine: false },
  ] };
  const row = render(h(FindYourGameRow, { feed, onOpen: () => {}, onAll: () => {} }));
  assert.match(row, /LIVE/);
  assert.match(row, /บาสเกตบอล · Open Run 3x3/);
  assert.match(row, /เหลือ 2 ที่เท่านั้น/);
  assert.match(row, /แบดมินตัน · มือใหม่/);
  assert.match(row, /ขาดคู่ตีเบิ้ลอีก 1 คน/);
  assert.doesNotMatch(row, /สร้างก๊วน/, "Find Your Game is not the group finder");
});

// ---------- Item 5: scan ----------

test("scan has Member and Coupon tabs, a readable empty state with a buy button, and coupon QR per pack", () => {
  const { ScanHub } = ui("components/member-scan.tsx");
  const now = Date.parse("2026-11-19T10:00:00+07:00");
  const data = { user: { displayName: "พลอย", memberCode: "PPA-1" }, memberships: [], membershipPauses: [], entitlements: [], coupons: [{ id: 401, name: "คูปอง Fitness 10 ใบ", category: "fitness", remainingUses: 7, totalUses: 10, expiresAt: "2026-12-30T10:00:00+07:00" }, { id: 403, name: "HYROX Class 10 ครั้ง", category: "hyrox-class", remainingUses: 2, totalUses: 10, expiresAt: "2026-12-30T10:00:00+07:00" }] };
  const props = { data, now, onTab: () => {}, onOpen: () => {}, onBuyPackage: () => {}, onBuyCoupon: () => {}, onVisits: () => {} };
  const member = render(h(ScanHub, { ...props, tab: "member" }));
  assert.match(member, /role="tab"[^>]*aria-selected="true"[^>]*>เมมเบอร์/);
  assert.match(member, />คูปอง<em class="scan-count">2<\/em>/);
  assert.match(member, /ยังไม่มีแพ็กเกจที่ใช้งานได้/);
  assert.match(member, /ซื้อแพ็กเกจ/, "a way to buy from the empty state");
  assert.match(member, /ใช้คูปอง \(2\)/);
  const coupons = render(h(ScanHub, { ...props, tab: "coupon" }));
  assert.match(coupons, /คูปองที่คุณซื้อ — แตะเพื่อสร้าง QR สแกนเข้า \(ตัด 1 ใบ\)/);
  assert.match(coupons, /คูปอง Fitness 10 ใบ/);
  assert.match(coupons, /เหลือ 7 ใบ · หมดอายุ/);
  assert.match(coupons, /🔥/, "an icon per coupon kind");
  const withPackage = render(h(ScanHub, { ...props, tab: "member", data: { ...data, memberships: [{ id: 3, planName: "Fitness (12 เดือน)", startsAt: "2026-01-01T00:00:00+07:00", endsAt: "2026-12-25T00:00:00+07:00", status: "active", metadata: '{"months":12}' }] } }));
  assert.match(withPackage, /🏆/);
  assert.match(withPackage, /Fitness \(12 เดือน\)/);
  assert.match(withPackage, /เหลือ 36 วัน/);
});

test("the QR pass counts down 20 seconds with a bar and asks for the next QR at 00:00", () => {
  const source = readFileSync("components/member-scan.tsx", "utf8");
  assert.match(source, /export const QR_REFRESH_SECONDS = 20/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /if \(until\.current && until\.current <= time\) void load\(\)/);
  assert.match(source, /document\.hidden/, "no QR is fetched while the phone screen is off");
  const qr = readFileSync("app/api/qr/route.ts", "utf8");
  assert.match(qr, /membershipId/);
  assert.match(qr, /AND id = \?/, "a chosen package's own QR");
});

// ---------- Item 3: guide ----------

test("the guide has the PPA app's 10 steps with real emoji, dots, the swipe step and the orange theme", () => {
  const { guideSteps, GUIDE_VERSION, isBackSwipe, MemberGuide } = ui("components/member-guide.tsx");
  const steps = guideSteps(["แบดมินตัน", "พิคเคิลบอล"]);
  assert.equal(steps.length, 10);
  assert.deepEqual(steps.map((step) => step.icon), ["👋", "🎫", "⚡", "🍽️", "👥", "💪", "🪙", "👈", "📲", "🎉"]);
  assert.ok(steps.every((step) => !/[◫▣]/.test(step.icon)), "no placeholder boxes");
  assert.deepEqual(steps.filter((step) => step.swipe).map((step) => step.title), ["ปัดซ้าย = ย้อนกลับ"]);
  assert.equal(steps[3].values.value0, "แบดมินตัน · พิคเคิลบอล", "Buffet Rank names the sports that really have rooms");
  assert.match(GUIDE_VERSION, /^[A-Za-z0-9.-]{1,20}$/);
  assert.equal(isBackSwipe(-80, 10, 300), true);
  assert.equal(isBackSwipe(-80, -70, 300), true, "slanted up-left counts");
  assert.equal(isBackSwipe(-40, 0, 300), false);
  assert.equal(isBackSwipe(80, 0, 300), false);
  assert.equal(isBackSwipe(-80, 0, 900), false);
  const markup = render(h(MemberGuide, { steps, step: 3, onNext: () => {}, onSkip: () => {}, onSwiped: () => {} }));
  assert.match(markup, /3\/10/);
  assert.equal((markup.match(/<li/g) || []).length, 10, "ten progress dots");
  assert.match(markup, /class="on" aria-current="step"/);
  assert.match(markup, /ถัดไป ›/);
  const app = readFileSync("components/ppa-app.tsx", "utf8");
  assert.match(app, /<MenuItem icon="🎓" title=\{t\("คู่มือการใช้งาน"\)\}[^\n]*onClick=\{openGuide\}/, "Profile › คู่มือการใช้งาน opens it at any time");
  assert.match(app, /data\.guideVersion === GUIDE_VERSION/, "opens by itself once per version");
  assert.match(readFileSync("app/api/guide/route.ts", "utf8"), /UPDATE users SET guide_version = \? WHERE id = \?/);
});

// ---------- Item 1: packages ----------

test("เลือกแพ็กเกจ: four tabs, the 12-month hero card, coupon cards with a green [+] and the usage info", () => {
  const { PackagePlansScreen } = ui("components/member-packages.tsx");
  const item = (id, contentType, title, price, sortOrder, metadata, extra = {}) => ({ id, contentType, slug: `s-${id}`, title, price, sortOrder, icon: "", metadata: JSON.stringify(metadata), ...extra });
  const contentItems = [
    item(1, "membership_plan", "Fitness 12 เดือน", 19200, 110, { tab: "monthly", group: "12m", variant: "base", label: "Fitness (12 เดือน)", featured: true, badge: "คุ้มสุด", perks: ["เข้าใช้ไม่จำกัดตลอด 12 เดือน", "เข้าใช้ฟิตเนสไม่จำกัด", "จองผ่านแอปได้ทันที"], months: 12 }),
    item(2, "membership_plan", "Fitness + Swim 12 เดือน", 19700, 111, { tab: "monthly", group: "12m", variant: "swim", label: "Fitness + Swim", months: 12 }),
    item(3, "membership_plan", "Fitness 1 เดือน", 2000, 120, { tab: "monthly", group: "1m", variant: "base", label: "1 เดือน", months: 1 }, { subtitle: "เข้าใช้ไม่จำกัด" }),
    item(4, "time_pass", "Fitness 1 ครั้ง", 200, 10, { tab: "time", group: "1d", variant: "base", label: "1 ครั้ง", days: 1 }, { subtitle: "ใช้ได้ 1 วัน" }),
    item(5, "renewal_option", "ต่ออายุคูปอง", 500, 20, { kind: "coupon_renewal", months: 1 }),
  ];
  const couponStore = [
    { id: 10, name: "คูปอง Fitness 10 ใบ", category: "fitness", price: 1600, totalUses: 10, validityDays: 60, sortOrder: 10, metadata: '{"tab":"coupon","group":"c10","variant":"base"}' },
    { id: 11, name: "คูปอง Fitness + Swim 10 ใบ", category: "fitness-swim", price: 2400, totalUses: 10, validityDays: 60, sortOrder: 11, metadata: '{"tab":"coupon","group":"c10","variant":"swim","label":"Fitness + Swim"}' },
    { id: 12, name: "คูปอง Fitness 120 ใบ", category: "fitness", price: 12000, totalUses: 120, validityDays: 365, sortOrder: 40, metadata: '{"tab":"coupon","group":"c120","variant":"base","badge":"BEST SELLER"}' },
  ];
  const data = { coupons: [], expiredCoupons: [], memberships: [], membershipPauses: [], pendingPayments: [] };
  const props = { variant: "choose", contentItems, couponStore, data, now: Date.parse("2026-11-19T10:00:00+07:00"), busy: false, onTab: () => {}, onBack: () => {}, onSelectContent: () => {}, onBuyCoupon: () => {}, onRequestPause: () => {}, onRenewCoupon: () => {} };
  const monthly = render(h(PackagePlansScreen, { ...props, tab: "monthly" }));
  assert.match(monthly, /<h1>เลือกแพ็กเกจ<\/h1>/, "not '💪 ฟิตเนส'");
  assert.deepEqual([...monthly.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((match) => match[1]), ["Monthly", "Time", "Coupon", "ต่ออายุ"]);
  assert.ok(monthly.indexOf("plan-card") < monthly.indexOf("1 เดือน"), "the hero card comes first");
  for (const text of ["Fitness (12 เดือน)", "คุ้มสุด", "19,200", "(เฉลี่ย 1,600 ฿ / เดือน)", "เข้าใช้ไม่จำกัดตลอด 12 เดือน", "เข้าใช้ฟิตเนสไม่จำกัด", "จองผ่านแอปได้ทันที", "เลือกแพ็กเกจนี้", "Extra · 12 เดือน"]) assert.ok(monthly.includes(text), text);
  const time = render(h(PackagePlansScreen, { ...props, tab: "time" }));
  assert.match(time, /TIME · รายครั้ง \(FITNESS\)/);
  assert.match(time, /ใช้ได้ 1 วัน/);
  const coupon = render(h(PackagePlansScreen, { ...props, tab: "coupon" }));
  assert.equal((coupon.match(/class="cp-add"/g) || []).length, 2, "a green [+] on every coupon pack");
  assert.match(coupon, /aria-label="ซื้อ คูปอง Fitness 10 ใบ"/);
  for (const text of ["คูปอง (Fitness)", "10 ใบ / 2 เดือน", "1,600 ฿ · เฉลี่ย 160 ฿/วัน", "120 ใบ / 1 ปี", "BEST SELLER", "ข้อมูลการใช้งาน", "แชร์ให้เพื่อนได้ 1 คน"]) assert.ok(coupon.includes(text), text);
  const fitness = render(h(PackagePlansScreen, { ...props, variant: "page", tab: "package" }));
  assert.deepEqual([...fitness.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((match) => match[1]), ["Package", "Coupon"], "GYMNOS › Fitness keeps Package / Coupon");
});

test("the rich menu Packages and สมาชิกของฉัน › แพ็กเกจของฉัน open เลือกแพ็กเกจ; GYMNOS › Fitness opens its own page", () => {
  const app = readFileSync("components/ppa-app.tsx", "utf8");
  assert.match(app, /\{screen === "plans" && \(\s*<PackagePlansScreen\s*variant="choose"/);
  assert.match(app, /\{screen === "fitness" && \(\s*<PackagePlansScreen\s*tab=\{fitnessTab\}\s*page="fitness"/);
  assert.match(app, /<MenuItem icon="📦" title=\{t\("แพ็กเกจของฉัน"\)\} onClick=\{\(\) => openPlans\("monthly", "membership"\)\} \/>/);
});

// ---------- Brand colours ----------

test("the member app uses PPA orange #FF6B00 on charcoal; no lime is left", () => {
  const css = ["app/styles.css", "app/member-features.css", "app/responsive.css"].map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(css, /--orange: #ff6b00;/);
  assert.match(css, /--on-orange: #1a0d00;/);
  assert.match(css, /--text-2: #cccccc;/);
  assert.doesNotMatch(css, /#b7ff2a|#8ee600|#ccff4f|#d7ff63|183 255 42|ppa-lime/i, "no lime green");
  // Contrast: text on orange and orange on charcoal pass WCAG AA (4.5:1).
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  assert.ok(contrast("#ff6b00", "#1a0d00") >= 4.5);
  assert.ok(contrast("#ff6b00", "#141417") >= 4.5);
  assert.ok(contrast("#cccccc", "#141417") >= 7);
});

// ---------- Back office ----------

test("back office Groups: members.manage, list, moderation actions with an audit record", async () => {
  const { requiredPermissions, canAccessSection } = load("lib/admin-permissions.ts");
  assert.deepEqual(requiredPermissions("groups", "PATCH"), ["members.manage"]);
  assert.equal(canAccessSection("groups", (code) => code === "members.manage"), true);
  assert.equal(canAccessSection("groups", (code) => code === "content.manage"), false);
  const removed = [];
  const conn = connection([["FROM groups_clubs WHERE id = ? FOR UPDATE", [[{ id: 5, name: "ก๊วน", ownerUserId: 9, status: "active", photoUrl: "/uploads/groups/1-a.jpg" }]]]]);
  const route = load("app/api/admin/groups/route.ts", {
    "@/lib/admin-auth": { assertAdminRequest: async () => null, getAdminIdentity: async () => ({ id: 7 }), adminSessionCookieName: () => "session" },
    "@/lib/db": { query: async () => [], pool: { getConnection: async () => conn } },
    "@/lib/security": { parseJsonBody: async () => ({ id: 5, action: "remove_photo", reason: "รูปไม่เหมาะสม" }), secureResponse: (response) => response, validationErrorResponse: () => Response.json({}, { status: 400 }) },
    "@/lib/image-upload": { removeUploadedImage: async (folder, url) => { removed.push(url); } },
    "@/lib/notify": { notifyMember: async (c, userId, title) => { c.execute("INSERT INTO notifications (user_id, title) VALUES (?, ?)", [userId, title]); } },
  });
  const { NextRequest } = require("next/server");
  const response = await route.PATCH(new NextRequest("http://localhost/api/admin/groups", { method: "PATCH", body: "{}" }));
  assert.equal(response.status, 200);
  assert.ok(conn.writes.some(([sql]) => sql === "UPDATE groups_clubs SET photo_url = NULL WHERE id = ?"));
  assert.ok(conn.writes.some(([sql, params]) => sql.startsWith("INSERT INTO admin_audit_logs") && params[1] === "group.remove_photo"));
  assert.ok(conn.writes.some(([sql, params]) => sql.startsWith("INSERT INTO notifications") && params[0] === 9 && params[1] === "เจ้าหน้าที่นำรูปก๊วนออก"));
  assert.deepEqual(removed, ["/uploads/groups/1-a.jpg"], "the file is deleted after the commit");
});
