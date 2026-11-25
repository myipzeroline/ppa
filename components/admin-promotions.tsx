"use client";

import { useEffect, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { useAdminFeedback } from "@/components/admin-feedback";
import { AdminNotice } from "@/components/admin-notice";

// Back office · Promotion (แก้ 12): the weekly deals members take in the app (10% off packages, a free
// weekly coupon after 3 check-in days, free trainer hours with a first PT purchase) with this and last
// week's takers, the Member-price packages, and the PPA member list the Member OTP is checked against.

type Lang = "th" | "en";
type ItemRow = { id: number; contentType: string; slug: string; title: string; subtitle: string | null; icon: string; actionLabel: string | null; price: number; metadata: string | null; active: boolean; claimsThisWeek?: number; claimsLastWeek?: number };
type PromotionData = { week: { key: string; lastDay: string }; deals: ItemRow[]; packages: ItemRow[]; memberStats: { verifiedThisWeek: number; paidThisWeek: number } };
type PpaMember = { id: number; memberNo: string; fullName: string; phone: string; status: "active" | "inactive"; expiresOn: string | null; note: string | null; verifiedAt: string | null; appName: string | null; appCode: string | null };
type MembersData = { members: PpaMember[]; totals: { total: number; active: number } };
type DealForm = { id: number; kind: string; title: string; subtitle: string; icon: string; actionLabel: string; price: number; active: boolean; meta: Record<string, unknown> };
type MemberForm = { id?: number; memberNo: string; fullName: string; phone: string; status: "active" | "inactive"; expiresOn: string; note: string };

const scopes = ["fitness", "swim", "pilates", "airfit", "hyrox"];

const copy = {
  th: {
    title: "โปรโมชัน (Hot Deals)", intro: "ดีลประจำสัปดาห์ที่สมาชิกกดรับในแอป และแพ็กเกจราคา Member ที่ต้องยืนยันรหัสสมาชิก PPA + OTP ก่อนซื้อ",
    deals: "ดีลประจำสัปดาห์", week: "สัปดาห์นี้ถึง", thisWeek: "รับสัปดาห์นี้", lastWeek: "สัปดาห์ก่อน", on: "เปิดอยู่", off: "ปิด", edit: "แก้ไข", turnOn: "เปิดดีล", turnOff: "ปิดดีล",
    kinds: { discount: "ส่วนลดแพ็กเกจ", weekly_coupon: "แถมคูปองเมื่อเช็คอินครบ", trainer_bonus: "เทรนฟรีกับเทรนเนอร์ครั้งแรก" } as Record<string, string>,
    percent: "ส่วนลด (%)", scope: "ใช้กับแพ็กเกจ", couponCode: "รหัสคูปองที่แจก", checkinDays: "เช็คอินครบ (วัน/สัปดาห์)", validityDays: "คูปองใช้ได้ (วัน)", hours: "ชั่วโมงเทรนฟรี", value: "มูลค่า (฿)",
    titleField: "ชื่อดีล", subtitle: "รายละเอียด", icon: "ไอคอน", actionLabel: "ข้อความปุ่ม", active: "เปิดใช้งาน",
    packages: "แพ็กเกจราคา Member", price: "ราคา ฿/เดือน", months: "จำนวนเดือน", services: "บริการที่ใช้ได้ (คั่นด้วย ,)", label: "ชื่อที่แสดง",
    stats: "ยืนยันสมาชิกสัปดาห์นี้ {verified} บัญชี · ซื้อแพ็กเกจ Member แล้ว {paid} รายการ",
    registry: "รายชื่อสมาชิก PPA (สำหรับ OTP)", registryIntro: "รหัสสมาชิก 6 หลักและเบอร์มือถือที่ระบบส่ง OTP ไปให้ สมาชิกที่ปิดหรือหมดอายุจะซื้อแพ็กเกจ Member ไม่ได้", search: "ค้นหารหัส ชื่อ หรือเบอร์", add: "เพิ่มสมาชิก",
    memberNo: "รหัสสมาชิก 6 หลัก", fullName: "ชื่อ-นามสกุล", phone: "เบอร์มือถือ", status: "สถานะ", expiresOn: "หมดอายุ (เว้นว่าง = ไม่หมดอายุ)", note: "หมายเหตุ", linked: "บัญชีแอปที่ยืนยันล่าสุด", never: "ยังไม่เคยยืนยัน",
    import: "นำเข้ารายชื่อ", importHint: "วางทีละบรรทัด: รหัสสมาชิก,ชื่อ,เบอร์มือถือ,วันหมดอายุ(YYYY-MM-DD ไม่บังคับ) รหัสที่มีอยู่แล้วจะถูกอัปเดต", importDone: "นำเข้าแล้ว {saved} รายการ", skipped: "ข้ามบรรทัดที่ไม่ถูกต้อง",
    total: "ทั้งหมด {total} · ใช้งานได้ {active}", noMembers: "ยังไม่มีรายชื่อสมาชิก PPA", noPermission: "ต้องมีสิทธิ์จัดการสมาชิกจึงจะดูและแก้รายชื่อนี้ได้",
    save: "บันทึก", cancel: "ยกเลิก", close: "ปิด", saved: "บันทึกแล้ว", failed: "บันทึกไม่สำเร็จ", loadFailed: "โหลดข้อมูลไม่สำเร็จ", retry: "ลองใหม่", active2: "ใช้งาน", inactive: "ปิด",
  },
  en: {
    title: "Promotion (Hot Deals)", intro: "Weekly deals members take in the app, and Member-price packages bought after the PPA member number + OTP.",
    deals: "Weekly deals", week: "This week until", thisWeek: "Taken this week", lastWeek: "Last week", on: "On", off: "Off", edit: "Edit", turnOn: "Turn on", turnOff: "Turn off",
    kinds: { discount: "Package discount", weekly_coupon: "Free coupon after check-ins", trainer_bonus: "Free hours with a first trainer" } as Record<string, string>,
    percent: "Discount (%)", scope: "Applies to packages of", couponCode: "Coupon code given", checkinDays: "Check-in days a week", validityDays: "Coupon valid (days)", hours: "Free training hours", value: "Value (฿)",
    titleField: "Deal name", subtitle: "Details", icon: "Icon", actionLabel: "Button text", active: "Active",
    packages: "Member-price packages", price: "Price ฿/month", months: "Months", services: "Services (comma separated)", label: "Display name",
    stats: "{verified} accounts confirmed this week · {paid} Member packages paid",
    registry: "PPA member list (for the OTP)", registryIntro: "6-digit member numbers and the mobile each code is sent to. Inactive or expired members cannot buy Member packages.", search: "Search number, name or phone", add: "Add member",
    memberNo: "6-digit member number", fullName: "Full name", phone: "Mobile", status: "Status", expiresOn: "Expires (blank = never)", note: "Note", linked: "Last confirmed by", never: "Never confirmed",
    import: "Import list", importHint: "One per line: member number,name,mobile,expiry (YYYY-MM-DD, optional). Existing numbers are updated.", importDone: "Imported {saved}", skipped: "Skipped lines",
    total: "{total} in total · {active} active", noMembers: "No PPA members yet", noPermission: "Managing members permission is needed to see and edit this list",
    save: "Save", cancel: "Cancel", close: "Close", saved: "Saved", failed: "Could not save", loadFailed: "Could not load", retry: "Try again", active2: "Active", inactive: "Off",
  },
};

function record(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));

async function send<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, status: response.status, message: String(body.message || response.statusText) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, message: "Network error" };
  }
}

export function AdminPromotions({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify } = useAdminFeedback();
  const [data, setData] = useState<PromotionData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [deal, setDeal] = useState<DealForm | null>(null);
  const [dealError, setDealError] = useState("");
  useEffect(() => {
    let alive = true;
    send<PromotionData>("/api/admin/promotions", { method: "GET" }).then((sent) => {
      if (!alive) return;
      if (sent.ok) { setData(sent.data); setError(""); } else setError(sent.message);
    });
    return () => { alive = false; };
  }, [revision]);

  const save = async (form: DealForm) => {
    setDealError("");
    const sent = await send<PromotionData>("/api/admin/promotions", { method: "PUT", body: JSON.stringify({ id: form.id, title: form.title, subtitle: form.subtitle, icon: form.icon, actionLabel: form.actionLabel, price: form.price, active: form.active, metadata: form.meta }) });
    if (!sent.ok) {
      setDealError(sent.message || t.failed);
      return false;
    }
    setData(sent.data);
    notify("success", t.saved);
    return true;
  };
  const formOf = (row: ItemRow): DealForm => {
    const meta = record(row.metadata);
    return { id: row.id, kind: row.contentType === "promotion_deal" ? String(meta.kind || "") : "member_package", title: row.title, subtitle: row.subtitle || "", icon: row.icon, actionLabel: row.actionLabel || "", price: Number(row.price || 0), active: row.active, meta };
  };
  const setMeta = (key: string, value: unknown) => setDeal((current) => (current ? { ...current, meta: { ...current.meta, [key]: value } } : current));

  return (
    <div className="admin-trainer-layout">
      <section className="admin-panel">
        <h2>{t.title}</h2>
        <p>{t.intro}</p>
        {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t.retry}</button></AdminNotice> : null}
        <h3 className="admin-subhead">{t.deals}{data ? ` · ${t.week} ${data.week.lastDay}` : ""}</h3>
        <div className="admin-booking-cards">
          {(data?.deals || []).map((row) => {
            const meta = record(row.metadata);
            const detail = meta.kind === "discount" ? `${meta.percent}% · ${Array.isArray(meta.scope) ? meta.scope.join(", ") : ""}` : meta.kind === "weekly_coupon" ? `${meta.couponCode} · ${meta.checkinDays}/7 · ${meta.validityDays}d` : `${meta.hours} h · ${Number(meta.value || 0).toLocaleString()} ฿`;
            return (
              <article key={row.id}>
                <div>
                  <b>{row.icon} {row.title}</b>
                  <span>{t.kinds[String(meta.kind)] || String(meta.kind)} · {detail}</span>
                  <small>{t.thisWeek} {row.claimsThisWeek ?? 0} · {t.lastWeek} {row.claimsLastWeek ?? 0}</small>
                </div>
                <span className={`admin-badge ${row.active ? "good" : "neutral"}`}>{row.active ? t.on : t.off}</span>
                <div className="admin-row-actions">
                  <button type="button" onClick={() => { setDealError(""); setDeal(formOf(row)); }}>{t.edit}</button>
                  <button type="button" className={row.active ? "danger" : ""} onClick={() => void save({ ...formOf(row), active: !row.active })}>{row.active ? t.turnOff : t.turnOn}</button>
                </div>
              </article>
            );
          })}
        </div>
        <h3 className="admin-subhead">{t.packages}</h3>
        {data ? <p>{fill(t.stats, { verified: data.memberStats.verifiedThisWeek, paid: data.memberStats.paidThisWeek })}</p> : null}
        <div className="admin-booking-cards">
          {(data?.packages || []).map((row) => {
            const meta = record(row.metadata);
            return (
              <article key={row.id}>
                <div>
                  <b>{row.icon} {String(meta.label || row.title)}</b>
                  <span>{Number(row.price).toLocaleString()} ฿ · {String(meta.months || 1)} {lang === "th" ? "เดือน" : "month(s)"} · {Array.isArray(meta.services) ? meta.services.join(", ") : "-"}</span>
                </div>
                <span className={`admin-badge ${row.active ? "good" : "neutral"}`}>{row.active ? t.on : t.off}</span>
                <div className="admin-row-actions"><button type="button" onClick={() => { setDealError(""); setDeal(formOf(row)); }}>{t.edit}</button></div>
              </article>
            );
          })}
        </div>
      </section>
      <PpaMembers lang={lang} />
      {deal ? (
        <AdminDialog onClose={() => setDeal(null)}>
          <section className="admin-modal">
            <header><div><small>{deal.kind === "member_package" ? t.packages : t.deals}</small><h2>{deal.title}</h2></div><button type="button" aria-label={t.close} onClick={() => setDeal(null)}>×</button></header>
            <div className="admin-form">
              <label className="wide">{t.titleField}<input value={deal.title} maxLength={180} onChange={(event) => setDeal({ ...deal, title: event.target.value })} /></label>
              <label className="wide">{t.subtitle}<input value={deal.subtitle} maxLength={255} onChange={(event) => setDeal({ ...deal, subtitle: event.target.value })} /></label>
              <label>{t.icon}<input value={deal.icon} maxLength={16} onChange={(event) => setDeal({ ...deal, icon: event.target.value })} /></label>
              {deal.kind !== "member_package" ? <label>{t.actionLabel}<input value={deal.actionLabel} maxLength={80} onChange={(event) => setDeal({ ...deal, actionLabel: event.target.value })} /></label> : null}
              {deal.kind === "discount" ? (
                <>
                  <label>{t.percent}<input type="number" min={1} max={90} value={Number(deal.meta.percent || 0)} onChange={(event) => setMeta("percent", Number(event.target.value))} /></label>
                  <fieldset className="wide admin-weekdays"><legend>{t.scope}</legend>{scopes.map((scope) => {
                    const chosen = Array.isArray(deal.meta.scope) ? deal.meta.scope.map(String) : [];
                    return <label key={scope}><input type="checkbox" checked={chosen.includes(scope)} onChange={(event) => setMeta("scope", event.target.checked ? [...chosen, scope] : chosen.filter((value) => value !== scope))} /> {scope}</label>;
                  })}</fieldset>
                </>
              ) : null}
              {deal.kind === "weekly_coupon" ? (
                <>
                  <label>{t.couponCode}<input value={String(deal.meta.couponCode || "")} maxLength={40} onChange={(event) => setMeta("couponCode", event.target.value.toUpperCase())} /></label>
                  <label>{t.checkinDays}<input type="number" min={1} max={7} value={Number(deal.meta.checkinDays || 3)} onChange={(event) => setMeta("checkinDays", Number(event.target.value))} /></label>
                  <label>{t.validityDays}<input type="number" min={1} max={90} value={Number(deal.meta.validityDays || 7)} onChange={(event) => setMeta("validityDays", Number(event.target.value))} /></label>
                </>
              ) : null}
              {deal.kind === "trainer_bonus" ? (
                <>
                  <label>{t.hours}<input type="number" min={1} max={20} value={Number(deal.meta.hours || 2)} onChange={(event) => setMeta("hours", Number(event.target.value))} /></label>
                  <label>{t.value}<input type="number" min={0} value={Number(deal.meta.value || 0)} onChange={(event) => setMeta("value", Number(event.target.value))} /></label>
                </>
              ) : null}
              {deal.kind === "member_package" ? (
                <>
                  <label>{t.label}<input value={String(deal.meta.label || "")} maxLength={60} onChange={(event) => setMeta("label", event.target.value)} /></label>
                  <label>{t.price}<input type="number" min={1} value={deal.price} onChange={(event) => setDeal({ ...deal, price: Number(event.target.value) })} /></label>
                  <label>{t.months}<input type="number" min={1} max={36} value={Number(deal.meta.months || 1)} onChange={(event) => setMeta("months", Number(event.target.value))} /></label>
                  <label className="wide">{t.services}<input value={Array.isArray(deal.meta.services) ? deal.meta.services.join(", ") : ""} onChange={(event) => setMeta("services", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></label>
                </>
              ) : null}
              <label className="admin-inline-check"><input type="checkbox" checked={deal.active} onChange={(event) => setDeal({ ...deal, active: event.target.checked })} /> {t.active}</label>
              {dealError ? <AdminNotice tone="error" lang={lang}>{dealError}</AdminNotice> : null}
              <div className="admin-form-actions"><button type="button" onClick={() => void save(deal).then((ok) => { if (ok) setDeal(null); })}>{t.save}</button><button type="button" className="ghost" onClick={() => setDeal(null)}>{t.cancel}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
    </div>
  );
}

function PpaMembers({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify } = useAdminFeedback();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<MembersData | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [form, setForm] = useState<MemberForm | null>(null);
  const [formError, setFormError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      send<MembersData>(`/api/admin/ppa-members?q=${encodeURIComponent(query)}`, { method: "GET" }).then((sent) => {
        if (!alive) return;
        if (sent.ok) { setData(sent.data); setError(null); } else setError({ status: sent.status, message: sent.message });
      });
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, revision]);

  const submit = async () => {
    if (!form) return;
    setFormError("");
    const sent = await send<MembersData>("/api/admin/ppa-members", { method: form.id ? "PUT" : "POST", body: JSON.stringify(form) });
    if (!sent.ok) return setFormError(sent.message || t.failed);
    setData(sent.data);
    setForm(null);
    notify("success", t.saved);
  };
  const runImport = async () => {
    if (importing === null) return;
    const sent = await send<{ saved: number; skipped: string[] }>("/api/admin/ppa-members", { method: "POST", body: JSON.stringify({ action: "import", lines: importing }) });
    if (!sent.ok) return notify("error", sent.message || t.failed);
    notify(sent.data.skipped.length ? "warning" : "success", `${fill(t.importDone, { saved: sent.data.saved })}${sent.data.skipped.length ? ` · ${t.skipped}: ${sent.data.skipped.slice(0, 5).join(", ")}` : ""}`);
    setImporting(null);
    setRevision((value) => value + 1);
  };

  if (error?.status === 403) return <section className="admin-panel"><h2>{t.registry}</h2><AdminNotice tone="info" lang={lang}>{t.noPermission}</AdminNotice></section>;
  return (
    <section className="admin-panel">
      <h2>{t.registry}</h2>
      <p>{t.registryIntro}</p>
      <div className="admin-list-toolbar">
        <input type="search" value={query} placeholder={t.search} aria-label={t.search} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" onClick={() => { setFormError(""); setForm({ memberNo: "", fullName: "", phone: "", status: "active", expiresOn: "", note: "" }); }}>{t.add}</button>
        <button type="button" className="ghost" onClick={() => setImporting("")}>{t.import}</button>
        {data ? <span>{fill(t.total, data.totals)}</span> : null}
      </div>
      {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error.message} <button type="button" onClick={() => setRevision((value) => value + 1)}>{t.retry}</button></AdminNotice> : null}
      <div className="admin-booking-cards">
        {(data?.members || []).map((member) => (
          <article key={member.id}>
            <div>
              <b>{member.memberNo} · {member.fullName}</b>
              <span>{member.phone}{member.expiresOn ? ` · ${t.expiresOn.split(" ")[0]} ${member.expiresOn}` : ""}{member.note ? ` · ${member.note}` : ""}</span>
              <small>{t.linked}: {member.appName ? `${member.appName} (${member.appCode}) · ${String(member.verifiedAt || "").slice(0, 16).replace("T", " ")}` : t.never}</small>
            </div>
            <span className={`admin-badge ${member.status === "active" ? "good" : "neutral"}`}>{member.status === "active" ? t.active2 : t.inactive}</span>
            <div className="admin-row-actions"><button type="button" onClick={() => { setFormError(""); setForm({ id: member.id, memberNo: member.memberNo, fullName: member.fullName, phone: member.phone, status: member.status, expiresOn: member.expiresOn || "", note: member.note || "" }); }}>{t.edit}</button></div>
          </article>
        ))}
        {data && !data.members.length ? <p>{t.noMembers}</p> : null}
      </div>
      {form ? (
        <AdminDialog onClose={() => setForm(null)}>
          <section className="admin-modal">
            <header><div><small>{t.registry}</small><h2>{form.id ? form.memberNo : t.add}</h2></div><button type="button" aria-label={t.close} onClick={() => setForm(null)}>×</button></header>
            <div className="admin-form">
              <label>{t.memberNo}<input inputMode="numeric" maxLength={6} value={form.memberNo} onChange={(event) => setForm({ ...form, memberNo: event.target.value.replace(/\D/g, "").slice(0, 6) })} /></label>
              <label>{t.phone}<input inputMode="tel" maxLength={32} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="0812345678" /></label>
              <label className="wide">{t.fullName}<input maxLength={160} value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
              <label>{t.status}<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as MemberForm["status"] })}><option value="active">{t.active2}</option><option value="inactive">{t.inactive}</option></select></label>
              <label>{t.expiresOn}<input type="date" value={form.expiresOn} onChange={(event) => setForm({ ...form, expiresOn: event.target.value })} /></label>
              <label className="wide">{t.note}<input maxLength={255} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
              {formError ? <AdminNotice tone="error" lang={lang}>{formError}</AdminNotice> : null}
              <div className="admin-form-actions"><button type="button" onClick={() => void submit()}>{t.save}</button><button type="button" className="ghost" onClick={() => setForm(null)}>{t.cancel}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
      {importing !== null ? (
        <AdminDialog onClose={() => setImporting(null)}>
          <section className="admin-modal">
            <header><div><small>{t.registry}</small><h2>{t.import}</h2></div><button type="button" aria-label={t.close} onClick={() => setImporting(null)}>×</button></header>
            <div className="admin-form">
              <p className="wide">{t.importHint}</p>
              <label className="wide">{t.import}<textarea rows={10} value={importing} onChange={(event) => setImporting(event.target.value)} placeholder={"123456,สมชาย ใจดี,0812345678,2027-12-31"} /></label>
              <div className="admin-form-actions"><button type="button" disabled={!importing.trim()} onClick={() => void runImport()}>{t.save}</button><button type="button" className="ghost" onClick={() => setImporting(null)}>{t.cancel}</button></div>
            </div>
          </section>
        </AdminDialog>
      ) : null}
    </section>
  );
}
