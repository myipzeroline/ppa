"use client";

import { useEffect, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { useAdminFeedback } from "@/components/admin-feedback";
import { AdminNotice } from "@/components/admin-notice";
import { clockOf, minutesOf, timesOn, timetableOf, type ClassProgram } from "@/lib/class-programs";

// Back office · Classes (แก้ 8-11): every class program — HYROX, Pilates, Airfit and the free Service
// Classes — with its times, places, instructors, rooms and coupons, the weekly timetable members see,
// and the class times of a day with who booked, how they paid, and a way to cancel a time for everyone.

type Lang = "th" | "en";
type ProgramRow = { id: number; slug: string; title: string; subtitle: string | null; body: string | null; icon: string; price: number; metadata: string | null; sortOrder: number; active: boolean; program: ClassProgram | null; problem: string | null };
type BookingRow = { id: number; bookingNo: string; classKey: string; time: string; status: string; amount: number; userCouponId: number | null; resource: string | null; trainerName: string | null; displayName: string; memberCode: string; phone: string | null; metadata: string | null; checkedInAt: string | null; cancelReason: string | null; taken: number };
type Data = { date: string; programs: ProgramRow[]; bookings: BookingRow[] };
type ScheduleRow = { day: number; time: string; instructor: string };
type InstructorRow = { name: string; from: string; to: string };
type Form = {
  id?: number; slug: string; title: string; subtitle: string; body: string; icon: string; price: number; active: boolean; sortOrder: number;
  service: string; kind: string; tab: string; group: string; subgroup: string; short: string; capacity: number; minutes: number; minPeople: number; confirmHours: number;
  mode: "times" | "schedule"; times: string; weekdays: number[]; schedule: ScheduleRow[]; instructors: InstructorRow[];
  couponCategories: string; membershipServices: string; resources: string; resourceLabel: string; trainerLink: boolean; trainerMatch: string; weeks: number; simulations: number; label: string;
  extra: Record<string, unknown>;
};

const services = ["hyrox", "pilates", "airfit", "service"] as const;
const kinds = ["coupon", "free", "session", "series"] as const;
const dayOrder = [1, 2, 3, 4, 5, 6, 0];

const copy = {
  th: {
    title: "คลาสและตารางเรียน", intro: "ตั้งค่าคลาสที่สมาชิกจองในแอป (HYROX, Pilates, Airfit, Service Class) ดูตารางรายสัปดาห์ และรายชื่อผู้จองของแต่ละรอบ",
    day: "วันที่", today: "วันนี้", all: "ทั้งหมด", roster: "รอบเรียนของวัน", showEmpty: "แสดงรอบที่ยังไม่มีผู้จอง", noSessions: "ไม่มีรอบเรียนที่มีผู้จองในวันนี้", noTimes: "ไม่มีรอบเรียนในวันนี้",
    booked: "จองแล้ว", places: "ที่", short: "ยังไม่ครบขั้นต่ำ", cancelSession: "ยกเลิกรอบนี้", cancelTitle: "ยกเลิกรอบเรียนนี้ให้ทุกคน?", cancelMessage: "ผู้จองทุกคนจะได้รับแจ้ง คูปองคืนอัตโนมัติ เงินที่จ่ายแล้วคืนเป็นเครดิตในแอป", reason: "เหตุผล (แจ้งสมาชิก)", reasonDefault: "ผู้สอนติดภารกิจ ขออภัยในความไม่สะดวก",
    viaCoupon: "คูปอง", viaPackage: "แพ็กเกจ", viaFree: "ฟรี", viaMoney: "ชำระเงิน", pending: "รอชำระ", cancelled: "ยกเลิก", checkedIn: "เช็คอินแล้ว",
    programs: "ตั้งค่าคลาส", add: "เพิ่มคลาส", edit: "แก้ไข", on: "เปิด", off: "ปิด", problem: "ตั้งค่าไม่ครบ", timetable: "ตารางรายสัปดาห์ (ที่สมาชิกเห็น)", timetableEmpty: "ยังไม่มีคลาสกลุ่มในตาราง",
    save: "บันทึก", cancel: "ยกเลิก", close: "ปิด", saved: "บันทึกคลาสแล้ว", cancelledDone: "ยกเลิกรอบเรียนแล้ว", failed: "บันทึกไม่สำเร็จ", loadFailed: "โหลดข้อมูลคลาสไม่สำเร็จ", retry: "ลองใหม่",
    f: {
      slug: "รหัส (slug ภาษาอังกฤษ)", titleField: "ชื่อคลาส", subtitle: "คำอธิบายสั้น", body: "หมายเหตุ (แสดงในหน้าคลาส)", icon: "ไอคอน", price: "ราคา ฿ (Simulation/Series)", active: "เปิดให้จอง", sortOrder: "ลำดับ",
      service: "บริการ", kind: "ประเภท", tab: "แท็บ", group: "กลุ่ม (เช่น 1/1 All)", subgroup: "กลุ่มย่อย (เช่น Private Room)", short: "ชื่อในตารางคลาส", capacity: "รับต่อรอบ (คน)", minutes: "เรียน (นาที)", minPeople: "ขั้นต่ำ (คน, 0 = ไม่มี)", confirmHours: "ยืนยันก่อนเริ่ม (ชม.)",
      mode: "รูปแบบเวลา", modeTimes: "ทุกวันที่เลือก เวลาเดียวกัน", modeSchedule: "ตารางรายสัปดาห์ (วัน + เวลา + ผู้สอน)", times: "เวลาเริ่ม (คั่นด้วย ,)", weekdays: "วันที่เปิด", schedule: "ตารางรายสัปดาห์", addRow: "เพิ่มแถว", remove: "ลบ",
      instructors: "ผู้สอนตามช่วงเวลา (01/02/03)", name: "ชื่อ", from: "ตั้งแต่", to: "ถึง", coupons: "หมวดคูปองที่ใช้จองได้ (คั่นด้วย ,)", membership: "แพ็กเกจที่จองได้ไม่จำกัด (services คั่นด้วย ,)", resources: "ห้อง/เครื่อง (คั่นด้วย ,)", resourceLabel: "หัวข้อเลือกห้อง/เครื่อง",
      trainerLink: "ให้สมาชิกเลือกผู้สอน (หน้าเทรนเนอร์)", trainerMatch: "แสดงเฉพาะเทรนเนอร์ที่มีคำนี้ (เช่น pilates)", weeks: "จำนวนสัปดาห์ (Series)", simulations: "Simulation ที่ได้ (Series)", label: "ชื่อแพ็กเกจ (Series)",
    },
    kindNames: { coupon: "ใช้คูปอง", free: "ฟรี (Active Member)", session: "จ่ายต่อครั้ง", series: "โปรแกรม Series" },
    serviceNames: { hyrox: "HYROX", pilates: "Pilates", airfit: "Airfit", service: "Service Class" },
  },
  en: {
    title: "Classes and timetable", intro: "Set up the classes members book in the app (HYROX, Pilates, Airfit, Service Class), see the weekly timetable and who booked each class time.",
    day: "Date", today: "Today", all: "All", roster: "Class times of the day", showEmpty: "Show times nobody booked", noSessions: "No booked class times on this day", noTimes: "No class times on this day",
    booked: "Booked", places: "places", short: "Below the minimum", cancelSession: "Cancel this time", cancelTitle: "Cancel this class time for everyone?", cancelMessage: "Everyone booked is told; vouchers come back and money paid returns as app credit.", reason: "Reason (sent to members)", reasonDefault: "The instructor is unavailable. Sorry for the inconvenience",
    viaCoupon: "Voucher", viaPackage: "Package", viaFree: "Free", viaMoney: "Paid", pending: "Awaiting payment", cancelled: "Cancelled", checkedIn: "Checked in",
    programs: "Class setup", add: "Add class", edit: "Edit", on: "On", off: "Off", problem: "Incomplete", timetable: "Weekly timetable (as members see it)", timetableEmpty: "No group classes in the timetable yet",
    save: "Save", cancel: "Cancel", close: "Close", saved: "Class saved", cancelledDone: "Class time cancelled", failed: "Could not save", loadFailed: "Could not load classes", retry: "Try again",
    f: {
      slug: "Code (slug)", titleField: "Class name", subtitle: "Short description", body: "Note (shown on the class page)", icon: "Icon", price: "Price ฿ (Simulation/Series)", active: "Open for booking", sortOrder: "Order",
      service: "Service", kind: "Type", tab: "Tab", group: "Group (e.g. 1/1 All)", subgroup: "Sub-group (e.g. Private Room)", short: "Name in the timetable", capacity: "Places per time", minutes: "Length (minutes)", minPeople: "Minimum people (0 = none)", confirmHours: "Confirm before start (hours)",
      mode: "Times", modeTimes: "Same times on chosen days", modeSchedule: "Weekly timetable (day + time + instructor)", times: "Start times (comma separated)", weekdays: "Open on", schedule: "Weekly timetable", addRow: "Add row", remove: "Remove",
      instructors: "Instructors by time (01/02/03)", name: "Name", from: "From", to: "To", coupons: "Voucher categories that book it (comma separated)", membership: "Packages that book it without limit (services)", resources: "Rooms/machines (comma separated)", resourceLabel: "Room/machine heading",
      trainerLink: "Members choose the instructor (trainer page)", trainerMatch: "Only trainers mentioning (e.g. pilates)", weeks: "Weeks (Series)", simulations: "Simulations granted (Series)", label: "Package name (Series)",
    },
    kindNames: { coupon: "Voucher", free: "Free (Active Member)", session: "Pay per time", series: "Series program" },
    serviceNames: { hyrox: "HYROX", pilates: "Pilates", airfit: "Airfit", service: "Service Class" },
  },
} as const;

const bangkokToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const dayName = (lang: Lang, day: number) => new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + day)));
const list = (value: string) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];

function record(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function send<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: String(body.message || response.statusText) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

const known = ["service", "kind", "tab", "group", "subgroup", "short", "capacity", "minutes", "minPeople", "confirmHours", "times", "weekdays", "schedule", "instructors", "couponCategories", "membershipServices", "resources", "resourceLabel", "trainerLink", "trainerMatch", "weeks", "simulations", "label", "sport"];

function formOf(row?: ProgramRow): Form {
  const meta = record(row?.metadata);
  const extra = Object.fromEntries(Object.entries(meta).filter(([key]) => !known.includes(key)));
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  const schedule = Array.isArray(meta.schedule) ? meta.schedule.map(record).map((entry) => ({ day: Number(entry.day ?? 1), time: String(entry.time || "08:00"), instructor: String(entry.instructor || "") })) : [];
  return {
    id: row?.id, slug: row?.slug || "", title: row?.title || "", subtitle: row?.subtitle || "", body: row?.body || "", icon: row?.icon || "🗓️", price: Number(row?.price || 0), active: row ? row.active : true, sortOrder: Number(row?.sortOrder || 0),
    service: String(meta.service || "service"), kind: String(meta.kind || "free"), tab: String(meta.tab || "class"), group: String(meta.group || ""), subgroup: String(meta.subgroup || ""), short: String(meta.short || ""),
    capacity: Number(meta.capacity || 20), minutes: Number(meta.minutes || 60), minPeople: Number(meta.minPeople || 0), confirmHours: Number(meta.confirmHours || 2),
    mode: schedule.length ? "schedule" : "times", times: strings(meta.times).join(", "), weekdays: Array.isArray(meta.weekdays) ? meta.weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6], schedule,
    instructors: Array.isArray(meta.instructors) ? meta.instructors.map(record).map((entry) => ({ name: String(entry.name || ""), from: String(entry.from || "08:00"), to: String(entry.to || "12:00") })) : [],
    couponCategories: strings(meta.couponCategories).join(", "), membershipServices: strings(meta.membershipServices).join(", "), resources: strings(meta.resources).join(", "), resourceLabel: String(meta.resourceLabel || ""),
    trainerLink: meta.trainerLink === true, trainerMatch: String(meta.trainerMatch || ""), weeks: Number(meta.weeks || 0), simulations: Number(meta.simulations || 0), label: String(meta.label || ""),
    extra: { ...extra, ...(meta.sport ? { sport: meta.sport } : {}) },
  };
}

function metadataOf(form: Form) {
  const meta: Record<string, unknown> = { ...form.extra, service: form.service, kind: form.kind, tab: form.tab || "class", capacity: Number(form.capacity), minutes: Number(form.minutes) };
  if (!meta.sport) meta.sport = form.service === "service" || form.service === "hyrox" ? "gym" : form.service;
  if (form.group.trim()) meta.group = form.group.trim();
  if (form.subgroup.trim()) meta.subgroup = form.subgroup.trim();
  if (form.short.trim()) meta.short = form.short.trim();
  if (form.label.trim()) meta.label = form.label.trim();
  if (Number(form.minPeople) > 0) { meta.minPeople = Number(form.minPeople); meta.confirmHours = Number(form.confirmHours) || 2; }
  if (form.mode === "schedule") meta.schedule = form.schedule.filter((row) => row.time).map((row) => ({ day: Number(row.day), time: row.time, ...(row.instructor.trim() ? { instructor: row.instructor.trim() } : {}) }));
  else { meta.times = list(form.times); meta.weekdays = [...form.weekdays].sort(); }
  const instructors = form.instructors.filter((row) => row.name.trim());
  if (instructors.length) meta.instructors = instructors.map((row) => ({ name: row.name.trim(), from: row.from, to: row.to }));
  if (list(form.couponCategories).length) meta.couponCategories = list(form.couponCategories);
  if (list(form.membershipServices).length) meta.membershipServices = list(form.membershipServices);
  if (list(form.resources).length) { meta.resources = list(form.resources); if (form.resourceLabel.trim()) meta.resourceLabel = form.resourceLabel.trim(); }
  if (form.trainerLink) { meta.trainerLink = true; if (form.trainerMatch.trim()) meta.trainerMatch = form.trainerMatch.trim(); }
  if (form.kind === "series") { meta.weeks = Number(form.weeks); meta.simulations = Number(form.simulations); }
  return meta;
}

function paidVia(booking: BookingRow, t: (typeof copy)[Lang]) {
  if (booking.userCouponId) return t.viaCoupon;
  const meta = record(booking.metadata);
  if (meta.package) return t.viaPackage;
  return Number(booking.amount) > 0 ? t.viaMoney : t.viaFree;
}

export function AdminClasses({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify } = useAdminFeedback();
  const [date, setDate] = useState(bangkokToday);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [service, setService] = useState<string>("all");
  const [showEmpty, setShowEmpty] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState("");
  // The class time staff are cancelling, with the reason members will read.
  const [cancelling, setCancelling] = useState<{ programId: number; title: string; time: string; endTime: string; taken: number } | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    let alive = true;
    send<Data>(`/api/admin/classes?date=${date}`, { method: "GET" }).then((sent) => {
      if (!alive) return;
      if (sent.ok) { setData(sent.data); setError(""); } else setError(sent.message);
    });
    return () => { alive = false; };
  }, [date, revision]);

  const programs = (data?.programs || []).filter((row) => service === "all" || row.program?.service === service || record(row.metadata).service === service);
  const live = programs.filter((row) => row.active && row.program);
  const sessions = live.flatMap((row) => timesOn(row.program!, date).map((time) => {
    const bookings = (data?.bookings || []).filter((booking) => booking.classKey === row.slug && booking.time === time);
    const taken = bookings.filter((booking) => Number(booking.taken)).length;
    return { row, program: row.program!, time, endTime: clockOf(minutesOf(time) + row.program!.minutes), bookings, taken };
  })).filter((session) => showEmpty || session.bookings.length).sort((a, b) => a.time.localeCompare(b.time) || a.row.sortOrder - b.row.sortOrder);
  const timetable = timetableOf(live.map((row) => row.program!));

  const cancelSession = async () => {
    if (!cancelling || reason.trim().length < 2) return;
    const sent = await send<Data>("/api/admin/classes", { method: "POST", body: JSON.stringify({ action: "cancel_session", programId: cancelling.programId, date, time: cancelling.time, reason: reason.trim() }) });
    if (!sent.ok) return notify("error", sent.message || t.failed);
    setData(sent.data);
    setCancelling(null);
    notify("success", t.cancelledDone);
  };

  const submit = async () => {
    if (!form) return;
    setFormError("");
    const payload = { title: form.title, subtitle: form.subtitle, body: form.body, icon: form.icon, price: Number(form.price), active: form.active, sortOrder: Number(form.sortOrder), metadata: metadataOf(form) };
    const sent = form.id
      ? await send<Data>("/api/admin/classes", { method: "PUT", body: JSON.stringify({ id: form.id, ...payload }) })
      : await send<Data>("/api/admin/classes", { method: "POST", body: JSON.stringify({ action: "create", slug: form.slug, ...payload }) });
    if (!sent.ok) return setFormError(sent.message || t.failed);
    setData(sent.data);
    setForm(null);
    notify("success", t.saved);
  };
  const patch = (value: Partial<Form>) => setForm((current) => (current ? { ...current, ...value } : current));

  return (
    <div className="admin-trainer-layout">
      <section className="admin-panel">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
        <div className="admin-list-toolbar">
          <label>{t.day} <input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>
          <button type="button" className="ghost" onClick={() => setDate(bangkokToday())}>{t.today}</button>
          <select value={service} aria-label={t.f.service} onChange={(event) => setService(event.target.value)}>
            <option value="all">{t.all}</option>
            {services.map((key) => <option key={key} value={key}>{t.serviceNames[key]}</option>)}
          </select>
          <label className="admin-inline-check"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} /> {t.showEmpty}</label>
        </div>
        {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t.retry}</button></AdminNotice> : null}
        <h3 className="admin-subhead">{t.roster}</h3>
        <div className="admin-class-sessions">
          {sessions.map((session) => {
            const short = session.program.minPeople > 0 && session.taken < session.program.minPeople;
            return (
              <article key={`${session.row.id}-${session.time}`} className="admin-class-session">
                <header>
                  <div>
                    <b>{session.row.icon} {session.row.title}</b>
                    <span>{session.time}–{session.endTime}{session.program.schedule.length || session.program.instructors.length ? ` · ${session.program.schedule.find((entry) => entry.time === session.time && entry.day === new Date(`${date}T00:00:00Z`).getUTCDay())?.instructor || session.program.instructors.find((row) => row.from <= session.time && session.time < row.to)?.name || ""}` : ""}</span>
                  </div>
                  <span className={`admin-badge ${session.taken >= session.program.capacity ? "bad" : short ? "warn" : "good"}`}>{session.taken}/{session.program.capacity} {t.places}{short ? ` · ${t.short} ${session.program.minPeople}` : ""}</span>
                  {session.taken ? <button type="button" className="danger" onClick={() => { setReason(t.reasonDefault); setCancelling({ programId: session.row.id, title: session.row.title, time: session.time, endTime: session.endTime, taken: session.taken }); }}>{t.cancelSession}</button> : null}
                </header>
                {session.bookings.length ? (
                  <ul>
                    {session.bookings.map((booking) => (
                      <li key={booking.id} className={Number(booking.taken) ? "" : "muted"}>
                        <span>{booking.displayName} · {booking.memberCode}{booking.phone ? ` · ${booking.phone}` : ""}</span>
                        <small>{[paidVia(booking, t), booking.trainerName, booking.resource, booking.status === "cancelled" ? `${t.cancelled}${booking.cancelReason ? ` (${booking.cancelReason})` : ""}` : booking.status === "checked_in" || booking.checkedInAt ? t.checkedIn : ["hold", "pending_payment"].includes(booking.status) ? t.pending : "", booking.bookingNo].filter(Boolean).join(" · ")}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })}
          {data && !sessions.length ? <p>{showEmpty ? t.noTimes : t.noSessions}</p> : null}
        </div>

        <h3 className="admin-subhead">{t.timetable}</h3>
        {timetable.length ? (
          <div className="admin-table-scroll">
            <table className="admin-timetable">
              <thead><tr>{dayOrder.map((day) => <th key={day}>{dayName(lang, day)}</th>)}</tr></thead>
              <tbody>
                <tr>
                  {dayOrder.map((day) => (
                    <td key={day}>
                      {timetable.flatMap((row) => {
                        const entry = row.days.find((item) => item.day === day);
                        if (!entry) return [];
                        return [<div key={row.slug} className="admin-timetable-cell"><b>{row.short}</b><span>{entry.slots.length > 3 ? `${entry.slots[0].time}–${entry.slots.at(-1)?.endTime} (${entry.slots.length})` : entry.slots.map((slot) => `${slot.time}${slot.instructor ? ` ${slot.instructor}` : ""}`).join(" · ")}</span></div>];
                      })}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : <p>{t.timetableEmpty}</p>}

        <h3 className="admin-subhead">{t.programs}</h3>
        <div className="admin-list-toolbar"><button type="button" onClick={() => { setFormError(""); setForm(formOf()); }}>{t.add}</button></div>
        <div className="admin-booking-cards">
          {programs.map((row) => (
            <article key={row.id}>
              <div>
                <b>{row.icon} {row.title}</b>
                <span>{t.serviceNames[(row.program?.service || record(row.metadata).service) as keyof typeof t.serviceNames] || String(record(row.metadata).service || "-")} · {t.kindNames[(row.program?.kind || "coupon") as keyof typeof t.kindNames]} · {row.program ? `${row.program.capacity} ${t.places} · ${row.program.minutes}′` : "-"}</span>
                <small>{row.program ? (row.program.schedule.length ? row.program.schedule.map((entry) => `${dayName(lang, entry.day)} ${entry.time}`).join(" · ") : `${row.program.times[0]}–${row.program.times.at(-1)} (${row.program.times.length})`) : row.problem}</small>
              </div>
              <span className={`admin-badge ${row.problem ? "bad" : row.active ? "good" : "neutral"}`}>{row.problem ? t.problem : row.active ? t.on : t.off}</span>
              <div className="admin-row-actions"><button type="button" onClick={() => { setFormError(""); setForm(formOf(row)); }}>{t.edit}</button></div>
            </article>
          ))}
        </div>
      </section>
      {cancelling ? (
        <AdminDialog onClose={() => setCancelling(null)}>
          <section className="admin-modal">
            <header><div><small>{t.roster}</small><h2>{t.cancelTitle}</h2></div><button type="button" aria-label={t.close} onClick={() => setCancelling(null)}>×</button></header>
            <div className="admin-form">
              <p className="wide">{cancelling.title} · {date} {cancelling.time}–{cancelling.endTime} · {t.booked} {cancelling.taken}</p>
              <p className="wide">{t.cancelMessage}</p>
              <label className="wide">{t.reason}<textarea value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label>
              <div className="admin-form-actions"><button type="button" className="danger" disabled={reason.trim().length < 2} onClick={() => void cancelSession()}>{t.cancelSession}</button><button type="button" className="ghost" onClick={() => setCancelling(null)}>{t.close}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
      {form ? (
        <AdminDialog onClose={() => setForm(null)}>
          <section className="admin-modal admin-class-form">
            <header><div><small>{t.programs}</small><h2>{form.id ? `${t.edit} · ${form.title}` : t.add}</h2></div><button type="button" aria-label={t.close} onClick={() => setForm(null)}>×</button></header>
            <div className="admin-form">
              {!form.id ? <label>{t.f.slug}<input value={form.slug} maxLength={96} onChange={(event) => patch({ slug: event.target.value.toLowerCase() })} placeholder="service-yoga-evening" /></label> : null}
              <label className="wide">{t.f.titleField}<input value={form.title} maxLength={180} onChange={(event) => patch({ title: event.target.value })} /></label>
              <label className="wide">{t.f.subtitle}<input value={form.subtitle} maxLength={255} onChange={(event) => patch({ subtitle: event.target.value })} /></label>
              <label className="wide">{t.f.body}<textarea value={form.body} maxLength={3000} onChange={(event) => patch({ body: event.target.value })} /></label>
              <label>{t.f.icon}<input value={form.icon} maxLength={16} onChange={(event) => patch({ icon: event.target.value })} /></label>
              <label>{t.f.service}<select value={form.service} onChange={(event) => patch({ service: event.target.value })}>{services.map((key) => <option key={key} value={key}>{t.serviceNames[key]}</option>)}</select></label>
              <label>{t.f.kind}<select value={form.kind} onChange={(event) => patch({ kind: event.target.value })}>{kinds.map((key) => <option key={key} value={key}>{t.kindNames[key]}</option>)}</select></label>
              <label>{t.f.tab}<input value={form.tab} maxLength={32} onChange={(event) => patch({ tab: event.target.value })} placeholder="class / private / group" /></label>
              <label>{t.f.group}<input value={form.group} maxLength={40} onChange={(event) => patch({ group: event.target.value })} /></label>
              <label>{t.f.subgroup}<input value={form.subgroup} maxLength={40} onChange={(event) => patch({ subgroup: event.target.value })} /></label>
              <label>{t.f.short}<input value={form.short} maxLength={24} onChange={(event) => patch({ short: event.target.value })} placeholder="YOGA" /></label>
              <label>{t.f.capacity}<input type="number" min={1} max={200} value={form.capacity} onChange={(event) => patch({ capacity: Number(event.target.value) })} /></label>
              <label>{t.f.minutes}<input type="number" min={15} max={360} step={15} value={form.minutes} onChange={(event) => patch({ minutes: Number(event.target.value) })} /></label>
              <label>{t.f.minPeople}<input type="number" min={0} max={200} value={form.minPeople} onChange={(event) => patch({ minPeople: Number(event.target.value) })} /></label>
              {form.minPeople > 0 ? <label>{t.f.confirmHours}<input type="number" min={1} max={24} value={form.confirmHours} onChange={(event) => patch({ confirmHours: Number(event.target.value) })} /></label> : null}
              {form.kind === "session" || form.kind === "series" ? <label>{t.f.price}<input type="number" min={0} value={form.price} onChange={(event) => patch({ price: Number(event.target.value) })} /></label> : null}
              {form.kind === "series" ? (
                <>
                  <label>{t.f.label}<input value={form.label} maxLength={40} onChange={(event) => patch({ label: event.target.value })} /></label>
                  <label>{t.f.weeks}<input type="number" min={1} max={52} value={form.weeks} onChange={(event) => patch({ weeks: Number(event.target.value) })} /></label>
                  <label>{t.f.simulations}<input type="number" min={0} max={50} value={form.simulations} onChange={(event) => patch({ simulations: Number(event.target.value) })} /></label>
                </>
              ) : null}
              <label className="wide">{t.f.mode}<select value={form.mode} onChange={(event) => patch({ mode: event.target.value as Form["mode"] })}><option value="times">{t.f.modeTimes}</option><option value="schedule">{t.f.modeSchedule}</option></select></label>
              {form.mode === "times" ? (
                <>
                  <label className="wide">{t.f.times}<input value={form.times} onChange={(event) => patch({ times: event.target.value })} placeholder="08:00, 09:00, 10:00" /></label>
                  <fieldset className="wide admin-weekdays"><legend>{t.f.weekdays}</legend>{dayOrder.map((day) => <label key={day}><input type="checkbox" checked={form.weekdays.includes(day)} onChange={(event) => patch({ weekdays: event.target.checked ? [...form.weekdays, day] : form.weekdays.filter((value) => value !== day) })} /> {dayName(lang, day)}</label>)}</fieldset>
                </>
              ) : (
                <fieldset className="wide admin-rows">
                  <legend>{t.f.schedule}</legend>
                  {form.schedule.map((row, index) => (
                    <div key={index} className="admin-row-inputs">
                      <select value={row.day} aria-label={t.day} onChange={(event) => patch({ schedule: form.schedule.map((item, at) => (at === index ? { ...item, day: Number(event.target.value) } : item)) })}>{dayOrder.map((day) => <option key={day} value={day}>{dayName(lang, day)}</option>)}</select>
                      <input type="time" value={row.time} aria-label={t.f.from} onChange={(event) => patch({ schedule: form.schedule.map((item, at) => (at === index ? { ...item, time: event.target.value } : item)) })} />
                      <input value={row.instructor} maxLength={40} aria-label={t.f.name} placeholder={t.f.name} onChange={(event) => patch({ schedule: form.schedule.map((item, at) => (at === index ? { ...item, instructor: event.target.value } : item)) })} />
                      <button type="button" className="ghost" onClick={() => patch({ schedule: form.schedule.filter((_, at) => at !== index) })}>{t.f.remove}</button>
                    </div>
                  ))}
                  <button type="button" className="ghost" onClick={() => patch({ schedule: [...form.schedule, { day: 1, time: "18:00", instructor: "" }] })}>{t.f.addRow}</button>
                </fieldset>
              )}
              <fieldset className="wide admin-rows">
                <legend>{t.f.instructors}</legend>
                {form.instructors.map((row, index) => (
                  <div key={index} className="admin-row-inputs">
                    <input value={row.name} maxLength={40} aria-label={t.f.name} placeholder={t.f.name} onChange={(event) => patch({ instructors: form.instructors.map((item, at) => (at === index ? { ...item, name: event.target.value } : item)) })} />
                    <input type="time" value={row.from} aria-label={t.f.from} onChange={(event) => patch({ instructors: form.instructors.map((item, at) => (at === index ? { ...item, from: event.target.value } : item)) })} />
                    <input type="time" value={row.to} aria-label={t.f.to} onChange={(event) => patch({ instructors: form.instructors.map((item, at) => (at === index ? { ...item, to: event.target.value } : item)) })} />
                    <button type="button" className="ghost" onClick={() => patch({ instructors: form.instructors.filter((_, at) => at !== index) })}>{t.f.remove}</button>
                  </div>
                ))}
                <button type="button" className="ghost" onClick={() => patch({ instructors: [...form.instructors, { name: "", from: "08:00", to: "12:00" }] })}>{t.f.addRow}</button>
              </fieldset>
              <label className="wide">{t.f.coupons}<input value={form.couponCategories} onChange={(event) => patch({ couponCategories: event.target.value })} placeholder="pilates, airfit-group" /></label>
              <label className="wide">{t.f.membership}<input value={form.membershipServices} onChange={(event) => patch({ membershipServices: event.target.value })} placeholder="pilates" /></label>
              <label className="wide">{t.f.resources}<input value={form.resources} onChange={(event) => patch({ resources: event.target.value })} placeholder="ห้อง 01, ห้อง 02, ห้อง 03" /></label>
              {list(form.resources).length ? <label>{t.f.resourceLabel}<input value={form.resourceLabel} maxLength={40} onChange={(event) => patch({ resourceLabel: event.target.value })} placeholder="เลือกห้อง" /></label> : null}
              <label className="admin-inline-check wide"><input type="checkbox" checked={form.trainerLink} onChange={(event) => patch({ trainerLink: event.target.checked })} /> {t.f.trainerLink}</label>
              {form.trainerLink ? <label>{t.f.trainerMatch}<input value={form.trainerMatch} maxLength={40} onChange={(event) => patch({ trainerMatch: event.target.value })} /></label> : null}
              <label>{t.f.sortOrder}<input type="number" min={0} value={form.sortOrder} onChange={(event) => patch({ sortOrder: Number(event.target.value) })} /></label>
              <label className="admin-inline-check"><input type="checkbox" checked={form.active} onChange={(event) => patch({ active: event.target.checked })} /> {t.f.active}</label>
              {formError ? <AdminNotice tone="error" lang={lang}>{formError}</AdminNotice> : null}
              <div className="admin-form-actions"><button type="button" onClick={() => void submit()}>{t.save}</button><button type="button" className="ghost" onClick={() => setForm(null)}>{t.cancel}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
    </div>
  );
}
