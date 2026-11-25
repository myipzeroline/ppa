"use client";

import { useEffect, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { useAdminFeedback } from "@/components/admin-feedback";
import { AdminNotice } from "@/components/admin-notice";

// Back office · Buffet Rank / Open Run (item 2): the day's sessions (players, automatic pairing, who is
// on court), recording each game (ratings move by ELO), undoing the last game, finishing a session
// (the day's winners get their Coins) or cancelling it (every paid player is refunded to app credit);
// the rooms (level, court, price, places, times) and the rating leaderboard of a sport.

type Lang = "th" | "en";
type Room = {
  id: number; sportId: number; sportName: string; slug: string; title: string; levelName: string | null; icon: string; kind: "buffet" | "open_run"; teamSize: number;
  courtId: number | null; courtName: string | null; price: number; capacity: number; minPlayers: number; slots: string; weekdays: string; rules: string | null;
  prize: string | null; prizeCoins: string | null; matchMinutes: number; closeMinutes: number; active: number | boolean; sortOrder: number;
};
type SessionRow = { id: number; roomId: number; startsAt: string; endsAt: string; status: string; matchedAt: string | null; cancelReason: string | null; taken: number; paid: number; games: number };
type Snapshot = { date: string; rooms: Room[]; sessions: SessionRow[]; sports: { id: number; slug: string; name: string; icon: string }[]; courts: { id: number; sportId: number; name: string; status: string }[]; leaders: { userId: number; name: string; memberCode: string; rating: number; games: number; wins: number; losses: number }[] };
type Person = { userId: number; name: string; tier: string };
type Detail = {
  session: { id: number; startsAt: string; endsAt: string; status: string; matched: boolean; cancelReason: string | null };
  room: { title: string; icon: string; kind: string; teamSize: number; courtName: string | null; capacity: number; minPlayers: number; price: number; prize: string | null; prizeCoins: string | null };
  players: (Person & { rating: number; paid: boolean; checkedIn: boolean; queue: number })[];
  pairing: { teams: { no: number; rating: number; players: Person[] }[]; reserves: Person[] };
  games: { id: number; teamA: Person[]; teamB: Person[]; winner: "a" | "b"; scoreA: number | null; scoreB: number | null; teamANo: number | null; teamBNo: number | null }[];
  onCourt: { no: number; players: Person[] }[] | null;
  queue: number[];
  standings: (Person & { wins: number; played: number; gain: number })[];
  awards: (Person & { place: number; coins: number; wins: number })[];
};
type RoomForm = Omit<Room, "id" | "sportName" | "courtName" | "active"> & { id?: number; active: boolean };

const copy = {
  th: {
    title: "Buffet Rank / Open Run", intro: "รอบของวันที่เลือก ผู้เล่นที่ชำระแล้วเรียงตามคิวชำระ ระบบจัดคู่อัตโนมัติก่อนเริ่ม ปิดรับและคืนเงินอัตโนมัติถ้าผู้เล่นไม่ครบ เจ้าหน้าที่บันทึกผลทุกเกมเพื่อคำนวณคะแนน (ELO)",
    date: "วันที่", reload: "โหลดใหม่", sessions: "รอบของวันนี้", noSessions: "ยังไม่มีรอบที่มีผู้สมัครในวันนี้", manage: "จัดการรอบ",
    players: "ผู้เล่น", paid: "ชำระแล้ว", waiting: "รอชำระ", checkedIn: "เช็คอินแล้ว", games: "เกม", places: "ที่",
    status: { open: "เปิดรับ", closed: "ปิดรับ/จัดคู่แล้ว", cancelled: "ยกเลิก", finished: "จบแล้ว" } as Record<string, string>,
    pairing: "การจัดคู่", noPairing: "ยังไม่จัดคู่ (จัดอัตโนมัติเมื่อถึงเวลาและผู้เล่นครบ)", reserves: "ตัวสำรอง", team: (no: number) => `ทีม ${no}`,
    onCourt: "กำลังลงสนาม", wins: (no: number) => `ทีม ${no} ชนะ`, score: "คะแนน (ไม่บังคับ)", record: "บันทึกผล", customGame: "บันทึกเกมอื่น (เลือกทีม)", teamA: "ทีม A", teamB: "ทีม B", winner: "ผู้ชนะ",
    results: "ผลการแข่งขัน", undo: "ยกเลิกผลล่าสุด", pair: "จัดคู่ใหม่", finish: "จบรอบ & แจกรางวัล", cancelSession: "ยกเลิกรอบ & คืนเงิน", reason: "เหตุผล",
    standings: "อันดับวันนี้", prize: "รางวัล", queue: "คิวถัดไป",
    confirmFinish: "จบรอบนี้และแจก Coin ให้ผู้ชนะ?", confirmFinishMessage: "หลังจบรอบจะบันทึกผลเพิ่มไม่ได้", confirmCancel: "ยกเลิกรอบนี้และคืนเงินทุกคน?", confirmCancelMessage: "ผู้ที่ชำระแล้วได้เงินคืนเข้าเครดิตในแอปทันที และสนามกลับมาให้เช่าตามปกติ", confirmUndo: "ยกเลิกผลเกมล่าสุด?", confirmUndoMessage: "คะแนนของผู้เล่นในเกมนั้นจะถูกคืนค่า", confirmPair: "จัดคู่ใหม่จากผู้เล่นที่ชำระแล้ว?",
    done: "บันทึกแล้ว", failed: "ทำรายการไม่สำเร็จ", loadFailed: "โหลดข้อมูลไม่สำเร็จ", close: "ปิด",
    rooms: "ห้อง", addRoom: "เพิ่มห้อง", editRoom: "แก้ไขห้อง", save: "บันทึก", cancel: "ยกเลิก", inactive: "ปิดใช้งาน",
    sport: "กีฬา", slug: "รหัสห้อง (a-z 0-9 -)", roomTitle: "ชื่อห้อง", level: "ระดับฝีมือ", icon: "ไอคอน", kind: "รูปแบบ", kinds: { buffet: "Buffet Rank (คู่)", open_run: "Open Run (ทีม)" },
    teamSize: "ผู้เล่นต่อทีม", court: "สนาม", noCourt: "ไม่ใช้สนาม", price: "ราคา/คน", capacity: "รับสูงสุด (คน)", minPlayers: "ขั้นต่ำ (คน)", slots: "รอบเวลา เช่น 18:00-20:00,20:00-22:00",
    weekdays: "วันที่เปิด", days: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"], rules: "กติกา", prizeText: "รางวัล (ข้อความ)", prizeCoins: "Coin อันดับ 1,2,3 เช่น 5,3,2", matchMinutes: "จัดคู่ก่อนเริ่ม (นาที)", closeMinutes: "ปิดรับก่อนเริ่ม (นาที)", active: "เปิดใช้งาน", sort: "ลำดับ",
    leaderboard: "อันดับคะแนน", rating: "คะแนน", record_: "ชนะ–แพ้",
  },
  en: {
    title: "Buffet Rank / Open Run", intro: "Sessions of the chosen day. Paid players in payment order; pairs are made automatically before the start; sessions short of players close and refund automatically. Record every game so ratings (ELO) move.",
    date: "Date", reload: "Reload", sessions: "Sessions of the day", noSessions: "No session with players on this day", manage: "Manage",
    players: "Players", paid: "Paid", waiting: "Awaiting payment", checkedIn: "Checked in", games: "games", places: "places",
    status: { open: "Open", closed: "Closed/paired", cancelled: "Cancelled", finished: "Finished" } as Record<string, string>,
    pairing: "Pairing", noPairing: "Not paired yet (automatic at the set time once there are enough players)", reserves: "Reserves", team: (no: number) => `Team ${no}`,
    onCourt: "On court", wins: (no: number) => `Team ${no} won`, score: "Score (optional)", record: "Record result", customGame: "Record another game (choose teams)", teamA: "Team A", teamB: "Team B", winner: "Winner",
    results: "Results", undo: "Undo last result", pair: "Pair again", finish: "Finish & pay prizes", cancelSession: "Cancel & refund", reason: "Reason",
    standings: "Today's standings", prize: "Prize", queue: "Next in line",
    confirmFinish: "Finish this session and pay the winners' Coins?", confirmFinishMessage: "No more results can be recorded afterwards", confirmCancel: "Cancel this session and refund everyone?", confirmCancelMessage: "Paid players get their money back as app credit at once and the court returns to normal hire", confirmUndo: "Undo the last result?", confirmUndoMessage: "The ratings of that game's players go back", confirmPair: "Pair again from the paid players?",
    done: "Saved", failed: "Could not save", loadFailed: "Could not load", close: "Close",
    rooms: "Rooms", addRoom: "Add room", editRoom: "Edit room", save: "Save", cancel: "Cancel", inactive: "Off",
    sport: "Sport", slug: "Room code (a-z 0-9 -)", roomTitle: "Room name", level: "Skill level", icon: "Icon", kind: "Format", kinds: { buffet: "Buffet Rank (pairs)", open_run: "Open Run (teams)" },
    teamSize: "Players per team", court: "Court", noCourt: "No court", price: "Price/person", capacity: "Places", minPlayers: "Minimum players", slots: "Times, e.g. 18:00-20:00,20:00-22:00",
    weekdays: "Days", days: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"], rules: "Rules", prizeText: "Prize (text)", prizeCoins: "Coins for places 1,2,3 e.g. 5,3,2", matchMinutes: "Pair before start (min)", closeMinutes: "Close before start (min)", active: "Active", sort: "Order",
    leaderboard: "Rating leaderboard", rating: "Rating", record_: "Won–lost",
  },
};

const bangkokDate = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function send<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, data: body as T } : { ok: false, message: String(body.message || response.statusText) };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

const names = (people: Person[]) => people.map((person) => person.name).join(" + ");

export function AdminRank({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify, confirm } = useAdminFeedback();
  const [date, setDate] = useState(bangkokDate);
  const [sport, setSport] = useState(0);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [room, setRoom] = useState<RoomForm | null>(null);
  const [roomError, setRoomError] = useState("");

  useEffect(() => {
    let alive = true;
    send<Snapshot>(`/api/admin/rank?${new URLSearchParams({ date, ...(sport ? { sport: String(sport) } : {}) })}`, { method: "GET" }).then((sent) => {
      if (!alive) return;
      if (sent.ok) {
        setSnapshot(sent.data);
        setError("");
      } else setError(sent.message);
    });
    return () => { alive = false; };
  }, [date, sport, revision]);

  const roomOf = (id: number) => snapshot?.rooms.find((item) => item.id === id);
  const saveRoom = async () => {
    if (!room) return;
    setRoomError("");
    const body = { ...room, levelName: room.levelName || "", rules: room.rules || "", prize: room.prize || "", prizeCoins: room.prizeCoins || "", courtId: room.courtId || null, price: Number(room.price), capacity: Number(room.capacity), minPlayers: Number(room.minPlayers), teamSize: Number(room.teamSize), matchMinutes: Number(room.matchMinutes), closeMinutes: Number(room.closeMinutes), sortOrder: Number(room.sortOrder), sportId: Number(room.sportId) };
    const sent = await send<Snapshot>("/api/admin/rank", { method: room.id ? "PUT" : "POST", body: JSON.stringify(body) });
    if (!sent.ok) return setRoomError(sent.message || t.failed);
    setRoom(null);
    setRevision((value) => value + 1);
    notify("success", t.done);
  };
  const newRoom = (): RoomForm => ({ sportId: snapshot?.sports.find((item) => item.slug === "badminton")?.id || snapshot?.sports[0]?.id || 1, slug: "", title: "", levelName: "", icon: "🏸", kind: "buffet", teamSize: 2, courtId: null, price: 100, capacity: 16, minPlayers: 4, slots: "18:00-20:00,20:00-22:00", weekdays: "0123456", rules: "", prize: "", prizeCoins: "5,3,2", matchMinutes: 60, closeMinutes: 10, active: true, sortOrder: 0 });

  return (
    <div className="admin-trainer-layout">
      <section className="admin-panel">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
        <div className="admin-list-toolbar">
          <label className="admin-inline-field">{t.date}<input type="date" value={date} onChange={(event) => { setSelected(null); setDate(event.target.value); }} /></label>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>{t.reload}</button>
        </div>
        {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error}</AdminNotice> : null}
        <h3 className="admin-subhead">{t.sessions}</h3>
        <div className="admin-booking-cards">
          {(snapshot?.sessions || []).map((session) => {
            const sessionRoom = roomOf(Number(session.roomId));
            return (
              <article key={session.id} className={selected === session.id ? "selected" : ""}>
                <div>
                  <b>{sessionRoom?.icon} {sessionRoom?.title} · {session.startsAt.slice(11, 16)}–{session.endsAt.slice(11, 16)}</b>
                  <span>{sessionRoom?.sportName} · {sessionRoom?.courtName || "-"}</span>
                  <small>{t.players} {session.taken}/{sessionRoom?.capacity || "-"} · {t.paid} {session.paid} · {session.games} {t.games}{session.cancelReason ? ` · ${session.cancelReason}` : ""}</small>
                </div>
                <span className={`admin-badge ${session.status === "cancelled" ? "bad" : session.status === "finished" ? "neutral" : session.status === "closed" ? "good" : "warn"}`}>{t.status[session.status] || session.status}</span>
                <div className="admin-row-actions"><button type="button" onClick={() => setSelected(session.id)}>{t.manage}</button></div>
              </article>
            );
          })}
          {snapshot && !snapshot.sessions.length ? <p>{t.noSessions}</p> : null}
        </div>
      </section>

      {selected ? <SessionManager key={`${selected}-${revision}`} sessionId={selected} lang={lang} onChanged={() => setRevision((value) => value + 1)} notify={notify} confirm={confirm} /> : null}

      <section className="admin-panel">
        <h2>{t.rooms}</h2>
        <div className="admin-list-toolbar"><button type="button" onClick={() => { setRoomError(""); setRoom(newRoom()); }}>{t.addRoom}</button></div>
        <div className="admin-court-grid">
          {(snapshot?.rooms || []).map((item) => (
            <article key={item.id}>
              <div>
                <b>{item.icon} {item.title}{item.levelName ? ` · ${item.levelName}` : ""}</b>
                <span>{item.sportName} · {item.courtName || t.noCourt} · {item.slots}</span>
                <small>{Number(item.price).toLocaleString()} ฿ · {item.minPlayers}–{item.capacity} {t.places} · {t.kinds[item.kind]}</small>
              </div>
              <span className={`admin-badge ${Number(item.active) ? "good" : "neutral"}`}>{Number(item.active) ? t.active : t.inactive}</span>
              <div className="admin-row-actions"><button type="button" onClick={() => { setRoomError(""); setRoom({ ...item, levelName: item.levelName || "", rules: item.rules || "", prize: item.prize || "", prizeCoins: item.prizeCoins || "", active: Boolean(Number(item.active)) }); }}>{t.editRoom}</button></div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <h2>{t.leaderboard}</h2>
        <div className="admin-list-toolbar">
          <label className="admin-inline-field">{t.sport}<select value={sport} onChange={(event) => setSport(Number(event.target.value))}><option value={0}>-</option>{(snapshot?.sports || []).map((item) => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label>
        </div>
        {sport ? (
          <div className="admin-table-scroll">
            <table>
              <thead><tr><th>#</th><th>{t.players}</th><th>{t.rating}</th><th>{t.games}</th><th>{t.record_}</th></tr></thead>
              <tbody>{(snapshot?.leaders || []).map((row, index) => <tr key={row.userId}><td>{index + 1}</td><td>{row.name} · {row.memberCode}</td><td>{row.rating}</td><td>{row.games}</td><td>{row.wins}–{row.losses}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
      </section>

      {room ? (
        <AdminDialog onClose={() => setRoom(null)}>
          <section className="admin-modal">
            <header><div><small>{t.rooms}</small><h2>{room.id ? t.editRoom : t.addRoom}</h2></div><button type="button" aria-label={t.close} onClick={() => setRoom(null)}>×</button></header>
            <div className="admin-form">
              <label>{t.sport}<select value={room.sportId} onChange={(event) => setRoom({ ...room, sportId: Number(event.target.value), courtId: null })}>{(snapshot?.sports || []).map((item) => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label>
              <label>{t.slug}<input value={room.slug} onChange={(event) => setRoom({ ...room, slug: event.target.value.toLowerCase() })} /></label>
              <label>{t.roomTitle}<input value={room.title} onChange={(event) => setRoom({ ...room, title: event.target.value })} /></label>
              <label>{t.level}<input value={room.levelName || ""} onChange={(event) => setRoom({ ...room, levelName: event.target.value })} /></label>
              <label>{t.icon}<input value={room.icon} onChange={(event) => setRoom({ ...room, icon: event.target.value })} /></label>
              <label>{t.kind}<select value={room.kind} onChange={(event) => setRoom({ ...room, kind: event.target.value as Room["kind"], teamSize: event.target.value === "open_run" ? 3 : 2 })}><option value="buffet">{t.kinds.buffet}</option><option value="open_run">{t.kinds.open_run}</option></select></label>
              <label>{t.teamSize}<input type="number" min={1} max={11} value={room.teamSize} onChange={(event) => setRoom({ ...room, teamSize: Number(event.target.value) })} /></label>
              <label>{t.court}<select value={room.courtId || 0} onChange={(event) => setRoom({ ...room, courtId: Number(event.target.value) || null })}><option value={0}>{t.noCourt}</option>{(snapshot?.courts || []).filter((court) => court.sportId === room.sportId).map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
              <label>{t.price}<input type="number" min={0} value={room.price} onChange={(event) => setRoom({ ...room, price: Number(event.target.value) })} /></label>
              <label>{t.capacity}<input type="number" min={2} value={room.capacity} onChange={(event) => setRoom({ ...room, capacity: Number(event.target.value) })} /></label>
              <label>{t.minPlayers}<input type="number" min={2} value={room.minPlayers} onChange={(event) => setRoom({ ...room, minPlayers: Number(event.target.value) })} /></label>
              <label className="wide">{t.slots}<input value={room.slots} onChange={(event) => setRoom({ ...room, slots: event.target.value })} /></label>
              <fieldset className="wide admin-weekdays"><legend>{t.weekdays}</legend>{t.days.map((label, day) => (
                <label key={label}><input type="checkbox" checked={room.weekdays.includes(String(day))} onChange={(event) => setRoom({ ...room, weekdays: (event.target.checked ? [...room.weekdays.split(""), String(day)] : room.weekdays.split("").filter((value) => value !== String(day))).sort().join("") })} />{label}</label>
              ))}</fieldset>
              <label className="wide">{t.rules}<input value={room.rules || ""} onChange={(event) => setRoom({ ...room, rules: event.target.value })} /></label>
              <label className="wide">{t.prizeText}<input value={room.prize || ""} onChange={(event) => setRoom({ ...room, prize: event.target.value })} /></label>
              <label>{t.prizeCoins}<input value={room.prizeCoins || ""} onChange={(event) => setRoom({ ...room, prizeCoins: event.target.value.replace(/\s+/g, "") })} /></label>
              <label>{t.matchMinutes}<input type="number" min={0} value={room.matchMinutes} onChange={(event) => setRoom({ ...room, matchMinutes: Number(event.target.value) })} /></label>
              <label>{t.closeMinutes}<input type="number" min={0} value={room.closeMinutes} onChange={(event) => setRoom({ ...room, closeMinutes: Number(event.target.value) })} /></label>
              <label>{t.sort}<input type="number" min={0} value={room.sortOrder} onChange={(event) => setRoom({ ...room, sortOrder: Number(event.target.value) })} /></label>
              <label className="admin-check"><input type="checkbox" checked={room.active} onChange={(event) => setRoom({ ...room, active: event.target.checked })} />{t.active}</label>
              {roomError ? <AdminNotice tone="error" lang={lang}>{roomError}</AdminNotice> : null}
              <div className="admin-form-actions"><button type="button" onClick={() => void saveRoom()}>{t.save}</button><button type="button" className="ghost" onClick={() => setRoom(null)}>{t.cancel}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
    </div>
  );
}

function SessionManager({ sessionId, lang, onChanged, notify, confirm }: {
  sessionId: number;
  lang: Lang;
  onChanged: () => void;
  notify: ReturnType<typeof useAdminFeedback>["notify"];
  confirm: ReturnType<typeof useAdminFeedback>["confirm"];
}) {
  const t = copy[lang];
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [score, setScore] = useState({ a: "", b: "" });
  const [custom, setCustom] = useState({ a: 0, b: 0, winner: "a" as "a" | "b" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    send<Detail>(`/api/admin/rank/session?id=${sessionId}`, { method: "GET" }).then((sent) => {
      if (!alive) return;
      if (sent.ok) setDetail(sent.data);
      else setError(sent.message);
    });
    return () => { alive = false; };
  }, [sessionId]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    const sent = await send<Detail>("/api/admin/rank/session", { method: "POST", body: JSON.stringify({ sessionId, ...body }) });
    setBusy(false);
    if (!sent.ok) return notify("error", sent.message || t.failed);
    setDetail(sent.data);
    setScore({ a: "", b: "" });
    notify("success", t.done);
    onChanged();
  };
  const teamIds = (no: number) => (detail?.pairing.teams.find((team) => team.no === no)?.players || []).map((person) => person.userId);
  const scoreOf = (value: string) => (value.trim() === "" ? null : Math.max(0, Math.min(99, Math.trunc(Number(value)) || 0)));
  const recordWin = (a: number, b: number, winner: "a" | "b") => void act({ action: "record", teamA: teamIds(a), teamB: teamIds(b), winner, scoreA: scoreOf(score.a), scoreB: scoreOf(score.b) });
  if (error) return <section className="admin-panel"><AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error}</AdminNotice></section>;
  if (!detail) return <section className="admin-panel"><p>…</p></section>;
  const live = ["open", "closed"].includes(detail.session.status);
  const teams = detail.pairing.teams;
  return (
    <section className="admin-panel admin-rank-session">
      <h2>{detail.room.icon} {detail.room.title} · {detail.session.startsAt.slice(0, 16)}–{detail.session.endsAt.slice(11, 16)}</h2>
      <p>{detail.room.courtName || t.noCourt} · {t.status[detail.session.status] || detail.session.status}{detail.session.cancelReason ? ` · ${detail.session.cancelReason}` : ""} · {t.prize}: {detail.room.prize || "-"} ({detail.room.prizeCoins || "-"})</p>
      <div className="admin-rank-grid">
        <div>
          <h3 className="admin-subhead">{t.players} ({detail.players.length}/{detail.room.capacity})</h3>
          <ol className="admin-rank-list">
            {detail.players.map((player) => <li key={player.userId}><span>{player.queue}. {player.name}</span><small>{player.tier} · {player.rating}</small><em className={player.paid ? "good" : "warn"}>{player.checkedIn ? t.checkedIn : player.paid ? t.paid : t.waiting}</em></li>)}
          </ol>
        </div>
        <div>
          <h3 className="admin-subhead">{t.pairing}</h3>
          {teams.length ? (
            <ol className="admin-rank-list">{teams.map((team) => <li key={team.no}><span>{t.team(team.no)} · {names(team.players)}</span><small>{team.rating}</small></li>)}</ol>
          ) : <p>{t.noPairing}</p>}
          {detail.pairing.reserves.length ? <p>{t.reserves}: {names(detail.pairing.reserves)}</p> : null}
          {detail.queue.length ? <p>{t.queue}: {detail.queue.map(t.team).join(" → ")}</p> : null}
        </div>
      </div>
      {live && detail.onCourt ? (
        <div className="admin-rank-court">
          <h3 className="admin-subhead">{t.onCourt}: {t.team(detail.onCourt[0].no)} ({names(detail.onCourt[0].players)}) vs {t.team(detail.onCourt[1].no)} ({names(detail.onCourt[1].players)})</h3>
          <div className="admin-list-toolbar">
            <label className="admin-inline-field">{t.score}<input inputMode="numeric" value={score.a} onChange={(event) => setScore({ ...score, a: event.target.value })} aria-label={`${t.team(detail.onCourt[0].no)} ${t.score}`} /> – <input inputMode="numeric" value={score.b} onChange={(event) => setScore({ ...score, b: event.target.value })} aria-label={`${t.team(detail.onCourt[1].no)} ${t.score}`} /></label>
            <button type="button" disabled={busy} onClick={() => recordWin(detail.onCourt![0].no, detail.onCourt![1].no, "a")}>{t.wins(detail.onCourt[0].no)}</button>
            <button type="button" disabled={busy} onClick={() => recordWin(detail.onCourt![0].no, detail.onCourt![1].no, "b")}>{t.wins(detail.onCourt[1].no)}</button>
          </div>
        </div>
      ) : null}
      {live && teams.length >= 2 ? (
        <div className="admin-list-toolbar">
          <span>{t.customGame}</span>
          <label className="admin-inline-field">{t.teamA}<select value={custom.a} onChange={(event) => setCustom({ ...custom, a: Number(event.target.value) })}><option value={0}>-</option>{teams.map((team) => <option key={team.no} value={team.no}>{t.team(team.no)}</option>)}</select></label>
          <label className="admin-inline-field">{t.teamB}<select value={custom.b} onChange={(event) => setCustom({ ...custom, b: Number(event.target.value) })}><option value={0}>-</option>{teams.map((team) => <option key={team.no} value={team.no}>{t.team(team.no)}</option>)}</select></label>
          <label className="admin-inline-field">{t.winner}<select value={custom.winner} onChange={(event) => setCustom({ ...custom, winner: event.target.value as "a" | "b" })}><option value="a">{t.teamA}</option><option value="b">{t.teamB}</option></select></label>
          <button type="button" disabled={busy || !custom.a || !custom.b || custom.a === custom.b} onClick={() => recordWin(custom.a, custom.b, custom.winner)}>{t.record}</button>
        </div>
      ) : null}
      <h3 className="admin-subhead">{t.results} ({detail.games.length})</h3>
      <ol className="admin-rank-list">
        {detail.games.map((game, index) => <li key={game.id}><span>{index + 1}. {game.teamANo ? t.team(game.teamANo) : names(game.teamA)} {game.scoreA ?? ""}–{game.scoreB ?? ""} {game.teamBNo ? t.team(game.teamBNo) : names(game.teamB)}</span><small>{t.winner}: {names(game.winner === "a" ? game.teamA : game.teamB)}</small></li>)}
      </ol>
      {detail.standings.length ? (
        <>
          <h3 className="admin-subhead">{t.standings}</h3>
          <ol className="admin-rank-list">{detail.standings.map((row, index) => <li key={row.userId}><span>{index + 1}. {row.name}</span><small>{row.wins}/{row.played} · {row.gain >= 0 ? "+" : ""}{row.gain}</small></li>)}</ol>
        </>
      ) : null}
      {live ? (
        <div className="admin-form-actions admin-rank-actions">
          <button type="button" className="ghost" disabled={busy || detail.games.length > 0} onClick={async () => { if (await confirm({ title: t.confirmPair, confirmLabel: t.pair })) void act({ action: "pair" }); }}>{t.pair}</button>
          <button type="button" className="ghost" disabled={busy || !detail.games.length} onClick={async () => { if (await confirm({ title: t.confirmUndo, message: t.confirmUndoMessage, confirmLabel: t.undo, danger: true })) void act({ action: "undo" }); }}>{t.undo}</button>
          <button type="button" disabled={busy} onClick={async () => { if (await confirm({ title: t.confirmFinish, message: t.confirmFinishMessage, details: detail.standings.slice(0, 3).map((row, index) => [String(index + 1), `${row.name} · ${row.wins}/${row.played}`] as [string, string]), confirmLabel: t.finish })) void act({ action: "finish" }); }}>{t.finish}</button>
          <label className="admin-inline-field">{t.reason}<input value={reason} maxLength={160} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="button" className="danger" disabled={busy || !reason.trim()} onClick={async () => { if (await confirm({ title: t.confirmCancel, message: t.confirmCancelMessage, details: [[t.players, `${detail.players.filter((player) => player.paid).length} ${t.paid}`], [t.reason, reason]], confirmLabel: t.cancelSession, danger: true })) void act({ action: "cancel", reason: reason.trim() }); }}>{t.cancelSession}</button>
        </div>
      ) : null}
    </section>
  );
}
