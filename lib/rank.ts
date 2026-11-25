// Buffet Rank and Open Run: skill rating (ELO), skill tiers (Skill Rating Matrix), automatic pairing
// and the king-of-the-court rotation ("แพ้ออก · ชนะติดกัน 2 ครั้งออกทั้งคู่"). Pure functions shared by the
// server (lib/rank-server.ts), the back office and the member app: no server imports.

export type SkillTier = { name: string; min: number };
export type RatingSettings = { start: number; k: number; provisionalGames: number; provisionalK: number; tiers: SkillTier[] };

export const defaultRatingSettings: RatingSettings = {
  start: 1000,
  k: 32,
  provisionalGames: 10,
  provisionalK: 48,
  tiers: [
    { name: "มือใหม่", min: 0 },
    { name: "ฝึกหน้าบ้าน", min: 1050 },
    { name: "พอตัว", min: 1150 },
    { name: "แข่งขัน", min: 1300 },
  ],
};

function record(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function integer(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

// Site setting "skill-rating"; anything missing or invalid keeps the default.
export function ratingSettings(metadata: unknown): RatingSettings {
  const source = record(metadata);
  const tiers = Array.isArray(source.tiers)
    ? source.tiers
      .map((tier) => record(tier))
      .filter((tier) => typeof tier.name === "string" && tier.name.trim() && typeof tier.min === "number" && Number.isFinite(tier.min))
      .map((tier) => ({ name: String(tier.name).trim().slice(0, 40), min: Math.round(Number(tier.min)) }))
      .sort((a, b) => a.min - b.min)
    : [];
  return {
    start: integer(source.start, 100, 3000, defaultRatingSettings.start),
    k: integer(source.k, 4, 100, defaultRatingSettings.k),
    provisionalGames: integer(source.provisionalGames, 0, 100, defaultRatingSettings.provisionalGames),
    provisionalK: integer(source.provisionalK, 4, 120, defaultRatingSettings.provisionalK),
    tiers: tiers.length ? tiers : defaultRatingSettings.tiers,
  };
}

// Problem text for the back office, or null when the setting is usable as written.
export function ratingSettingsProblem(metadata: Record<string, unknown>) {
  if (!Array.isArray(metadata.tiers) || !metadata.tiers.length) return "skill-rating: ต้องมี tiers อย่างน้อย 1 ระดับ เช่น [{\"name\":\"มือใหม่\",\"min\":0}]";
  const parsed = ratingSettings(metadata);
  if (parsed.tiers.length !== metadata.tiers.length) return "skill-rating: ทุก tier ต้องมี name และ min เป็นตัวเลข";
  if (new Set(parsed.tiers.map((tier) => tier.min)).size !== parsed.tiers.length) return "skill-rating: min ของแต่ละ tier ต้องไม่ซ้ำกัน";
  for (const key of ["start", "k", "provisionalGames", "provisionalK"]) {
    if (metadata[key] !== undefined && metadata[key] !== parsed[key as keyof RatingSettings]) return `skill-rating: ${key} ไม่ถูกต้อง`;
  }
  return null;
}

export type TierInfo = { name: string; min: number; next: SkillTier | null };

export function tierFor(rating: number, tiers: SkillTier[] = defaultRatingSettings.tiers): TierInfo {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  let index = 0;
  sorted.forEach((tier, position) => { if (rating >= tier.min) index = position; });
  const tier = sorted[index] || { name: "-", min: 0 };
  return { name: tier.name, min: tier.min, next: sorted[index + 1] || null };
}

export function expectedScore(rating: number, opponent: number) {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

export type RatedPlayer = { userId: number; rating: number; games: number };

// Rating change of every player of one doubles (or team) game: each team plays at its average rating;
// a player still in the first `provisionalGames` games moves faster (provisional K).
export function gameDeltas(teamA: RatedPlayer[], teamB: RatedPlayer[], winner: "a" | "b", settings: RatingSettings = defaultRatingSettings) {
  const average = (team: RatedPlayer[]) => team.reduce((sum, player) => sum + Number(player.rating), 0) / Math.max(1, team.length);
  const expectedA = expectedScore(average(teamA), average(teamB));
  const scoreA = winner === "a" ? 1 : 0;
  const deltas = new Map<number, number>();
  const kOf = (player: RatedPlayer) => (Number(player.games) < settings.provisionalGames ? settings.provisionalK : settings.k);
  for (const player of teamA) deltas.set(player.userId, Math.round(kOf(player) * (scoreA - expectedA)));
  for (const player of teamB) deltas.set(player.userId, Math.round(kOf(player) * ((1 - scoreA) - (1 - expectedA))));
  return deltas;
}

export type QueuedPlayer = { userId: number; rating: number; queue: number };
export type Pairing = { teams: { no: number; userIds: number[]; rating: number }[]; reserves: number[] };

// Automatic pairing: players in payment order (first paid, first in); the latest payers beyond full
// teams wait as reserves. Teams are balanced by rating (snake draft: the strongest player with the
// weakest), and teams take the court in the order of their earliest payer.
export function buildPairing(players: QueuedPlayer[], teamSize = 2): Pairing {
  const size = Math.max(1, Math.trunc(teamSize));
  const byQueue = [...players].sort((a, b) => a.queue - b.queue || a.userId - b.userId);
  const teamCount = Math.floor(byQueue.length / size);
  if (teamCount < 2) return { teams: [], reserves: byQueue.map((player) => player.userId) };
  const playing = byQueue.slice(0, teamCount * size);
  const reserves = byQueue.slice(teamCount * size).map((player) => player.userId);
  const byRating = [...playing].sort((a, b) => b.rating - a.rating || a.queue - b.queue);
  const teams = Array.from({ length: teamCount }, () => [] as QueuedPlayer[]);
  byRating.forEach((player, index) => {
    const round = Math.floor(index / teamCount);
    const position = index % teamCount;
    teams[round % 2 === 0 ? position : teamCount - 1 - position].push(player);
  });
  const ordered = teams
    .map((members) => ({ members, first: Math.min(...members.map((member) => member.queue)) }))
    .sort((a, b) => a.first - b.first);
  return {
    teams: ordered.map(({ members }, index) => ({
      no: index + 1,
      userIds: [...members].sort((a, b) => a.queue - b.queue).map((member) => member.userId),
      rating: Math.round(members.reduce((sum, member) => sum + member.rating, 0) / members.length),
    })),
    reserves,
  };
}

// Number of the pairing team made of exactly these players, or null.
export function teamNumberOf(pairing: Pairing, userIds: number[]) {
  const key = [...userIds].map(Number).sort((a, b) => a - b).join(",");
  return pairing.teams.find((team) => [...team.userIds].sort((a, b) => a - b).join(",") === key)?.no ?? null;
}

export type CourtResult = { a: number; b: number; winner: "a" | "b" };

// King of the court: the first two teams play; the loser goes to the back of the queue and the winner
// stays, until it wins twice in a row: then both teams leave and the next two in the queue play.
// Returns the teams on court now (from the recorded results) and the queue behind them.
export function courtRotation(teamNumbers: number[], results: CourtResult[], winsToLeave = 2) {
  const queue = [...teamNumbers];
  if (queue.length < 2) return { onCourt: null as [number, number] | null, queue, streak: 0 };
  let onCourt: [number, number] = [queue.shift()!, queue.shift()!];
  let streakTeam = 0;
  let streak = 0;
  for (const result of results) {
    const winner = result.winner === "a" ? result.a : result.b;
    const loser = result.winner === "a" ? result.b : result.a;
    if (!onCourt.includes(winner) || !onCourt.includes(loser)) continue;
    streak = streakTeam === winner ? streak + 1 : 1;
    streakTeam = winner;
    queue.push(loser);
    if (streak >= winsToLeave) {
      queue.push(winner);
      streak = 0;
      streakTeam = 0;
      onCourt = [queue.shift()!, queue.shift()!];
    } else {
      onCourt = [winner, queue.shift()!];
    }
  }
  return { onCourt, queue, streak };
}

export type GameRecord = { teamA: number[]; teamB: number[]; winner: "a" | "b"; ratingChanges?: Record<string, number> | null };
export type Standing = { userId: number; wins: number; played: number; gain: number };

// Daily winners of a session: most wins, then the biggest rating gain, then fewest games.
export function sessionStandings(games: GameRecord[]): Standing[] {
  const table = new Map<number, Standing>();
  const row = (userId: number) => {
    const existing = table.get(userId);
    if (existing) return existing;
    const created = { userId, wins: 0, played: 0, gain: 0 };
    table.set(userId, created);
    return created;
  };
  for (const game of games) {
    for (const [team, side] of [[game.teamA, "a"], [game.teamB, "b"]] as const) {
      for (const userId of team) {
        const entry = row(Number(userId));
        entry.played += 1;
        if (game.winner === side) entry.wins += 1;
        entry.gain += Number(game.ratingChanges?.[String(userId)] || 0);
      }
    }
  }
  return [...table.values()].sort((a, b) => b.wins - a.wins || b.gain - a.gain || a.played - b.played || a.userId - b.userId);
}

// Coins for the top places ("5,3,2"): only players with at least one win get a prize.
export function prizeAwards(standings: Standing[], prizeCoins: string | null | undefined) {
  const prizes = String(prizeCoins || "").split(",").map((value) => Math.trunc(Number(value.trim()))).filter((value) => Number.isFinite(value) && value > 0).slice(0, 10);
  return standings.filter((standing) => standing.wins > 0).slice(0, prizes.length).map((standing, index) => ({ ...standing, place: index + 1, coins: prizes[index] }));
}

// Room slots "18:00-20:00,20:00-22:00" → valid whole-hour ranges inside one day.
export function parseRoomSlots(text: string | null | undefined) {
  return String(text || "")
    .split(",")
    .map((part) => part.trim())
    .map((part) => /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/.exec(part))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ from: `${match[1]}:${match[2]}`, to: `${match[3]}:${match[4]}` }))
    .filter((slot) => slot.from < slot.to);
}

// When a session pairs players and when joining closes (minutes before the start).
export function sessionTimes(startsAt: string, matchMinutes: number, closeMinutes: number) {
  const start = Date.parse(`${startsAt.replace(" ", "T")}+07:00`);
  return { start, matchAt: start - matchMinutes * 60_000, closeAt: start - closeMinutes * 60_000 };
}
