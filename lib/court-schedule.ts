import type mysql from "mysql2/promise";
import { linkedCourtIds, type SpaceCourt } from "@/lib/court-space";

type Connection = Pick<mysql.PoolConnection, "execute">;
type Reader = (sql: string, params?: unknown[]) => Promise<unknown[]>;

// A court slot is taken by an active booking (paid, checked in, or held: a NULL expiry is a
// counter hold kept until staff act) or by an active court block (maintenance, events).
export const takenBookingSql = "status IN ('paid','checked_in') OR (status IN ('hold','pending_payment') AND (expires_at IS NULL OR expires_at > NOW()))";

// The same rule with the bookings table alias, for queries that join users (which also has `status`).
export function takenBookingAs(alias: string) {
  return `${alias}.status IN ('paid','checked_in') OR (${alias}.status IN ('hold','pending_payment') AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > NOW()))`;
}

export function placeholders(count: number) {
  return Array.from({ length: Math.max(1, count) }, () => "?").join(", ");
}

// Courts with shared floor space (a handful of rows). Read before a booking transaction to know which
// court rows to lock with the court being booked; courts without shared space conflict only with
// themselves.
export const sharedCourtsSql = "SELECT id, shared_space sharedSpace FROM courts WHERE shared_space IS NOT NULL AND shared_space <> ''";

export async function linkedCourts(read: Reader, courtIds: number[]) {
  const shared = (await read(sharedCourtsSql)) as SpaceCourt[];
  return linkedCourtIds(courtIds, Array.isArray(shared) ? shared : []);
}

// Run inside the booking transaction after locking the court rows (every court sharing the floor
// space, in id order); both reads lock what they find. `courtIds` are the court and the courts that
// share its space: a volleyball booking takes the indoor basketball court, and the reverse.
export async function courtConflict(conn: Connection, courtIds: number | number[], startsAt: string, endsAt: string, options: { excludeBookingId?: number } = {}): Promise<"booked" | "blocked" | null> {
  const ids = (Array.isArray(courtIds) ? courtIds : [courtIds]).map(Number);
  const exclude = options.excludeBookingId ? " AND id <> ?" : "";
  const [bookings] = await conn.execute(
    `SELECT id FROM bookings WHERE court_id IN (${placeholders(ids.length)})${exclude} AND (${takenBookingSql}) AND starts_at < ? AND ends_at > ? FOR UPDATE`,
    [...ids, ...(options.excludeBookingId ? [options.excludeBookingId] : []), endsAt, startsAt],
  );
  if ((bookings as unknown[]).length) return "booked";
  const [blocks] = await conn.execute(
    `SELECT id FROM court_blocks WHERE court_id IN (${placeholders(ids.length)}) AND cancelled_at IS NULL AND starts_at < ? AND ends_at > ? LIMIT 1 FOR UPDATE`,
    [...ids, endsAt, startsAt],
  );
  return (blocks as unknown[]).length ? "blocked" : null;
}
