// Find Your Game (PPA app analysis V2, item 4): the cards of the club's Buffet Rank / Open Run sessions.
// Pure helpers, safe in client components; every number comes from GET /api/rank/live.

export type LiveGame = {
  sportSlug: string; sportName: string; sportIcon: string; roomId: number; roomTitle: string; roomIcon: string; kind: "buffet" | "open_run";
  levelName: string | null; teamSize: number; capacity: number; minPlayers: number; price: number;
  date: string; from: string; to: string; startsAt: string; day: "today" | "tomorrow";
  taken: number; left: number; joinable: boolean; live: boolean; mine: boolean;
};
export type LiveFeed = { games: LiveGame[]; sports: { slug: string; name: string; icon: string }[] };

// What a session still needs, in words (Thai source text + values for t()):
//   playing now → "กำลังเล่นอยู่ · {n} คน"; full → "เต็มแล้ว";
//   Buffet Rank with a court not yet complete (4 per court in doubles) → "ขาดคู่ตีเบิ้ลอีก {n} คน";
//   short of the session's minimum → "ขาดอีก {n} คนจะเปิดรอบ";
//   Open Run → "เหลือ {n} ที่" ("… ที่เท่านั้น" when 3 or fewer); otherwise "เปิดรับเพิ่มอีก {n} คน".
export function gameNeed(game: Pick<LiveGame, "kind" | "teamSize" | "taken" | "left" | "minPlayers" | "live" | "joinable">): { text: string; values: Record<string, number>; tone: "live" | "full" | "need" | "open" } {
  if (game.live && !game.joinable) return { text: "กำลังเล่นอยู่ · {{value0}} คน", values: { value0: game.taken }, tone: "live" };
  if (game.left <= 0) return { text: "เต็มแล้ว", values: {}, tone: "full" };
  if (game.kind === "buffet" && game.taken > 0) {
    const perCourt = Math.max(2, Number(game.teamSize) || 2) * 2;
    const short = (perCourt - (game.taken % perCourt)) % perCourt;
    if (short > 0 && short <= game.left) return { text: game.teamSize === 2 ? "ขาดคู่ตีเบิ้ลอีก {{value0}} คน" : "ขาดอีก {{value0}} คนครบทีม", values: { value0: short }, tone: "need" };
  }
  if (game.taken < game.minPlayers) return { text: "ขาดอีก {{value0}} คนจะเปิดรอบ", values: { value0: Math.min(game.left, game.minPlayers - game.taken) }, tone: "need" };
  if (game.kind === "open_run") return { text: game.left <= 3 ? "เหลือ {{value0}} ที่เท่านั้น" : "เหลือ {{value0}} ที่", values: { value0: game.left }, tone: game.left <= 3 ? "need" : "open" };
  return { text: "เปิดรับเพิ่มอีก {{value0}} คน", values: { value0: game.left }, tone: "open" };
}

// LIVE on the Find Your Game header: a session is being played now, or one can still be joined today.
export function feedIsLive(games: Pick<LiveGame, "live" | "joinable" | "day">[]) {
  return games.some((game) => game.live || (game.joinable && game.day === "today"));
}

// Up to `limit` cards for the home row: games being played and today's first, then by start time.
export function homeGames<T extends Pick<LiveGame, "live" | "day" | "startsAt" | "left" | "joinable">>(games: T[], limit = 6) {
  return [...games]
    .filter((game) => game.live || game.joinable)
    .sort((a, b) => Number(b.live) - Number(a.live) || Number(a.day !== "today") - Number(b.day !== "today") || a.startsAt.localeCompare(b.startsAt))
    .slice(0, Math.max(0, limit));
}

// Quick Booking: the sports the member books most often first (from the member's recent bookings),
// the club's own order otherwise.
export function sportsByUse<T extends { slug: string }>(sports: T[], bookings: { sportSlug?: string | null; status?: string }[]) {
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    if (!booking.sportSlug || ["cancelled", "expired"].includes(String(booking.status))) continue;
    counts.set(booking.sportSlug, (counts.get(booking.sportSlug) || 0) + 1);
  }
  return sports.map((sport, index) => ({ sport, index, count: counts.get(sport.slug) || 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((item) => item.sport);
}
