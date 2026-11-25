"use client";
import { useEffect, useState } from "react";
import { Empty, LoadingNote, money, Top } from "@/components/member-ui";
import { SectionLabel, SlotGrid, TabBar, WeekStrip, weekdayName, type GridSlot } from "@/components/member-schedule";
import type { Coupon, Membership, Trainer } from "@/components/member-types";
import { PriceTag, validityText } from "@/components/member-packages";
import { bangkokToday } from "@/lib/court-availability";
import { clockOf, couponMeta, instructorCards, minutesOf, packsForProgram, timesOn, type ClassProgram } from "@/lib/class-programs";
import { t } from "@/lib/i18n";
import { parseMeta, perUnit } from "@/lib/package-presentation";
import { discounted, type ActiveDiscount } from "@/lib/promotions";

// แก้ 8-11: HYROX (Simulation · Series · Class), Pilates (Private: 1/1 All · 1/1 Reformer · Duo 1:2 ·
// Rent Room, and Group Class), Airfit (Private 1:1 / 1:2 and Class) and the free Service Classes.
// Each class page: the member's coupons for it and the packs on sale, the instructor (chosen on the
// trainer page for a private class) or the instructors by time, the room or machine of a rental, then
// a month of days and the class times with the places taken (x/10, x/12, x/20).

type DaySlot = { time: string; endTime: string; taken: number; capacity: number; status: "available" | "full" | "past" | "closed"; mine: boolean; instructor: string | null; resource: string | null };
type DaySlots = { programId: number; open: boolean; resource: string | null; trainerId: number | null; slots: DaySlot[] };
export type ClassService = "hyrox" | "airfit" | "pilates" | "service";
// What the member chose on a class page, kept while they go to the trainer page and back.
export type ClassView = { tab?: string; group?: string; subgroup?: string; date?: string; seriesId?: number; chosen?: boolean; program?: string; trainers?: Record<string, number>; resources?: Record<string, string> };
export type ClassReserve = { program: ClassProgram; date: string; time: string; endTime: string; instructor: string | null; useCoupon: boolean; couponLeft: number; covered: string | null; activeMember: boolean; trainerId?: number; trainerName?: string; resource?: string | null };

export const CLASS_DAYS = 30;
const tabLabels: Record<string, string> = { simulation: "Simulation", series: "Series", class: "Class", private: "Private", group: "Group Class" };
const tones = ["#1d3a28", "#3b1f3f", "#3f1f28", "#2a1f45", "#16304a", "#3a2a12"];

// focusOf: the instructor and rooms to read the times for, from the programs on screen.
function useClassDay(service: string, date: string, revision: number, focusOf: (programs: ClassProgram[]) => string) {
  const [state, setState] = useState<{ key: string; programs?: ClassProgram[]; days?: DaySlots[]; error?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const focus = focusOf(state?.programs || []);
  const key = `${service}:${date}:${revision}:${focus}`;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(focus);
    params.set("service", service);
    params.set("date", date);
    const load = () => fetch(`/api/classes?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then((response) => (response.ok ? response.json() as Promise<{ programs: ClassProgram[]; days: DaySlots[] }> : Promise.reject(new Error("load"))))
      .then((body) => { if (!controller.signal.aborted) setState({ key, programs: body.programs, days: body.days }); })
      .catch(() => { if (!controller.signal.aborted) setState((current) => (current?.key === key && current.days ? current : { key, programs: current?.programs, error: true })); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [service, date, focus, key, attempt]);
  // The programs are the same on every day: the last ones stay on screen while another day loads.
  return { programs: state?.programs, days: state?.key === key ? state.days : undefined, loading: state?.key !== key, error: state?.key === key && Boolean(state.error), retry: () => setAttempt((value) => value + 1) };
}

// Uses left of the member's valid coupons that can book the program.
export function couponBalance(program: Pick<ClassProgram, "couponCategories">, coupons: Coupon[]) {
  return coupons.filter((coupon) => program.couponCategories.includes(coupon.category)).reduce((sum, coupon) => sum + Number(coupon.remainingUses || 0), 0);
}

// The member's unlimited Member package that includes the class (books it without coupons), if any.
export function coveringPlan(program: Pick<ClassProgram, "membershipServices">, memberships: Membership[], now: number) {
  if (!program.membershipServices.length) return null;
  const plan = memberships.find((membership) => {
    if (membership.status !== "active" || Date.parse(String(membership.endsAt).replace(" ", "T") + "+07:00") <= now) return false;
    const services = parseMeta(membership.metadata).services;
    return Array.isArray(services) && services.some((service) => program.membershipServices.includes(String(service)));
  });
  return plan?.planName || null;
}

export function durationText(minutes: number) {
  return minutes % 60 === 0 || minutes % 30 === 0 && minutes > 60 ? t("{{value0}} ชั่วโมง", { value0: minutes / 60 }) : t("{{value0}} นาที", { value0: minutes });
}

function openRange(program: ClassProgram) {
  const first = program.times[0];
  const last = program.times.at(-1);
  return first && last ? { from: first, to: clockOf(Math.min(24 * 60, minutesOf(last) + program.minutes)) } : null;
}

type Props = {
  service: ClassService;
  title: string;
  icon: string;
  coupons: Coupon[];
  couponStore: Coupon[];
  trainers: Trainer[];
  memberships: Membership[];
  activeMember: boolean;
  discount?: ActiveDiscount | null;
  now: number;
  busy: boolean;
  revision: number;
  view: ClassView;
  onView: (view: ClassView) => void;
  onBack: () => void;
  onBuyCoupon: (coupon: Coupon, price: number) => void;
  onReserve: (input: ClassReserve) => void;
  onPickTrainer: (program: ClassProgram) => void;
  onOpenTimetable: () => void;
  onOpenPlans: () => void;
};

export function ClassServiceScreen(props: Props) {
  const { service, title, icon, coupons, couponStore, trainers, memberships, activeMember, discount, now, busy, revision, view, onView, onBack } = props;
  const today = bangkokToday(now);
  const date = view.date && view.date >= today ? view.date : today;
  const setDate = (value: string) => onView({ ...view, date: value });

  // The visible programs decide which instructor and room the times are read for.
  const day = useClassDay(service, date, revision, (list) => focusQuery(visiblePrograms(service, list, view).programs, view));
  const programs = day.programs || [];
  const current = visiblePrograms(service, programs, view);

  if (service === "service" && !view.program) {
    return (
      <div className="page class-page">
        <Top title="Service Class" icon="🧘" onBack={onBack} />
        <p className="gymnos-lead">{t("คลาสฟรี เฉพาะสมาชิกที่มีสถานะเท่านั้น")}</p>
        <div className="gx-grid two">
          {programs.map((program, index) => (
            <button type="button" className="gx" key={program.id} onClick={() => onView({ ...view, program: program.slug })}>
              <span className="gi" style={{ background: tones[index % tones.length] }} aria-hidden="true">{program.icon}</span>
              <b>{program.short || program.title}</b>
              <small>{t(program.subtitle) || t("ฟรี · เฉพาะสมาชิก")}</small>
            </button>
          ))}
          <button type="button" className="gx" onClick={props.onOpenTimetable}>
            <span className="gi" style={{ background: "#3a2a12" }} aria-hidden="true">📅</span>
            <b>{t("ตารางคลาส")}</b>
            <small>{t("30 วัน")}</small>
          </button>
        </div>
        {day.loading && !programs.length ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
        {day.error && !programs.length ? <div role="alert" className="calendar-error">{t("โหลดข้อมูลไม่สำเร็จ")}<button type="button" onClick={day.retry}>{t("ลองใหม่")}</button></div> : null}
        <p className="class-note">📌 {t("เฉพาะสมาชิกที่มีสถานะ (Active Member) เท่านั้นจึงจะลงชื่อจองได้ · รับคลาสละ 20 คน")}</p>
        {!activeMember ? <MemberNeeded onOpenPlans={props.onOpenPlans} /> : null}
      </div>
    );
  }

  if (service === "pilates" && !view.chosen) {
    const privatePrograms = programs.filter((program) => program.tab === "private");
    const groupPrograms = programs.filter((program) => program.tab === "group");
    return (
      <div className="page class-page">
        <Top title={title} icon={icon} onBack={onBack} />
        <p className="gymnos-lead">{t("เลือกรูปแบบคลาส")}</p>
        <div className="gx-grid two">
          <button type="button" className="gx" onClick={() => onView({ ...view, tab: "private", chosen: true })}>
            <span className="gi" style={{ background: "#33203f" }} aria-hidden="true">🧑‍🏫</span>
            <b>PRIVATE</b>
            <small>{[...new Set(privatePrograms.map((program) => program.group || program.title))].join(" · ") || t("เรียนส่วนตัว")}</small>
          </button>
          <button type="button" className="gx" onClick={() => onView({ ...view, tab: "group", chosen: true })}>
            <span className="gi" style={{ background: "#123a3f" }} aria-hidden="true">👥</span>
            <b>GROUP CLASS</b>
            <small>{groupPrograms.map((program) => t(program.subtitle) || program.title).join(" · ") || t("คลาสกลุ่ม")}</small>
          </button>
        </div>
        <p className="class-note">🎫 {t("ทุกหน้า — มีคูปองถึงจะจองเวลาได้")}</p>
        {day.loading && !programs.length ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      </div>
    );
  }

  const { tabKeys, activeTab, groups, activeGroup, subgroups, activeSubgroup } = current;
  const seriesPrograms = activeTab === "series" ? current.programs.filter((program) => program.kind === "series") : [];
  const series = seriesPrograms.find((program) => program.id === view.seriesId) || null;
  const scheduled = activeTab === "series" ? (series ? [series] : []) : current.programs;
  const daySlots = (program: ClassProgram) => day.days?.find((item) => item.programId === program.id);
  const single = service === "service" ? programs.find((program) => program.slug === view.program) : null;
  const pageTitle = single ? `${single.icon} ${single.title}` : service === "pilates" ? `${title} · ${tabLabels[activeTab] || activeTab}` : title;
  const back = service === "service" ? () => onView({ ...view, program: undefined }) : service === "pilates" ? () => onView({ ...view, chosen: false }) : onBack;

  return (
    <div className="page class-page">
      <Top title={pageTitle} icon={single ? undefined : icon} onBack={back} />
      {series ? <div className="class-picked" role="status">✓ {t("เลือก {{value0}} + Simulation {{value1}} ครั้ง แล้ว — เลือกวันเริ่มโปรแกรมด้านล่าง", { value0: t(series.label || series.title), value1: series.simulations })}</div> : null}
      {tabKeys.length > 1 && service !== "pilates" && service !== "service" ? <TabBar label={t("ประเภทบริการ")} tabs={tabKeys.map((key) => [key, tabLabels[key] || key] as [string, string])} value={activeTab} onChange={(key) => onView({ ...view, tab: key, group: undefined, subgroup: undefined })} /> : null}
      {groups.length > 1 ? <TabBar label={t("รูปแบบ")} tabs={groups.map((key) => [key, key] as [string, string])} value={activeGroup} onChange={(key) => onView({ ...view, group: key, subgroup: undefined })} className="sub-tabs" /> : null}
      {subgroups.length > 1 ? <TabBar label={t("รูปแบบ")} tabs={subgroups.map((key) => [key, key] as [string, string])} value={activeSubgroup} onChange={(key) => onView({ ...view, subgroup: key })} className="sub-tabs" /> : null}
      {day.error && !programs.length ? <div role="alert" className="calendar-error">{t("โหลดข้อมูลไม่สำเร็จ")}<button type="button" onClick={day.retry}>{t("ลองใหม่")}</button></div> : null}
      {!programs.length && day.loading ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {!programs.length && !day.loading && !day.error ? <Empty text={t("ยังไม่มีคลาสเปิดให้จอง")} /> : null}

      {activeTab === "series" && seriesPrograms.length ? (
        <>
          <section className="class-hero series">
            <b>🔥 HYROX SERIES</b>
            <small>{t(seriesPrograms[0].body) || t("Private Zone + Online Program")} · {t("เลือกแพ็กเกจก่อน แล้วเลือกวันเริ่มโปรแกรม")}</small>
          </section>
          <div className="pack-list" role="radiogroup" aria-label={t("แพ็กเกจ")}>
            {seriesPrograms.map((program) => (
              <button type="button" role="radio" aria-checked={series?.id === program.id} key={program.id} className={series?.id === program.id ? "pkg-row on" : "pkg-row"} onClick={() => onView({ ...view, seriesId: program.id })}>
                <span><b>{program.label ? t(program.label) : t(program.title)}</b><small>{t("+ Simulation {{value0}} ครั้ง", { value0: program.simulations })}</small></span>
                <strong>{money(program.price)} ฿</strong>
              </button>
            ))}
          </div>
          {!series ? <p className="slot-footnote">{t("เลือกโปรแกรมก่อน แล้วจึงเลือกวันและเวลาเริ่ม")}</p> : null}
        </>
      ) : null}

      {scheduled.map((program) => {
        const balance = couponBalance(program, coupons);
        const covered = coveringPlan(program, memberships, now);
        const packs = packsForProgram(program, couponStore);
        const slotsOfDay = daySlots(program);
        const hours = openRange(program);
        const trainer = program.trainerLink ? trainers.find((item) => item.id === view.trainers?.[program.slug]) || null : null;
        const resource = program.resources.length ? (view.resources?.[program.slug] && program.resources.includes(view.resources[program.slug]) ? view.resources[program.slug] : program.resources[0]) : null;
        const cards = program.trainerLink ? [] : instructorCards(program);
        const showCounts = (program.kind === "coupon" || program.kind === "free") && program.capacity > 1;
        const ranges = program.minutes % 60 !== 0;
        const packDiscount = discount && discount.scope.includes(program.service) ? discount : null;
        const grid: GridSlot[] = (slotsOfDay?.slots || []).map((slot) => {
          const full = slot.status === "full";
          const text = slot.mine ? t("จองแล้ว") : slot.status === "past" ? t("ผ่านแล้ว") : slot.status === "closed" ? t("ปิดรับ") : full ? (showCounts ? t("{{value0}}/{{value1}} เต็ม", { value0: slot.taken, value1: slot.capacity }) : t("ไม่ว่าง")) : showCounts ? `${slot.taken}/${slot.capacity}` : undefined;
          const time = ranges ? `${slot.time} – ${slot.endTime}` : slot.time;
          return {
            key: slot.time, time, sub: text,
            state: slot.mine ? "mine" : slot.status === "past" ? "past" : full || slot.status === "closed" ? "unavailable" : "available",
            label: [time, text].filter(Boolean).join(" "),
            onPick: slot.mine || slot.status !== "available" ? undefined : () => props.onReserve({
              program, date, time: slot.time, endTime: slot.endTime, instructor: trainer?.name || slot.instructor,
              useCoupon: program.kind === "coupon" || (program.kind === "session" && balance > 0), couponLeft: balance, covered, activeMember,
              trainerId: trainer?.id, trainerName: trainer ? `${trainer.name}${trainer.nickname ? ` (${trainer.nickname})` : ""}` : undefined, resource,
            }),
          };
        });
        const scheduleLabel = program.kind === "series" ? t("เลือกวันเริ่มโปรแกรม (จันทร์ – อาทิตย์)")
          : program.kind === "session" ? t("เลือกวันและช่วงเวลา (จันทร์ – อาทิตย์)")
            : program.kind === "free" ? t("ตารางจอง (จันทร์ – อาทิตย์)")
              : t("ตารางรายเดือน (จันทร์ – อาทิตย์) · เรียน {{value0}}", { value0: durationText(program.minutes) });
        const footnote = program.kind === "free" ? t("จองฟรีทันที (ต้องมีสถานะสมาชิก) · บันทึกลง “การจองของฉัน”")
          : program.kind === "coupon" ? (covered ? t("แตะเวลาเพื่อจอง · แพ็กเกจ Member ใช้ได้ไม่จำกัด") : balance > 0 ? t("แตะเวลาเพื่อจอง · ใช้คูปอง 1 ครั้งต่อการจอง") : t("ซื้อคูปองก่อนแล้วแตะเวลาเพื่อจอง"))
            : program.kind === "series" ? t("แตะเวลาเริ่มเพื่อชำระเงินทันที · บันทึกลง “การจองของฉัน”")
              : t("แตะช่วงเวลาเพื่อชำระเงินทันที · บันทึกลง “การจองของฉัน”");
        return (
          <section className="class-program" key={program.id}>
            {program.kind === "session" ? (
              <div className="class-hero">
                <b>{t(program.title)}</b>
                <strong>{money(program.price)} ฿ <small>{t("/ ครั้ง")}</small></strong>
                {program.subtitle ? <small>{t(program.subtitle)}</small> : null}
                {balance > 0 ? <em className="credit-note">{t("คุณมีสิทธิ์ {{value0}} {{value1}} ครั้ง · ใช้สิทธิ์ได้ตอนจอง", { value0: t(program.title), value1: balance })}</em> : null}
              </div>
            ) : null}
            {program.kind === "free" ? (
              <>
                <div className="coupon-balance has">
                  <span><b>{t("คลาสฟรี · ไม่ต้องใช้คูปอง")}</b><small>📌 {t("เฉพาะสมาชิกที่มีสถานะ (Active Member) เท่านั้นจึงจะลงชื่อจองได้ · รับคลาสละ {{value0}} คน", { value0: program.capacity })}</small></span>
                </div>
                {!activeMember ? <MemberNeeded onOpenPlans={props.onOpenPlans} /> : null}
              </>
            ) : null}
            {program.kind === "coupon" ? (
              <>
                <div className={balance > 0 || covered ? "coupon-balance has" : "coupon-balance"}>
                  <span><b>{t("คูปอง {{value0}} ของฉัน", { value0: t(program.title) })}</b><small>{covered ? t("แพ็กเกจ {{value0}} จองคลาสนี้ได้ไม่จำกัด", { value0: t(covered) }) : t("มีคูปองถึงจะจองเวลาได้")}</small></span>
                  <strong>{covered ? "∞" : balance}</strong>
                </div>
                <SectionLabel>{t("แพ็กเกจคูปอง")}</SectionLabel>
                <div className="pack-list">
                  {packs.map((coupon) => {
                    const meta = couponMeta(coupon);
                    const uses = Number(coupon.totalUses || 0);
                    const original = Number(coupon.price || 0);
                    const price = packDiscount ? discounted(original, packDiscount.percent) : original;
                    const sub = [meta.note ? t(meta.note) : "", uses > 1 ? t("ใช้งานได้ {{value0}}", { value0: validityText(coupon.validityDays) }) : "", uses > 2 ? t("เฉลี่ย {{value0}} ฿/ครั้ง", { value0: money(perUnit(price, uses)) }) : "", meta.badge ? t(meta.badge) : ""].filter(Boolean).join(" · ");
                    return (
                      <button type="button" key={coupon.id} className="pkg-row" onClick={() => props.onBuyCoupon(coupon, price)} aria-label={t("ซื้อ {{value0}}", { value0: t(coupon.name) })}>
                        <span><b>{meta.label ? t(meta.label) : t(coupon.name)}</b>{sub ? <small>{sub}</small> : null}</span>
                        <PriceTag price={price} original={packDiscount ? original : undefined} />
                      </button>
                    );
                  })}
                  {!packs.length ? <Empty text={t("ยังไม่มีคูปองเปิดจำหน่าย")} /> : null}
                </div>
                <p className="slot-footnote">{t("ซื้อแล้วคูปองจะเก็บใน “คูปองของฉัน”")}</p>
              </>
            ) : null}
            {program.body && program.kind !== "series" ? <p className="class-note">📌 {t(program.body)}</p> : null}
            {program.minPeople > 0 ? <p className="class-note">👥 {t("ขั้นต่ำ {{value0}} คน คลาสจึงจะเปิด · ถ้าไม่ครบ ระบบยกเลิกและคืนคูปองให้ {{value1}} ชม. ก่อนเริ่ม", { value0: program.minPeople, value1: program.confirmHours })}</p> : null}
            {program.trainerLink ? (
              <>
                <SectionLabel>{t("ผู้สอน")}</SectionLabel>
                {trainer ? (
                  <div className="class-trainer">
                    <span className="class-trainer-ava" aria-hidden="true">{trainer.avatar || "🧑‍🏫"}</span>
                    <span><b>{trainer.name}{trainer.nickname ? ` (${trainer.nickname})` : ""}</b><small>{t(trainer.role)}</small></span>
                    <button type="button" className="ghost" onClick={() => props.onPickTrainer(program)}>{t("เปลี่ยนผู้สอน")}</button>
                  </div>
                ) : <button type="button" className="ghost trainer-link" onClick={() => props.onPickTrainer(program)}>🧑‍🏫 {t("เลือกผู้สอน — ไปหน้าเทรนเนอร์")}</button>}
              </>
            ) : null}
            {cards.length ? (
              <>
                <SectionLabel>{t("ผู้สอนตามช่วงเวลา")}</SectionLabel>
                <div className="instructor-list">
                  {cards.map((row, index) => (
                    <div key={row.name} className="instructor-row">
                      <span aria-hidden="true">🧑‍🏫</span>
                      <b>{row.name}</b>
                      <small>{row.from ? t("{{value0}} – {{value1}} น.", { value0: row.from, value1: row.to }) : row.slots.map((slot) => `${weekdayName(slot.day)} ${slot.time}`).join(" · ")}</small>
                      <em>{String(index + 1).padStart(2, "0")}</em>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {program.resources.length ? (
              <>
                <SectionLabel>{t(program.resourceLabel || "เลือกห้องหรือเครื่อง")}</SectionLabel>
                <div className="resource-grid" role="group" aria-label={t(program.resourceLabel || "เลือกห้องหรือเครื่อง")}>
                  {program.resources.map((item) => (
                    <button type="button" key={item} className={item === resource ? "on" : ""} aria-pressed={item === resource} onClick={() => onView({ ...view, resources: { ...view.resources, [program.slug]: item } })}>{t(item)}</button>
                  ))}
                </div>
              </>
            ) : null}
            <SectionLabel note={hours ? `${t("เปิด {{value0}} – {{value1}} น.", { value0: hours.from, value1: hours.to })}${showCounts ? ` · ${t("รับ {{value0}} คน/รอบ", { value0: program.capacity })}` : ""}` : undefined}>{scheduleLabel}</SectionLabel>
            <WeekStrip from={today} value={date} onChange={setDate} days={CLASS_DAYS} dim={(value) => !timesOn(program, value).length} />
            {day.loading ? <LoadingNote text={t("กำลังโหลดเวลาว่าง")} /> : null}
            {slotsOfDay && !slotsOfDay.open ? <p className="slot-grid-empty">{t("ไม่มีรอบในวันนี้")}</p> : null}
            {slotsOfDay?.open ? <SlotGrid slots={grid} /> : null}
            {program.trainerLink && !trainer && slotsOfDay?.open ? <p className="slot-footnote">{t("เลือกผู้สอนก่อน แล้วระบบจะแสดงเวลาที่ผู้สอนว่าง")}</p> : null}
            <p className="slot-footnote">{footnote}</p>
            {busy ? <LoadingNote text={t("กำลังดำเนินการ…")} /> : null}
          </section>
        );
      })}
    </div>
  );
}

function MemberNeeded({ onOpenPlans }: { onOpenPlans: () => void }) {
  return (
    <div className="renew-note member-needed">
      <span>{t("ต้องมีแพ็กเกจสมาชิกที่ใช้งานอยู่จึงจะเข้าคลาสฟรีได้")}</span>
      <button type="button" className="ghost" onClick={onOpenPlans}>{t("ดูแพ็กเกจ")}</button>
    </div>
  );
}

function focusQuery(programs: ClassProgram[], view: ClassView) {
  const focus = new URLSearchParams();
  const trainerProgram = programs.find((program) => program.trainerLink && view.trainers?.[program.slug]);
  if (trainerProgram) focus.set("trainer", String(view.trainers?.[trainerProgram.slug]));
  for (const program of programs) if (program.resources.length && view.resources?.[program.slug]) focus.append("resource", `${program.slug}|${view.resources[program.slug]}`);
  return focus.toString();
}

// The tab, group (1/1 All, Private 1:2, Rent Room …) and sub-group (Private Room / Reformer) on screen,
// and the programs they hold. A Service Class page shows its one class.
function visiblePrograms(service: ClassService, programs: ClassProgram[], view: ClassView) {
  if (service === "service") {
    const one = programs.filter((program) => program.slug === view.program);
    return { programs: one, tabKeys: [] as string[], activeTab: "class", groups: [] as string[], activeGroup: "", subgroups: [] as string[], activeSubgroup: "" };
  }
  const tabKeys = [...new Set(programs.map((program) => program.tab))];
  const activeTab = view.tab && tabKeys.includes(view.tab) ? view.tab : tabKeys[0] || "";
  const inTab = programs.filter((program) => program.tab === activeTab);
  const groups = [...new Set(inTab.map((program) => program.group).filter((value): value is string => Boolean(value)))];
  const activeGroup = view.group && groups.includes(view.group) ? view.group : groups[0] || "";
  const inGroup = groups.length ? inTab.filter((program) => program.group === activeGroup) : inTab;
  const subgroups = [...new Set(inGroup.map((program) => program.subgroup).filter((value): value is string => Boolean(value)))];
  const activeSubgroup = view.subgroup && subgroups.includes(view.subgroup) ? view.subgroup : subgroups[0] || "";
  const visible = subgroups.length ? inGroup.filter((program) => program.subgroup === activeSubgroup) : inGroup;
  return { programs: visible, tabKeys, activeTab, groups, activeGroup, subgroups, activeSubgroup };
}
