"use client";

import { useEffect, useState } from "react";
import { useAdminFeedback } from "@/components/admin-feedback";
import { AdminNotice } from "@/components/admin-notice";

// Back office · Bookings: day and night court prices and member booking hours of each sport (item 3,
// "แยกเรทราคาชัดเจน: กลางวัน 08:00–16:00 และ กลางคืน 16:00–21:00"). A court's own rates win over these.

type Lang = "th" | "en";
type SportRow = { id: number; slug: string; name: string; icon: string; requiresBooking: number | boolean; baseRate: number; nightRate: number | null; nightFrom: number; openHour: number; closeHour: number; active: number | boolean };

const copy = {
  th: {
    title: "ราคากลางวัน/กลางคืน และเวลาเปิดจองของแต่ละกีฬา",
    intro: "สมาชิกเห็นราคาแยกกลางวันและกลางคืนบนปุ่มชั่วโมง และจองได้ตั้งแต่เวลาเปิดถึงเวลาปิด สนามที่ตั้งราคาเฉพาะสนามไว้จะใช้ราคาของสนามนั้น",
    sport: "กีฬา", day: "กลางวัน ฿/ชม.", night: "กลางคืน ฿/ชม.", nightFrom: "เริ่มกลางคืน", open: "เปิด", close: "ปิด", save: "บันทึก",
    saved: "บันทึกราคาแล้ว", failed: "บันทึกไม่สำเร็จ", loadFailed: "โหลดราคาไม่สำเร็จ", auto: "x1.5",
  },
  en: {
    title: "Day and night prices and booking hours by sport",
    intro: "Members see the day and night price on each hour and can book from opening to closing. A court with its own rates uses them instead.",
    sport: "Sport", day: "Day ฿/hr", night: "Night ฿/hr", nightFrom: "Night from", open: "Opens", close: "Closes", save: "Save",
    saved: "Prices saved", failed: "Could not save", loadFailed: "Could not load prices", auto: "x1.5",
  },
};

const hours = Array.from({ length: 25 }, (_, hour) => hour);

export function AdminSportRates({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const { notify } = useAdminFeedback();
  const [rows, setRows] = useState<SportRow[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/sports", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() as Promise<{ sports: SportRow[] }> : Promise.reject(new Error((await response.json().catch(() => ({}))).message || response.statusText))))
      .then((body) => { if (alive) setRows(body.sports); })
      .catch((reason: Error) => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, []);
  const update = (id: number, patch: Partial<SportRow>) => setRows((current) => current?.map((row) => (row.id === id ? { ...row, ...patch } : row)) || current);
  const save = async (row: SportRow) => {
    setSaving(row.id);
    try {
      const response = await fetch("/api/admin/sports", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id, baseRate: Number(row.baseRate), nightRate: row.nightRate ? Number(row.nightRate) : null, nightFrom: Number(row.nightFrom), openHour: Number(row.openHour), closeHour: Number(row.closeHour) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || t.failed);
      setRows(body.sports);
      notify("success", t.saved);
    } catch (reason) {
      notify("error", (reason as Error).message || t.failed);
    } finally {
      setSaving(0);
    }
  };
  const bookable = (rows || []).filter((row) => Number(row.requiresBooking));
  return (
    <section className="admin-panel">
      <h2>{t.title}</h2>
      <p>{t.intro}</p>
      {error ? <AdminNotice tone="error" lang={lang}>{t.loadFailed} · {error}</AdminNotice> : null}
      <div className="admin-table-scroll">
        <table className="admin-rates-table">
          <thead><tr><th>{t.sport}</th><th>{t.day}</th><th>{t.night}</th><th>{t.nightFrom}</th><th>{t.open}</th><th>{t.close}</th><th /></tr></thead>
          <tbody>
            {bookable.map((row) => (
              <tr key={row.id}>
                <td>{row.icon} {row.name}</td>
                <td><input type="number" min={0} value={Number(row.baseRate)} aria-label={`${row.name} ${t.day}`} onChange={(event) => update(row.id, { baseRate: Number(event.target.value) })} /></td>
                <td><input type="number" min={0} value={row.nightRate ? Number(row.nightRate) : ""} placeholder={t.auto} aria-label={`${row.name} ${t.night}`} onChange={(event) => update(row.id, { nightRate: event.target.value ? Number(event.target.value) : null })} /></td>
                <td><select value={row.nightFrom} aria-label={`${row.name} ${t.nightFrom}`} onChange={(event) => update(row.id, { nightFrom: Number(event.target.value) })}>{hours.slice(0, 24).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></td>
                <td><select value={row.openHour} aria-label={`${row.name} ${t.open}`} onChange={(event) => update(row.id, { openHour: Number(event.target.value) })}>{hours.slice(0, 24).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></td>
                <td><select value={row.closeHour} aria-label={`${row.name} ${t.close}`} onChange={(event) => update(row.id, { closeHour: Number(event.target.value) })}>{hours.slice(1).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></td>
                <td><button type="button" disabled={saving === row.id} onClick={() => void save(row)}>{t.save}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
