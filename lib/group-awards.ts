import type mysql from "mysql2/promise";
import { notifyMember } from "@/lib/notify";

type Connection = Pick<mysql.PoolConnection, "execute">;
export type AwardNotice = { userId: number; title: string; body: string };

// Coins for groups (ก๊วน), as the group rules in the app say:
//   top_of_day: the group with the most members among the groups of a sport that played that day:
//     the owner gets 2 Coins, every other member 1.
//   streak_3:   a group that played three days in a row: the owner gets 3 Coins, every other member 2;
//     a day already counted in an earlier streak does not count again.
// A group played on a day when its owner had a paid (or checked-in) court booking of the group's sport
// starting that day. Each award is written once in group_awards, so the job can run at any interval.
//
// The Coins are received at the counter (PPA app analysis V2, item 2: "🎁 รับ Coin" shows a QR/code):
// each member gets a one-use right (user_entitlements, type group_coin, valid 30 days) and the Coins
// reach the wallet when staff scan its QR (app/api/admin/qr/verify).
export const GROUP_AWARDS = {
  top_of_day: { owner: 2, member: 1 },
  streak_3: { owner: 3, member: 2 },
} as const;
export const GROUP_COIN_VALID_DAYS = 30;

type PlayedGroup = { id: number; sportId: number; ownerUserId: number; name: string; createdAt: string; members: number; day1: number; day2: number };

export function previousDay(date: string, days = 1) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

const playedOn = (alias: string) => `EXISTS (SELECT 1 FROM bookings b WHERE b.user_id = ${alias}.owner_user_id AND b.sport_id = ${alias}.sport_id AND b.court_id IS NOT NULL AND b.status IN ('paid','checked_in') AND b.starts_at >= ? AND b.starts_at < ?)`;

// Winners of one day per sport (pure): most members, then the group created first.
export function topGroups(groups: Pick<PlayedGroup, "id" | "sportId" | "members" | "createdAt">[]) {
  const best = new Map<number, (typeof groups)[number]>();
  for (const group of groups) {
    const current = best.get(Number(group.sportId));
    if (!current || group.members > current.members || (group.members === current.members && String(group.createdAt) < String(current.createdAt))) best.set(Number(group.sportId), group);
  }
  return [...best.values()].map((group) => group.id);
}

const shortDate = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

async function award(conn: Connection, group: PlayedGroup, kind: keyof typeof GROUP_AWARDS, day: string): Promise<AwardNotice[]> {
  const coins = GROUP_AWARDS[kind];
  const [inserted] = await conn.execute(
    "INSERT IGNORE INTO group_awards (kind, group_id, award_date, coins_owner, coins_member, members) VALUES (?, ?, ?, ?, ?, ?)",
    [kind, group.id, day, coins.owner, coins.member, group.members],
  );
  if (Number((inserted as { affectedRows?: number }).affectedRows) !== 1) return [];
  const [members] = await conn.execute("SELECT user_id userId FROM group_members WHERE group_id = ?", [group.id]);
  const notices: AwardNotice[] = [];
  const userIds = new Set([Number(group.ownerUserId), ...(members as { userId: number }[]).map((member) => Number(member.userId))]);
  const reason = kind === "top_of_day" ? `อันดับ 1 ก๊วนประจำวัน ${shortDate(day)}` : `เล่นต่อเนื่อง 3 วัน ถึง ${shortDate(day)}`;
  for (const userId of userIds) {
    const owner = userId === Number(group.ownerUserId);
    const amount = owner ? coins.owner : coins.member;
    const title = `🎁 ${amount} Coin · ก๊วน ${group.name} · ${reason}`.slice(0, 180);
    await conn.execute(
      `INSERT INTO user_entitlements (user_id, payment_id, entitlement_type, title, remaining_uses, ends_at, status, metadata) VALUES (?, NULL, 'group_coin', ?, 1, DATE_ADD(NOW(), INTERVAL ${GROUP_COIN_VALID_DAYS} DAY), 'active', ?)`,
      [userId, title, JSON.stringify({ source: "group_award", coins: amount, kind, groupId: Number(group.id), groupName: group.name, awardDate: day, role: owner ? "owner" : "member" })],
    );
    const notice = { userId, title: "ก๊วนได้รับ Coin", body: `ก๊วน ${group.name} · ${reason} · รับ ${amount} Coin ที่เคาน์เตอร์: เปิดหน้าอันดับก๊วนแล้วกด 🎁 รับ Coin (ภายใน ${GROUP_COIN_VALID_DAYS} วัน)` };
    await notifyMember(conn, userId, notice.title, notice.body);
    notices.push(notice);
  }
  return notices;
}

// Awards for `day` (a finished Bangkok day, normally yesterday).
export async function awardGroupCoins(conn: Connection, day: string): Promise<AwardNotice[]> {
  const dayStart = `${day} 00:00:00`;
  const dayEnd = `${previousDay(day, -1)} 00:00:00`;
  const day1 = previousDay(day, 1);
  const day2 = previousDay(day, 2);
  const [rows] = await conn.execute(
    "SELECT g.id, g.sport_id sportId, g.owner_user_id ownerUserId, g.name, DATE_FORMAT(g.created_at, '%Y-%m-%d %H:%i:%s') createdAt, " +
      "(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) members, " +
      `${playedOn("g")} day1, ${playedOn("g")} day2 ` +
      `FROM groups_clubs g WHERE g.status = 'active' AND ${playedOn("g")} LIMIT 500`,
    [`${day1} 00:00:00`, dayStart, `${day2} 00:00:00`, `${day1} 00:00:00`, dayStart, dayEnd],
  );
  const played = (rows as PlayedGroup[]).map((row) => ({ ...row, members: Number(row.members) }));
  const notices: AwardNotice[] = [];
  const tops = new Set(topGroups(played));
  for (const group of played) {
    if (tops.has(group.id) && group.members > 0) notices.push(...await award(conn, group, "top_of_day", day));
    if (Number(group.day1) && Number(group.day2)) {
      const [earlier] = await conn.execute("SELECT award_date FROM group_awards WHERE kind = 'streak_3' AND group_id = ? AND award_date IN (?, ?) LIMIT 1", [group.id, day1, day2]);
      if (!(earlier as unknown[]).length) notices.push(...await award(conn, group, "streak_3", day));
    }
  }
  return notices;
}

// Where no cron job runs, the group pages settle the last three finished days (oldest first, so a
// streak sees the day before it). Each award is recorded once, so running it again changes nothing.
export async function awardRecentGroupCoins(conn: Connection, today: string): Promise<AwardNotice[]> {
  const notices: AwardNotice[] = [];
  for (const back of [3, 2, 1]) notices.push(...await awardGroupCoins(conn, previousDay(today, back)));
  return notices;
}
