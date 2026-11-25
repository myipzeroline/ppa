"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { LoadingNote, Top } from "@/components/member-ui";
import { formatDate } from "@/components/member-packages";
import type { Bootstrap, Coupon, Entitlement, Membership } from "@/components/member-types";
import { localeTag, t } from "@/lib/i18n";
import { daysLeft, parseMeta, wallClockTime } from "@/lib/package-presentation";
import { qrErrorKey } from "@/lib/qr-presentation";

// สแกนเข้าใช้บริการ (PPA app analysis V2, item 5): two tabs, เมมเบอร์ (packages and time passes in force)
// and คูปอง (vouchers with uses left, one used per scan). Tapping a right opens its QR, which the app
// replaces every 20 seconds (00:20 → 00:00 with a bar), so a screenshot passed on stops working.

export type AccessQr =
  | { purpose: "member"; membershipId?: number; title?: string; detail?: string }
  | { purpose: "coupon"; couponId: number; title?: string; detail?: string }
  | { purpose: "entitlement"; entitlementId: number; title?: string; detail?: string }
  | { purpose: "booking"; bookingNo: string; title?: string; detail?: string };

export type ScanTab = "member" | "coupon";

type QrPayload = { svg: string; expiresIn: number; refreshIn?: number; title: string };
type ScanData = Pick<Bootstrap, "memberships" | "membershipPauses" | "entitlements" | "coupons" | "user">;

export const QR_REFRESH_SECONDS = 20;

const couponIcons: [RegExp, string][] = [[/hyrox/, "🔥"], [/airfit/, "🪂"], [/pilates/, "🤸"], [/swim/, "🏊"], [/fitness/, "🎟️"]];

export function couponIcon(category: string) {
  return couponIcons.find(([pattern]) => pattern.test(category))?.[1] || "🎫";
}

function longDate(value: string | null | undefined) {
  const time = wallClockTime(value);
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" }) : "-";
}

// Packages in force now (a paused one is listed with the date it comes back) and time passes.
export function memberRights(data: ScanData, now: number) {
  const memberships = data.memberships
    .filter((membership) => membership.status === "active" && wallClockTime(membership.startsAt) <= now && wallClockTime(membership.endsAt) > now)
    .sort((a, b) => wallClockTime(b.endsAt) - wallClockTime(a.endsAt));
  const passes = data.entitlements.filter((right) => right.entitlementType === "time_pass" && right.status === "active" && (!right.endsAt || wallClockTime(right.endsAt) > now) && (right.remainingUses === null || right.remainingUses === undefined || Number(right.remainingUses) > 0));
  return { memberships, passes };
}

function pausedUntil(data: ScanData, membership: Membership, now: number) {
  const pause = data.membershipPauses.find((item) => Number(item.membershipId) === Number(membership.id) && wallClockTime(item.startsAt) <= now && wallClockTime(item.endsAt) > now);
  return pause ? pause.endsAt : null;
}

export function membershipIcon(membership: Membership) {
  const services = parseMeta(membership.metadata).services;
  const list = Array.isArray(services) ? services.map(String) : [];
  if (list.includes("swim") && !list.includes("fitness")) return "🏊";
  return Number(parseMeta(membership.metadata).months) >= 12 ? "🏆" : "🏋️";
}

function Row({ icon, title, sub, disabled, onClick }: { icon: string; title: string; sub: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="scan-right" disabled={disabled} onClick={onClick}>
      <span className="scan-right-icon" aria-hidden="true">{icon}</span>
      <span className="scan-right-text"><b>{title}</b><small>{sub}</small></span>
      <span className="chev" aria-hidden="true">›</span>
    </button>
  );
}

export function ScanHub({ data, now, tab, onTab, onOpen, onBuyPackage, onBuyCoupon, onVisits }: {
  data: ScanData;
  now: number;
  tab: ScanTab;
  onTab: (tab: ScanTab) => void;
  onOpen: (access: AccessQr) => void;
  onBuyPackage: () => void;
  onBuyCoupon: () => void;
  onVisits: () => void;
}) {
  const { memberships, passes } = memberRights(data, now);
  const coupons = data.coupons.filter((coupon) => Number(coupon.remainingUses || 0) > 0 && wallClockTime(coupon.expiresAt) > now);
  return (
    <div className="page scan-page">
      <Top title={t("สแกนเข้าใช้บริการ")} icon="📲" />
      <div className="plan-tabs scan-tabs" role="tablist" aria-label={t("สแกนเข้าใช้บริการ")}>
        <button type="button" role="tab" aria-selected={tab === "member"} className={tab === "member" ? "on" : ""} onClick={() => onTab("member")}>{t("เมมเบอร์")}</button>
        <button type="button" role="tab" aria-selected={tab === "coupon"} className={tab === "coupon" ? "on" : ""} onClick={() => onTab("coupon")}>{t("คูปอง")}{coupons.length ? <em className="scan-count">{coupons.length}</em> : null}</button>
      </div>
      {tab === "member" ? (
        <>
          <p className="scan-hint">{t("เมมเบอร์ที่คุณซื้อ — แตะเพื่อสร้าง QR สแกนเข้า")}</p>
          <div className="scan-list">
            {memberships.map((membership) => {
              const paused = pausedUntil(data, membership, now);
              return (
                <Row
                  key={`m-${membership.id}`}
                  icon={membershipIcon(membership)}
                  title={t(membership.planName)}
                  sub={paused ? t("พักการใช้งานถึง {{value0}}", { value0: longDate(paused) }) : t("ใช้ได้ถึง {{value0}} · เหลือ {{value1}} วัน", { value0: longDate(membership.endsAt), value1: daysLeft(membership.endsAt, now) })}
                  disabled={Boolean(paused)}
                  onClick={() => onOpen({ purpose: "member", membershipId: Number(membership.id), title: membership.planName, detail: t("ใช้ได้ถึง {{value0}}", { value0: longDate(membership.endsAt) }) })}
                />
              );
            })}
            {passes.map((pass: Entitlement) => (
              <Row
                key={`p-${pass.id}`}
                icon="🎫"
                title={t(pass.title)}
                sub={[pass.endsAt ? t("ใช้ได้ถึง {{value0}}", { value0: formatDate(pass.endsAt, true) }) : "", pass.remainingUses ? t("เหลือ {{value0}} ครั้ง", { value0: pass.remainingUses }) : ""].filter(Boolean).join(" · ") || t("บัตรผ่าน Time")}
                onClick={() => onOpen({ purpose: "entitlement", entitlementId: pass.id, title: pass.title, detail: pass.endsAt ? t("ใช้ได้ถึง {{value0}}", { value0: formatDate(pass.endsAt, true) }) : undefined })}
              />
            ))}
          </div>
          {!memberships.length && !passes.length ? (
            <div className="scan-empty">
              <span aria-hidden="true">🎫</span>
              <strong>{t("ยังไม่มีแพ็กเกจที่ใช้งานได้")}</strong>
              <p>{coupons.length ? t("ซื้อแพ็กเกจเพื่อสแกนเข้าใช้บริการ หรือใช้คูปองที่มีอยู่ในแท็บคูปอง") : t("ซื้อแพ็กเกจหรือคูปองเพื่อสแกนเข้าใช้บริการได้ทันที")}</p>
              <button type="button" className="primary" onClick={onBuyPackage}>{t("ซื้อแพ็กเกจ")}</button>
              {coupons.length ? <button type="button" className="ghost" onClick={() => onTab("coupon")}>{t("ใช้คูปอง ({{value0}})", { value0: coupons.length })}</button> : <button type="button" className="ghost" onClick={onBuyCoupon}>{t("ซื้อคูปอง")}</button>}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="scan-hint">{t("คูปองที่คุณซื้อ — แตะเพื่อสร้าง QR สแกนเข้า (ตัด 1 ใบ)")}</p>
          <div className="scan-list">
            {coupons.map((coupon: Coupon) => (
              <Row
                key={`c-${coupon.id}`}
                icon={couponIcon(coupon.category)}
                title={t(coupon.name)}
                sub={t("เหลือ {{value0}} ใบ · หมดอายุ {{value1}}", { value0: coupon.remainingUses ?? 0, value1: longDate(coupon.expiresAt) })}
                onClick={() => onOpen({ purpose: "coupon", couponId: coupon.id, title: coupon.name, detail: t("เหลือ {{value0}} ใบ · หมดอายุ {{value1}}", { value0: coupon.remainingUses ?? 0, value1: longDate(coupon.expiresAt) }) })}
              />
            ))}
          </div>
          {!coupons.length ? (
            <div className="scan-empty">
              <span aria-hidden="true">🎟️</span>
              <strong>{t("ยังไม่มีคูปองที่ใช้ได้")}</strong>
              <p>{t("ซื้อคูปองแล้วกลับมาที่แท็บนี้เพื่อสร้าง QR สแกนเข้า ระบบหัก 1 ใบต่อการสแกน")}</p>
              <button type="button" className="primary" onClick={onBuyCoupon}>{t("ซื้อคูปอง")}</button>
              <button type="button" className="ghost" onClick={onBuyPackage}>{t("ดูแพ็กเกจ")}</button>
            </div>
          ) : null}
        </>
      )}
      <button type="button" className="renew-link scan-visits" onClick={onVisits}><span aria-hidden="true">🚪</span><b>{t("ประวัติการเข้าใช้บริการ")}</b><i aria-hidden="true">›</i></button>
    </div>
  );
}

async function fetchQr(access: AccessQr, signal: AbortSignal) {
  const params = new URLSearchParams({ purpose: access.purpose });
  if (access.purpose === "member" && access.membershipId) params.set("membershipId", String(access.membershipId));
  if (access.purpose === "coupon") params.set("couponId", String(access.couponId));
  if (access.purpose === "entitlement") params.set("entitlementId", String(access.entitlementId));
  if (access.purpose === "booking") params.set("bookingNo", access.bookingNo);
  const response = await fetch(`/api/qr?${params}`, { cache: "no-store", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    const error = new Error("qr");
    Object.assign(error, { status: response.status, code: body?.code });
    throw error;
  }
  return await response.json() as QrPayload;
}

const mmss = (seconds: number) => `00:${String(Math.max(0, Math.min(59, seconds))).padStart(2, "0")}`;

// QR สแกนเข้า: the right's name and detail, the QR, "QR ใช้ได้อีก 00:15" and a bar that empties over 20 s;
// at 00:00 the next QR is already on its way. The page asks for no QR while the phone screen is off.
export function QrPass({ access, memberCode, onBack, onBuy, onVisits }: { access: AccessQr; memberCode: string; onBack: () => void; onBuy?: () => void; onVisits: () => void }) {
  const [qr, setQr] = useState<{ key: string; payload: QrPayload; until: number; window: number } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [revision, setRevision] = useState(0);
  const key = `${access.purpose}:${access.purpose === "member" ? access.membershipId || "" : access.purpose === "coupon" ? access.couponId : access.purpose === "entitlement" ? access.entitlementId : access.bookingNo}`;
  const loading = useRef(false);
  const until = useRef(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    until.current = 0;
    const load = async () => {
      if (loading.current || document.hidden) return;
      loading.current = true;
      const requestedAt = Date.now();
      try {
        const payload = await fetchQr(access, AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
        if (!alive) return;
        const span = Math.max(5, Math.min(Number(payload.refreshIn) || QR_REFRESH_SECONDS, Number(payload.expiresIn) || QR_REFRESH_SECONDS));
        until.current = requestedAt + span * 1000;
        setQr({ key, payload, until: until.current, window: span });
        setNow(Date.now());
        setError(null);
      } catch (failure) {
        if (!alive) return;
        until.current = 0;
        setQr(null);
        setError({ key, text: qrErrorKey((failure as { status?: number }).status, access.purpose, (failure as { code?: string }).code) });
      } finally {
        loading.current = false;
      }
    };
    void load();
    // Counts down every quarter second; at 00:00 the next QR is fetched (none after an error until
    // "ลองใหม่", and none while the screen is off).
    const tick = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (until.current && until.current <= time) void load();
    }, 250);
    const visible = () => { if (!document.hidden && (!until.current || until.current <= Date.now())) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", visible);
    };
    // access is identified by key; a new revision asks again after an error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);

  const current = qr?.key === key ? qr : null;
  const failure = error?.key === key ? error.text : "";
  // Never more than the window (the clock above may be a quarter second behind the request).
  const remaining = current ? Math.min(current.window, Math.max(0, Math.ceil((current.until - now) / 1000))) : 0;
  const percent = current ? Math.max(0, Math.min(100, ((current.until - now) / (current.window * 1000)) * 100)) : 0;
  const showBuy = failure === "qr.error.membership" || failure === "qr.error.rights";
  return (
    <div className="page qr-pass">
      <Top title={t("QR สแกนเข้า")} onBack={onBack} />
      <div className="qr-pass-head">
        <b>{t(access.title) || t(current?.payload.title) || t("QR สมาชิก")}</b>
        {access.detail ? <small>{access.detail}</small> : null}
      </div>
      <div className={failure ? "qr-box qr-error-state" : "qr-box"}>
        {current?.payload.svg ? (
          <Image unoptimized width={220} height={220} alt={t("QR เข้าใช้บริการ")} className="qr-svg" src={`data:image/svg+xml,${encodeURIComponent(current.payload.svg)}`} />
        ) : failure ? (
          <div role="status" className="qr-error">
            <p>{t(failure)}</p>
            <button type="button" className="ghost" onClick={() => setRevision((value) => value + 1)}>{t("ลองใหม่")}</button>
            {showBuy && onBuy ? <button type="button" className="primary" onClick={onBuy}>{t("ซื้อแพ็กเกจ/คูปอง")}</button> : null}
          </div>
        ) : (
          <div><i className="sk sk-qr" aria-hidden="true" /><LoadingNote text={t("กำลังโหลด QR...")} /></div>
        )}
      </div>
      {current ? (
        <>
          <div className="qr-refresh" role="timer" aria-live="off"><span>{t("QR ใช้ได้อีก")}</span><b>{mmss(remaining)}</b></div>
          <div className="qr-bar" role="progressbar" aria-label={t("QR ใช้ได้อีก")} aria-valuemin={0} aria-valuemax={current.window} aria-valuenow={remaining}><i style={{ width: `${percent}%` }} /></div>
        </>
      ) : null}
      <p className="qr-hint">{t("นำ QR ไปสแกนที่ประตูภายใน 20 วินาที")}<br />{t("หมดเวลา ระบบจะสร้าง QR ใหม่ให้อัตโนมัติ")}</p>
      <p className="qr-member-code">{t("MEMBER ID ·")} {memberCode}</p>
      <button type="button" className="renew-link scan-visits" onClick={onVisits}><span aria-hidden="true">🚪</span><b>{t("ประวัติการเข้าใช้บริการ")}</b><i aria-hidden="true">›</i></button>
    </div>
  );
}
