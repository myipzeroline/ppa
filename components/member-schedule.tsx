"use client";
import type { ReactNode } from "react";
import { currentLocale, localeTag, t } from "@/lib/i18n";
import { weekDates } from "@/lib/court-availability";

// Day strip of the coming week (จันทร์ 13 · อังคาร 14 …) and the grid of time buttons shared by court
// booking, Buffet Rank and class booking screens.

export function dayName(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const thai = currentLocale() === "th";
  const name = new Intl.DateTimeFormat(localeTag(), { weekday: thai ? "long" : "short", timeZone: "UTC" }).format(value);
  return thai ? name.replace(/^วัน/, "").replace(/พฤหัสบดี/, "พฤหัสฯ") : name;
}

export function dateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(localeTag(), { day: "numeric", month: "short", timeZone: "UTC" });
}

// Weekday 0 (Sunday) … 6 (Saturday) by name, from a week known to start on a Sunday (1-7 Jan 2023).
export function weekdayName(day: number) {
  return dayName(`2023-01-0${1 + Math.min(6, Math.max(0, day))}`);
}

// days: 7 for courts, 30 for classes (scrolls sideways); dim: days without any class time.
export function WeekStrip({ from, value, onChange, days = 7, label, dim }: { from: string; value: string; onChange: (date: string) => void; days?: number; label?: string; dim?: (date: string) => boolean }) {
  return (
    <div className="week-strip" role="group" aria-label={label || t("เลือกวัน")}>
      {weekDates(from, days).map(({ date }) => (
        <button type="button" key={date} className={[value === date ? "on" : "", dim?.(date) ? "off" : ""].filter(Boolean).join(" ")} aria-pressed={value === date} onClick={() => onChange(date)}>
          <small>{dayName(date)}</small>
          <b>{Number(date.slice(-2))}</b>
        </button>
      ))}
    </div>
  );
}

export type GridSlot = {
  key: string;
  time: string;
  sub?: ReactNode;
  state: "available" | "selected" | "unavailable" | "mine" | "past";
  tone?: "day" | "night";
  label: string;
  onPick?: () => void;
};

export function SlotGrid({ slots, empty }: { slots: GridSlot[]; empty?: string }) {
  if (!slots.length) return <p className="slot-grid-empty">{empty || t("ไม่มีรอบเวลาในวันนี้")}</p>;
  return (
    <div className="slot-grid">
      {slots.map((slot) => (
        <button
          type="button"
          key={slot.key}
          className={`slot-cell ${slot.state}${slot.tone ? ` ${slot.tone}` : ""}`}
          disabled={slot.state === "unavailable" || slot.state === "past"}
          aria-pressed={slot.state === "selected"}
          aria-label={slot.label}
          onClick={slot.onPick}
        >
          <b>{slot.time}</b>
          {slot.sub ? <small>{slot.sub}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function SectionLabel({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange, label, className = "" }: { tabs: [T, string][]; value: T; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div className={`plan-tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {tabs.map(([key, text]) => (
        <button type="button" role="tab" key={key} aria-selected={value === key} className={value === key ? "on" : ""} onClick={() => onChange(key)}>{text}</button>
      ))}
    </div>
  );
}
