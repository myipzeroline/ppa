"use client";
import { useEffect, useState } from "react";
import { Empty, LoadingNote, Top } from "@/components/member-ui";
import { weekdayName } from "@/components/member-schedule";
import type { TimetableRow } from "@/lib/class-programs";
import { t } from "@/lib/i18n";

// แก้ 11 · ตารางคลาสประจำสัปดาห์: every group class of the club with its days, times and instructors,
// repeating every week of the month (classes are bookable 30 days ahead). "ทั้งหมด" is the week at a
// glance; a class chip lists its days. Tapping a class time opens its booking page on the next such day.

const order = [1, 2, 3, 4, 5, 6, 0];
// A class running many times a day shows as one span ("08:00–20:00 · 13 รอบ").
const MANY = 3;

export type TimetablePick = { row: TimetableRow; day: number; time?: string };

export function TimetableScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pick: TimetablePick) => void }) {
  const [rows, setRows] = useState<TimetableRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/classes/timetable", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then((response) => (response.ok ? response.json() as Promise<{ rows: TimetableRow[] }> : Promise.reject(new Error("load"))))
      .then((body) => { if (!controller.signal.aborted) { setRows(body.rows); setFailed(false); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);

  const chosen = rows?.find((row) => row.slug === filter) || null;
  return (
    <div className="page timetable-page">
      <Top title={t("ตารางคลาสประจำสัปดาห์")} icon="📅" onBack={onBack} />
      <p className="gymnos-lead">{t("รูปแบบซ้ำทุกสัปดาห์ตลอดเดือน · กดเวลาเรียนเพื่อจอง")}</p>
      {failed && !rows ? <div role="alert" className="calendar-error">{t("โหลดข้อมูลไม่สำเร็จ")}<button type="button" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>{t("ลองใหม่")}</button></div> : null}
      {!rows && !failed ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {rows && !rows.length ? <Empty text={t("ยังไม่มีตารางคลาสประกาศ")} /> : null}
      {rows?.length ? (
        <>
          <div className="tt-chips" role="tablist" aria-label={t("ชนิดคลาส")}>
            <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>{t("ทั้งหมด")}</button>
            {rows.map((row) => <button type="button" role="tab" key={row.slug} aria-selected={filter === row.slug} className={filter === row.slug ? "on" : ""} onClick={() => setFilter(row.slug)}>{row.short}</button>)}
          </div>
          {chosen ? (
            <section className="tt-list">
              <div className="section-label"><span>{chosen.icon} {t("{{value0}} ในสัปดาห์นี้", { value0: chosen.short })}</span></div>
              {chosen.days.map((day) => {
                const many = day.slots.length > MANY;
                const teachers = [...new Set(day.slots.map((slot) => slot.instructor).filter(Boolean))].join(" · ");
                return (
                  <button type="button" key={day.day} className="tt-row" onClick={() => onOpen({ row: chosen, day: day.day, time: many ? undefined : day.slots[0]?.time })}>
                    <span className="tt-day" aria-hidden="true">📅</span>
                    <span className="tt-info"><b>{weekdayName(day.day)}</b><small>{teachers || t("ไม่ระบุผู้สอน")}</small></span>
                    <strong>{many ? `${day.slots[0].time}–${day.slots.at(-1)?.endTime}` : day.slots.map((slot) => slot.time).join(" · ")}</strong>
                    {many ? <em>{t("{{value0}} รอบ", { value0: day.slots.length })}</em> : null}
                  </button>
                );
              })}
            </section>
          ) : (
            <div className="tt-week" role="table" aria-label={t("ตารางคลาสประจำสัปดาห์")}>
              <div className="tt-week-row head" role="row">
                {order.map((day) => <span role="columnheader" key={day} className={day === 0 || day === 6 ? "weekend" : ""}>{weekdayName(day)}</span>)}
              </div>
              <div className="tt-week-row" role="row">
                {order.map((day) => (
                  <div role="cell" key={day} className="tt-col">
                    {rows.flatMap((row) => {
                      const entry = row.days.find((item) => item.day === day);
                      if (!entry) return [];
                      if (entry.slots.length > MANY) {
                        return [<button type="button" key={`${row.slug}-${day}`} className="tt-cell" onClick={() => onOpen({ row, day })}><b>{row.short}</b><i>{entry.slots[0].time}–{entry.slots.at(-1)?.endTime}</i><small>{t("{{value0}} รอบ", { value0: entry.slots.length })}</small></button>];
                      }
                      return entry.slots.map((slot) => (
                        <button type="button" key={`${row.slug}-${day}-${slot.time}`} className="tt-cell" onClick={() => onOpen({ row, day, time: slot.time })}><b>{row.short}</b><i>{slot.time}</i>{slot.instructor ? <small>{slot.instructor}</small> : null}</button>
                      ));
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="slot-footnote">{t("จองล่วงหน้าได้ 30 วัน · คลาสฟรีเฉพาะสมาชิกที่มีสถานะ · คลาสอื่นใช้คูปองของคลาสนั้น")}</p>
        </>
      ) : null}
    </div>
  );
}

// The next date (today included while the time is still ahead) that falls on a weekday.
export function nextDateOn(day: number, today: string, nowTime: string, time?: string) {
  const start = new Date(`${today}T00:00:00Z`);
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 86_400_000);
    if (candidate.getUTCDay() !== day) continue;
    if (offset === 0 && time && time <= nowTime) continue;
    return candidate.toISOString().slice(0, 10);
  }
  return today;
}
