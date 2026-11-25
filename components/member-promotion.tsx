"use client";
import { useEffect, useState } from "react";
import { Empty, LoadingNote, money, Top } from "@/components/member-ui";
import { TabBar } from "@/components/member-schedule";
import type { ContentItem } from "@/components/member-types";
import { t } from "@/lib/i18n";
import { parseMeta } from "@/lib/package-presentation";
import type { ActiveDiscount, Deal } from "@/lib/promotions";

// แก้ 12 · PROMOTION (Hot Deals): two tabs.
//   ดีลประจำสัปดาห์: deals members take at once — "รับดีล" (a weekly discount, a weekly free coupon for
//   members with 3 check-in days) or "จองเลย" (free training hours with the first Personal Trainer).
//   Member: unlimited monthly packages at the PPA Member price, bought after the 6-digit member number
//   and a one-time code sent to the member's phone.

type DealView = Deal & { claimed: boolean; checkins?: number; eligible?: boolean; bonus?: "received" | "not_first" | "available" };
type PromotionState = { week: { key: string; lastDay: string }; deals: DealView[]; discount: ActiveDiscount | null; verification: { memberNo: string; name: string; verifiedAt: string } | null; otpDelivery: "sms" | "screen" | "unavailable" };

async function send<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || "network.error"), { status: response.status, code: data.code });
  return data as T;
}

export function memberPackages(items: ContentItem[]) {
  return items.filter((item) => item.contentType === "membership_plan" && parseMeta(item.metadata).tab === "member");
}

const tones: Record<string, string> = { orange: "#ff6a00", green: "#2ecc71", blue: "#3b82f6", purple: "#a855f7", red: "#ef4444" };

export function PromotionScreen({ items, onBack, onClaimed, onOpen, onBuyMember, notice }: {
  items: ContentItem[];
  onBack: () => void;
  onClaimed: () => void;
  onOpen: (target: string) => void;
  onBuyMember: (item: ContentItem, verified: boolean) => void;
  notice: (message: string) => void;
}) {
  const [tab, setTab] = useState<"deals" | "member">("deals");
  const [state, setState] = useState<PromotionState | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [working, setWorking] = useState("");
  useEffect(() => {
    let alive = true;
    send<PromotionState>("/api/promotions")
      .then((body) => { if (alive) { setState(body); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [revision]);

  async function claim(deal: DealView) {
    if (working) return;
    setWorking(deal.slug);
    try {
      const result = await send<{ kind: string; percent: number; until: string; coupon: { name: string; expiresInDays: number } | null }>("/api/promotions/claim", { slug: deal.slug });
      notice(result.coupon ? t("รับคูปองแล้ว · ดูได้ที่คูปองของฉัน") : t("รับดีลแล้ว · ลด {{value0}}% อัตโนมัติเมื่อชำระเงินสัปดาห์นี้", { value0: result.percent }));
      setRevision((value) => value + 1);
      onClaimed();
    } catch (error) {
      notice((error as Error).message);
      setRevision((value) => value + 1);
    } finally {
      setWorking("");
    }
  }

  const packages = memberPackages(items);
  return (
    <div className="page promotion-page">
      <Top title={t("โปรโมชัน")} icon="🎁" onBack={onBack} />
      <TabBar label={t("ประเภทโปรโมชัน")} tabs={[["deals", t("ดีลประจำสัปดาห์")], ["member", "Member"]]} value={tab} onChange={setTab} />
      {failed && !state ? <div role="alert" className="calendar-error">{t("โหลดข้อมูลไม่สำเร็จ")}<button type="button" onClick={() => setRevision((value) => value + 1)}>{t("ลองใหม่")}</button></div> : null}
      {!state && !failed ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {tab === "deals" && state ? (
        <div className="deal-list">
          {state.deals.map((deal) => {
            const done = deal.claimed || deal.bonus === "received";
            const blocked = deal.kind === "weekly_coupon" && !deal.claimed && !deal.eligible;
            const status = deal.kind === "discount" && deal.claimed ? t("รับแล้ว · ลด {{value0}}% ถึงวันอาทิตย์นี้", { value0: deal.percent })
              : deal.kind === "weekly_coupon" ? (deal.claimed ? t("รับแล้ว · คูปองอยู่ในคูปองของฉัน") : t("เช็คอินแล้ว {{value0}}/{{value1}} วันในสัปดาห์นี้", { value0: deal.checkins ?? 0, value1: deal.checkinDays }))
                : deal.kind === "trainer_bonus" ? (deal.bonus === "received" ? t("ได้รับเวลาเทรนฟรีแล้ว · ดูได้ที่สิทธิ์ของฉัน") : deal.bonus === "not_first" ? t("สำหรับการซื้อแพ็กเกจเทรนเนอร์ครั้งแรกเท่านั้น") : t("รับอัตโนมัติเมื่อชำระแพ็กเกจเทรนเนอร์ครั้งแรก")) : "";
            const action = deal.kind === "trainer_bonus"
              ? <button type="button" className="deal-action" onClick={() => onOpen("trainer")}>{t(deal.actionLabel || "จองเลย")}</button>
              : done
                ? <button type="button" className="deal-action done" onClick={() => onOpen(deal.kind === "discount" ? "plans" : "mycoupons")}>{deal.kind === "discount" ? t("เลือกแพ็กเกจ") : t("ดูคูปอง")}</button>
                : <button type="button" className="deal-action" disabled={Boolean(working) || blocked} onClick={() => void claim(deal)}>{working === deal.slug ? t("กำลังรับ...") : t(deal.actionLabel || "รับดีล")}</button>;
            return (
              <article className="deal-card" key={deal.slug} style={{ borderLeftColor: tones[deal.tone] || tones.orange }}>
                <span className="deal-icon" aria-hidden="true">{deal.icon}</span>
                <div className="deal-text">
                  <b>{t(deal.title)}</b>
                  {deal.subtitle ? <small>{t(deal.subtitle)}</small> : null}
                  {status ? <em className={done ? "deal-status done" : "deal-status"}>{status}</em> : null}
                </div>
                {action}
              </article>
            );
          })}
          {!state.deals.length ? <Empty text={t("ยังไม่มีดีลประจำสัปดาห์นี้")} /> : null}
        </div>
      ) : null}
      {tab === "member" ? (
        <>
          <div className="share-note">🔐 {t("ยืนยันสมาชิกด้วยรหัสสมาชิก + OTP ก่อนซื้อแพ็กเกจ")}</div>
          {state?.verification ? <p className="deal-verified">✓ {t("ยืนยันสมาชิก {{value0}} แล้ว · ซื้อแพ็กเกจ Member ได้ภายใน 30 นาที", { value0: state.verification.name })}</p> : null}
          <div className="pack-list">
            {packages.map((item) => (
              <button type="button" key={item.id} className="pkg-row member-pack" onClick={() => onBuyMember(item, Boolean(state?.verification))}>
                <span><b>{item.icon} {t(String(parseMeta(item.metadata).label || item.title))}</b><small>{t(item.subtitle) || t("ใช้ไม่จำกัด · รายเดือน")}</small></span>
                <strong>{money(item.price)} ฿<small>{t("/เดือน")}</small></strong>
              </button>
            ))}
            {!packages.length ? <Empty text={t("ยังไม่มีแพ็กเกจ Member เปิดจำหน่าย")} /> : null}
          </div>
          {state?.otpDelivery === "unavailable" ? <p className="renew-note">{t("ระบบส่ง OTP ยังไม่พร้อม กรุณาซื้อแพ็กเกจ Member ที่เคาน์เตอร์")}</p> : null}
        </>
      ) : null}
    </div>
  );
}

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

function Keypad({ onKey, disabled }: { onKey: (key: string) => void; disabled?: boolean }) {
  return (
    <div className="keypad">
      {keys.map((key, index) => key
        ? <button type="button" key={key} disabled={disabled} aria-label={key === "⌫" ? t("ลบ") : key} onClick={() => onKey(key)}>{key}</button>
        : <span key={`gap-${index}`} aria-hidden="true" />)}
    </div>
  );
}

// ยืนยันสมาชิก: the member number on a keypad → "ส่งรหัส OTP" → the 4-digit code from the member's
// phone → straight on to the QR payment.
export function MemberVerifyScreen({ item, onBack, onVerified }: { item: ContentItem | null; onBack: () => void; onVerified: (item: ContentItem) => void }) {
  const [memberNo, setMemberNo] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"number" | "otp">("number");
  const [phone, setPhone] = useState("");
  const [devCode, setDevCode] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);
  const wait = Math.max(0, Math.ceil((resendAt - tick) / 1000));

  async function request() {
    if (working || memberNo.length !== 6) return;
    setWorking(true);
    setError("");
    try {
      const body = await send<{ phone: string; expiresIn: number; devCode?: string }>("/api/member-verify", { memberNo });
      setPhone(body.phone);
      setDevCode(body.devCode || "");
      setCode("");
      setStep("otp");
      setResendAt(Date.now() + 60_000);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function confirm(value: string) {
    if (working || !item) return;
    setWorking(true);
    setError("");
    try {
      await send("/api/member-verify/confirm", { memberNo, code: value });
      onVerified(item);
    } catch (reason) {
      setError((reason as Error).message);
      setCode("");
    } finally {
      setWorking(false);
    }
  }

  function typeNumber(key: string) {
    setError("");
    setMemberNo((value) => (key === "⌫" ? value.slice(0, -1) : value.length < 6 ? value + key : value));
  }

  function typeCode(key: string) {
    setError("");
    const next = key === "⌫" ? code.slice(0, -1) : code.length < 4 ? code + key : code;
    setCode(next);
    if (next.length === 4 && key !== "⌫") void confirm(next);
  }

  const price = item ? `${t(String(parseMeta(item.metadata).label || item.title))} Member ${money(item.price)} ฿${t("/เดือน")}` : "";
  return (
    <div className="page verify-page">
      <Top title={t("ยืนยันสมาชิก")} onBack={step === "otp" ? () => { setStep("number"); setError(""); } : onBack} />
      {step === "number" ? (
        <>
          <p className="verify-lead">{t("กรอกรหัสสมาชิก PPA ของคุณ")}<br />{t("เพื่อซื้อ")} <b>{price}</b></p>
          <label className="verify-display">
            <span className="member-sr-only">{t("รหัสสมาชิก 6 หลัก")}</span>
            <input inputMode="numeric" autoComplete="off" maxLength={6} value={memberNo} placeholder={t("รหัสสมาชิก 6 หลัก")} onChange={(event) => { setError(""); setMemberNo(event.target.value.replace(/\D/g, "").slice(0, 6)); }} />
          </label>
          <Keypad onKey={typeNumber} disabled={working} />
          {error ? <p role="alert" className="verify-error">{t(error)}</p> : null}
          <button type="button" className="primary" disabled={working || memberNo.length !== 6} onClick={() => void request()}>{working ? t("กำลังส่งรหัส...") : t("ส่งรหัส OTP")}</button>
        </>
      ) : (
        <>
          <p className="verify-lead">{t("ส่งรหัส OTP ไปที่เบอร์ของสมาชิก")}<br /><b>{phone}</b></p>
          <div className="otp-boxes" aria-label={t("รหัส OTP 4 หลัก")}>
            {[0, 1, 2, 3].map((index) => <span key={index} className={index < code.length ? "filled" : ""}>{code[index] || ""}</span>)}
          </div>
          <label className="member-sr-only">{t("รหัส OTP 4 หลัก")}<input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(event) => { const value = event.target.value.replace(/\D/g, "").slice(0, 4); setCode(value); if (value.length === 4) void confirm(value); }} /></label>
          <p className="verify-hint">{t("ยืนยันตัวตนแล้วจะไปหน้าชำระเงินทันที")}</p>
          {devCode ? <p className="verify-dev">{t("โหมดทดสอบ (ยังไม่ได้ตั้งค่า SMS): รหัส OTP คือ {{value0}}", { value0: devCode })}</p> : null}
          <Keypad onKey={typeCode} disabled={working} />
          {error ? <p role="alert" className="verify-error">{t(error)}</p> : null}
          {working ? <LoadingNote text={t("กำลังตรวจสอบรหัส...")} /> : null}
          <button type="button" className="ghost" disabled={working || wait > 0} onClick={() => void request()}>{wait > 0 ? t("ขอรหัสใหม่ได้ใน {{value0}} วินาที", { value0: wait }) : t("ขอรหัส OTP ใหม่")}</button>
        </>
      )}
    </div>
  );
}
