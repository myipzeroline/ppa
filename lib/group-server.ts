import { query } from "@/lib/db";
import { bangkokToday } from "@/lib/court-availability";
import { previousDay } from "@/lib/group-awards";
import { normalizeMemberCode } from "@/lib/groups";
import { loadRatingSettings } from "@/lib/rank-server";
import { tierFor } from "@/lib/rank";
import { notWalkIn } from "@/lib/walk-in";

// Group (ก๊วน) pages of the member app: the group page, today's group ranking of a sport and the
// Coins a member won with a group (received at the counter with a QR, see lib/group-awards.ts).

type DetailRow = {
  id: number; name: string; levelName: string; description: string | null; photoUrl: string | null; status: string;
  ownerUserId: number; maxPlayers: number; createdAt: string; sportId: number; sportSlug: string; sportName: string; sportIcon: string; ownerName: string;
};
type MemberRow = { userId: number; displayName: string; avatar: string | null; avatarTier: string | null; rating: number | null; joinedAt: string };
type BookingRow = { bookingNo: string; title: string; startsAt: string; endsAt: string; courtName: string | null; status: string };

// The group page: who is in it, its level and description, and the courts its owner has booked
// (members are told those times when the owner pays, lib/booking-paid.ts).
export async function loadGroupDetail(userId: number, groupId: number) {
  const [group] = await query<DetailRow>(
    "SELECT g.id, g.name, g.level_name levelName, g.description, g.photo_url photoUrl, g.status, g.owner_user_id ownerUserId, g.max_players maxPlayers, " +
      "DATE_FORMAT(g.created_at, '%Y-%m-%d %H:%i:%s') createdAt, s.id sportId, s.slug sportSlug, s.name_th sportName, s.icon sportIcon, u.display_name ownerName " +
      "FROM groups_clubs g JOIN sports s ON s.id = g.sport_id JOIN users u ON u.id = g.owner_user_id WHERE g.id = ? AND g.status = 'active' LIMIT 1",
    [groupId],
  );
  if (!group) return null;
  const [members, settings] = await Promise.all([
    query<MemberRow>(
      "SELECT gm.user_id userId, u.display_name displayName, u.avatar, u.avatar_tier avatarTier, pr.rating, DATE_FORMAT(gm.joined_at, '%Y-%m-%d %H:%i:%s') joinedAt " +
        "FROM group_members gm JOIN users u ON u.id = gm.user_id LEFT JOIN player_ratings pr ON pr.user_id = gm.user_id AND pr.sport_id = ? " +
        "WHERE gm.group_id = ? ORDER BY gm.user_id = ? DESC, gm.joined_at, gm.user_id LIMIT 60",
      [group.sportId, groupId, group.ownerUserId],
    ),
    loadRatingSettings(),
  ]);
  const isOwner = Number(group.ownerUserId) === userId;
  const joined = members.some((member) => Number(member.userId) === userId);
  // Play times are the group's business: members (and the owner) see them, other members of the club do not.
  const bookings = joined ? await query<BookingRow>(
    "SELECT b.booking_no bookingNo, b.title, DATE_FORMAT(b.starts_at, '%Y-%m-%d %H:%i:%s') startsAt, DATE_FORMAT(b.ends_at, '%Y-%m-%d %H:%i:%s') endsAt, c.name courtName, b.status " +
      "FROM bookings b LEFT JOIN courts c ON c.id = b.court_id WHERE b.user_id = ? AND b.sport_id = ? AND b.court_id IS NOT NULL AND b.status IN ('paid','checked_in') AND b.ends_at > NOW() ORDER BY b.starts_at LIMIT 5",
    [group.ownerUserId, group.sportId],
  ) : [];
  return {
    group: {
      id: Number(group.id), name: group.name, levelName: group.levelName, description: group.description, photoUrl: group.photoUrl,
      sportSlug: group.sportSlug, sportName: group.sportName, sportIcon: group.sportIcon, ownerName: group.ownerName, createdAt: group.createdAt,
      maxPlayers: Number(group.maxPlayers), memberCount: members.length, isOwner, joined,
    },
    members: members.map((member) => ({
      // Only the owner needs the id (to take someone out of the group).
      ...(isOwner ? { userId: Number(member.userId) } : {}),
      displayName: member.displayName,
      avatar: member.avatar || "",
      level: member.rating === null || member.rating === undefined ? member.avatarTier || "" : tierFor(Number(member.rating), settings.tiers).name,
      isOwner: Number(member.userId) === Number(group.ownerUserId),
      isMe: Number(member.userId) === userId,
    })),
    bookings,
  };
}

type RankingRow = { id: number; name: string; levelName: string; photoUrl: string | null; createdAt: string; members: number; mine: number };

// Today's group ranking of a sport (🏆 อันดับก๊วนวันนี้): the groups whose owner has a paid court booking
// of the sport starting today, most members first, then the group created first — the same rule as the
// day's award (lib/group-awards.ts topGroups), decided once the day is over.
export async function loadGroupRanking(userId: number, sportSlug: string, now = Date.now()) {
  const [sport] = await query<{ id: number; slug: string; name: string; icon: string }>("SELECT id, slug, name_th name, icon FROM sports WHERE slug = ? AND active = TRUE LIMIT 1", [sportSlug]);
  if (!sport) return null;
  const today = bangkokToday(now);
  const ranking = await query<RankingRow>(
    "SELECT g.id, g.name, g.level_name levelName, g.photo_url photoUrl, DATE_FORMAT(g.created_at, '%Y-%m-%d %H:%i:%s') createdAt, " +
      "(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) members, " +
      "EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) mine " +
      "FROM groups_clubs g WHERE g.status = 'active' AND g.sport_id = ? AND EXISTS (SELECT 1 FROM bookings b WHERE b.user_id = g.owner_user_id AND b.sport_id = g.sport_id AND b.court_id IS NOT NULL AND b.status IN ('paid','checked_in') AND b.starts_at >= ? AND b.starts_at < ?) " +
      "ORDER BY members DESC, g.created_at, g.id LIMIT 3",
    [userId, sport.id, `${today} 00:00:00`, `${previousDay(today, -1)} 00:00:00`],
  );
  return {
    date: today,
    sport: { slug: sport.slug, name: sport.name, icon: sport.icon },
    ranking: ranking.map((row, index) => ({ place: index + 1, id: Number(row.id), name: row.name, levelName: row.levelName, photoUrl: row.photoUrl, memberCount: Number(row.members), mine: Boolean(Number(row.mine)) })),
    claims: await loadCoinClaims(userId),
  };
}

export type CoinClaim = { entitlementId: number; title: string; coins: number; kind: string; groupId: number; groupName: string; awardDate: string; role: string; endsAt: string | null };

// Coins won with a group and not yet received: a one-use right whose QR staff scan at the counter.
export async function loadCoinClaims(userId: number): Promise<CoinClaim[]> {
  const rows = await query<{ id: number; title: string; endsAt: string | null; metadata: string | null }>(
    "SELECT id, title, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') endsAt, CAST(metadata AS CHAR) metadata FROM user_entitlements WHERE user_id = ? AND entitlement_type = 'group_coin' AND status = 'active' AND (ends_at IS NULL OR ends_at > NOW()) AND (remaining_uses IS NULL OR remaining_uses > 0) ORDER BY created_at DESC LIMIT 10",
    [userId],
  );
  return rows.map((row) => {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.metadata || "{}"); } catch { meta = {}; }
    return {
      entitlementId: Number(row.id), title: row.title, coins: Number(meta.coins) || 0, kind: String(meta.kind || ""), groupId: Number(meta.groupId) || 0,
      groupName: String(meta.groupName || ""), awardDate: String(meta.awardDate || ""), role: String(meta.role || "member"), endsAt: row.endsAt,
    };
  });
}

export type MemberLookup = { memberCode: string; displayName: string; avatar: string; level: string };

// A member found by the member ID on their profile, to add to a group. Suspended accounts, the
// counter's walk-in account and the member themself are never returned.
export async function lookupMember(code: string, userId: number): Promise<MemberLookup | "self" | "invalid" | null> {
  const memberCode = normalizeMemberCode(code);
  if (!memberCode) return "invalid";
  const [member] = await query<{ id: number; memberCode: string; displayName: string; avatar: string | null; avatarTier: string | null }>(
    `SELECT u.id, u.member_code memberCode, u.display_name displayName, u.avatar, u.avatar_tier avatarTier FROM users u WHERE u.member_code = ? AND u.status = 'active' AND ${notWalkIn("u")} LIMIT 1`,
    [memberCode],
  );
  if (!member) return null;
  if (Number(member.id) === userId) return "self";
  return { memberCode: member.memberCode, displayName: member.displayName, avatar: member.avatar || "", level: member.avatarTier || "" };
}
