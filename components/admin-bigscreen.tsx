"use client";

import { useEffect, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { useAdminFeedback } from "@/components/admin-feedback";
import { AdminNotice } from "@/components/admin-notice";
import { SCREEN_ZONES } from "@/lib/screen-programs";

// Back office · Big Screen: the program guide members see under Big Screen Live (item 1). Each program
// has a zone (the screen it is on), a start and an end; members see today and tomorrow, with "LIVE"
// while a program is on.

type Lang = "th" | "en";
type Program = { id: number; title: string; subtitle: string | null; icon: string; zone: string; startsAt: string; endsAt: string; status: "active" | "cancelled"; metadata: string | null };
type Form = { id?: number; title: string; subtitle: string; icon: string; zone: string; date: string; from: string; to: string; titleEn: string; subtitleEn: string };

const copy = {
  th: {
    title: "ผังรายการจอยักษ์ (Big Screen Live)",
    intro: "รายการที่สมาชิกเห็นในหน้า Big Screen Live แยกวันนี้/พรุ่งนี้ พร้อมโซนจอที่ฉาย ระหว่างเวลาออกอากาศจะขึ้นป้าย LIVE ให้อัตโนมัติ",
    add: "เพิ่มรายการ", edit: "แก้ไขรายการ", save: "บันทึก", cancel: "ยกเลิก", close: "ปิด",
    programTitle: "ชื่อรายการ", subtitle: "รายละเอียด (ลีก · ประเทศ)", icon: "ไอคอน", zone: "โซนจอ", date: "วันที่", from: "เริ่ม", to: "จบ",
    titleEn: "ชื่อภาษาอังกฤษ (ไม่บังคับ)", subtitleEn: "รายละเอียดภาษาอังกฤษ (ไม่บังคับ)",
    upcoming: "รายการที่กำลังจะมาถึง", past: "7 วันที่ผ่านมา", none: "ยังไม่มีรายการ", live: "กำลังออกอากาศ", cancelled: "ยกเลิกแล้ว",
    remove: "เอาออกจากผัง", removeTitle: "เอารายการนี้ออกจากผัง?", removeMessage: "สมาชิกจะไม่เห็นรายการนี้ในหน้า Big Screen Live", restore: "นำกลับมา",
    saved: "บันทึกรายการแล้ว", removed: "เอารายการออกจากผังแล้ว", failed: "บันทึกไม่สำเร็จ", loadFailed: "โหลดผังรายการไม่สำเร็จ", retry: "ลองใหม่",
    hint: "เวลาเป็นเวลาประเทศไทย รายการยาวได้ไม่เกิน 12 ชั่วโมง ถ้าจบหลังเที่ยงคืนให้แยกเป็น 2 รายการ",
  },
  en: {
    title: "Big screen program guide (Big Screen Live)",
    intro: "What members see under Big Screen Live, today and tomorrow, with the zone of the screen. LIVE shows automatically while a program is on.",
    add: "Add program", edit: "Edit program", save: "Save", cancel: "Cancel", close: "Close",
    programTitle: "Title", subtitle: "Details (league · country)", icon: "Icon", zone: "Screen zone", date: "Date", from: "Starts", to: "Ends",
    titleEn: "English title (optional)", subtitleEn: "English details (optional)",
    upcoming: "Coming up", past: "Last 7 days", none: "No programs yet", live: "On air", cancelled: "Cancelled",
    remove: "Take off the guide", removeTitle: "Take this program off the guide?", removeMessage: "Members will no longer see it under Big Screen Live", restore: "Put back",
    saved: "Program saved", removed: "Program taken off the guide", failed: "Could not save", loadFailed: "Could not load the guide", retry: "Try again",
    hint: "Times are Thailand time. A program can last up to 12 hours; split one that ends after midnight.",
  },
} as const;

const bangkokNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
const emptyForm = (): Form => ({ title: "", subtitle: "", icon: "📺", zone: SCREEN_ZONES[0], date: bangkokNow().slice(0, 10), from: "18:00", to: "20:00", titleEn: "", subtitleEn: "" });

function englishOf(metadata: string | null) {
  try {
    const parsed = JSON.parse(metadata || "{}") as { i18n?: { en?: { title?: string; subtitle?: string } } };
    return parsed.i18n?.en || {};
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

export function AdminBigScreen({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify, confirm } = useAdminFeedback();
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    send<{ programs: Program[] }>("/api/admin/screen-programs", { method: "GET" }).then((sent) => {
      if (!alive) return;
      if (sent.ok) setPrograms(sent.data.programs);
      else setError(sent.message);
    });
    return () => { alive = false; };
  }, [revision]);

  const now = bangkokNow();
  const upcoming = (programs || []).filter((program) => program.endsAt > now);
  const past = (programs || []).filter((program) => program.endsAt <= now);

  const submit = async () => {
    if (!form) return;
    setFormError("");
    const body = { ...(form.id ? { id: form.id } : {}), title: form.title, subtitle: form.subtitle, icon: form.icon, zone: form.zone, startsAt: `${form.date} ${form.from}`, endsAt: `${form.date} ${form.to}`, titleEn: form.titleEn, subtitleEn: form.subtitleEn };
    const sent = await send<{ programs: Program[] }>("/api/admin/screen-programs", { method: form.id ? "PUT" : "POST", body: JSON.stringify(body) });
    if (!sent.ok) return setFormError(sent.message || t.failed);
    setPrograms(sent.data.programs);
    setForm(null);
    notify("success", t.saved);
  };
  const remove = async (program: Program) => {
    if (!(await confirm({ title: t.removeTitle, message: t.removeMessage, details: [[t.programTitle, program.title], [t.date, `${program.startsAt} – ${program.endsAt.slice(11)}`], [t.zone, program.zone]], confirmLabel: t.remove, danger: true }))) return;
    const sent = await send<{ programs: Program[] }>(`/api/admin/screen-programs?id=${program.id}`, { method: "DELETE" });
    if (!sent.ok) return notify("error", sent.message || t.failed);
    setPrograms(sent.data.programs);
    notify("success", t.removed);
  };
  const restore = async (program: Program) => {
    const english = englishOf(program.metadata);
    const sent = await send<{ programs: Program[] }>("/api/admin/screen-programs", { method: "PUT", body: JSON.stringify({ id: program.id, title: program.title, subtitle: program.subtitle || "", icon: program.icon, zone: program.zone, startsAt: program.startsAt, endsAt: program.endsAt, titleEn: english.title || "", subtitleEn: english.subtitle || "", status: "active" }) });
    if (!sent.ok) return notify("error", sent.message || t.failed);
    setPrograms(sent.data.programs);
    notify("success", t.saved);
  };
  const editForm = (program: Program) => {
    const english = englishOf(program.metadata);
    setFormError("");
    setForm({ id: program.id, title: program.title, subtitle: program.subtitle || "", icon: program.icon, zone: program.zone, date: program.startsAt.slice(0, 10), from: program.startsAt.slice(11, 16), to: program.endsAt.slice(11, 16), titleEn: english.title || "", subtitleEn: english.subtitle || "" });
  };

  const row = (program: Program) => {
    const live = program.status === "active" && program.startsAt <= now && program.endsAt > now;
    return (
      <article key={program.id}>
        <div>
          <b>{program.icon} {program.title}</b>
          <span>{program.startsAt} – {program.endsAt.slice(11)} · {program.zone}</span>
          {program.subtitle ? <small>{program.subtitle}</small> : null}
        </div>
        <span className={`admin-badge ${program.status === "cancelled" ? "bad" : live ? "good" : "neutral"}`}>{program.status === "cancelled" ? t.cancelled : live ? t.live : program.zone}</span>
        <div className="admin-row-actions">
          <button type="button" onClick={() => editForm(program)}>{t.edit}</button>
          {program.status === "cancelled" ? <button type="button" onClick={() => void restore(program)}>{t.restore}</button> : <button type="button" className="danger" onClick={() => void remove(program)}>{t.remove}</button>}
        </div>
      </article>
    );
  };

  return (
    <div className="admin-trainer-layout">
      <section className="admin-panel">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
        <div className="admin-list-toolbar">
          <button type="button" onClick={() => { setFormError(""); setForm(emptyForm()); }}>{t.add}</button>
          <span>{t.hint}</span>
        </div>
        {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error} <button type="button" onClick={() => { setError(""); setRevision((value) => value + 1); }}>{t.retry}</button></AdminNotice> : null}
        <h3 className="admin-subhead">{t.upcoming}</h3>
        <div className="admin-booking-cards">{upcoming.map(row)}{programs && !upcoming.length ? <p>{t.none}</p> : null}</div>
        {past.length ? <><h3 className="admin-subhead">{t.past}</h3><div className="admin-booking-cards">{past.map(row)}</div></> : null}
      </section>
      {form ? (
        <AdminDialog onClose={() => setForm(null)}>
          <section className="admin-modal">
            <header><div><small>{t.title}</small><h2>{form.id ? t.edit : t.add}</h2></div><button type="button" aria-label={t.close} onClick={() => setForm(null)}>×</button></header>
            <div className="admin-form">
              <label className="wide">{t.programTitle}<input value={form.title} maxLength={180} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Wimbledon · รอบ 8 คนสุดท้าย" /></label>
              <label className="wide">{t.subtitle}<input value={form.subtitle} maxLength={255} onChange={(event) => setForm({ ...form, subtitle: event.target.value })} placeholder="เทนนิส แกรนด์สแลม · อังกฤษ" /></label>
              <label>{t.icon}<input value={form.icon} maxLength={16} onChange={(event) => setForm({ ...form, icon: event.target.value })} /></label>
              <label>{t.zone}<input list="screen-zones" value={form.zone} maxLength={40} onChange={(event) => setForm({ ...form, zone: event.target.value.toUpperCase() })} /><datalist id="screen-zones">{SCREEN_ZONES.map((zone) => <option key={zone} value={zone} />)}</datalist></label>
              <label>{t.date}<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
              <label>{t.from}<input type="time" step={300} value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} /></label>
              <label>{t.to}<input type="time" step={300} value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} /></label>
              <label className="wide">{t.titleEn}<input value={form.titleEn} maxLength={180} onChange={(event) => setForm({ ...form, titleEn: event.target.value })} /></label>
              <label className="wide">{t.subtitleEn}<input value={form.subtitleEn} maxLength={255} onChange={(event) => setForm({ ...form, subtitleEn: event.target.value })} /></label>
              {formError ? <AdminNotice tone="error" lang={lang}>{formError}</AdminNotice> : null}
              <div className="admin-form-actions"><button type="button" onClick={() => void submit()}>{t.save}</button><button type="button" className="ghost" onClick={() => setForm(null)}>{t.cancel}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
    </div>
  );
}
