"use client";
import { useEffect, useState } from "react";
import { Empty, LoadingNote, money, Spinner, Top } from "@/components/member-ui";
import { dateLabel, SectionLabel, SlotGrid, TabBar, WeekStrip, type GridSlot } from "@/components/member-schedule";
import { RankPanel, type RankFocus, type RankJoin, type RankView } from "@/components/member-rank";
import { SportGroupsPanel } from "@/components/member-groups";
import type { Group, Sport } from "@/components/member-types";
import { bangkokToday, hourSlots } from "@/lib/court-availability";
import { courtName, t } from "@/lib/i18n";

// รายการที่ 3: a sport's own page. Tabs: booking (one per zone: Indoor / Outdoor 3x3), Buffet Rank or
// Open Run when the sport has rooms, and the sport's groups (ก๊วน). Booking shows the day and night
// prices, a week strip and an hourly grid with the price on each button; a court sharing its floor with
// another sport shows "ไม่ว่าง · วอลเลย์บอล" when that sport booked it (Cross-Sport Conflict Check).

type LiveStatus = { status: "free" | "booked" | "in_use" | "closed"; until?: string; sportId?: number | null };
type CourtInfo = { id: number; name: string; zone: string | null; kind: string | null; capacity: number; dayRate: number; nightRate: number; sharedWith: number[]; live?: LiveStatus };
type SlotInfo = { courtId: number; time: string; status: "available" | "full" | "past" | "closed"; available: boolean; rate: number; period: "day" | "night"; sharedWith?: number };
export type Availability = { date: string; hours: { open: number; close: number; nightFrom: number }; rates: { dayRate: number; nightRate: number }; courts: CourtInfo[]; slots: SlotInfo[] };

export type CourtBookingRequest = { courtId: number | null; zone?: string; courtKind?: string; date: string; time: string; durationHours: number; amount: number; label: string };

const courtWords = new Set(["badminton", "pickleball", "tennis", "padel"]);

function useAvailability(sport: string, date: string, revision: number) {
  const key = `${sport}:${date}:${revision}`;
  const [state, setState] = useState<{ key: string; data?: Availability; error?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/courts/availability?${new URLSearchParams({ sport, date })}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error("load");
        const data = await response.json() as Availability;
        if (!controller.signal.aborted) setState({ key, data });
      } catch {
        if (!controller.signal.aborted) setState((current) => (current?.key === key && current.data ? current : { key, error: true }));
      }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [sport, date, key, attempt]);
  return { data: state?.key === key ? state.data : undefined, loading: state?.key !== key, error: state?.key === key && Boolean(state.error) && !state.data, retry: () => setAttempt((value) => value + 1) };
}

function useRankView(sport: string, revision: number) {
  const [view, setView] = useState<{ key: string; data: RankView | null } | null>(null);
  const key = `${sport}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    const load = () => fetch(`/api/rank?${new URLSearchParams({ sport })}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then((response) => (response.ok ? response.json() as Promise<RankView> : null))
      .then((data) => { if (!controller.signal.aborted) setView({ key, data }); })
      .catch(() => { if (!controller.signal.aborted) setView((current) => current || { key, data: null }); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [sport, key]);
  return { rank: view?.data ?? null, rankLoaded: view !== null };
}

const hourText = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function rangeText(values: number[]) {
  const positive = values.filter((value) => value > 0);
  if (!positive.length) return "-";
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}

export function SportScreen(props: {
  sport: Sport;
  sports: Sport[];
  groups: Group[];
  now: number;
  busy: boolean;
  revision: number;
  onBack: () => void;
  onBook: (request: CourtBookingRequest) => void;
  onJoinRank: (join: RankJoin) => void;
  onOpenLevel: () => void;
  // ก๊วน tab: create and ranking open their own pages; a group opens the group page.
  onCreateGroup: () => void;
  onGroupRanking: () => void;
  onOpenGroup: (group: Group) => void;
  onRefreshGroups: () => void;
  // Opened on a tab ("rank" from Find Your Game, "groups" back from a group page) and, for Buffet Rank,
  // on the room, day and time the member tapped.
  initialTab?: string;
  rankFocus?: RankFocus;
  onTabChange?: (tab: string) => void;
}) {
  const { sport, sports, now, revision } = props;
  const today = bangkokToday(now);
  const [date, setDate] = useState(today);
  const [tab, setTabState] = useState<string>(props.initialTab || "");
  const setTab = (next: string) => { setTabState(next); props.onTabChange?.(next); };
  const selected = useAvailability(sport.slug, date, revision);
  const todayView = useAvailability(sport.slug, today, revision);
  const { rank, rankLoaded } = useRankView(sport.slug, revision);
  const courts = (selected.data || todayView.data)?.courts || [];
  const zones = [...new Set(courts.map((court) => court.zone || ""))];
  const rankLabel = rank?.rooms.length ? (rank.rooms.every((room) => room.kind === "open_run") ? "Open Run" : "Buffet Rank") : "";
  const bookingWord = courtWords.has(sport.slug) ? t("จองคอร์ท") : t("จองสนาม");
  const tabs: [string, string][] = [
    ...(zones.length > 1 ? zones.map((zone) => [`zone:${zone}`, t(zone) || bookingWord] as [string, string]) : [["zone:" + (zones[0] ?? ""), bookingWord] as [string, string]]),
    ...(rankLabel ? [["rank", rankLabel] as [string, string]] : []),
    ["groups", t("ก๊วน")],
  ];
  // "rank" waits for the room list before falling back to booking (Find Your Game opens it directly).
  const activeTab = tabs.some(([key]) => key === tab) ? tab : tab === "rank" && !rankLoaded ? "" : tabs[0][0];
  useEffect(() => {
    if (activeTab === "groups") props.onRefreshGroups();
    // Refresh the club's groups once each time the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const sportName = (id: number) => t(sports.find((item) => Number(item.id) === Number(id))?.name) || t("กีฬาอื่น");

  return (
    <div className="page sport-page">
      <Top title={t(sport.name)} icon={sport.icon} onBack={props.onBack} />
      <p className="sport-open">{t("เปิดจอง จันทร์ – อาทิตย์")}</p>
      <TabBar label={t("เมนู{{value0}}", { value0: t(sport.name) })} tabs={tabs} value={activeTab} onChange={setTab} className="sport-tabs" />
      {activeTab.startsWith("zone:") ? (
        <CourtBookingPanel
          key={activeTab}
          zone={activeTab.slice(5)}
          sport={sport}
          date={date}
          today={today}
          onDate={setDate}
          selected={selected}
          todayCourts={todayView.data?.courts || []}
          busy={props.busy}
          sportName={sportName}
          onBook={props.onBook}
        />
      ) : null}
      {activeTab === "" ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {activeTab === "rank" && rank ? <RankPanel view={rank} now={now} busy={props.busy} focus={props.rankFocus} onJoin={props.onJoinRank} onOpenLevel={props.onOpenLevel} /> : null}
      {activeTab === "groups" ? (
        <SportGroupsPanel sport={sport} groups={props.groups} onCreate={props.onCreateGroup} onRanking={props.onGroupRanking} onOpen={props.onOpenGroup} />
      ) : null}
    </div>
  );
}

type Option = { key: string; label: string; courts: CourtInfo[]; kind: string | null };

function CourtBookingPanel({ zone, sport, date, today, onDate, selected, todayCourts, busy, sportName, onBook }: {
  zone: string;
  sport: Sport;
  date: string;
  today: string;
  onDate: (date: string) => void;
  selected: ReturnType<typeof useAvailability>;
  todayCourts: CourtInfo[];
  busy: boolean;
  sportName: (id: number) => string;
  onBook: (request: CourtBookingRequest) => void;
}) {
  const data = selected.data;
  const zoneCourts = (data?.courts || todayCourts).filter((court) => (court.zone || "") === zone);
  const kinds = [...new Set(zoneCourts.map((court) => court.kind).filter((kind): kind is string => Boolean(kind)))];
  const options: Option[] = kinds.length
    ? kinds.map((kind) => ({ key: kind, label: kind, kind, courts: zoneCourts.filter((court) => court.kind === kind) }))
    : [{ key: "all", label: "", kind: null, courts: zoneCourts }];
  const [optionKey, setOptionKey] = useState(options[0]?.key || "all");
  const option = options.find((item) => item.key === optionKey) || options[0];
  const [courtChoice, setCourtChoice] = useState<number | "auto">("auto");
  const [start, setStart] = useState<string | null>(null);
  const [hours, setHours] = useState(1);
  const pickable = !option?.kind && (option?.courts.length || 0) > 1;
  const candidates = !option ? [] : pickable && courtChoice !== "auto" ? option.courts.filter((court) => court.id === courtChoice) : option.courts;
  const reset = () => { setStart(null); setHours(1); };

  const times = data ? hourSlots(data.hours.open, data.hours.close) : [];
  const slotOf = (courtId: number, time: string) => data?.slots.find((slot) => slot.courtId === courtId && slot.time === time);
  // Consecutive free hours of a court from `time` (the server books the first court free for all of them).
  const freeRun = (courtId: number, time: string) => {
    let count = 0;
    for (let index = times.indexOf(time); index >= 0 && index < times.length && count < 4; index += 1) {
      if (!slotOf(courtId, times[index])?.available) break;
      count += 1;
    }
    return count;
  };
  const maxHours = start ? Math.max(0, ...candidates.map((court) => freeRun(court.id, start))) : 0;
  const assigned = start ? candidates.find((court) => freeRun(court.id, start) >= Math.min(hours, maxHours || 1)) : undefined;
  const duration = Math.max(1, Math.min(hours, maxHours || 1));
  const amount = start && assigned ? times.slice(times.indexOf(start), times.indexOf(start) + duration).reduce((sum, time) => sum + Number(slotOf(assigned.id, time)?.rate || 0), 0) : 0;

  const shared = [...new Set(option?.courts.flatMap((court) => court.sharedWith) || [])];
  const sharedNames = shared.map(sportName).join(", ");
  const optionTitle = [zone && zone !== "Main" ? t(zone) : "", option?.kind || ""].filter(Boolean).join(" · ");
  const nightFrom = data?.hours.nightFrom ?? 16;
  const open = data?.hours.open ?? 8;
  const close = data?.hours.close ?? 21;

  const grid: GridSlot[] = times.map((time) => {
    const cells = candidates.map((court) => slotOf(court.id, time)).filter((slot): slot is SlotInfo => Boolean(slot));
    const free = cells.find((slot) => slot.available);
    const night = Number(time.slice(0, 2)) >= nightFrom;
    const icon = night ? "🌙" : "☀";
    if (free) {
      const isStart = start === time;
      const inRange = start && assigned && times.indexOf(time) > times.indexOf(start) && times.indexOf(time) < times.indexOf(start) + duration;
      return {
        key: time, time, tone: night ? "night" : "day", state: isStart || inRange ? "selected" : "available",
        sub: `${icon} ${money(free.rate)} ฿`,
        label: t("{{value0}} ว่าง {{value1}} บาท", { value0: time, value1: money(free.rate) }),
        onPick: () => { setStart(time === start ? null : time); setHours(1); },
      };
    }
    const sharedTaken = cells.find((slot) => slot.sharedWith);
    const past = cells.length > 0 && cells.every((slot) => slot.status === "past");
    const closed = cells.length > 0 && cells.every((slot) => slot.status === "closed");
    const text = past ? t("ผ่านแล้ว") : closed ? t("ปิด") : sharedTaken ? t("ไม่ว่าง · {{value0}}", { value0: sportName(Number(sharedTaken.sharedWith)) }) : t("ไม่ว่าง");
    return { key: time, time, state: past ? "past" : "unavailable", sub: text, label: `${time} ${text}` };
  });

  const placeText = assigned ? (option?.kind ? optionTitle || option.kind : courtName(assigned.name)) : optionTitle;
  const end = start ? hourText(Number(start.slice(0, 2)) + duration) : "";

  return (
    <div className={start ? "booking-panel with-sticky-bar" : "booking-panel"}>
      {options.length > 1 ? (
        <TabBar label={t("ประเภทสนาม")} tabs={options.map((item) => [item.key, t(item.label)] as [string, string])} value={option?.key || ""} onChange={(key) => { setOptionKey(key); reset(); }} className="sub-tabs" />
      ) : null}
      <section className="price-card">
        <h3><span aria-hidden="true">{sport.icon}</span> {optionTitle ? t("ค่าเช่าสนาม · {{value0}}", { value0: optionTitle }) : t("ค่าเช่าสนาม")}{sharedNames ? ` · ${t("ใช้ร่วมกับ{{value0}}", { value0: sharedNames })}` : ""}</h3>
        <div className="price-row day"><span className="price-tag">☀ {t("กลางวัน")}</span><small>{hourText(open)} – {hourText(Math.min(nightFrom, close))}</small><b>{rangeText(option?.courts.map((court) => court.dayRate) || [])}<em> {t("฿/ชม.")}</em></b></div>
        {nightFrom < close ? <div className="price-row night"><span className="price-tag">🌙 {t("กลางคืน")}</span><small>{hourText(nightFrom)} – {hourText(close)}</small><b>{rangeText(option?.courts.map((court) => court.nightRate) || [])}<em> {t("฿/ชม.")}</em></b></div> : null}
      </section>
      {sharedNames ? <p className="shared-note">{t("ใช้พื้นที่เดียวกับ{{value0}} · ช่วงที่{{value0}}จองแล้วจะขึ้น ไม่ว่าง · {{value0}} ให้เห็นทันที", { value0: sharedNames })}</p> : null}

      {pickable ? (
        <section className="court-lights" aria-label={t("สถานะสนามตอนนี้")}>
          <button type="button" className={courtChoice === "auto" ? "court-light on" : "court-light"} onClick={() => { setCourtChoice("auto"); reset(); }}>
            <i className="dot auto" aria-hidden="true" /><b>{t("สนามไหนก็ได้")}</b><small>{t("ระบบเลือกสนามว่างให้")}</small>
          </button>
          {option.courts.map((court) => {
            const live = todayCourts.find((item) => item.id === court.id)?.live;
            const status = live?.status || "free";
            const statusText = status === "booked" ? t("จองแล้ว ถึง {{value0}}", { value0: live?.until || "" }) : status === "in_use" ? t("กำลังใช้งาน ถึง {{value0}}", { value0: live?.until || "" }) : status === "closed" ? t("ปิดชั่วคราว ถึง {{value0}}", { value0: live?.until || "" }) : t("ว่างตอนนี้");
            return (
              <button type="button" key={court.id} className={`court-light ${status}${courtChoice === court.id ? " on" : ""}`} aria-pressed={courtChoice === court.id} onClick={() => { setCourtChoice(court.id); reset(); }}>
                <i className={`dot ${status}`} aria-hidden="true" /><b>{courtName(court.name)}</b><small>{rangeText([court.dayRate, court.nightRate])} {t("฿/ชม.")} · {statusText}</small>
              </button>
            );
          })}
          <p className="court-legend"><span><i className="dot free" aria-hidden="true" />{t("ว่าง")}</span><span><i className="dot booked" aria-hidden="true" />{t("จองแล้ว")}</span><span><i className="dot in_use" aria-hidden="true" />{t("กำลังใช้งาน")}</span></p>
        </section>
      ) : null}

      <SectionLabel note={t("เปิด {{value0}} – {{value1}} น. · {{value2}} สนาม", { value0: hourText(open), value1: hourText(close), value2: option?.courts.length || 0 })}>{t("เลือกวันและเวลา (จันทร์ – อาทิตย์)")}</SectionLabel>
      <WeekStrip from={today} value={date} onChange={(next) => { onDate(next); reset(); }} />
      {selected.loading ? <LoadingNote text={t("กำลังโหลดเวลาว่าง")} /> : null}
      {selected.error ? <div role="alert" className="calendar-error">{t("โหลดเวลาว่างไม่สำเร็จ")}<button type="button" onClick={selected.retry}>{t("ลองใหม่")}</button></div> : null}
      {data && option ? <SlotGrid slots={grid} empty={t("ยังไม่มีสนามเปิดให้จองสำหรับบริการนี้")} /> : null}
      {data && !zoneCourts.length ? <Empty text={t("ยังไม่มีสนามเปิดให้จองสำหรับบริการนี้")} /> : null}
      <p className="slot-footnote">{t("แตะช่วงเวลาเพื่อเลือก · ราคาปรับตามช่วงกลางวัน/กลางคืนอัตโนมัติ")}</p>

      {start && assigned ? (
        <div className="sticky-summary summary-actions booking-bar">
          <div className="booking-bar-head">
            <span>{placeText ? `${placeText} · ` : ""}{dateLabel(date)} · {start}–{end}</span>
            <b>{money(amount)} ฿</b>
          </div>
          {maxHours > 1 ? (
            <div className="duration-pick" role="group" aria-label={t("จำนวนชั่วโมง")}>
              {Array.from({ length: maxHours }, (_, index) => index + 1).map((value) => (
                <button type="button" key={value} className={duration === value ? "on" : ""} aria-pressed={duration === value} onClick={() => setHours(value)}>{t("{{value0}} ชม.", { value0: value })}</button>
              ))}
            </div>
          ) : null}
          <button type="button" className="primary" disabled={busy} onClick={() => onBook({
            courtId: pickable && courtChoice !== "auto" ? courtChoice : option?.courts.length === 1 ? option.courts[0].id : null,
            zone: zone || undefined,
            courtKind: option?.kind || undefined,
            date, time: start, durationHours: duration, amount,
            label: `${sport.icon} ${t(sport.name)}${placeText ? ` · ${placeText}` : ""}`,
          })}>{busy ? <><Spinner />{t("กำลังดำเนินการ…")}</> : t("ยืนยันและชำระเงิน")}</button>
        </div>
      ) : null}
    </div>
  );
}
