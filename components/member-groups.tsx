"use client";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Empty, LoadingNote, Spinner, Top } from "@/components/member-ui";
import { SectionLabel } from "@/components/member-schedule";
import type { Group, Sport } from "@/components/member-types";
import { feedIsLive, gameNeed, homeGames, type LiveFeed, type LiveGame } from "@/lib/find-your-game";
import { courtName, localeTag, t } from "@/lib/i18n";
import { safeImageSource } from "@/lib/media";
import { wallClockTime } from "@/lib/package-presentation";
import { shrinkPhoto } from "@/lib/photo-resize";

// PPA app analysis V2, items 2 and 4.
//   Find Your Game: the club's Buffet Rank / Open Run sessions of every sport with places left now (not
//   members' groups); a card opens the sport's Buffet Rank / Open Run tab at that time.
//   ก๊วน: standing groups. The sport's ก๊วน tab: create, today's ranking, my groups, the club's other
//   groups and the five group rules. Creating: photo, name, description, four level buttons and members
//   added by member ID (play times and head counts belong to the court booking). The group page shows
//   members and the courts booked for the group. 🏆 อันดับก๊วนวันนี้ ranks today's groups; Coins won are
//   received at the counter with "🎁 รับ Coin" (a QR staff scan).

export const LEVEL_CHOICES = ["มือใหม่", "ฝึกหน้าบ้าน", "พอตัว", "แข่งขัน"];
// The four level buttons of the create form: stored level, emoji and the short label of the design.
export const LEVEL_BUTTONS: [string, string, string][] = [["มือใหม่", "🌱", "มือใหม่"], ["ฝึกหน้าบ้าน", "🏸", "หน้าบ้าน"], ["พอตัว", "💪", "พอตัว"], ["แข่งขัน", "🔥", "แข่งขัน"]];
export const GROUP_RULES = { perCourt: 6, extraPlayers: 2, extraPercent: 50, maxPerCourt: 8, top: { owner: 2, member: 1 }, streak: { owner: 3, member: 2 } };

export type NewGroup = { sportSlug: string; name: string; levelName: string; description?: string; memberCodes?: string[]; photo?: Blob | null };
export type CoinClaim = { entitlementId: number; title: string; coins: number; kind: string; groupId: number; groupName: string; awardDate: string; role: string; endsAt: string | null };
type Member = { userId?: number; displayName: string; avatar: string; level: string; isOwner: boolean; isMe: boolean };
type GroupBooking = { bookingNo: string; title: string; startsAt: string; endsAt: string; courtName: string | null; status: string };
type GroupDetail = { group: Group & { ownerName: string; createdAt: string; isOwner: boolean; joined: boolean }; members: Member[]; bookings: GroupBooking[] };
type RankingRow = { place: number; id: number; name: string; levelName: string; photoUrl: string | null; memberCount: number; mine: boolean };
type Ranking = { date: string; sport: { slug: string; name: string; icon: string }; ranking: RankingRow[]; claims: CoinClaim[] };
type Lookup = { memberCode: string; displayName: string; avatar: string; level: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, signal: init?.signal || AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) {
    const error = new Error(body?.message || "เกิดข้อผิดพลาด");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body as T;
}

export function levelIcon(level: string | null | undefined) {
  return LEVEL_BUTTONS.find(([value]) => value === level)?.[1] || "👥";
}

export function GroupAvatar({ photoUrl, level, size = 48, className = "" }: { photoUrl?: string | null; level?: string | null; size?: number; className?: string }) {
  const src = safeImageSource(photoUrl);
  if (src) return <Image className={`group-avatar ${className}`.trim()} src={src} alt="" width={size} height={size} sizes={`${size}px`} unoptimized={!src.startsWith("/uploads/")} />;
  return <span className={`group-avatar fallback ${className}`.trim()} aria-hidden="true">{levelIcon(level)}</span>;
}

function LivePill() {
  return <span className="fyg-live-pill"><i aria-hidden="true" />LIVE</span>;
}

function gameTime(game: LiveGame) {
  if (game.live) return t("กำลังเล่น · ถึง {{value0}}", { value0: game.to });
  return game.day === "today" ? t("วันนี้ {{value0}}–{{value1}}", { value0: game.from, value1: game.to }) : t("พรุ่งนี้ {{value0}}–{{value1}}", { value0: game.from, value1: game.to });
}

function gameName(game: LiveGame) {
  const room = game.kind === "open_run" ? game.roomTitle : game.levelName || game.roomTitle;
  return `${t(game.sportName)} · ${t(room)}`;
}

// Home: "🎯 Find Your Game" with LIVE and the sessions members can join (or that are being played).
export function FindYourGameRow({ feed, onOpen, onAll }: { feed: LiveFeed | null; onOpen: (game: LiveGame) => void; onAll: () => void }) {
  const games = homeGames(feed?.games || []);
  return (
    <section className="fyg-section" aria-label={t("fyg.title")}>
      <div className="sec-head fyg-head"><strong>🎯 {t("fyg.title")}</strong>{feed && feedIsLive(feed.games) ? <LivePill /> : null}</div>
      {!feed ? (
        <div className="fyg-row fyg-slots" aria-hidden="true"><i className="sk sk-card game" /><i className="sk sk-card game" /><i className="sk sk-card game" /></div>
      ) : (
        <div className={games.length > 3 ? "fyg-row fyg-slots scroll" : "fyg-row fyg-slots"}>
          {games.map((game) => {
            const need = gameNeed(game);
            return (
              <button type="button" className={`fyg-slot ${need.tone}${game.mine ? " mine" : ""}`} key={`${game.roomId}-${game.startsAt}`} onClick={() => onOpen(game)} aria-label={`${gameName(game)} · ${t(need.text, need.values)} · ${gameTime(game)}`}>
                <b><span aria-hidden="true">{game.sportIcon}</span> {gameName(game)}</b>
                <small className="fyg-need">{t(need.text, need.values)}</small>
                <small>{game.mine ? t("คุณเข้าร่วมแล้ว") : gameTime(game)}</small>
              </button>
            );
          })}
          {!games.length ? (
            <button type="button" className="fyg-slot create alone" onClick={onAll}>
              <b>{t("ยังไม่มีรอบเปิดรับตอนนี้")}</b>
              <small>{t("ดู Buffet Rank / Open Run ทั้งหมด")}</small>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

// Find Your Game page (บริการเพิ่มเติม › Find Your Game, rich menu "groups"): every session open now, by
// sport, and the member's own groups.
export function FindYourGameScreen({ feed, groups, sports, onBack, onOpenGame, onOpenGroup, onOpenSportGroups }: {
  feed: LiveFeed | null;
  groups: Group[];
  sports: Sport[];
  onBack: () => void;
  onOpenGame: (game: LiveGame) => void;
  onOpenGroup: (group: Group) => void;
  onOpenSportGroups: (sport: Sport) => void;
}) {
  const games = (feed?.games || []).filter((game) => game.live || game.joinable);
  const mine = groups.filter((group) => Number(group.joined) || Number(group.isOwner));
  const groupSports = sports.filter((sport) => sport.requiresBooking && !["pilates", "airfit"].includes(sport.slug));
  return (
    <div className="page groups-page">
      <Top title="Find Your Game" icon="🎯" onBack={onBack} />
      <div className="fyg-screen-head"><span>{t("Buffet Rank และ Open Run ของสนาม · ที่ว่างอัปเดตตามจริง")}</span>{feed && feedIsLive(feed.games) ? <LivePill /> : null}</div>
      {!feed ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      <div className="fyg-list">
        {games.map((game) => {
          const need = gameNeed(game);
          return (
            <button type="button" className={`fyg-card ${need.tone}`} key={`${game.roomId}-${game.startsAt}`} onClick={() => onOpenGame(game)}>
              <span className="fyg-card-icon" aria-hidden="true">{game.sportIcon}</span>
              <span className="fyg-card-text">
                <b>{gameName(game)}</b>
                <small>{gameTime(game)} · {t("{{value0}} ฿ / คน", { value0: game.price.toLocaleString(localeTag()) })}</small>
                <em>{t(need.text, need.values)}</em>
              </span>
              <span className="fyg-card-left"><b>{game.left}</b><small>/ {game.capacity} {t("ที่")}</small></span>
            </button>
          );
        })}
        {feed && !games.length ? <Empty text={t("ยังไม่มีรอบเปิดรับตอนนี้")} /> : null}
      </div>
      <SectionLabel>{t("ก๊วนของฉัน")}</SectionLabel>
      <div className="group-list">
        {mine.map((group) => <GroupRow key={group.id} group={group} onOpen={onOpenGroup} />)}
        {!mine.length ? <p className="slot-grid-empty">{t("ยังไม่ได้อยู่ในก๊วนไหน · สร้างหรือเข้าร่วมก๊วนได้ที่แท็บก๊วนของแต่ละกีฬา")}</p> : null}
      </div>
      <div className="fyg-sport-links" role="group" aria-label={t("ก๊วนของแต่ละกีฬา")}>
        {groupSports.map((sport) => <button type="button" key={sport.slug} onClick={() => onOpenSportGroups(sport)}><span aria-hidden="true">{sport.icon}</span>{t("ก๊วน{{value0}}", { value0: t(sport.name) })}</button>)}
      </div>
    </div>
  );
}

function GroupRow({ group, onOpen }: { group: Group; onOpen: (group: Group) => void }) {
  const owner = Boolean(Number(group.isOwner));
  return (
    <button type="button" className="group-row" onClick={() => onOpen(group)}>
      <GroupAvatar photoUrl={group.photoUrl} level={group.levelName} />
      <span className="group-row-text">
        <b>{group.name}</b>
        <small>{t(group.levelName)} · {t("{{value0}} สมาชิก", { value0: group.memberCount })}{owner ? ` · ${t("ผู้จัดก๊วน")}` : ""}</small>
      </span>
      <span className="chev" aria-hidden="true">›</span>
    </button>
  );
}

export function GroupRules({ sportName }: { sportName?: string }) {
  const rules = GROUP_RULES;
  return (
    <section className="group-rules">
      <h3>{sportName ? t("กติกากลุ่มก๊วน{{value0}}", { value0: sportName }) : t("กติกากลุ่มก๊วน")}</h3>
      <ol>
        <li>{t("1 คอร์ทรับได้ {{value0}} คน เพิ่มได้อีก {{value1}} คน (คิดเพิ่ม +{{value2}}% ต่อคนที่เพิ่ม ชำระที่เคาน์เตอร์)", { value0: rules.perCourt, value1: rules.extraPlayers, value2: rules.extraPercent })}</li>
        <li>{t("เกิน {{value0}} คน/ชม. จองคอร์ทเพิ่มได้ทันที เลือก “สนามไหนก็ได้” ระบบเปิดคอร์ทที่ว่างให้อัตโนมัติ", { value0: rules.maxPerCourt })}</li>
        <li>{t("เมื่อผู้จัดก๊วนชำระเงินจองสนามแล้ว ระบบแจ้งเวลานัดให้สมาชิกทุกคนในกลุ่มอัตโนมัติ")}</li>
        <li>🏆 {t("กลุ่มที่มีสมาชิกมากสุดของวัน: ผู้จัดก๊วนรับ {{value0}} Coin · สมาชิกรับคนละ {{value1}} Coin", { value0: rules.top.owner, value1: rules.top.member })}</li>
        <li>🔥 {t("กลุ่มที่มาเล่นติดต่อกันทุก 3 วัน: ผู้จัดก๊วนรับ {{value0}} Coin · สมาชิกรับคนละ {{value1}} Coin", { value0: rules.streak.owner, value1: rules.streak.member })}</li>
      </ol>
      <p>{t("รับ Coin ที่เคาน์เตอร์: เปิดหน้าอันดับก๊วนแล้วกด 🎁 รับ Coin ภายใน 30 วัน")}</p>
    </section>
  );
}

// The ก๊วน tab of a sport: create and ranking first, then my groups, the club's other groups, the rules.
export function SportGroupsPanel({ sport, groups, onCreate, onRanking, onOpen }: {
  sport: Sport;
  groups: Group[];
  onCreate: () => void;
  onRanking: () => void;
  onOpen: (group: Group) => void;
}) {
  const sportGroups = groups.filter((group) => group.sportSlug === sport.slug);
  const mine = sportGroups.filter((group) => Number(group.joined) || Number(group.isOwner));
  const others = sportGroups.filter((group) => !Number(group.joined) && !Number(group.isOwner));
  const sportName = t(sport.name);
  return (
    <div className="sport-groups">
      <button type="button" className="join-btn" onClick={onCreate}>＋ {t("สร้างกลุ่มก๊วน{{value0}}", { value0: sportName })}</button>
      <button type="button" className="rank-prize" onClick={onRanking}>🏆 {t("อันดับก๊วน{{value0}}ประจำวัน", { value0: sportName })}</button>
      <SectionLabel>{t("กลุ่มก๊วน{{value0}}ของฉัน", { value0: sportName })}</SectionLabel>
      <div className="group-list">
        {mine.map((group) => <GroupRow key={group.id} group={group} onOpen={onOpen} />)}
        {!mine.length ? <p className="slot-grid-empty">{t("ยังไม่ได้อยู่ในกลุ่มของกีฬานี้")}</p> : null}
      </div>
      <SectionLabel>{t("กลุ่มก๊วน{{value0}}อื่นๆ ในคลับ", { value0: sportName })}</SectionLabel>
      <div className="group-list">
        {others.map((group) => <GroupRow key={group.id} group={group} onOpen={onOpen} />)}
        {!others.length ? <p className="slot-grid-empty">{t("ยังไม่มีกลุ่มอื่นในกีฬานี้")}</p> : null}
      </div>
      <GroupRules sportName={sportName} />
    </div>
  );
}

// Member ID field with [เพิ่ม]: finds the member (GET /api/members/lookup) before adding them.
function MemberIdField({ busy, onFound, placeholder, exclude }: { busy?: boolean; onFound: (member: Lookup) => Promise<boolean> | boolean; placeholder: string; exclude: string[] }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ checking?: boolean; error?: string }>({});
  async function add(event: FormEvent) {
    event.preventDefault();
    const value = code.trim();
    if (!value || state.checking) return;
    setState({ checking: true });
    try {
      const { member } = await request<{ member: Lookup }>(`/api/members/lookup?${new URLSearchParams({ code: value })}`);
      if (exclude.includes(member.memberCode.toUpperCase())) {
        setState({ error: t("เพิ่มคนนี้ไปแล้ว") });
        return;
      }
      const added = await onFound(member);
      setState({});
      if (added) setCode("");
    } catch (error) {
      setState({ error: t((error as Error).message) });
    }
  }
  return (
    <form className="member-id-field" onSubmit={add}>
      <div>
        <input value={code} maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder={placeholder} aria-label={t("ID สมาชิก")} onChange={(event) => { setCode(event.target.value); setState({}); }} />
        <button type="submit" className="primary" disabled={busy || state.checking || !code.trim()}>{state.checking ? <Spinner /> : t("เพิ่ม")}</button>
      </div>
      {state.error ? <small role="alert" className="field-error">{state.error}</small> : <small>{t("ID สมาชิกอยู่ที่หน้าโปรไฟล์ของเพื่อน (MEMBER ID · PPA-…)")}</small>}
    </form>
  );
}

function PhotoPicker({ preview, busy, onPick, label }: { preview: string | null; busy?: boolean; onPick: (photo: Blob, url: string) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  return (
    <div className="group-photo-picker">
      <button type="button" className={preview ? "group-photo-button has-photo" : "group-photo-button"} disabled={busy} onClick={() => input.current?.click()} aria-label={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="" /> : <span aria-hidden="true">📷</span>}
      </button>
      <small>{error || label}</small>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*" hidden onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          const photo = await shrinkPhoto(file);
          setError("");
          onPick(photo, URL.createObjectURL(photo));
        } catch {
          setError(t("เปิดรูปนี้ไม่ได้ ลองเลือกรูปอื่น"));
        }
      }} />
    </div>
  );
}

// สร้างกลุ่มก๊วน: photo, name, description, the level as four buttons and members added by member ID.
export function GroupCreateScreen({ sport, me, busy, onBack, onCreate }: {
  sport: Sport;
  me: { displayName: string; memberCode: string; level?: string };
  busy: boolean;
  onBack: () => void;
  onCreate: (input: NewGroup) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [levelName, setLevelName] = useState(LEVEL_CHOICES[0]);
  const [members, setMembers] = useState<Lookup[]>([]);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  const sportName = t(sport.name);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || name.trim().length < 2) return;
    await onCreate({ sportSlug: sport.slug, name: name.trim(), levelName, description: description.trim() || undefined, memberCodes: members.map((member) => member.memberCode), photo: photo?.blob || null });
  }
  return (
    <div className="page group-create-page">
      <Top title={t("สร้างกลุ่มก๊วน")} onBack={onBack} />
      <PhotoPicker preview={photo?.url || null} busy={busy} label={photo ? t("แตะเพื่อเปลี่ยนรูปกลุ่ม") : t("แตะเพื่อใส่รูปกลุ่ม")} onPick={(blob, url) => setPhoto({ blob, url })} />
      <form id="group-create" className="field-stack group-form" onSubmit={submit}>
        <label className="field">{t("ชื่อกลุ่ม")}<input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("เช่น ก๊วน{{value0}}พี่น้อง", { value0: sportName })} /></label>
        <label className="field">{t("คำอธิบายกลุ่ม")}<textarea maxLength={500} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("เช่น ก๊วนสายชิลตีทุกเย็นวันอังคาร-พฤหัส เน้นสนุก ไม่ซีเรียส")} /></label>
        <fieldset className="level-buttons">
          <legend>{t("ระดับของกลุ่ม")}</legend>
          {LEVEL_BUTTONS.map(([value, icon, label]) => (
            <button type="button" key={value} className={levelName === value ? "on" : ""} aria-pressed={levelName === value} onClick={() => setLevelName(value)}><span aria-hidden="true">{icon}</span> {t(label)}</button>
          ))}
        </fieldset>
      </form>
      <SectionLabel>{t("สมาชิก ({{value0}} คน)", { value0: members.length + 1 })}</SectionLabel>
      <MemberIdField busy={busy} placeholder={t("ใส่ ID สมาชิก เช่น PPA-1A2B3C4D")} exclude={[me.memberCode.toUpperCase(), ...members.map((member) => member.memberCode.toUpperCase())]} onFound={(member) => { setMembers((list) => [...list, member]); return true; }} />
      <ul className="group-member-list">
        <li><span className="group-member-avatar" aria-hidden="true">🙂</span><span><b>{t("ฉัน")} · {me.displayName}</b><small>{me.level ? `${t(me.level)} · ` : ""}{t("ผู้จัดก๊วน")}</small></span></li>
        {members.map((member) => (
          <li key={member.memberCode}>
            <span className="group-member-avatar" aria-hidden="true">{member.avatar || "🧑"}</span>
            <span><b>{member.displayName}</b><small>{member.memberCode}{member.level ? ` · ${t(member.level)}` : ""}</small></span>
            <button type="button" className="group-member-remove" aria-label={t("นำ {{value0}} ออก", { value0: member.displayName })} onClick={() => setMembers((list) => list.filter((item) => item.memberCode !== member.memberCode))}>×</button>
          </li>
        ))}
      </ul>
      <p className="slot-footnote">{t("วันเวลาเล่นและจำนวนผู้เล่น ตั้งตอนจองคอร์ทให้ก๊วน ระบบแจ้งสมาชิกทุกคนเมื่อชำระแล้ว")}</p>
      <button type="submit" form="group-create" className="primary green group-create-submit" disabled={busy || name.trim().length < 2}>{busy ? <><Spinner />{t("กำลังดำเนินการ…")}</> : t("สร้างกลุ่ม")}</button>
    </div>
  );
}

function shortDay(date: string) {
  const time = Date.parse(`${date}T00:00:00+07:00`);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(localeTag(), { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }) : date;
}

export function claimLabel(claim: Pick<CoinClaim, "kind" | "awardDate">) {
  return claim.kind === "streak_3" ? t("เล่นต่อเนื่อง 3 วัน ถึง {{value0}}", { value0: shortDay(claim.awardDate) }) : t("อันดับ 1 ประจำวัน {{value0}}", { value0: shortDay(claim.awardDate) });
}

// 🏆 อันดับก๊วนวันนี้: today's top three groups of the sport and the member's Coins waiting at the counter.
export function GroupRankingScreen({ sport, onBack, onClaim, onOpenGroup }: { sport: Sport; onBack: () => void; onClaim: (claim: CoinClaim) => void; onOpenGroup: (groupId: number) => void }) {
  const [state, setState] = useState<{ data?: Ranking; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    request<Ranking>(`/api/groups/ranking?${new URLSearchParams({ sport: sport.slug })}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then((data) => { if (!controller.signal.aborted) setState({ data }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ error: (error as Error).message }); });
    return () => controller.abort();
  }, [sport.slug, attempt]);
  const data = state?.data;
  const sportName = t(sport.name);
  const claimFor = (groupId: number) => data?.claims.find((claim) => claim.groupId === groupId);
  return (
    <div className="page group-ranking-page">
      <Top title={t("อันดับก๊วนวันนี้")} icon="🏆" onBack={onBack} />
      <p className="group-ranking-intro">{t("อันดับก๊วน{{value0}}วันนี้ · จัดอันดับตามจำนวนสมาชิกของก๊วนที่จองสนามวันนี้ · อันดับ 1 เมื่อจบวัน รับ Coin ทั้งผู้จัดก๊วนและสมาชิก", { value0: sportName })}</p>
      {!state ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {state?.error ? <div role="alert" className="calendar-error">{t(state.error)}<button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("ลองใหม่")}</button></div> : null}
      {data?.claims.length ? (
        <section className="coin-claims" aria-label={t("Coin รอรับของคุณ")}>
          <h3>🎁 {t("Coin รอรับของคุณ")}</h3>
          {data.claims.map((claim) => (
            <div className="coin-claim" key={claim.entitlementId}>
              <span><b>{t("ก๊วน {{value0}}", { value0: claim.groupName })}</b><small>{claimLabel(claim)} · +{claim.coins} Coin</small></span>
              <button type="button" className="primary green" onClick={() => onClaim(claim)}>🎁 {t("รับ Coin")}</button>
            </div>
          ))}
        </section>
      ) : null}
      {data ? (
        <ol className="group-ranking">
          {data.ranking.map((row) => {
            const claim = claimFor(row.id);
            return (
              <li key={row.id} className={row.place === 1 ? "first" : ""}>
                <span className="group-rank-place" aria-label={t("อันดับ {{value0}}", { value0: row.place })}>{row.place === 1 ? "⭐" : row.place}</span>
                <button type="button" className="group-rank-open" onClick={() => onOpenGroup(row.id)}>
                  <GroupAvatar photoUrl={row.photoUrl} level={row.levelName} size={44} />
                  <span><b>{row.name}</b><small>{t(row.levelName)} · {t("{{value0}} สมาชิก", { value0: row.memberCount })}{row.mine ? ` · ${t("ก๊วนของคุณ")}` : ""}</small></span>
                </button>
                {claim ? <button type="button" className="primary green group-rank-claim" onClick={() => onClaim(claim)}>🎁 {t("รับ Coin")}</button> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {data && !data.ranking.length ? (
        <div className="scan-empty">
          <span aria-hidden="true">🏆</span>
          <strong>{t("ยังไม่มีก๊วนที่จองสนามวันนี้")}</strong>
          <p>{t("ผู้จัดก๊วนจองและชำระค่าสนาม{{value0}}ของวันนี้ ก๊วนจะขึ้นอันดับทันที", { value0: sportName })}</p>
        </div>
      ) : null}
      <p className="slot-footnote">{t("กด “🎁 รับ Coin” เพื่อรับ QR ยื่นให้เจ้าหน้าที่หน้าคลับ")}</p>
    </div>
  );
}

function bookingWhen(booking: GroupBooking) {
  const start = wallClockTime(booking.startsAt);
  if (!Number.isFinite(start)) return booking.startsAt;
  const day = new Date(start).toLocaleDateString(localeTag(), { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
  return `${day} · ${booking.startsAt.slice(11, 16)}–${booking.endsAt.slice(11, 16)}`;
}

// The group page: photo, name, level, description, the courts booked for the group, members, and what the
// member can do (owner: add by ID, take out, change the photo, book a court, close; others: join / leave).
export function GroupDetailScreen({ groupId, revision, busy, onBack, onJoin, onLeave, onClose, onBook, notice }: {
  groupId: number;
  revision: number;
  busy: boolean;
  onBack: () => void;
  onJoin: (group: Group) => void;
  onLeave: (group: Group) => void;
  onClose: (group: Group) => void;
  onBook: (sportSlug: string) => void;
  notice: (message: string) => void;
}) {
  const [state, setState] = useState<{ data?: GroupDetail; error?: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request<GroupDetail>(`/api/groups/detail?id=${groupId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then((data) => { if (!controller.signal.aborted) setState({ data }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ error: (error as Error).message }); });
    return () => controller.abort();
  }, [groupId, revision, reload]);
  const data = state?.data;
  const group = data?.group;

  async function addMember(member: Lookup) {
    if (!group) return false;
    setWorking(true);
    try {
      const result = await request<{ added: boolean; member: { displayName: string } }>("/api/groups/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: group.id, code: member.memberCode }) });
      notice(result.added ? t("เพิ่ม {{value0}} เข้าก๊วนแล้ว", { value0: result.member.displayName }) : t("{{value0}} อยู่ในก๊วนนี้แล้ว", { value0: result.member.displayName }));
      setReload((value) => value + 1);
      return true;
    } catch (error) {
      notice((error as Error).message);
      return false;
    } finally {
      setWorking(false);
    }
  }
  async function removeMember(member: Member) {
    if (!group || !member.userId) return;
    setWorking(true);
    try {
      await request("/api/groups/members", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: group.id, userId: member.userId }) });
      notice(t("นำ {{value0}} ออกจากก๊วนแล้ว", { value0: member.displayName }));
      setReload((value) => value + 1);
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function changePhoto(photo: Blob) {
    if (!group) return;
    setWorking(true);
    try {
      const form = new FormData();
      form.set("groupId", String(group.id));
      form.set("file", new File([photo], "group.jpg", { type: "image/jpeg" }));
      await request("/api/groups/photo", { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
      notice(t("เปลี่ยนรูปก๊วนแล้ว"));
      setReload((value) => value + 1);
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const full = group ? group.memberCount >= group.maxPlayers : false;
  return (
    <div className="page group-detail-page">
      <Top title={group?.name || t("กลุ่มก๊วน")} onBack={onBack} />
      {!state ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {state?.error ? <div role="alert" className="calendar-error">{t(state.error)}<button type="button" onClick={() => setReload((value) => value + 1)}>{t("ลองใหม่")}</button></div> : null}
      {group && data ? (
        <>
          <header className="group-hero">
            {group.isOwner
              ? <PhotoPicker preview={safeImageSource(group.photoUrl)} busy={working} label={group.photoUrl ? t("แตะเพื่อเปลี่ยนรูปกลุ่ม") : t("แตะเพื่อใส่รูปกลุ่ม")} onPick={(blob, url) => { URL.revokeObjectURL(url); void changePhoto(blob); }} />
              : <GroupAvatar photoUrl={group.photoUrl} level={group.levelName} size={72} className="large" />}
            <b>{group.name}</b>
            <span className="level-badge">{levelIcon(group.levelName)} {t(group.levelName)}</span>
            <small>{group.sportIcon} {t(group.sportName)} · {t("ผู้จัดก๊วน")} {group.ownerName} · {t("{{value0}} สมาชิก", { value0: group.memberCount })}</small>
            {group.description ? <p>{group.description}</p> : null}
          </header>

          {group.joined ? (
            <section className="group-bookings">
              <SectionLabel>{t("นัดเล่นของก๊วน")}</SectionLabel>
              {data.bookings.map((booking) => (
                <div className="group-booking" key={booking.bookingNo}><span aria-hidden="true">{group.sportIcon}</span><span><b>{booking.courtName ? courtName(booking.courtName) : t(booking.title)}</b><small>{bookingWhen(booking)}</small></span></div>
              ))}
              {!data.bookings.length ? <p className="slot-grid-empty">{group.isOwner ? t("ยังไม่มีการจองคอร์ท · จองแล้วระบบแจ้งเวลานัดให้สมาชิกทุกคนอัตโนมัติ") : t("ยังไม่มีการจองคอร์ท · ผู้จัดก๊วนจองแล้วคุณจะได้รับแจ้งเวลานัด")}</p> : null}
              {group.isOwner ? <button type="button" className="primary green" onClick={() => onBook(String(group.sportSlug))}>📅 {t("จองคอร์ทให้ก๊วน")}</button> : null}
            </section>
          ) : null}

          <SectionLabel>{t("สมาชิกในกลุ่ม ({{value0}})", { value0: data.members.length })}</SectionLabel>
          <ul className="group-member-list">
            {data.members.map((member, index) => (
              <li key={member.userId ?? `${index}-${member.displayName}`}>
                <span className="group-member-avatar" aria-hidden="true">{member.avatar || "🧑"}</span>
                <span><b>{member.displayName}{member.isMe ? ` (${t("ฉัน")})` : ""}</b><small>{[member.level ? t(member.level) : "", member.isOwner ? t("ผู้จัดก๊วน") : ""].filter(Boolean).join(" · ") || t("สมาชิก")}</small></span>
                {group.isOwner && !member.isOwner && member.userId ? <button type="button" className="group-member-remove" disabled={working} aria-label={t("นำ {{value0}} ออก", { value0: member.displayName })} onClick={() => void removeMember(member)}>×</button> : null}
              </li>
            ))}
          </ul>

          {group.isOwner ? (
            <>
              <SectionLabel>{t("เพิ่มสมาชิกใหม่ (ผู้จัดก๊วนเท่านั้น)")}</SectionLabel>
              <MemberIdField busy={working || full} placeholder={t("ใส่ ID สมาชิก เช่น PPA-1A2B3C4D")} exclude={[]} onFound={addMember} />
              {full ? <p className="slot-grid-empty">{t("ก๊วนนี้เต็มแล้ว")}</p> : null}
            </>
          ) : null}

          <div className="group-actions">
            {group.isOwner ? <button type="button" className="group-action secondary" disabled={busy} onClick={() => onClose(group)}>{t("ปิดก๊วน")}</button>
              : group.joined ? <button type="button" className="group-action secondary" disabled={busy} onClick={() => onLeave(group)}>{t("ออกจากก๊วน")}</button>
                : <button type="button" className="primary green" disabled={busy || full} onClick={() => onJoin(group)}>{full ? t("เต็มแล้ว") : `🙋 ${t("เข้าร่วมก๊วน")}`}</button>}
          </div>
        </>
      ) : null}
    </div>
  );
}
