"use client";
import { useEffect, useRef, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { Empty, LoadingNote, money } from "@/components/member-ui";
import { SectionLabel, TabBar, WeekStrip } from "@/components/member-schedule";
import { bangkokToday } from "@/lib/court-availability";
import { courtName, t } from "@/lib/i18n";

// รายการที่ 2: Buffet Rank (badminton by skill level) and Open Run (basketball): the member's level and
// rating, rooms with their times of the coming week, places left in real time, automatic pairing,
// players, pairing and today's winners. Joining makes a booking the app pays like a court booking.

export type RankSlot = {
  date: string; from: string; to: string; startsAt: string; sessionId: number | null;
  status: "open" | "closed" | "cancelled" | "finished" | "none"; taken: number; paid: number; left: number;
  joinable: boolean; courtBusy: boolean; matched: boolean; closesAt: string; matchAt: string;
  mine: { bookingNo: string; status: string } | null; cancelReason: string | null;
};
export type RankRoom = {
  id: number; slug: string; title: string; levelName: string | null; icon: string; kind: "buffet" | "open_run"; teamSize: number;
  courtName: string | null; price: number; capacity: number; minPlayers: number; rules: string | null; prize: string | null;
  prizeCoins: string | null; matchMinutes: number; closeMinutes: number; slots: RankSlot[];
};
export type RankView = {
  sport: { id: number; slug: string; name: string };
  rating: { rating: number; games: number; wins: number; losses: number; tier: string; tierMin: number; next: { name: string; min: number } | null };
  tiers: { name: string; min: number }[];
  rooms: RankRoom[];
};
export type RankJoin = { room: RankRoom; slot: RankSlot };
// Find Your Game opens the tab on the room, day and time the member tapped.
export type RankFocus = { roomId: number; date: string; startsAt: string };

type Person = { name: string; tier: string };
type SessionDetail = {
  session: { id: number; startsAt: string; endsAt: string; status: string; matched: boolean; cancelReason: string | null };
  room: { title: string; icon: string; kind: string; teamSize: number; courtName: string | null; capacity: number; minPlayers: number; prize: string | null; prizeCoins: string | null };
  players: (Person & { rating: number; paid: boolean; checkedIn: boolean; queue: number })[];
  pairing: { teams: { no: number; rating: number; players: Person[] }[]; reserves: Person[] };
  games: { id: number; teamA: Person[]; teamB: Person[]; winner: "a" | "b"; scoreA: number | null; scoreB: number | null; teamANo: number | null; teamBNo: number | null }[];
  onCourt: { no: number; players: Person[] }[] | null;
  queue: number[];
  standings: (Person & { wins: number; played: number; gain: number })[];
  awards: (Person & { place: number; coins: number; wins: number })[];
};

const roomLabel = (room: Pick<RankRoom, "kind">) => (room.kind === "open_run" ? "Open Run" : "Buffet Rank");

export function RankPanel({ view, now, busy, focus, onJoin, onOpenLevel }: { view: RankView; now: number; busy: boolean; focus?: RankFocus; onJoin: (join: RankJoin) => void; onOpenLevel: () => void }) {
  const today = bangkokToday(now);
  const focused = focus && view.rooms.some((room) => room.id === focus.roomId) ? focus : undefined;
  const [day, setDay] = useState(focused && focused.date >= today ? focused.date : today);
  const [roomId, setRoomId] = useState<number | null>(focused?.roomId ?? null);
  const [detail, setDetail] = useState<{ sessionId: number; tab: "players" | "pairs" | "winners" } | null>(null);
  const openRun = view.rooms.length > 1 && view.rooms.every((room) => room.kind === "open_run");
  const rooms = openRun ? view.rooms.filter((room) => room.id === (roomId ?? view.rooms[0].id)) : view.rooms;
  if (!view.rooms.length) return <Empty text={t("ยังไม่มีรอบ Buffet Rank เปิดรับ")} />;
  return (
    <div className="rank-panel">
      <button type="button" className="rank-level" onClick={onOpenLevel}>
        <span className="rank-avatar" aria-hidden="true">🏅</span>
        <span>{t("ระดับของฉัน")}</span>
        <b>{t(view.rating.tier)} · {t("{{value0}} คะแนน", { value0: money(view.rating.rating) })}</b>
        <i aria-hidden="true">›</i>
      </button>
      {openRun ? <TabBar label={t("รูปแบบ")} tabs={view.rooms.map((room) => [String(room.id), room.title.replace(/^Open Run\s*/, "") || room.title] as [string, string])} value={String(roomId ?? view.rooms[0].id)} onChange={(value) => setRoomId(Number(value))} className="sub-tabs" /> : null}
      <SectionLabel>{t("เลือกวัน")}</SectionLabel>
      <WeekStrip from={today} value={day} onChange={setDay} />
      {rooms.map((room) => <RankRoomCard key={room.id} room={room} day={day} busy={busy} focusStart={focused?.roomId === room.id && focused.date === day ? focused.startsAt : undefined} onJoin={onJoin} onDetail={(sessionId, tab) => setDetail({ sessionId, tab })} />)}
      {detail ? <SessionSheet sessionId={detail.sessionId} initialTab={detail.tab} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function RankRoomCard({ room, day, busy, focusStart, onJoin, onDetail }: { room: RankRoom; day: string; busy: boolean; focusStart?: string; onJoin: (join: RankJoin) => void; onDetail: (sessionId: number, tab: "players" | "pairs" | "winners") => void }) {
  const slots = room.slots.filter((slot) => slot.date === day);
  const [slotKey, setSlotKey] = useState(focusStart || "");
  const card = useRef<HTMLElement>(null);
  // Opened from Find Your Game: bring the room into view.
  useEffect(() => {
    if (focusStart) card.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [focusStart]);
  const slot = slots.find((item) => item.startsAt === slotKey) || slots.find((item) => item.joinable) || slots[0];
  const teams = Math.floor(room.capacity / Math.max(1, room.teamSize));
  const minTeams = Math.ceil(room.minPlayers / Math.max(1, room.teamSize));
  const joinText = room.kind === "open_run" ? t("เข้าร่วม {{value0}}", { value0: room.title }) : t("เข้าร่วม Buffet Rank");
  let action = joinText;
  let enabled = Boolean(slot?.joinable);
  if (slot?.mine) {
    const paid = ["paid", "checked_in"].includes(slot.mine.status);
    action = paid ? t("คุณอยู่ในรอบนี้แล้ว · ชำระแล้ว") : t("ชำระเงินเพื่อยืนยันที่นั่ง");
    enabled = !paid && Boolean(slot.joinable || slot.mine);
  } else if (slot?.status === "cancelled") {
    action = t("งดรอบนี้");
  } else if (slot && slot.courtBusy) {
    action = t("สนามไม่ว่างรอบนี้");
  } else if (slot && slot.left <= 0) {
    action = t("รอบนี้เต็มแล้ว");
  } else if (slot && !slot.joinable) {
    action = t("ปิดรับสมัครแล้ว");
  }
  return (
    <article className={focusStart ? "rank-room focused" : "rank-room"} ref={card}>
      <header>
        <b>{room.icon} {t(room.title)}</b>
        {room.levelName ? <span className="level-badge">{t(room.levelName)}</span> : null}
      </header>
      <small className="rank-meta">{[t("ทุกวัน"), room.courtName ? courtName(room.courtName) : "", t(room.rules)].filter(Boolean).join(" · ")}</small>
      <div className="rank-price"><b>{money(room.price)} ฿</b><span>{t("/ คน / ครั้ง")}</span></div>
      <SectionLabel>{t("เลือกรอบเวลา")}</SectionLabel>
      {slots.length ? (
        <div className="rank-slots">
          {slots.map((item) => (
            <button type="button" key={item.startsAt} className={slot?.startsAt === item.startsAt ? "on" : ""} aria-pressed={slot?.startsAt === item.startsAt} onClick={() => setSlotKey(item.startsAt)}>
              {item.from} – {item.to}
            </button>
          ))}
        </div>
      ) : <p className="slot-grid-empty">{t("ไม่มีรอบในวันนี้")}</p>}
      {slot ? (
        <>
          <p className="rank-left">{t("เหลือ")} <b>{slot.left}</b> / {room.capacity} {t("ที่")}{slot.paid ? ` · ${t("ชำระแล้ว {{value0}} คน", { value0: slot.paid })}` : ""}</p>
          {slot.status === "cancelled" && slot.cancelReason ? <p className="rank-warning">{t("งดรอบนี้")} · {t(slot.cancelReason)}</p> : null}
          <p className="rank-warning">⚠ {room.kind === "open_run"
            ? t("หากทีมไม่ครบ {{value0}} ทีม (จาก {{value1}} ทีม) ระบบจะคืนเงินให้อัตโนมัติ และปรับเป็นค่าเช่าสนามแบบชั่วโมงปกติแทน · ปิดรับสมัคร {{value2}} น.", { value0: minTeams, value1: teams, value2: slot.closesAt })
            : t("ต่ำกว่า {{value0}} คน ระบบคืนเงินอัตโนมัติและปรับเป็นราคาเช่าสนามปกติ · จัดคู่อัตโนมัติเวลา {{value1}} หากครบ {{value0}} คนขึ้นไป เรียงตามคิวชำระก่อน-หลัง · ปิดรับจองอัปเดตคู่ล่าสุด {{value2}} น.", { value0: room.minPlayers, value1: slot.matchAt, value2: slot.closesAt })}</p>
        </>
      ) : null}
      <button type="button" className="join-btn" disabled={busy || !slot || !enabled} onClick={() => slot && onJoin({ room, slot })}>{action}</button>
      <button type="button" className="rank-link" disabled={!slot?.sessionId} onClick={() => slot?.sessionId && onDetail(slot.sessionId, "players")}>👥 {t("ดูผู้เข้าร่วม")}</button>
      <button type="button" className="rank-link" disabled={!slot?.sessionId} onClick={() => slot?.sessionId && onDetail(slot.sessionId, "pairs")}>{room.kind === "open_run" ? `🏀 ${t("ดูทีมล่าสุด")}` : `🏸 ${t("ดูการจัดคู่ตี")}`}</button>
      <button type="button" className="rank-prize" disabled={!slot?.sessionId} onClick={() => slot?.sessionId && onDetail(slot.sessionId, "winners")}>🏆 {t("รางวัลผู้ชนะวันนี้")}</button>
      {room.kind === "open_run" ? <p className="slot-footnote">{t("สมัครเป็นรายบุคคล · ครบจำนวนแล้วระบบจัดทีมให้ตามระดับฝีมือ")}</p> : null}
    </article>
  );
}

function SessionSheet({ sessionId, initialTab, onClose }: { sessionId: number; initialTab: "players" | "pairs" | "winners"; onClose: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const [state, setState] = useState<{ detail?: SessionDetail; error?: boolean } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/rank/session?id=${sessionId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then((response) => (response.ok ? response.json() as Promise<SessionDetail> : Promise.reject(new Error("load"))))
      .then((detail) => { if (!controller.signal.aborted) setState({ detail }); })
      .catch(() => { if (!controller.signal.aborted) setState({ error: true }); });
    return () => controller.abort();
  }, [sessionId]);
  const detail = state?.detail;
  const names = (people: Person[]) => people.map((person) => person.name).join(" + ");
  return (
    <AdminDialog onClose={onClose}>
      <section className="member-confirm rank-sheet">
        <h2>{detail ? `${detail.room.icon} ${roomLabel(detail.room as Pick<RankRoom, "kind">)} · ${t(detail.room.title)}` : t("รายละเอียดรอบ")}</h2>
        {detail ? <p className="rank-sheet-time">{detail.session.startsAt.slice(11, 16)}–{detail.session.endsAt.slice(11, 16)}{detail.room.courtName ? ` · ${courtName(detail.room.courtName)}` : ""}</p> : null}
        <TabBar label={t("รายละเอียดรอบ")} tabs={[["players", t("ผู้เข้าร่วม")], ["pairs", t("การจัดคู่")], ["winners", t("ผู้ชนะ")]]} value={tab} onChange={setTab} />
        {!state ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
        {state?.error ? <p role="alert">{t("โหลดข้อมูลไม่สำเร็จ")}</p> : null}
        {detail && tab === "players" ? (
          <ol className="rank-list">
            {detail.players.map((player) => <li key={`${player.queue}-${player.name}`}><span>{player.queue}. {player.name}</span><small>{t(player.tier)} · {money(player.rating)}</small><em className={player.paid ? "paid" : "waiting"}>{player.checkedIn ? t("เช็คอินแล้ว") : player.paid ? t("ชำระแล้ว") : t("รอชำระ")}</em></li>)}
            {!detail.players.length ? <li>{t("ยังไม่มีผู้เข้าร่วม")}</li> : null}
          </ol>
        ) : null}
        {detail && tab === "pairs" ? (
          <div className="rank-pairs">
            {detail.onCourt ? <p className="rank-oncourt">{t("กำลังลงสนาม: ทีม {{value0}} พบ ทีม {{value1}}", { value0: detail.onCourt[0].no, value1: detail.onCourt[1].no })}</p> : null}
            {detail.pairing.teams.length ? detail.pairing.teams.map((item) => <div key={item.no} className="rank-team"><b>{t("ทีม {{value0}}", { value0: item.no })}</b><span>{names(item.players)}</span><small>{t("เฉลี่ย {{value0}} คะแนน", { value0: money(item.rating) })}</small></div>)
              : <p>{detail.session.matched ? t("ยังไม่มีทีม") : t("ระบบจะจัดคู่อัตโนมัติเมื่อถึงเวลาและผู้เล่นครบ {{value0}} คน", { value0: detail.room.minPlayers })}</p>}
            {detail.pairing.reserves.length ? <p className="rank-reserve">{t("ตัวสำรอง")}: {names(detail.pairing.reserves)}</p> : null}
            {detail.queue.length ? <p className="rank-reserve">{t("คิวถัดไป")}: {detail.queue.map((no) => t("ทีม {{value0}}", { value0: no })).join(" → ")}</p> : null}
            {detail.games.length ? (
              <ol className="rank-list">
                {detail.games.map((game, index) => <li key={game.id}><span>{t("เกม {{value0}}", { value0: index + 1 })}: {game.teamANo ? t("ทีม {{value0}}", { value0: game.teamANo }) : names(game.teamA)} {game.scoreA ?? ""} – {game.scoreB ?? ""} {game.teamBNo ? t("ทีม {{value0}}", { value0: game.teamBNo }) : names(game.teamB)}</span><small>{t("ชนะ")}: {game.winner === "a" ? names(game.teamA) : names(game.teamB)}</small></li>)}
              </ol>
            ) : null}
          </div>
        ) : null}
        {detail && tab === "winners" ? (
          <div className="rank-winners">
            {detail.room.prize ? <p className="rank-prize-text">🏆 {t(detail.room.prize)}{detail.room.prizeCoins ? ` · ${t("Coin {{value0}}", { value0: detail.room.prizeCoins.split(",").join(" / ") })}` : ""}</p> : null}
            {detail.awards.length ? (
              <ol className="rank-list">{detail.awards.map((award) => <li key={award.place}><span>{t("อันดับ {{value0}}", { value0: award.place })} · {award.name}</span><small>{t("ชนะ {{value0}} เกม", { value0: award.wins })}</small><em className="paid">+{award.coins} Coin</em></li>)}</ol>
            ) : detail.standings.length ? (
              <ol className="rank-list">{detail.standings.map((row, index) => <li key={`${index}-${row.name}`}><span>{index + 1}. {row.name}</span><small>{t("ชนะ {{value0}}/{{value1}} เกม", { value0: row.wins, value1: row.played })} · {row.gain >= 0 ? "+" : ""}{row.gain}</small></li>)}</ol>
            ) : <p>{t("ยังไม่มีผลการแข่งขันของรอบนี้")}</p>}
          </div>
        ) : null}
        <div><button type="button" className="ghost" onClick={onClose}>{t("ปิด")}</button></div>
      </section>
    </AdminDialog>
  );
}
