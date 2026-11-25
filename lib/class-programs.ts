// Class programs (app_content_items content_type "class_program"): bookable times of HYROX Simulation,
// HYROX Series, HYROX Class, Airfit, Pilates and the free Service Classes. Pure: used by the class
// routes, the back office check and the member app.
//   kind "session": paid per booking (price), or with a coupon of couponCategories (Series credits).
//   kind "coupon":  needs a coupon of couponCategories ("มีคูปองถึงจะจองเวลาได้").
//   kind "series":  a HYROX program sold with a start time; paying it grants Simulation credits.
//   kind "free":    a Service Class: free for members with an active package (Active Member).
// Times are either `times` on `weekdays` (with `instructors` by time range, 01/02/03) or a weekly
// `schedule` of day + time + instructor (a class timetable that repeats every week of the month).

export type ClassKind = "session" | "coupon" | "series" | "free";
export type Instructor = { name: string; from: string; to: string };
export type ScheduleEntry = { day: number; time: string; instructor: string | null };
export type ClassProgram = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  icon: string;
  price: number;
  service: string;
  tab: string;
  group: string | null;
  subgroup: string | null;
  label: string | null;
  short: string | null;
  kind: ClassKind;
  sport: string;
  times: string[];
  minutes: number;
  capacity: number;
  weekdays: number[];
  schedule: ScheduleEntry[];
  couponCategories: string[];
  membershipServices: string[];
  instructors: Instructor[];
  resources: string[];
  resourceLabel: string | null;
  minPeople: number;
  confirmHours: number;
  weeks: number;
  simulations: number;
  trainerLink: boolean;
  trainerMatch: string | null;
  timetable: boolean;
  sortOrder: number;
};

type ContentLike = { id: number; slug: string; title: string; subtitle?: string | null; body?: string | null; icon?: string | null; price?: number | string | null; metadata?: unknown; sortOrder?: number | null };

const slugPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const kinds: ClassKind[] = ["session", "coupon", "series", "free"];
const everyDay = [0, 1, 2, 3, 4, 5, 6];

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

function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function slugList(value: unknown, max: number) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^[a-z0-9-]{1,80}$/.test(item)))].slice(0, max) : [];
}

export function minutesOf(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function clockOf(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function scheduleOf(value: unknown, minutes: number): ScheduleEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: ScheduleEntry[] = [];
  for (const raw of value.slice(0, 80)) {
    const row = record(raw);
    const day = integer(row.day, 0, 6);
    const time = typeof row.time === "string" && timePattern.test(row.time) ? row.time : null;
    if (day === null || !time || minutesOf(time) + minutes >= 24 * 60 || seen.has(`${day}-${time}`)) continue;
    seen.add(`${day}-${time}`);
    entries.push({ day, time, instructor: text(row.instructor, 40) });
  }
  return entries.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

// A usable program, or null when its metadata cannot be booked (the back office refuses to save it).
export function parseProgram(item: ContentLike): ClassProgram | null {
  const meta = record(item.metadata);
  const service = typeof meta.service === "string" && slugPattern.test(meta.service) ? meta.service : null;
  const kind = kinds.find((value) => value === meta.kind) || null;
  const minutes = integer(meta.minutes, 15, 360) ?? 60;
  const schedule = scheduleOf(meta.schedule, minutes);
  const listed = Array.isArray(meta.times)
    ? [...new Set(meta.times.filter((time): time is string => typeof time === "string" && timePattern.test(time)))]
      .filter((time) => minutesOf(time) + minutes < 24 * 60)
      .sort()
      .slice(0, 40)
    : [];
  // A weekly schedule decides the days and times; otherwise `times` run on `weekdays`.
  const times = schedule.length ? [...new Set(schedule.map((entry) => entry.time))].sort() : listed;
  const capacity = integer(meta.capacity, 1, 200);
  if (!service || !kind || !times.length || !capacity) return null;
  const listedDays = Array.isArray(meta.weekdays)
    ? [...new Set(meta.weekdays.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : everyDay;
  const weekdays = schedule.length ? [...new Set(schedule.map((entry) => entry.day))].sort() : listedDays.length ? listedDays : everyDay;
  const couponCategories = slugList(meta.couponCategories, 8);
  if (kind === "coupon" && !couponCategories.length) return null;
  const instructors = Array.isArray(meta.instructors)
    ? meta.instructors.map(record).filter((row) => typeof row.name === "string" && row.name.trim() && typeof row.from === "string" && timePattern.test(row.from) && typeof row.to === "string" && /^([01]\d|2[0-4]):[0-5]\d$/.test(row.to))
      .map((row) => ({ name: String(row.name).trim().slice(0, 40), from: String(row.from), to: String(row.to) }))
      .slice(0, 12)
    : [];
  const resources = Array.isArray(meta.resources)
    ? [...new Set(meta.resources.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim().slice(0, 40)))].slice(0, 30)
    : [];
  const trainerLink = meta.trainerLink === true;
  const minPeople = Math.min(integer(meta.minPeople, 0, 200) ?? 0, capacity);
  return {
    id: Number(item.id),
    slug: item.slug,
    title: item.title,
    subtitle: item.subtitle || null,
    body: item.body || null,
    icon: item.icon || "🗓️",
    price: Number(item.price || 0),
    service,
    tab: text(meta.tab, 32) || "class",
    group: text(meta.group, 40),
    subgroup: text(meta.subgroup, 40),
    label: text(meta.label, 40),
    short: text(meta.short, 24),
    kind,
    sport: typeof meta.sport === "string" && slugPattern.test(meta.sport) ? meta.sport : service,
    times,
    minutes,
    capacity,
    weekdays,
    schedule,
    couponCategories,
    membershipServices: slugList(meta.membershipServices, 6),
    instructors,
    resources,
    resourceLabel: text(meta.resourceLabel, 40),
    minPeople: kind === "coupon" || kind === "free" ? minPeople : 0,
    confirmHours: integer(meta.confirmHours, 1, 24) ?? 2,
    weeks: integer(meta.weeks, 1, 52) ?? 0,
    simulations: integer(meta.simulations, 0, 50) ?? 0,
    trainerLink,
    trainerMatch: text(meta.trainerMatch, 40),
    // The weekly class timetable lists group classes: free ones and coupon classes with places for many.
    timetable: typeof meta.timetable === "boolean" ? meta.timetable : kind === "free" || (kind === "coupon" && capacity > 1 && !trainerLink && !resources.length),
    sortOrder: Number(item.sortOrder || 0),
  };
}

// Back-office save check for content type class_program (null = fine).
export function programProblem(item: ContentLike) {
  const meta = record(item.metadata);
  if (!parseProgram(item)) {
    if (!kinds.includes(meta.kind as ClassKind)) return "class_program: metadata.kind ต้องเป็น session, coupon, series หรือ free";
    if (typeof meta.service !== "string" || !slugPattern.test(meta.service)) return "class_program: metadata.service ต้องเป็นตัวพิมพ์เล็ก เช่น hyrox";
    if ((!Array.isArray(meta.times) || !meta.times.length) && (!Array.isArray(meta.schedule) || !meta.schedule.length)) return "class_program: ต้องมี metadata.times เช่น [\"08:00\",\"09:30\"] หรือ metadata.schedule (วัน + เวลา)";
    if (Array.isArray(meta.schedule) && meta.schedule.length && !scheduleOf(meta.schedule, integer(meta.minutes, 15, 360) ?? 60).length) return "class_program: metadata.schedule ทุกแถวต้องมี day 0-6 (0 = อาทิตย์) และ time แบบ HH:MM";
    if (meta.kind === "coupon" && (!Array.isArray(meta.couponCategories) || !meta.couponCategories.length)) return "class_program: คลาสที่ใช้คูปองต้องมี metadata.couponCategories";
    return "class_program: metadata.capacity ต้องเป็นจำนวนเต็ม 1-200 และเวลาต้องจบภายในวัน";
  }
  const program = parseProgram(item)!;
  if ((program.kind === "session" || program.kind === "series") && !(program.price > 0)) return "class_program: รอบที่ชำระเงินต้องมีราคามากกว่า 0";
  if (program.kind === "series" && !program.weeks) return "class_program: series ต้องมี metadata.weeks (จำนวนสัปดาห์)";
  if (program.trainerLink && program.resources.length) return "class_program: เลือกได้อย่างใดอย่างหนึ่ง trainerLink (เลือกผู้สอน) หรือ resources (ห้อง/เครื่อง)";
  const asked = integer(meta.minPeople, 0, 200);
  if (asked !== null && asked > 0 && program.kind !== "coupon" && program.kind !== "free") return "class_program: minPeople ใช้ได้กับคลาสคูปองหรือคลาสฟรีเท่านั้น";
  if (asked !== null && asked > program.capacity) return "class_program: minPeople ต้องไม่เกิน capacity";
  if (Array.isArray(meta.schedule) && meta.schedule.length && program.schedule.length !== meta.schedule.length) return "class_program: metadata.schedule ทุกแถวต้องมี day 0-6 (0 = อาทิตย์) และ time แบบ HH:MM ไม่ซ้ำกัน";
  return null;
}

export function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

// The class times of a program on one calendar day.
export function timesOn(program: Pick<ClassProgram, "times" | "weekdays" | "schedule">, date: string) {
  const day = weekdayOf(date);
  if (program.schedule.length) return [...new Set(program.schedule.filter((entry) => entry.day === day).map((entry) => entry.time))].sort();
  return program.weekdays.includes(day) ? program.times : [];
}

// Bangkok wall-clock range of a class time, or null when the program has no such time on that day.
export function classRange(program: ClassProgram, date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const calendar = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) return null;
  if (!timesOn(program, date).includes(time)) return null;
  const end = minutesOf(time) + program.minutes;
  if (end >= 24 * 60) return null;
  return { startsAt: `${date} ${time}:00`, endsAt: `${date} ${clockOf(end)}:00`, endTime: clockOf(end) };
}

// Who teaches a class time: the weekly schedule's instructor of that day and time, else the
// instructor whose time range holds it (01 08:00–12:00, 02 12:00–16:00, 03 16:00–21:00).
export function instructorAt(program: Pick<ClassProgram, "instructors"> & Partial<Pick<ClassProgram, "schedule" | "minutes">>, time: string, date?: string): Instructor | null {
  if (date && program.schedule?.length) {
    const entry = program.schedule.find((row) => row.day === weekdayOf(date) && row.time === time);
    if (entry?.instructor) return { name: entry.instructor, from: time, to: clockOf(Math.min(24 * 60, minutesOf(time) + (program.minutes || 60))) };
  }
  const at = minutesOf(time);
  return program.instructors.find((row) => minutesOf(row.from) <= at && at < minutesOf(row.to)) || null;
}

// The instructors a class page lists: the time ranges (01/02/03), or the teachers of the weekly
// schedule with the days and times each one teaches.
export function instructorCards(program: Pick<ClassProgram, "instructors" | "schedule">) {
  if (program.instructors.length) return program.instructors.map((row) => ({ name: row.name, from: row.from, to: row.to, slots: [] as { day: number; time: string }[] }));
  const byName = new Map<string, { day: number; time: string }[]>();
  for (const entry of program.schedule) {
    if (!entry.instructor) continue;
    byName.set(entry.instructor, [...(byName.get(entry.instructor) || []), { day: entry.day, time: entry.time }]);
  }
  return [...byName.entries()].map(([name, slots]) => ({ name, from: "", to: "", slots }));
}

export type TimetableDay = { day: number; slots: { time: string; endTime: string; instructor: string | null }[] };
export type TimetableRow = { programId: number; slug: string; service: string; kind: ClassKind; short: string; title: string; icon: string; capacity: number; days: TimetableDay[] };

// The weekly class timetable (repeats every week of the month): each group class with its times on
// each day, Monday first.
export function timetableOf(programs: ClassProgram[]): TimetableRow[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return programs.filter((program) => program.timetable).map((program) => ({
    programId: program.id,
    slug: program.slug,
    service: program.service,
    kind: program.kind,
    short: program.short || program.title,
    title: program.title,
    icon: program.icon,
    capacity: program.capacity,
    days: order.map((day) => {
      const times = program.schedule.length
        ? program.schedule.filter((entry) => entry.day === day).map((entry) => entry.time)
        : program.weekdays.includes(day) ? program.times : [];
      return {
        day,
        slots: times.map((time) => ({
          time,
          endTime: clockOf(minutesOf(time) + program.minutes),
          instructor: program.schedule.find((entry) => entry.day === day && entry.time === time)?.instructor ?? instructorAt(program, time)?.name ?? null,
        })),
      };
    }).filter((entry) => entry.slots.length),
  })).filter((row) => row.days.length);
}

// Trainers a private class may be booked with: those whose role or specialties mention
// trainerMatch (e.g. "pilates"), or every trainer when none does.
export function trainersFor<T extends { role?: string | null; specialties?: unknown }>(program: Pick<ClassProgram, "trainerMatch">, trainers: T[]) {
  const match = program.trainerMatch?.toLowerCase();
  if (!match) return trainers;
  const words = (trainer: T) => {
    let specialties = trainer.specialties;
    if (typeof specialties === "string") {
      try {
        specialties = JSON.parse(specialties);
      } catch {
        specialties = [];
      }
    }
    return [trainer.role || "", ...(Array.isArray(specialties) ? specialties.map(String) : [])].join(" ").toLowerCase();
  };
  const found = trainers.filter((trainer) => words(trainer).includes(match));
  return found.length ? found : trainers;
}

export function couponFits(program: Pick<ClassProgram, "couponCategories">, category: string) {
  return program.couponCategories.includes(category);
}

// Coupon packs a program page sells: coupons whose metadata.program is the program.
export function packsForProgram<T extends { metadata?: unknown; sortOrder?: number | null; id: number }>(program: Pick<ClassProgram, "slug">, coupons: T[]) {
  return coupons
    .filter((coupon) => record(coupon.metadata).program === program.slug && record(coupon.metadata).grantOnly !== true)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.id - b.id);
}

export function couponMeta(coupon: { metadata?: unknown }) {
  const meta = record(coupon.metadata);
  return {
    label: text(meta.label, 60),
    note: text(meta.note, 120),
    badge: text(meta.badge, 30),
    oncePerMember: meta.oncePerMember === true,
    program: text(meta.program, 64),
  };
}

export function programsOf<T extends ContentLike & { contentType?: string }>(items: T[], service: string) {
  return allPrograms(items).filter((program) => program.service === service);
}

export function allPrograms<T extends ContentLike & { contentType?: string }>(items: T[]) {
  return items
    .filter((item) => item.contentType === undefined || item.contentType === "class_program")
    .map(parseProgram)
    .filter((program): program is ClassProgram => Boolean(program))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}
