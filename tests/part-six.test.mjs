import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load, require } from "./load-ts.mjs";

// แก้ไข app PPA part 6-12: Fitness and Swim packages, the QR payment page, HYROX / Pilates / Airfit
// classes with instructors, rooms and minimums, free Service Classes with the weekly timetable, and
// Promotion (weekly deals, Member prices with the PPA member number + OTP).

const schema = readFileSync("database/schema.sql", "utf8");
const statements = schema.split(/;\s*\n/).map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);

function connection(responder = () => undefined) {
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

const program = (slug, metadata, extra = {}) => ({ id: extra.id || 40, slug, title: extra.title || slug, price: extra.price || 0, icon: "🤸", metadata: JSON.stringify(metadata), ...extra });
const hourly = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
const yoga = program("service-yoga", { service: "service", kind: "free", sport: "gym", short: "YOGA", minutes: 60, capacity: 20, schedule: [{ day: 1, time: "07:00", instructor: "ครูอ้อย" }, { day: 3, time: "07:00", instructor: "ครูอ้อย" }, { day: 0, time: "09:00", instructor: "ครูอ้อย" }] }, { id: 51, title: "Yoga & Stretching" });
const privateAll = program("pilates-private-all", { service: "pilates", tab: "private", group: "1/1 All", kind: "coupon", sport: "pilates", times: hourly, minutes: 60, capacity: 1, couponCategories: ["pilates-private-all"], trainerLink: true, trainerMatch: "pilates" }, { id: 52 });
const rentRoom = program("pilates-rent-room", { service: "pilates", tab: "private", group: "Rent Room", subgroup: "Private Room", kind: "coupon", sport: "pilates", times: ["08:00", "09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "18:30", "20:00", "21:30"], minutes: 90, capacity: 1, couponCategories: ["pilates-rent-room"], resources: ["ห้อง 01", "ห้อง 02", "ห้อง 03"], resourceLabel: "เลือกห้อง" }, { id: 53 });
const pilatesGroup = program("pilates-group", { service: "pilates", tab: "group", kind: "coupon", sport: "pilates", short: "PILATES", times: hourly, minutes: 60, capacity: 10, minPeople: 3, couponCategories: ["pilates", "airfit-group"], membershipServices: ["pilates"], instructors: [{ name: "ครูมายด์", from: "08:00", to: "12:00" }, { name: "ครูเบล", from: "12:00", to: "16:00" }, { name: "ครูน้ำ", from: "16:00", to: "21:00" }] }, { id: 54 });

// ---------- Class programs ----------

test("a weekly schedule decides a class's days, times and instructors; ranges name 01/02/03", () => {
  const { parseProgram, timesOn, classRange, instructorAt, instructorCards } = load("lib/class-programs.ts");
  const parsed = parseProgram(yoga);
  assert.equal(parsed.kind, "free");
  assert.deepEqual(parsed.weekdays, [0, 1, 3]);
  assert.deepEqual(timesOn(parsed, "2099-02-02"), ["07:00"], "Monday");
  assert.deepEqual(timesOn(parsed, "2099-02-03"), [], "no Yoga on Tuesday");
  assert.deepEqual(timesOn(parsed, "2099-02-01"), ["09:00"], "Sunday");
  assert.equal(classRange(parsed, "2099-02-03", "07:00"), null);
  assert.deepEqual(classRange(parsed, "2099-02-02", "07:00"), { startsAt: "2099-02-02 07:00:00", endsAt: "2099-02-02 08:00:00", endTime: "08:00" });
  assert.equal(instructorAt(parsed, "07:00", "2099-02-02").name, "ครูอ้อย");
  assert.deepEqual(instructorCards(parsed).map((card) => [card.name, card.slots.length]), [["ครูอ้อย", 3]]);
  const group = parseProgram(pilatesGroup);
  assert.deepEqual(["08:00", "12:00", "20:00"].map((time) => instructorAt(group, time).name), ["ครูมายด์", "ครูเบล", "ครูน้ำ"]);
  assert.equal(group.minPeople, 3);
  assert.equal(group.timetable, true, "a group class is on the timetable");
  assert.equal(parseProgram(privateAll).timetable, false, "a private class is not");
  assert.equal(parseProgram(rentRoom).timetable, false, "nor a rental");
});

test("class programs refuse settings the app could not book", () => {
  const { programProblem } = load("lib/class-programs.ts");
  assert.equal(programProblem(rentRoom), null);
  assert.equal(programProblem(yoga), null);
  assert.match(programProblem(program("x", { service: "pilates", kind: "coupon", times: ["08:00"], capacity: 1, couponCategories: ["a"], trainerLink: true, resources: ["ห้อง 01"] })), /trainerLink/);
  assert.match(programProblem(program("x", { service: "pilates", kind: "coupon", times: ["08:00"], capacity: 2, couponCategories: ["a"], minPeople: 5 })), /minPeople/);
  assert.match(programProblem(program("x", { service: "hyrox", kind: "session", times: ["08:00"], capacity: 2, minPeople: 2 }, { price: 100 })), /minPeople/);
  assert.match(programProblem(program("x", { service: "service", kind: "free", capacity: 20, schedule: [{ day: 9, time: "07:00" }] })), /times|schedule/);
});

test("the weekly timetable lists group classes Monday first, and finds trainers who teach the class", () => {
  const { parseProgram, timetableOf, trainersFor } = load("lib/class-programs.ts");
  const rows = timetableOf([yoga, pilatesGroup, privateAll].map(parseProgram));
  assert.deepEqual(rows.map((row) => row.short), ["YOGA", "PILATES"]);
  assert.deepEqual(rows[0].days.map((day) => day.day), [1, 3, 0], "Monday, Wednesday, Sunday");
  assert.deepEqual(rows[0].days[0].slots, [{ time: "07:00", endTime: "08:00", instructor: "ครูอ้อย" }]);
  assert.equal(rows[1].days.length, 7);
  assert.equal(rows[1].days[0].slots.length, 13, "every hour 08:00-20:00");
  const trainers = [{ role: "HYROX Coach", specialties: '["HYROX"]' }, { role: "Pilates Instructor", specialties: ["Pilates"] }];
  assert.deepEqual(trainersFor(parseProgram(privateAll), trainers), [trainers[1]]);
  assert.deepEqual(trainersFor({ trainerMatch: "airfit" }, trainers), trainers, "nobody matches: everyone is listed");
});

// ---------- Booking a class ----------

function classConnection({ row, taken = 0, coupon = { id: 77, remainingUses: 3, name: "คูปอง" }, mine = [], trainer = { id: 3, name: "วรินทร สุขใจ" }, busy = [], memberships = [], passes = [] }) {
  return connection((sql) => {
    if (sql.includes("FROM app_content_items WHERE id = ?")) return [[row]];
    if (sql.includes("FROM sports WHERE slug")) return [[{ id: 1 }]];
    if (sql.includes("FROM trainers WHERE id = ?")) return [trainer ? [trainer] : []];
    if (sql.includes("SELECT id FROM bookings WHERE user_id = ? AND class_key")) return [mine];
    if (sql.includes("SELECT id FROM bookings WHERE trainer_id = ?")) return [busy];
    if (sql.includes("COUNT(*) taken")) return [[{ taken }]];
    if (sql.includes("FROM memberships")) return [memberships];
    if (sql.includes("FROM user_entitlements")) return [passes];
    if (sql.includes("FROM user_coupons uc")) return [coupon ? [coupon] : []];
    if (sql.includes("SELECT booking_no, title")) return [[{ booking_no: "BKTEST", status: "paid" }]];
    return undefined;
  });
}
const classBooking = () => load("lib/class-booking.ts", { "@/lib/db": { createPublicId: (prefix) => `${prefix}TEST` } });
const monday = { date: "2099-02-02", now: Date.parse("2099-02-01T10:00:00+07:00") };

test("a free Service Class is booked at once for a member with a package, refused without one", async () => {
  const { reserveClass, ClassBookingError } = classBooking();
  const conn = classConnection({ row: yoga, memberships: [{ id: 8, title: "Fitness 1 เดือน", metadata: '{"services":["fitness"]}' }] });
  const result = await reserveClass(conn, { userId: 9, programId: 51, time: "07:00", ...monday });
  assert.equal(result.paid, true);
  assert.equal(result.included, "Fitness 1 เดือน");
  const insert = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.match(insert[0], /VALUES \(\?, \?, \?, NULL, \?, \?, \?, \?, 1, 0, 'paid'/);
  assert.deepEqual(JSON.parse(insert[1].at(-1)).package, { kind: "membership", id: 8, title: "Fitness 1 เดือน" });
  const membershipRead = conn.statements.find(([sql]) => sql.includes("FROM memberships"));
  assert.match(membershipRead[0], /NOT EXISTS \(SELECT 1 FROM membership_pauses/, "a paused package does not count");
  const passOnly = await reserveClass(classConnection({ row: yoga, passes: [{ id: 4, title: "Fitness 1 ครั้ง" }] }), { userId: 9, programId: 51, time: "07:00", ...monday });
  assert.equal(passOnly.included, "Fitness 1 ครั้ง", "a time pass in force counts too");
  await assert.rejects(reserveClass(classConnection({ row: yoga }), { userId: 9, programId: 51, time: "07:00", ...monday }), (error) => error instanceof ClassBookingError && error.code === "MEMBER_REQUIRED" && error.status === 403);
  await assert.rejects(reserveClass(classConnection({ row: yoga }), { userId: 9, programId: 51, time: "07:00", date: "2099-02-03", now: monday.now }), /ไม่เปิดให้จอง/, "no Yoga on Tuesday");
});

test("a private class needs a free instructor; the booking keeps who teaches it", async () => {
  const { reserveClass } = classBooking();
  const input = { userId: 9, programId: 52, time: "10:00", ...monday };
  await assert.rejects(reserveClass(classConnection({ row: privateAll }), input), (error) => error.code === "TRAINER_REQUIRED");
  await assert.rejects(reserveClass(classConnection({ row: privateAll, trainer: null }), { ...input, trainerId: 3 }), (error) => error.code === "TRAINER_NOT_FOUND");
  await assert.rejects(reserveClass(classConnection({ row: privateAll, busy: [{ id: 1 }] }), { ...input, trainerId: 3 }), (error) => error.code === "TRAINER_BUSY");
  const conn = classConnection({ row: privateAll });
  const result = await reserveClass(conn, { ...input, trainerId: 3 });
  assert.equal(result.paid, true);
  assert.match(conn.statements.find(([sql]) => sql.includes("FROM trainers WHERE id = ?"))[0], /FOR UPDATE/, "one instructor's bookings are serialized");
  const busy = conn.statements.find(([sql]) => sql.includes("WHERE trainer_id = ?"));
  assert.deepEqual(busy[1], [3, "2099-02-02 11:00:00", "2099-02-02 10:00:00"], "any class of that instructor overlapping the hour");
  const insert = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.match(insert[0], /trainer_id, resource_code\) VALUES/);
  assert.deepEqual(insert[1].slice(-2), [3, null]);
  assert.match(insert[1][5], /วรินทร สุขใจ/, "the title names the instructor");
});

test("a rental books one room per time: the room is required and counted on its own", async () => {
  const { reserveClass } = classBooking();
  const input = { userId: 9, programId: 53, time: "09:30", ...monday };
  await assert.rejects(reserveClass(classConnection({ row: rentRoom }), input), (error) => error.code === "RESOURCE_REQUIRED");
  await assert.rejects(reserveClass(classConnection({ row: rentRoom }), { ...input, resource: "ห้อง 09" }), (error) => error.code === "RESOURCE_REQUIRED");
  await assert.rejects(reserveClass(classConnection({ row: rentRoom, taken: 1 }), { ...input, resource: "ห้อง 02" }), (error) => error.code === "FULL" && /ห้องหรือเครื่อง/.test(error.message));
  const conn = classConnection({ row: rentRoom });
  await reserveClass(conn, { ...input, resource: "ห้อง 02" });
  const counted = conn.statements.find(([sql]) => sql.includes("COUNT(*) taken"));
  assert.match(counted[0], /AND resource_code = \?/);
  assert.deepEqual(counted[1], ["pilates-rent-room", "2099-02-02 09:30:00", "ห้อง 02"]);
  const insert = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO bookings"));
  assert.deepEqual(insert[1].slice(-2), [null, "ห้อง 02"]);
  assert.equal(insert[1][7], "2099-02-02 11:00:00", "a 1.5-hour round");
});

test("an unlimited Member package books its group class free; a class short of its minimum closes at confirmation time", async () => {
  const { reserveClass } = classBooking();
  const conn = classConnection({ row: pilatesGroup, memberships: [{ id: 5, title: "แพ็กเกจ Pilates Member", metadata: '{"services":["pilates"]}' }] });
  const result = await reserveClass(conn, { userId: 9, programId: 54, time: "18:00", ...monday });
  assert.equal(result.included, "แพ็กเกจ Pilates Member");
  assert.equal(conn.statements.some(([sql]) => sql.includes("FROM user_coupons uc")), false, "no coupon used");
  const coupon = classConnection({ row: pilatesGroup, memberships: [{ id: 6, title: "Fitness 1 เดือน", metadata: '{"services":["fitness"]}' }] });
  const used = await reserveClass(coupon, { userId: 9, programId: 54, time: "18:00", ...monday });
  assert.ok(used.coupon, "another package does not include it: one coupon use");
  const soon = Date.parse("2099-02-02T16:30:00+07:00");
  await assert.rejects(reserveClass(classConnection({ row: pilatesGroup, taken: 0 }), { userId: 9, programId: 54, time: "18:00", date: "2099-02-02", now: soon }), (error) => error.code === "CLOSED");
  const completes = await reserveClass(classConnection({ row: pilatesGroup, taken: 2 }), { userId: 9, programId: 54, time: "18:00", date: "2099-02-02", now: soon });
  assert.equal(completes.paid, true, "the third person still opens the class");
});

test("class times show an instructor's busy hours, a room's own bookings and closing classes", async () => {
  const { classSlots } = classBooking();
  const { parseProgram } = load("lib/class-programs.ts");
  const reads = [];
  const read = async (sql, params) => {
    reads.push([sql, params]);
    if (sql.includes("GROUP BY b.class_key")) return [
      { classKey: "pilates-rent-room", time: "09:30", resource: "ห้อง 01", trainerId: null, taken: 1, mine: 0 },
      { classKey: "pilates-group", time: "18:00", resource: null, trainerId: null, taken: 1, mine: 1 },
    ];
    if (sql.includes("b.trainer_id = ?")) return [{ fromTime: "17:00", toTime: "18:00" }];
    return [];
  };
  const now = Date.parse("2099-02-02T16:30:00+07:00");
  const days = await classSlots(read, [privateAll, rentRoom, pilatesGroup].map(parseProgram), "2099-02-02", 9, now, { trainerId: 3, resources: { "pilates-rent-room": "ห้อง 02" } });
  const slot = (index, time) => days[index].slots.find((item) => item.time === time);
  assert.equal(slot(0, "17:00").status, "full", "the instructor teaches another class then");
  assert.equal(slot(0, "11:00").status, "past");
  assert.equal(slot(0, "18:00").status, "available");
  assert.equal(days[1].resource, "ห้อง 02");
  assert.equal(slot(1, "17:00").status, "available");
  assert.equal(slot(2, "18:00").mine, true);
  assert.equal(slot(2, "18:00").status, "closed", "1 of 3 inside the confirmation window");
  assert.equal(slot(2, "19:00").status, "available", "still more than two hours away");
  assert.deepEqual(reads.find(([sql]) => sql.includes("b.trainer_id = ?"))[1], [3, "2099-02-02 23:59:59", "2099-02-02 00:00:00"]);
});

test("a group class short of its minimum is cancelled at its confirmation time, coupons returned and members told", async () => {
  const notices = [];
  const { cancelUnderfilledClasses } = load("lib/class-jobs.ts", {
    "@/lib/db": { createPublicId: () => "x", pool: {} },
    "@/lib/notify": { notifyMember: async (_conn, userId, title, body) => { notices.push({ userId, title, body }); }, pushLineMessage: async () => {}, pushText: (title, body) => `${title}\n${body}` },
  });
  const conn = connection((sql, params) => {
    if (sql.includes("FROM app_content_items WHERE content_type = 'class_program'")) return [[pilatesGroup, yoga]];
    if (sql.includes("GROUP BY starts_at HAVING")) return [params[0] === "pilates-group" ? [{ startsAt: "2099-02-02 18:00:00", taken: 2 }] : []];
    if (sql.includes("SELECT id, user_id userId, user_coupon_id userCouponId")) return [[{ id: 11, userId: 9, userCouponId: 70, amount: 0, startText: "02/02 18:00" }, { id: 12, userId: 10, userCouponId: null, amount: 0, startText: "02/02 18:00" }]];
    return undefined;
  });
  const result = await cancelUnderfilledClasses(conn, Date.parse("2099-02-02T16:30:00+07:00"));
  const window = conn.statements.find(([sql]) => sql.includes("HAVING COUNT(*) < ?"));
  assert.deepEqual(window[1], ["pilates-group", "2099-02-02 16:30:00", "2099-02-02 18:30:00", 3], "times starting within 2 hours, fewer than 3 booked");
  assert.equal(conn.statements.filter(([sql]) => sql.startsWith("UPDATE bookings SET status = 'cancelled'")).length, 2);
  assert.ok(conn.statements.some(([sql, params]) => sql.startsWith("UPDATE user_coupons SET remaining_uses = remaining_uses + 1") && params[0] === 70), "the coupon use comes back");
  assert.deepEqual(result.map((notice) => notice.userId), [9, 10]);
  assert.equal(notices[0].title, "คลาสถูกยกเลิก");
  assert.match(notices[0].body, /ไม่ถึง 3 คน/);
});

// ---------- Promotion ----------

test("weekly deals: Monday weeks, the discount in scope only, and claims once a week", async () => {
  const { weekOf, discounted, contentScope, couponScope, priceWithDiscount, claimDeal, PromotionError } = load("lib/promotions.ts");
  assert.deepEqual(weekOf(Date.parse("2026-11-15T23:00:00+07:00")), { key: "2026-11-09", from: "2026-11-09 00:00:00", to: "2026-11-16 00:00:00", lastDay: "2026-11-15" }, "Sunday night is still this week");
  assert.equal(weekOf(Date.parse("2026-11-16T00:10:00+07:00")).key, "2026-11-16");
  assert.equal(discounted(10885, 10), 9797);
  assert.equal(contentScope({ contentType: "membership_plan", metadata: '{"tab":"monthly"}' }), "fitness");
  assert.equal(contentScope({ contentType: "time_pass", metadata: '{"page":"swim"}' }), "swim");
  assert.equal(contentScope({ contentType: "membership_plan", metadata: '{"tab":"member","memberOnly":true}' }), null, "Member prices are not discounted again");
  assert.equal(couponScope({ metadata: '{"tab":"coupon","page":"swim"}' }), "swim");
  assert.equal(couponScope({ metadata: '{"program":"pilates-duo"}' }, "pilates"), "pilates");
  assert.equal(couponScope({ metadata: '{"grantOnly":true}' }), null);
  const deal = { slug: "deal-package-10", title: "ส่วนลด", percent: 10, scope: ["fitness", "swim", "pilates", "airfit"], until: "2026-11-15" };
  assert.deepEqual(priceWithDiscount(2000, "swim", deal), { amount: 1800, discount: { deal: "deal-package-10", percent: 10, original: 2000 } });
  assert.deepEqual(priceWithDiscount(590, "hyrox", deal), { amount: 590, discount: null }, "HYROX is not in scope");

  const dealRow = (metadata) => [[{ id: 1, slug: "deal", title: "ดีล", metadata: JSON.stringify(metadata) }]];
  const claimConn = (metadata, extra = () => undefined) => connection((sql, params) => extra(sql, params) ?? (sql.includes("content_type = 'promotion_deal' AND slug = ?") ? dealRow(metadata) : undefined));
  const discount = claimConn({ kind: "discount", percent: 10, scope: ["fitness"] });
  await claimDeal(discount, 9, "deal", Date.parse("2026-11-12T10:00:00+07:00"));
  assert.deepEqual(discount.statements.find(([sql]) => sql.startsWith("INSERT INTO promotion_claims"))[1], [9, "deal", "2026-11-09"]);
  await assert.rejects(claimDeal(claimConn({ kind: "discount", percent: 10, scope: ["fitness"] }, (sql) => (sql.includes("FROM promotion_claims WHERE user_id") ? [[{ id: 1 }]] : undefined)), 9, "deal"), (error) => error instanceof PromotionError && error.code === "ALREADY_CLAIMED");
  const weekly = { kind: "weekly_coupon", couponCode: "FIT-WEEKLY-FREE", checkinDays: 3, validityDays: 7 };
  await assert.rejects(claimDeal(claimConn(weekly, (sql) => (sql.includes("COUNT(DISTINCT DATE(created_at))") ? [[{ days: 2 }]] : undefined)), 9, "deal"), (error) => error.code === "NOT_ELIGIBLE");
  const granted = claimConn(weekly, (sql) => (sql.includes("COUNT(DISTINCT DATE(created_at))") ? [[{ days: 3 }]] : sql.includes("FROM coupons WHERE code = ?") ? [[{ id: 66, name: "คูปอง Fitness ฟรีประจำสัปดาห์", totalUses: 1 }]] : undefined));
  const result = await claimDeal(granted, 9, "deal");
  assert.equal(result.coupon.name, "คูปอง Fitness ฟรีประจำสัปดาห์");
  assert.deepEqual(granted.statements.find(([sql]) => sql.startsWith("INSERT INTO user_coupons"))[1], [9, 66, 1, 1, 7]);
  await assert.rejects(claimDeal(claimConn({ kind: "trainer_bonus", hours: 2 }), 9, "deal"), (error) => error.code === "AUTOMATIC");
});

test("the first personal trainer purchase brings the free training hours, once", async () => {
  const { grantTrainerBonus } = load("lib/promotions.ts");
  const deal = [[{ id: 3, slug: "deal-trainer-2h", title: "เทรนฟรี 2 ชั่วโมง กับเทรนเนอร์", metadata: '{"kind":"trainer_bonus","hours":2,"value":3000}' }]];
  const first = connection((sql) => (sql.includes("JSON_VALUE(metadata, '$.kind') = 'trainer_bonus'") ? deal : undefined));
  assert.deepEqual(await grantTrainerBonus(first, 9, 500), { title: "เทรนฟรี 2 ชม. (เทรนฟรี 2 ชั่วโมง กับเทรนเนอร์)", hours: 2 });
  const insert = first.statements.find(([sql]) => sql.startsWith("INSERT INTO user_entitlements"));
  assert.deepEqual(insert[1].slice(0, 5), [9, 500, "trainer_bonus", "เทรนฟรี 2 ชม. (เทรนฟรี 2 ชั่วโมง กับเทรนเนอร์)", 2]);
  const again = connection((sql) => (sql.includes("JSON_VALUE(metadata, '$.kind') = 'trainer_bonus'") ? deal : sql.includes("entitlement_type IN ('trainer', ?)") ? [[{ id: 1 }]] : undefined));
  assert.equal(await grantTrainerBonus(again, 9, 501), null, "not the first trainer purchase");
  assert.equal(await grantTrainerBonus(connection(), 9, 502), null, "deal switched off");
  assert.match(readFileSync("lib/entitlements.ts", "utf8"), /if \(type === "trainer"\) await grantTrainerBonus\(/);
});

test("PPA Member: a 4-digit code to the member's phone, five tries, then 30 minutes to buy", async () => {
  process.env.SESSION_SECRET = "test-secret-for-member-otp-0123456789";
  const { createOtp, confirmOtp, maskPhone, MemberVerifyError } = load("lib/ppa-member.ts");
  const member = { id: 4, memberNo: "123456", fullName: "สมชาย ใจดี", phone: "0812345678", status: "active", current: 1 };
  assert.equal(maskPhone("0812345678"), "081-xxx-5678");
  assert.equal(maskPhone("+66812345678"), "081-xxx-5678");
  const created = connection((sql) => (sql.includes("FROM ppa_members WHERE member_no") ? [[member]] : sql.includes("FROM member_otps WHERE ppa_member_id = ? AND created_at") ? [[{ sinceLast: null, lastHour: 0 }]] : undefined));
  const otp = await createOtp(created, 9, "123456");
  assert.match(otp.code, /^\d{4}$/);
  assert.equal(otp.phoneMasked, "081-xxx-5678");
  const stored = created.statements.find(([sql]) => sql.startsWith("INSERT INTO member_otps"));
  assert.match(stored[1][2], /^[a-f0-9]{64}$/, "only a keyed hash is kept");
  assert.ok(!stored[1].includes(otp.code));
  const waiting = connection((sql) => (sql.includes("FROM ppa_members WHERE member_no") ? [[member]] : sql.includes("FROM member_otps WHERE ppa_member_id = ? AND created_at") ? [[{ sinceLast: 20, lastHour: 1 }]] : undefined));
  await assert.rejects(createOtp(waiting, 9, "123456"), (error) => error instanceof MemberVerifyError && error.code === "WAIT");
  await assert.rejects(createOtp(connection((sql) => (sql.includes("FROM ppa_members") ? [[{ ...member, current: 0 }]] : undefined)), 9, "123456"), (error) => error.code === "NOT_FOUND", "expired members cannot buy");
  const latest = (attempts = 0) => connection((sql) => (sql.includes("FROM ppa_members WHERE member_no") ? [[member]] : sql.includes("FROM member_otps WHERE ppa_member_id = ? AND user_id = ?") ? [[{ id: 31, codeHash: stored[1][2], attempts, valid: 1, verifiedAt: null }]] : undefined));
  const wrong = latest();
  await assert.rejects(confirmOtp(wrong, 9, "123456", otp.code === "0000" ? "1111" : "0000"), (error) => error.code === "WRONG");
  assert.ok(wrong.statements.some(([sql]) => sql === "UPDATE member_otps SET attempts = attempts + 1 WHERE id = ?"));
  await assert.rejects(confirmOtp(latest(5), 9, "123456", otp.code), (error) => error.code === "TOO_MANY");
  await assert.rejects(confirmOtp(latest(), 10, "123456", otp.code), (error) => error.code === "WRONG", "the code belongs to the account that asked for it");
  const right = latest();
  assert.deepEqual(await confirmOtp(right, 9, "123456", otp.code), { memberNo: "123456", name: "สมชาย ใจดี", minutes: 30 });
  assert.ok(right.statements.some(([sql, params]) => sql.startsWith("UPDATE ppa_members SET user_id = ?") && params[0] === 9));
});

test("checkout: Member packages need the confirmed member, a claimed weekly deal takes its percent off", async () => {
  const conn = connection((sql) => (sql.includes("request_id = ?") ? [[]] : undefined));
  const route = (item, rows = {}) => load("app/api/payments/route.ts", {
    "@/lib/auth": { assertApiUser: async () => ({ id: 2 }), authErrorResponse: () => Response.json({}, { status: 401 }) },
    "@/lib/booking-rules": { expirePendingBookings: async () => {} },
    "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", parseJsonBody: async () => ({ contentId: 3, method: "promptpay", requestId: "req-pay-0009" }), validationErrorResponse: () => Response.json({}, { status: 400 }) },
    "@/lib/payment-catalog": { resolvePaymentItem: async () => item },
    "@/lib/db": { query: async (sql) => { for (const [needle, value] of Object.entries(rows)) if (sql.includes(needle)) return value; return []; }, createPublicId: (prefix) => `${prefix}NEW`, pool: { getConnection: async () => conn } },
  });
  const member = { amount: 5000, itemName: "แพ็กเกจสระว่ายน้ำ Member", itemType: "membership", contentId: 3, grant: { months: 1, services: ["swim"] }, scope: null, memberOnly: true };
  const refused = await route(member).POST(new Request("http://localhost/api/payments", { method: "POST" }));
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, "MEMBER_VERIFY_REQUIRED");
  assert.equal(conn.statements.some(([sql]) => sql.startsWith("INSERT INTO payments")), false);
  const verified = await route(member, { "FROM member_otps o": [{ id: 4, memberNo: "123456", name: "สมชาย", verifiedAt: "2099-01-01 10:00:00" }] }).POST(new Request("http://localhost/api/payments", { method: "POST" }));
  assert.equal(verified.status, 201);
  const memberPayment = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO payments"));
  assert.equal(JSON.parse(memberPayment[1][8]).ppaMemberNo, "123456");
  conn.statements.length = 0;
  const plan = { amount: 2000, itemName: "Swim 1 เดือน", itemType: "membership", contentId: 3, grant: { months: 1 }, scope: "swim", memberOnly: false };
  const deal = [{ id: 1, slug: "deal-package-10", title: "ส่วนลด", metadata: '{"kind":"discount","percent":10,"scope":["fitness","swim"]}' }];
  const response = await route(plan, { "FROM promotion_claims pc": deal }).POST(new Request("http://localhost/api/payments", { method: "POST" }));
  assert.deepEqual(await response.json(), { paymentNo: "PAYNEW", status: "created", amount: 1800, discount: { deal: "deal-package-10", percent: 10, original: 2000 } });
  const payment = conn.statements.find(([sql]) => sql.startsWith("INSERT INTO payments"));
  assert.equal(payment[1][4], 1800);
});

test("the PromptPay page counts down the QR: a booking's hold, a package's 15 minutes, then a fresh QR", async () => {
  const rows = {
    PAYPACK1234: { paymentNo: "PAYPACK1234", amount: 1800, status: "created", method: "promptpay", itemName: "Swim 1 เดือน", bookingId: null, slipUploadedAt: null, qrSeconds: 840, original: "2000" },
    PAYLAPS1234: { paymentNo: "PAYLAPS1234", amount: 300, status: "created", method: "promptpay", itemName: "Fitness 1 ครั้ง", bookingId: null, slipUploadedAt: null, qrSeconds: -5 },
  };
  const seen = [];
  const route = load("app/api/payments/promptpay/route.ts", {
    "@/lib/auth": { assertApiUser: async () => ({ id: 2 }), authErrorResponse: () => Response.json({}, { status: 401 }) },
    "@/lib/security": { checkRateLimit: () => null, clientIp: async () => "test", secureResponse: (response) => response },
    "@/lib/db": { query: async (sql, params) => { seen.push([sql, params]); if (sql.startsWith("UPDATE payments")) return { affectedRows: 1 }; return rows[params[0]] ? [rows[params[0]]] : []; } },
  });
  const { NextRequest } = require("next/server");
  process.env.PROMPTPAY_ID = "0812345678";
  try {
    const open = await (await route.GET(new NextRequest("http://localhost/api/payments/promptpay?paymentNo=PAYPACK1234"))).json();
    assert.equal(open.qrExpiresIn, 840);
    assert.equal(open.qrExpired, false);
    assert.equal(open.original, 2000, "the price before the weekly deal");
    assert.equal(open.payee.name, process.env.PROMPTPAY_NAME || "PPA Power Play Sport Club");
    assert.match(seen[0][0], /INTERVAL 15 MINUTE\)\) qrSeconds/);
    const lapsed = await (await route.GET(new NextRequest("http://localhost/api/payments/promptpay?paymentNo=PAYLAPS1234"))).json();
    assert.equal(lapsed.qrExpired, true);
    assert.equal(lapsed.qr, null, "an expired QR is not shown");
    await route.POST(new NextRequest("http://localhost/api/payments/promptpay", { method: "POST", body: JSON.stringify({ paymentNo: "PAYLAPS1234" }) }));
    const renew = seen.find(([sql]) => sql.startsWith("UPDATE payments"));
    assert.match(renew[0], /'\$\.qrIssuedAt'/);
    assert.match(renew[0], /booking_id IS NULL/, "a booking's QR follows its hold");
    assert.deepEqual(renew[1], ["PAYLAPS1234", 2]);
  } finally {
    delete process.env.PROMPTPAY_ID;
  }
});

// ---------- Database, back office, app ----------

test("schema: new tables and columns, the one-time class update behind its marker, seeds at the design's prices", () => {
  for (const table of ["ppa_members", "member_otps", "promotion_claims"]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`), table);
  assert.ok(schema.includes("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS trainer_id BIGINT UNSIGNED NULL"));
  assert.ok(schema.includes("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS resource_code VARCHAR(40) NULL"));
  assert.match(schema, /UNIQUE KEY uq_promotion_claim \(user_id, deal_slug, period_key\)/);
  const marker = "ppa-part-6-12-v1";
  const uses = statements.filter((statement) => statement.includes(`'${marker}'`));
  assert.ok(uses.length >= 8);
  assert.ok(uses.slice(0, -1).every((statement) => statement.includes(`NOT EXISTS (SELECT 1 FROM schema_markers WHERE name = '${marker}')`)), "every one-time change is guarded");
  assert.match(uses.at(-1), new RegExp(`^INSERT IGNORE INTO schema_markers \\(name\\) VALUES \\('${marker}'\\)`));
  assert.ok(schema.indexOf("CREATE TABLE IF NOT EXISTS schema_markers") < schema.indexOf(`'${marker}'`));
  const prices = [
    ["PILATES-PR-1", 990, 1, 30], ["PILATES-PR-TRIAL", 1390, 2, 30], ["PILATES-PR-10", 8900, 10, 90], ["PILATES-PR-20", 15800, 20, 180], ["PILATES-PR-30", 20700, 30, 180],
    ["PILATES-DUO-1", 1590, 1, 30], ["PILATES-DUO-TRIAL", 1990, 2, 30], ["PILATES-DUO-10", 14900, 10, 90], ["PILATES-DUO-20", 27800, 20, 180], ["PILATES-DUO-30", 38700, 30, 270],
    ["PILATES-ROOM-1", 700, 1, 30], ["PILATES-RENT-REFORMER-1", 400, 1, 30],
    ["PILATES-GRP-1", 790, 1, 30], ["PILATES-GRP-TRIAL", 890, 2, 30], ["PILATES-GRP-10", 6900, 10, 90], ["PILATES-GRP-20", 11800, 20, 180], ["PILATES-GRP-30", 14700, 30, 270], ["PILATES-GRP-50", 22000, 50, 365],
    ["AIRFIT-P2-1", 1590, 1, 30], ["AIRFIT-P2-TRIAL", 1990, 2, 30], ["AIRFIT-P2-10", 14900, 10, 90], ["AIRFIT-P2-20", 27800, 20, 180], ["AIRFIT-P2-30", 38700, 30, 270],
    ["SWIM-COUPON-10", 1600, 10, 60], ["SWIM-FIT-COUPON-10", 2400, 10, 60], ["SWIM-HYROX-COUPON-30", 6300, 30, 120], ["SWIM-COUPON-60", 7200, 60, 180], ["SWIM-COUPON-120", 12000, 120, 365], ["SWIM-HYROX-COUPON-120", 18000, 120, 365],
  ];
  for (const [code, price, uses, days] of prices) assert.match(schema, new RegExp(`\\('${code}', '[^']+', '[a-z0-9-]+', ${price}, ${uses}, ${days}, TRUE`), code);
  assert.match(schema, /\('FIT-WEEKLY-FREE', '[^']+', 'fitness', 0, 1, 7, FALSE/, "granted, never sold");
  for (const [slug, price] of [["swim-1-visit", 200], ["swim-fitness-1-visit", 300], ["swim-1-week", 1000], ["swim-hyrox-1-week", 1500], ["swim-1m", 2000], ["swim-fitness-1m", 2700], ["swim-6m", 10885], ["swim-hyrox-6m", 11485], ["swim-12m", 19200], ["swim-fitness-12m", 19700], ["member-swim-unlimited", 5000], ["member-airfit-unlimited", 5000], ["member-pilates-unlimited", 5000]]) {
    assert.match(schema, new RegExp(`'${slug}', [^\\n]*, ${price}, '\\{`), slug);
  }
  for (const slug of ["service-yoga", "service-zumba", "service-kpop", "service-cover-dance", "service-circuit", "pilates-rent-reformer", "deal-package-10", "deal-weekly-coupon", "deal-trainer-2h"]) assert.match(schema, new RegExp(`'${slug}'`), slug);
  assert.match(schema, /'hyrox-class'[^\n]*"capacity":10,/, "HYROX Class: 10 a time");
  assert.match(schema, /'pilates-group'[^\n]*"minPeople":3,/, "Reformer Group opens with 3");
  assert.doesNotMatch(schema, /"name":"ครูนายต์"/, "the instructor is ครูมายด์");
  for (const needle of ["'SWIM-COUPON-10'", "'service-yoga'", "'deal-package-10'", "'member-swim-unlimited'", "'PILATES-PR-1'"]) {
    assert.match(statements.find((statement) => statement.includes(needle)), /^INSERT IGNORE INTO/, `${needle} keeps admin edits`);
  }
});

test("seeded classes and deals pass the checks the back office applies", () => {
  const { programProblem } = load("lib/class-programs.ts");
  const { dealProblem } = load("lib/promotions.ts");
  const rows = [...schema.matchAll(/\('class_program', '([a-z0-9-]+)', '([^']*)', (?:'[^']*'|NULL), (?:'[^']*'|NULL), '[^']*', '[^']*', '[a-z]+', (\d+), '(\{[^']*\})', \d+\)/g)];
  assert.ok(rows.length >= 19, String(rows.length));
  for (const [, slug, title, price, metadata] of rows) assert.equal(programProblem({ id: 1, slug, title, price: Number(price), metadata }), null, slug);
  const deals = [...schema.matchAll(/\('promotion_deal', '([a-z0-9-]+)'[^\n]*'(\{[^']*\})', \d+\)/g)];
  assert.equal(deals.length, 3);
  for (const [, slug, metadata] of deals) assert.equal(dealProblem(JSON.parse(metadata)), null, slug);
});

test("back office: Classes and Promotion sections and their resources are permission-gated", () => {
  const { requiredPermissions, canAccessSection } = load("lib/admin-permissions.ts");
  assert.deepEqual(requiredPermissions("classes", "POST"), ["bookings.manage"]);
  assert.deepEqual(requiredPermissions("promotions", "PUT"), ["content.manage"]);
  assert.deepEqual(requiredPermissions("ppa-members", "GET"), ["members.manage"]);
  assert.equal(canAccessSection("classes", (code) => code === "bookings.manage"), true);
  assert.equal(canAccessSection("promotions", (code) => code === "bookings.manage"), false);
  const { contentProblem } = load("lib/site-settings.ts");
  assert.match(contentProblem("class_program", "x", { service: "pilates", kind: "coupon", times: ["08:00"], capacity: 1 }), /couponCategories/, "content saves check class programs too");
  assert.match(contentProblem("promotion_deal", "x", { kind: "discount", percent: 0 }), /percent/);
  assert.match(contentProblem("site_setting", "member-tiers", {}), /tiers/);
  const console = readFileSync("components/admin-console.tsx", "utf8");
  assert.match(console, /\{tab === "classes" && <AdminClasses lang=\{lang\} \/>\}/);
  assert.match(console, /\{tab === "promotions" && <AdminPromotions lang=\{lang\} \/>\}/);
  const cron = readFileSync("app/api/cron/run/route.ts", "utf8");
  assert.match(cron, /runJob\(\(conn\) => cancelUnderfilledClasses\(conn\)\)/);
});

test("the member app opens the QR payment from a price, and has the new pages", () => {
  const app = readFileSync("components/ppa-app.tsx", "utf8");
  assert.match(app, /function startCheckout\(/);
  assert.match(app, /void pay\("promptpay", target, requestId\)/, "no method screen when the app credit cannot pay");
  assert.doesNotMatch(app, /setPendingItem\(\{[^}]*\}\);\s*go\("payment"\)/, "purchases go through startCheckout");
  for (const screen of ["<PromotionScreen", "<MemberVerifyScreen", "<TimetableScreen", 'page="swim"', 'service={service}']) assert.ok(app.includes(screen), screen);
  const pay = readFileSync("components/member-promptpay.tsx", "utf8");
  assert.match(pay, /t\("สแกนชำระเงิน"\)/);
  assert.match(pay, /t\("QR หมดอายุใน"\)/);
  assert.match(pay, /t\("บันทึกรูป QR"\)/);
  const { allMessages } = load("lib/i18n/index.ts");
  const keys = new Set(allMessages.map(([key]) => key));
  for (const title of ["คลาสถูกยกเลิก", "ยกเลิกรอบเรียน"]) assert.ok(keys.has(title), title);
  for (const file of ["lib/ppa-member.ts", "lib/promotions.ts"]) {
    for (const match of readFileSync(file, "utf8").matchAll(/new (?:MemberVerifyError|PromotionError)\("([^"]+)"/g)) assert.ok(keys.has(match[1]), `${file}: ${match[1]}`);
  }
});
