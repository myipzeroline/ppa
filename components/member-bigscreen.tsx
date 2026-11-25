"use client";
import { useState } from "react";
import { Empty, Top } from "@/components/member-ui";
import { TabBar } from "@/components/member-schedule";
import { localizedContent, t } from "@/lib/i18n";
import { clockText, isLiveNow, programsForDay, type ScreenProgram } from "@/lib/screen-programs";

// Big Screen Live (รายการที่ 1): the program guide of the club's big screens instead of court cameras.
// Today / tomorrow tabs, the zone of the screen for every program, and "LIVE ตอนนี้" for what is on.

function zoneClass(zone: string) {
  const key = zone.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `zone-badge zone-${key || "other"}`;
}

export function BigScreenBanner({ programs, now, onOpen }: { programs: ScreenProgram[]; now: number; onOpen: () => void }) {
  const today = programsForDay(programs, "today", now).map(localizedContent);
  const tomorrow = programsForDay(programs, "tomorrow", now).map(localizedContent);
  const live = today.some((program) => isLiveNow(program, now));
  const items = [
    ...today.map((program) => isLiveNow(program, now)
      ? `${program.icon} ${t(program.title)} · ${program.zone}`
      : `${program.icon} ${t("วันนี้ {{value0}}", { value0: clockText(program.startsAt) })} · ${t(program.title)} · ${program.zone}`),
    ...tomorrow.slice(0, 4).map((program) => `${program.icon} ${t("พรุ่งนี้ {{value0}}", { value0: clockText(program.startsAt) })} · ${t(program.title)} · ${program.zone}`),
  ];
  return (
    <button type="button" className="live-banner bigscreen-banner" onClick={onOpen}>
      <div className="lb-head">
        {live ? <span className="live-pill red"><i aria-hidden="true" />LIVE</span> : <span className="live-pill muted">{t("ตารางจอยักษ์")}</span>}
        <strong>{t("BIG SCREEN LIVE")} <span aria-hidden="true">📺</span></strong>
      </div>
      <div className="ticker-wrap">
        {items.length ? <div className="live-ticker-track">{[...items, ...items].map((text, index) => <span key={`${index}-${text}`} aria-hidden={index >= items.length}>{text}</span>)}</div> : t("ยังไม่มีรายการถ่ายทอดสด")}
      </div>
      <small>{t("ถ่ายทอดสดคู่สำคัญ & การแข่งขันในโครงการ บนจอยักษ์ PPA")}</small>
    </button>
  );
}

export function BigScreenScreen({ programs, now, onBack }: { programs: ScreenProgram[]; now: number; onBack: () => void }) {
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const list = programsForDay(programs, day, now).map(localizedContent);
  const counts = { today: programsForDay(programs, "today", now).length, tomorrow: programsForDay(programs, "tomorrow", now).length };
  return (
    <div className="page bigscreen-page">
      <Top title={t("Big Screen Live")} icon="📺" onBack={onBack} />
      <TabBar
        label={t("เลือกวัน")}
        value={day}
        onChange={setDay}
        tabs={[["today", counts.today ? t("วันนี้ ({{value0}})", { value0: counts.today }) : t("วันนี้")], ["tomorrow", counts.tomorrow ? t("พรุ่งนี้ ({{value0}})", { value0: counts.tomorrow }) : t("พรุ่งนี้")]]}
      />
      <div className="screen-guide">
        {list.map((program) => {
          const live = isLiveNow(program, now);
          return (
            <article className={live ? "screen-row live" : "screen-row"} key={program.id}>
              <div className="screen-time">{live ? <><b>LIVE</b><small>{t("ตอนนี้")}</small></> : <b>{clockText(program.startsAt)}</b>}</div>
              <div className="screen-info">
                <strong>{program.icon} {t(program.title)}</strong>
                {program.subtitle ? <small>{t(program.subtitle)}</small> : null}
                <small className="screen-until">{t("ถึง {{value0}} น.", { value0: clockText(program.endsAt) })}</small>
              </div>
              <span className={zoneClass(program.zone)}>{program.zone}</span>
            </article>
          );
        })}
        {!list.length ? <Empty text={day === "today" ? t("ยังไม่มีรายการถ่ายทอดสดวันนี้") : t("ยังไม่มีรายการถ่ายทอดสดพรุ่งนี้")} /> : null}
      </div>
      <p className="screen-note">{t("ไปชมได้ที่โซนจอที่ระบุ · รายการอาจเปลี่ยนแปลงตามผังถ่ายทอดสดทั่วโลก")}</p>
    </div>
  );
}
