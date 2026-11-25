"use client";
import { useEffect, useRef, type TouchEvent } from "react";
import { t } from "@/lib/i18n";

// คู่มือการใช้งาน (PPA app analysis V2, item 3): ten steps in the PPA orange, an emoji on every step, dots
// for progress and the step number, "ข้าม" / "ถัดไป ›". Steps that point at something on the home screen
// light it up. Step 8 teaches the swipe-left gesture (swiping on the card moves on). The app opens the
// guide by itself once per version (users.guide_version); Profile › คู่มือการใช้งาน opens it at any time.
export const GUIDE_VERSION = "2026-11-v2";

export type GuideStep = { icon: string; title: string; text: string; values?: Record<string, unknown>; target?: string; place?: "top" | "middle" | "bottom"; swipe?: boolean };

export function guideSteps(rankSports: string[]): GuideStep[] {
  return [
    { icon: "👋", title: "ยินดีต้อนรับสู่ PPA!", text: "มาดูวิธีใช้งานแบบเร็วๆ ใช้เวลาไม่ถึงนาที" },
    { icon: "🎫", title: "การ์ดสมาชิกของคุณ", text: "QR มุมขวาคือบัตรสมาชิกดิจิทัล ใช้สแกนเข้าใช้บริการที่คลับ แตะการ์ดเพื่อดูแพ็กเกจ คูปอง และสิทธิ์ของคุณ", target: ".home-page .member-card", place: "bottom" },
    { icon: "⚡", title: "Quick Booking = จองคอร์ท", text: "แตะกีฬาที่ต้องการ เลือกสนาม วันเวลา แล้วชำระเงินได้ในไม่กี่ขั้นตอน ระบบจะเรียงกีฬาที่คุณจองบ่อยไว้ก่อนอัตโนมัติ", target: ".quick-booking-row", place: "top" },
    rankSports.length
      ? { icon: "🍽️", title: "Buffet Rank", text: "จ่ายครั้งเดียว ตีได้ไม่จำกัดรอบในช่วงเวลา! เลือกระดับฝีมือ (มือใหม่–แข่งขัน) ระบบจับคู่คนเก่งใกล้เคียงกันให้อัตโนมัติ มีใน {{value0}}", values: { value0: rankSports.join(" · ") } }
      : { icon: "🍽️", title: "Buffet Rank", text: "จ่ายครั้งเดียว ตีได้ไม่จำกัดรอบในช่วงเวลา! เลือกระดับฝีมือ (มือใหม่–แข่งขัน) ระบบจับคู่คนเก่งใกล้เคียงกันให้อัตโนมัติ" },
    { icon: "👥", title: "สร้างกลุ่มก๊วน", text: "ชวนเพื่อนตั้งกลุ่มก๊วนประจำ นัดเล่นกันเป็นประจำได้ง่ายๆ เล่นติดต่อกันครบ 3 วันรับ Coin แถมลุ้นอันดับก๊วนประจำวันของคลับด้วย" },
    { icon: "💪", title: "GYMNOS ครบทุกบริการ", text: "Fitness · Swim · Hyrox · Pilates · Airfit และโปรโมชัน อยู่ในนี้หมด — ซื้อแพ็กเกจและคูปองได้ทันที", target: ".gymnos-banner", place: "top" },
    { icon: "🪙", title: "สะสม Coin แลกรางวัล", text: "เล่น Buffet Rank เล่นก๊วน หรือกลุ่มก๊วนที่แอคทีฟ จะได้ Coin สะสม เอาไปแลกของรางวัลได้ที่โปรไฟล์ → แลกรางวัล" },
    { icon: "👈", title: "ปัดซ้าย = ย้อนกลับ", text: "อยู่หน้าไหนก็ตาม ปัดนิ้วไปทางซ้าย (ตรง เฉียงขึ้น หรือเฉียงลงก็ได้) เพื่อย้อนกลับทีละหน้า จนถึงหน้าแรก — ลองปัดตอนนี้เพื่อไปขั้นถัดไป!", swipe: true },
    { icon: "📲", title: "สแกนเข้าใช้บริการ", text: "แถบล่าง: หน้าหลัก · เทรนเนอร์ · สแกน (QR อายุ 20 วิ กันแชร์) · ประวัติ · โปรไฟล์ — ทุกอย่างอยู่ห่างแค่แตะเดียว", target: "#tabbar", place: "middle" },
    { icon: "🎉", title: "พร้อมแล้ว!", text: "เริ่มจองสนามแรกของคุณได้เลย ดูคู่มือนี้อีกครั้งได้ที่ โปรไฟล์ → คู่มือการใช้งาน" },
  ];
}

// A left swipe: mostly sideways (straight, up-left or down-left), at least 60 px, within 0.7 s.
export function isBackSwipe(dx: number, dy: number, ms: number) {
  return ms < 700 && dx <= -60 && Math.abs(dy) <= Math.abs(dx) * 1.2;
}

export function MemberGuide({ steps, step, onNext, onSkip, onSwiped }: { steps: GuideStep[]; step: number; onNext: () => void; onSkip: () => void; onSwiped: () => void }) {
  const current = steps[Math.min(Math.max(step, 1), steps.length) - 1];
  const last = step >= steps.length;
  const next = useRef<HTMLButtonElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);

  // Light up what the step talks about (member card, Quick Booking, GYMNOS, tab bar) on the home screen.
  useEffect(() => {
    const target = current.target ? document.querySelector<HTMLElement>(current.target) : null;
    if (!target) return;
    target.classList.add("tut-hi");
    if (current.target !== "#tabbar") target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return () => target.classList.remove("tut-hi");
  }, [current.target]);
  useEffect(() => { next.current?.focus(); }, [step]);

  const swiped = (dx: number, dy: number, ms: number) => {
    if (current.swipe && isBackSwipe(dx, dy, ms)) onSwiped();
  };
  // The card sits away from what it points at (only on the home screen, where the targets are).
  const place = current.target && typeof document !== "undefined" && document.querySelector(current.target) ? current.place || "middle" : "middle";

  return (
    <div
      className={`tut-overlay ${place}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tut-title"
      aria-describedby="tut-text"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onSkip(); }
        if (event.key === "ArrowRight") { event.preventDefault(); onNext(); }
        if (event.key === "ArrowLeft" && current.swipe) { event.preventDefault(); onSwiped(); }
      }}
      onTouchStart={(event: TouchEvent) => { const touch = event.touches[0]; start.current = touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null; }}
      onTouchEnd={(event: TouchEvent) => { const touch = event.changedTouches[0]; if (start.current && touch) swiped(touch.clientX - start.current.x, touch.clientY - start.current.y, Date.now() - start.current.at); start.current = null; }}
      onPointerDown={(event) => { if (event.pointerType === "mouse") pointer.current = { x: event.clientX, y: event.clientY, at: Date.now() }; }}
      onPointerUp={(event) => { if (event.pointerType === "mouse" && pointer.current) swiped(event.clientX - pointer.current.x, event.clientY - pointer.current.y, Date.now() - pointer.current.at); pointer.current = null; }}
    >
      <section className="tut-card">
        <span className="tut-step">{step}/{steps.length}</span>
        <div className={current.swipe ? "tut-icon swipe-anim" : "tut-icon"} aria-hidden="true">{current.icon}</div>
        <strong id="tut-title">{t(current.title)}</strong>
        <p id="tut-text">{t(current.text, current.values)}</p>
        <ol className="tut-dots" aria-label={t("ขั้นที่ {{value0}} จาก {{value1}}", { value0: step, value1: steps.length })}>
          {steps.map((item, index) => <li key={item.title} className={index + 1 === step ? "on" : index + 1 < step ? "done" : ""} aria-current={index + 1 === step ? "step" : undefined} />)}
        </ol>
        <div className="tut-btns">
          <button type="button" className="tut-skip" onClick={onSkip}>{t("ข้าม")}</button>
          <button type="button" ref={next} className="tut-next" onClick={onNext}>{current.swipe ? t("ลองปัดซ้ายดูสิ 👈") : last ? t("เริ่มใช้งาน 🚀") : t("ถัดไป ›")}</button>
        </div>
      </section>
    </div>
  );
}
