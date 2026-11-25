// Big Screen Live: the program guide of the club's big screens (world sport and club tournaments),
// with the zone where each one is shown. Pure and dependency-free: the member app imports it.

export type ScreenProgram = {
  id: number;
  title: string;
  subtitle?: string | null;
  icon: string;
  zone: string;
  // Bangkok wall clock "YYYY-MM-DD HH:MM:SS" (or an ISO instant from a JSON date).
  startsAt: string;
  endsAt: string;
  metadata?: unknown;
};

export const SCREEN_ZONES = ["ZONE A", "ZONE B", "ARENA"];

export function wallTime(value: unknown) {
  if (value instanceof Date) return value.getTime();
  const text = String(value || "");
  return Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}+07:00`);
}

function bangkokDay(time: number) {
  return new Date(time + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function isLiveNow(program: Pick<ScreenProgram, "startsAt" | "endsAt">, now = Date.now()) {
  return wallTime(program.startsAt) <= now && now < wallTime(program.endsAt);
}

// "today": what is on now plus everything still to start today; "tomorrow": tomorrow's start times.
// Finished programs are not listed. Sorted by start time.
export function programsForDay<T extends Pick<ScreenProgram, "startsAt" | "endsAt">>(programs: T[], day: "today" | "tomorrow", now = Date.now()) {
  const today = bangkokDay(now);
  const tomorrow = bangkokDay(now + 86_400_000);
  return programs
    .filter((program) => {
      const start = wallTime(program.startsAt);
      const end = wallTime(program.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) return false;
      if (day === "tomorrow") return bangkokDay(start) === tomorrow;
      return bangkokDay(start) === today || start <= now;
    })
    .sort((a, b) => wallTime(a.startsAt) - wallTime(b.startsAt));
}

export function clockText(value: unknown) {
  const time = wallTime(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time + 7 * 3_600_000).toISOString().slice(11, 16);
}

export function sqlWallClock(value: string) {
  const [date, time = "00:00"] = value.replace("T", " ").split(" ");
  return `${date} ${time.length === 5 ? `${time}:00` : time}`;
}
