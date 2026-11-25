import { query } from "@/lib/db";

export type GroupRow = {
  id: number;
  name: string;
  levelName: string;
  description: string | null;
  photoUrl: string | null;
  sportSlug: string;
  sportName: string;
  sportIcon: string;
  maxPlayers: number;
  memberCount: number;
  playAt: string | null;
  joined: number;
  isOwner: number;
};

export const GROUP_MAX_DAYS_AHEAD = 60;
// A group (ก๊วน) is a standing group of players, not one game: up to 30 members. Play times and the
// number of players belong to the court booking the owner makes for the group.
export const GROUP_MAX_MEMBERS = 30;
// Members the owner may add by member ID when creating the group (the owner is the first member).
export const GROUP_MAX_INVITES = GROUP_MAX_MEMBERS - 1;

// The club's groups with live member counts. A group is a standing group: it stays listed until its
// owner (or staff) closes it, whatever its last play time (play_at is the next court the owner booked).
// The member's own groups come first, then groups with places, then the newest.
export function listGroups(userId: number, limit: number) {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(Number(limit)) || 1));
  return query<GroupRow>(
    "SELECT g.id, g.name, g.level_name levelName, g.description, g.photo_url photoUrl, s.slug sportSlug, s.name_th sportName, s.icon sportIcon, g.max_players maxPlayers, g.play_at playAt, " +
      "(SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) memberCount, " +
      "EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) joined, g.owner_user_id = ? isOwner " +
      "FROM groups_clubs g JOIN sports s ON s.id = g.sport_id " +
      "WHERE g.status = 'active' " +
      "ORDER BY joined DESC, (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) >= g.max_players, g.created_at DESC " +
      `LIMIT ${safeLimit}`,
    [userId, userId],
  );
}

// "YYYY-MM-DDTHH:mm" in Bangkok time → SQL wall-clock DATETIME, or null when it is not
// a real time in the future within the allowed window.
export function groupPlayAt(value: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const time = new Date(`${value}:00+07:00`).getTime();
  if (!Number.isFinite(time) || new Date(time + 7 * 3_600_000).toISOString().slice(0, 16) !== value) return null;
  if (time <= now || time > now + GROUP_MAX_DAYS_AHEAD * 86_400_000) return null;
  return `${value.replace("T", " ")}:00`;
}

// The member ID shown on the profile (users.member_code, "PPA-" and 8 hex characters). Members type
// it with or without "PPA-", in any case and with spaces; anything else is not an ID.
export function normalizeMemberCode(value: string) {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  if (/^PPA-[0-9A-Z]{3,24}$/.test(text)) return text;
  if (/^PPA[0-9A-F]{8}$/.test(text)) return `PPA-${text.slice(3)}`;
  if (/^[0-9A-F]{8}$/.test(text)) return `PPA-${text}`;
  return null;
}

// Group photos are saved as /uploads/groups/<timestamp>-<uuid>.<ext> (app/api/groups/photo).
export const groupPhotoPattern = /^\/uploads\/groups\/[A-Za-z0-9-]{1,120}\.(jpg|png|webp)$/;
