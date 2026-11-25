"use client";
import { useId, useState } from "react";
import { AdminDialog } from "@/components/admin-dialog";
import { Empty, money, Top } from "@/components/member-ui";
import type { Bootstrap, ContentItem, Coupon, Membership } from "@/components/member-types";
import { bangkokToday } from "@/lib/court-availability";
import { localeTag, t } from "@/lib/i18n";
import { addCalendarDays, addMonthsClamped, groupPackages, parseMeta, pauseDayChoices, pausesAllowedFor, perUnit, validityLabel, wallClockTime, type PackageGroup } from "@/lib/package-presentation";
import { discounted, type ActiveDiscount } from "@/lib/promotions";

// "monthly" and "time" are kept for links made before the Package tab joined them (rich menu, banners).
export type PlanTab = "package" | "coupon" | "renew" | "monthly" | "time";
export type RenewTab = "package" | "coupon";
// แก้ 6-7: the same page sells Fitness and Swim (catalog metadata.page, Fitness by default).
export type PlanPage = "fitness" | "swim";
type PlansData = Pick<Bootstrap, "coupons" | "expiredCoupons" | "memberships" | "membershipPauses" | "pendingPayments">;


const PAUSE_LEAD_DAYS = 30;

// GYMNOS › Fitness / Swim (รายการที่ 4, แก้ 6-7): one page, two tabs: Package (TIME · per visit and
// MONTHLY sections) and Coupon.
const planTabs: ["package" | "coupon", string][] = [["package", "plans.tab.package"], ["coupon", "plans.tab.coupon"]];
// สมาชิกของฉัน › แพ็กเกจของฉัน and the rich menu "แพ็กเกจ" (PPA app analysis V2, item 1): "เลือกแพ็กเกจ"
// with four tabs, Monthly · Time · Coupon · ต่ออายุ, the 12-month hero card first.
export type ChooseTab = "monthly" | "time" | "coupon" | "renew";
const chooseTabs: [ChooseTab, string][] = [["monthly", "plans.tab.monthly"], ["time", "plans.tab.time"], ["coupon", "plans.tab.coupon"], ["renew", "plans.tab.renew"]];

export function planTabOf(tab: PlanTab): "package" | "coupon" | "renew" {
  return tab === "monthly" || tab === "time" ? "package" : tab;
}

export function chooseTabOf(tab: PlanTab): ChooseTab {
  return tab === "package" ? "monthly" : tab;
}

export function formatDate(value: string | null | undefined, withTime = false) {
  const time = wallClockTime(value);
  if (!Number.isFinite(time)) return "-";
  return new Date(time).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function validityText(days: number | undefined) {
  const { amount, unit } = validityLabel(Number(days || 0));
  if (unit === "year") return t("{{value0}} ปี", { value0: amount });
  if (unit === "month") return t("{{value0}} เดือน", { value0: amount });
  return t("{{value0}} วัน", { value0: amount });
}

function labelOf(item: { title?: string; name?: string; metadata?: unknown }) {
  const label = parseMeta(item.metadata).label;
  return typeof label === "string" && label.trim() ? label : item.title || item.name || "";
}

function numberMeta(item: { metadata?: unknown }, key: string) {
  const value = parseMeta(item.metadata)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type ExtraRow = { key: string | number; label: string; sub?: string; price: number; original?: number; onClick: () => void };

export function pageOf(item: { metadata?: unknown }) {
  const page = parseMeta(item.metadata).page;
  return typeof page === "string" && page ? page : "fitness";
}

// A price with the week's discount taken off (the original struck through), as checkout will charge.
export function PriceTag({ price, original, className }: { price: number; original?: number; className?: string }) {
  return (
    <strong className={className}>
      {money(price)} ฿
      {original && original > price ? <s>{money(original)} ฿</s> : null}
    </strong>
  );
}

function priceFor(price: number | string | undefined, page: string, discount?: ActiveDiscount | null) {
  const value = Number(price || 0);
  return discount && discount.scope.includes(page) ? { price: discounted(value, discount.percent), original: value } : { price: value, original: undefined };
}

// "Extra" variants (Fitness + Swim / Fitness + Hyrox) collapse under their base option.
function ExtraPanel({ label, rows, standalone = false }: { label: string; rows: ExtraRow[]; standalone?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <>
      <button type="button" className={`extra-toggle${standalone ? " standalone" : ""}${open ? " open" : ""}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        {open ? t("plans.extra.hide") : label} <span aria-hidden="true">▾</span>
      </button>
      <div className="extra-panel" id={panelId} hidden={!open}>
        {rows.map((row) => (
          <button type="button" className="extra-row" key={row.key} onClick={row.onClick}>
            <span>{row.label}{row.sub ? <small>{row.sub}</small> : null}</span>
            <PriceTag price={row.price} original={row.original} />
          </button>
        ))}
      </div>
    </>
  );
}

// "Fitness + Swim 2,000 + 700 ฿": the bundle of the same package and what it adds to the base price
// (coupons show how long they last instead).
function extraRow(base: { price?: number | string }, extra: ContentItem | Coupon, onClick: () => void, page: string, discount?: ActiveDiscount | null, validity?: string): ExtraRow {
  const difference = Number(extra.price) - Number(base.price);
  const priced = priceFor(extra.price, page, discount);
  return { key: extra.id, label: t(labelOf(extra)), sub: validity || (difference > 0 ? `${money(base.price)} + ${money(difference)} ฿` : undefined), price: priced.price, original: priced.original, onClick };
}

function packageSubtitle(item: ContentItem, kind: "monthly" | "time") {
  const meta = parseMeta(item.metadata);
  const months = numberMeta(item, "months");
  const days = numberMeta(item, "days");
  const parts = [item.subtitle ? t(item.subtitle) : ""];
  if (!item.subtitle && kind === "monthly" && months > 1) parts.push(t("เฉลี่ย {{value0}} ฿/เดือน", { value0: money(perUnit(item.price, months)) }));
  if (!item.subtitle && kind === "time" && days > 1) parts.push(t("เฉลี่ย {{value0}} ฿/ครั้ง", { value0: money(perUnit(item.price, days)) }));
  if (typeof meta.badge === "string" && meta.badge.trim()) parts.push(t(meta.badge));
  return parts.filter(Boolean).join(" · ");
}

function PackageBlock({ group, kind, page, discount, onSelect }: { group: PackageGroup<ContentItem>; kind: "monthly" | "time"; page: string; discount?: ActiveDiscount | null; onSelect: (item: ContentItem) => void }) {
  const base = group.base;
  const sub = packageSubtitle(base, kind);
  const priced = priceFor(base.price, page, discount);
  return (
    <div className="pkg-block">
      <button type="button" className={group.extras.length ? "pkg-row has-extra" : "pkg-row"} onClick={() => onSelect(base)}>
        <span><b>{t(labelOf(base))}</b>{sub ? <small>{sub}</small> : null}</span>
        <PriceTag price={priced.price} original={priced.original} />
      </button>
      {group.extras.length ? <ExtraPanel label="Extra" rows={group.extras.map((extra) => extraRow(base, extra, () => onSelect(extra), page, discount))} /> : null}
    </div>
  );
}

// Coupon packs of a page (coupons with metadata.tab = "coupon"): "10 ใบ · ใช้งานได้ 2 เดือน · เฉลี่ย 160
// ฿/วัน", each with its Extra bundles. Tapping the price goes straight to payment.
export function CouponPacks({ coupons, onBuy, page = "fitness", discount }: { coupons: Coupon[]; onBuy: (coupon: Coupon) => void; page?: string; discount?: ActiveDiscount | null }) {
  const groups = groupPackages(coupons.filter((coupon) => parseMeta(coupon.metadata).tab === "coupon" && pageOf(coupon) === page));
  if (!groups.length) return <Empty text={t("ยังไม่มีคูปองเปิดจำหน่าย")} />;
  return (
    <div className="coupon-packs">
      {groups.map((group) => {
        const base = group.base;
        const meta = parseMeta(base.metadata);
        const uses = Number(base.totalUses || 0);
        const priced = priceFor(base.price, page, discount);
        return (
          <div className="pkg-block" key={group.key}>
            <button type="button" className={group.extras.length ? "pkg-row coupon-row has-extra" : "pkg-row coupon-row"} aria-label={t("ซื้อ {{value0}}", { value0: t(base.name) })} onClick={() => onBuy(base)}>
              {typeof meta.badge === "string" ? <em className="badge-best">{t(meta.badge)}</em> : null}
              <span>
                <b>{t("{{value0}} ใบ", { value0: uses })}</b>
                <small>{t("ใช้งานได้ {{value0}}", { value0: validityText(base.validityDays) })} · {t("เฉลี่ย {{value0}} ฿/วัน", { value0: money(perUnit(priced.price, uses)) })}</small>
              </span>
              <PriceTag price={priced.price} original={priced.original} />
            </button>
            {group.extras.length ? (
              <ExtraPanel label="Extra" rows={group.extras.map((extra) => extraRow(base, extra, () => onBuy(extra), page, discount, t("ใช้งานได้ {{value0}}", { value0: validityText(extra.validityDays) })))} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// The 12-month hero card of "เลือกแพ็กเกจ" (catalog metadata featured / badge / perks / months): the price
// with the monthly average, the perks as a checklist and the green "เลือกแพ็กเกจนี้", its Extra below.
function FeaturedPlan({ group, page, discount, onSelect }: { group: PackageGroup<ContentItem>; page: string; discount?: ActiveDiscount | null; onSelect: (item: ContentItem) => void }) {
  const base = group.base;
  const meta = parseMeta(base.metadata);
  const months = numberMeta(base, "months");
  const perks = Array.isArray(meta.perks) ? meta.perks.filter((perk): perk is string => typeof perk === "string" && Boolean(perk.trim())) : [];
  const priced = priceFor(base.price, page, discount);
  return (
    <div className="pkg-block featured">
      <article className="plan-card">
        <div className="plan-card-head">
          <strong>{t(labelOf(base))}</strong>
          {typeof meta.badge === "string" && meta.badge.trim() ? <span className="plan-badge">{t(meta.badge)}</span> : null}
        </div>
        <div className="plan-card-price">
          {money(priced.price)} ฿{priced.original ? <s>{money(priced.original)} ฿</s> : null} {months > 1 ? <small>{t("(เฉลี่ย {{value0}} ฿ / เดือน)", { value0: money(perUnit(priced.price, months)) })}</small> : null}
        </div>
        {perks.length ? <ul>{perks.map((perk) => <li key={perk}>{t(perk)}</li>)}</ul> : null}
        <button type="button" className="plan-card-cta" onClick={() => onSelect(base)}>{t(base.actionLabel || "เลือกแพ็กเกจนี้")}</button>
      </article>
      {group.extras.length ? (
        <ExtraPanel standalone label={months ? t("Extra · {{value0}} เดือน", { value0: months }) : "Extra"} rows={group.extras.map((extra) => extraRow(base, extra, () => onSelect(extra), page, discount))} />
      ) : null}
    </div>
  );
}

// Coupon packs as cards (PPA app analysis V2, item 1): the number of vouchers in large type, "10 ใบ /
// 2 เดือน", the price with the daily average, a green [+] that opens payment at once, BEST SELLER and
// the Extra bundles below.
export function CouponCards({ coupons, onBuy, page = "fitness", discount }: { coupons: Coupon[]; onBuy: (coupon: Coupon) => void; page?: string; discount?: ActiveDiscount | null }) {
  const groups = groupPackages(coupons.filter((coupon) => parseMeta(coupon.metadata).tab === "coupon" && pageOf(coupon) === page));
  if (!groups.length) return <Empty text={t("ยังไม่มีคูปองเปิดจำหน่าย")} />;
  return (
    <div className="coupon-packs">
      {groups.map((group) => {
        const base = group.base;
        const meta = parseMeta(base.metadata);
        const uses = Number(base.totalUses || 0);
        const priced = priceFor(base.price, page, discount);
        return (
          <div className="pkg-block" key={group.key}>
            <div className={group.extras.length ? "coupon-pack has-extra" : "coupon-pack"}>
              {typeof meta.badge === "string" && meta.badge.trim() ? <span className="badge-best">{t(meta.badge)}</span> : null}
              <span className="cp-count"><b>{uses}</b><small>{t("ใบ")}</small></span>
              <span className="cp-info">
                <b>{t("{{value0}} ใบ / {{value1}}", { value0: uses, value1: validityText(base.validityDays) })}</b>
                <small>{t("{{value0}} ฿ · เฉลี่ย {{value1}} ฿/วัน", { value0: money(priced.price), value1: money(perUnit(priced.price, uses)) })}{priced.original ? <s>{money(priced.original)} ฿</s> : null}</small>
              </span>
              <button type="button" className="cp-add" aria-label={t("ซื้อ {{value0}}", { value0: t(base.name) })} onClick={() => onBuy(base)}>+</button>
            </div>
            {group.extras.length ? (
              <ExtraPanel label="Extra" rows={group.extras.map((extra) => extraRow(base, extra, () => onBuy(extra), page, discount, t("ใช้งานได้ {{value0}}", { value0: validityText(extra.validityDays) })))} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// [ข้อมูลการใช้งาน]: how coupons are used, shared with one friend per voucher, how long each pack lasts
// (from the catalog) and how to renew them (the renewal price from App Content).
export function CouponUsageInfo({ coupons, page = "fitness", renewalPrice }: { coupons: Coupon[]; page?: string; renewalPrice?: number }) {
  const [open, setOpen] = useState(false);
  const packs = groupPackages(coupons.filter((coupon) => parseMeta(coupon.metadata).tab === "coupon" && pageOf(coupon) === page)).map((group) => group.base);
  const lasts = packs.map((pack) => t("{{value0}} ใบ {{value1}}", { value0: Number(pack.totalUses || 0), value1: validityText(pack.validityDays) })).join(" · ");
  return (
    <>
      <button type="button" className="ghost plans-info-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t("ข้อมูลการใช้งาน")}</button>
      {open ? (
        <AdminDialog onClose={() => setOpen(false)}>
          <section className="member-confirm coupon-info-sheet">
            <h2>{t("ข้อมูลการใช้งานคูปอง")}</h2>
            <ul className="plans-info">
              <li>{t("คูปอง 1 ใบ ใช้เข้าใช้บริการได้ 1 ครั้ง")}</li>
              <li>{t("แชร์ได้ 1 ใบต่อเพื่อน 1 คน: เพื่อนใช้ 1 ใบเข้าใช้บริการพร้อมคุณ แจ้งเจ้าหน้าที่ที่เคาน์เตอร์")}</li>
              <li>{t("เปิด QR ในหน้าสแกน › คูปอง แล้วให้เจ้าหน้าที่สแกน ระบบหัก 1 ใบต่อการสแกน · QR เปลี่ยนทุก 20 วินาที")}</li>
              {lasts ? <li>{t("อายุคูปองนับจากวันที่ซื้อ: {{value0}}", { value0: lasts })}</li> : null}
              <li>{renewalPrice ? t("หมดอายุแล้วยังมีใบเหลือ ต่ออายุได้ภายใน 30 วันที่แท็บต่ออายุ ({{value0}} ฿ ต่อ 1 เดือน จำนวนใบคงเดิม)", { value0: money(renewalPrice) }) : t("หมดอายุแล้วยังมีใบเหลือ ต่ออายุได้ภายใน 30 วันที่แท็บต่ออายุ จำนวนใบคงเดิม")}</li>
            </ul>
            <div><button type="button" className="primary" onClick={() => setOpen(false)}>{t("เข้าใจแล้ว")}</button></div>
          </section>
        </AdminDialog>
      ) : null}
    </>
  );
}

function CouponTab({ couponStore, onBuyCoupon, page, discount, renewalPrice, cards = false }: { couponStore: Coupon[]; onBuyCoupon: (coupon: Coupon) => void; page: PlanPage; discount?: ActiveDiscount | null; renewalPrice?: number; cards?: boolean }) {
  return (
    <>
      <h2 className="plans-subtitle">{page === "swim" ? t("คูปอง (Swim)") : t("คูปอง (Fitness)")}</h2>
      <div className="share-note">{t("🤝 คูปอง 1 ใบ สามารถแชร์ให้เพื่อนได้ 1 คน")}</div>
      {cards
        ? <CouponCards coupons={couponStore} onBuy={onBuyCoupon} page={page} discount={discount} />
        : <CouponPacks coupons={couponStore} onBuy={onBuyCoupon} page={page} discount={discount} />}
      <CouponUsageInfo coupons={couponStore} page={page} renewalPrice={renewalPrice} />
    </>
  );
}

function activeMembershipOf(memberships: Membership[], now: number) {
  return memberships
    .filter((membership) => membership.status === "active" && wallClockTime(membership.endsAt) > now)
    .sort((a, b) => wallClockTime(b.endsAt) - wallClockTime(a.endsAt))[0] || null;
}

function PausePanel({ option, data, now, busy, onRequestPause }: { option?: ContentItem; data: PlansData; now: number; busy: boolean; onRequestPause: Props["onRequestPause"] }) {
  const today = bangkokToday(now);
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState(30);
  if (!option) return <Empty text={t("ยังไม่เปิดให้ขอพักการใช้งานแพ็กเกจ")} />;
  const dayChoices = pauseDayChoices(numberMeta(option, "maxDays") || undefined);
  const selectedDays = dayChoices.includes(days) ? days : dayChoices[dayChoices.length - 1];
  const membership = activeMembershipOf(data.memberships, now);
  const pauses = membership ? data.membershipPauses.filter((pause) => Number(pause.membershipId) === Number(membership.id)) : [];
  const allowed = membership ? pausesAllowedFor(parseMeta(membership.metadata), membership.startsAt, membership.endsAt) : 0;
  const current = pauses.find((pause) => wallClockTime(pause.startsAt) <= now && wallClockTime(pause.endsAt) > now);
  const upcoming = pauses.find((pause) => wallClockTime(pause.startsAt) > now);
  const pending = membership ? data.pendingPayments.some((payment) => payment.itemType === "membership_pause" && String(payment.refId) === String(membership.id)) : false;
  const remaining = Math.max(0, allowed - pauses.length);
  const reason = !membership ? t("ต้องมีแพ็กเกจ 6 หรือ 12 เดือนที่ใช้งานอยู่") : !allowed ? t("แพ็กเกจนี้ไม่รองรับการพักการใช้งาน") : !remaining ? t("แพ็กเกจนี้ใช้สิทธิ์พักการใช้งานครบแล้ว") : pending ? t("มีคำขอพักการใช้งานรอยืนยันการชำระเงิน") : "";
  const maxStart = addCalendarDays(today, PAUSE_LEAD_DAYS);
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate >= today && startDate <= maxStart;
  return (
    <>
      <div className="renew-card">
        <b>{t("{{value0}} · {{value1}} ฿/ครั้ง", { value0: t(option.title), value1: money(option.price) })}</b>
        {option.subtitle ? <p>{t(option.subtitle)}</p> : null}
      </div>
      <div className="info-row"><span>{t("📦 แพ็กเกจ 6 เดือน")}</span><b>{t("หยุดได้ {{value0}} ครั้ง", { value0: 1 })}</b></div>
      <div className="info-row"><span>{t("📦 แพ็กเกจรายปี (12 เดือน)")}</span><b>{t("หยุดได้ {{value0}} ครั้ง", { value0: 2 })}</b></div>
      {membership ? (
        <div className="renew-status">
          <b>{t(membership.planName)}</b>
          <small>{t("ใช้ได้ถึง {{value0}}", { value0: formatDate(membership.endsAt) })} · {t("ใช้สิทธิ์พักแล้ว {{value0}}/{{value1}} ครั้ง", { value0: pauses.length, value1: allowed })}</small>
          {current ? <small className="renew-flag">{t("กำลังพักการใช้งานถึง {{value0}}", { value0: formatDate(current.endsAt) })}</small> : null}
          {!current && upcoming ? <small className="renew-flag">{t("นัดพักการใช้งาน {{value0}} – {{value1}}", { value0: formatDate(upcoming.startsAt), value1: formatDate(upcoming.endsAt) })}</small> : null}
        </div>
      ) : null}
      {reason ? <p className="renew-note">{reason}</p> : (
        <div className="renew-form">
          <label className="field">{t("วันเริ่มพัก")}<input type="date" min={today} max={maxStart} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field">{t("จำนวนวันที่พัก")}<select value={selectedDays} onChange={(event) => setDays(Number(event.target.value))}>{dayChoices.map((value) => <option key={value} value={value}>{t("{{value0}} วัน", { value0: value })}</option>)}</select></label>
          <p className="renew-preview">{t("กลับมาใช้ได้ {{value0}} · วันหมดอายุเลื่อนออกไป {{value1}} วัน", { value0: validStart ? formatDate(`${addCalendarDays(startDate, selectedDays)} 00:00:00`) : "-", value1: selectedDays })}</p>
        </div>
      )}
      <button type="button" className="ghost renew-action" disabled={busy || Boolean(reason) || !validStart || !membership} onClick={() => membership && onRequestPause({ membershipId: Number(membership.id), startDate, days: selectedDays, option })}>
        {t("ขอพักการใช้งาน {{value0}} ฿", { value0: money(option.price) })}
      </button>
    </>
  );
}

function CouponRenewPanel({ option, data, now, busy, onRenewCoupon, initialCouponId = 0 }: { option?: ContentItem; data: PlansData; now: number; busy: boolean; onRenewCoupon: Props["onRenewCoupon"]; initialCouponId?: number }) {
  const renewable = [...data.coupons, ...data.expiredCoupons];
  const [selectedId, setSelectedId] = useState(initialCouponId);
  if (!option) return <Empty text={t("ยังไม่เปิดให้ต่ออายุคูปอง")} />;
  const months = numberMeta(option, "months") || 1;
  const selected = renewable.find((coupon) => coupon.id === selectedId) || renewable[0];
  const pending = selected ? data.pendingPayments.some((payment) => payment.itemType === "coupon_renewal" && String(payment.refId) === String(selected.id)) : false;
  const nextExpiry = selected ? addMonthsClamped(Math.max(wallClockTime(selected.expiresAt), now), months) : NaN;
  return (
    <>
      <div className="renew-card coupon">
        <b>{t("{{value0}} · {{value1}} ฿/เดือน", { value0: t(option.title), value1: money(option.price) })}</b>
        {option.subtitle ? <p>{t(option.subtitle)}</p> : null}
      </div>
      {renewable.length ? (
        <div className="renew-form">
          <label className="field">{t("เลือกคูปองที่ต้องการต่ออายุ")}
            <select value={selected?.id || 0} onChange={(event) => setSelectedId(Number(event.target.value))}>
              {renewable.map((coupon) => <option key={coupon.id} value={coupon.id}>{t("{{value0}} · เหลือ {{value1}} · หมดอายุ {{value2}}", { value0: t(coupon.name), value1: coupon.remainingUses ?? 0, value2: formatDate(coupon.expiresAt) })}</option>)}
            </select>
          </label>
          {selected ? <p className="renew-preview">{t("วันหมดอายุใหม่ {{value0}} · จำนวนคงเหลือเท่าเดิม", { value0: Number.isFinite(nextExpiry) ? formatDate(new Date(nextExpiry).toISOString()) : "-" })}</p> : null}
          {pending ? <p className="renew-note">{t("มีคำขอต่ออายุคูปองนี้รอยืนยันการชำระเงิน")}</p> : null}
        </div>
      ) : <Empty text={t("ยังไม่มีคูปองที่ต่ออายุได้")} />}
      <button type="button" className="ghost renew-action" disabled={busy || !selected || pending} onClick={() => selected && onRenewCoupon({ userCouponId: selected.id, option, title: selected.name })}>
        {t("ต่ออายุคูปอง {{value0}} ฿/เดือน", { value0: money(option.price) })}
      </button>
    </>
  );
}

function RenewTabPanel(props: Props) {
  const [sub, setSub] = useState<RenewTab>(props.renewFocus?.sub ?? "package");
  const options = props.contentItems.filter((item) => item.contentType === "renewal_option");
  const optionFor = (kind: string) => options.find((item) => parseMeta(item.metadata).kind === kind);
  return (
    <>
      <div className="plan-tabs renew-tabs" role="tablist" aria-label={t("ประเภทการต่ออายุ")}>
        <button type="button" role="tab" aria-selected={sub === "package"} className={sub === "package" ? "on" : ""} onClick={() => setSub("package")}>{t("แพ็กเกจ")}</button>
        <button type="button" role="tab" aria-selected={sub === "coupon"} className={sub === "coupon" ? "on" : ""} onClick={() => setSub("coupon")}>{t("คูปอง")}</button>
      </div>
      {sub === "package"
        ? <PausePanel option={optionFor("membership_pause")} data={props.data} now={props.now} busy={props.busy} onRequestPause={props.onRequestPause} />
        : <CouponRenewPanel option={optionFor("coupon_renewal")} data={props.data} now={props.now} busy={props.busy} onRenewCoupon={props.onRenewCoupon} initialCouponId={props.renewFocus?.couponId} />}
    </>
  );
}

type Props = {
  tab: PlanTab;
  title?: string;
  page?: PlanPage;
  // "page": GYMNOS › Fitness / Swim (Package · Coupon). "choose": เลือกแพ็กเกจ (Monthly · Time · Coupon ·
  // ต่ออายุ) from สมาชิกของฉัน › แพ็กเกจของฉัน and the rich menu.
  variant?: "page" | "choose";
  // The weekly discount the member claimed (Promotion): prices show it, checkout charges it.
  discount?: ActiveDiscount | null;
  onTab: (tab: PlanTab) => void;
  contentItems: ContentItem[];
  couponStore: Coupon[];
  data: PlansData;
  now: number;
  busy: boolean;
  onBack: () => void;
  onSelectContent: (item: ContentItem) => void;
  onBuyCoupon: (coupon: Coupon) => void;
  onRequestPause: (input: { membershipId: number; startDate: string; days: number; option: ContentItem }) => void;
  onRenewCoupon: (input: { userCouponId: number; option: ContentItem; title: string }) => void;
  // Opens the Renew tab on a sub-tab / coupon (e.g. "ต่ออายุคูปองนี้" from My coupons).
  renewFocus?: { sub: RenewTab; couponId?: number };
};

function catalogOf(props: Props, page: string) {
  const byTab = (contentType: string, tab: string) => props.contentItems.filter((item) => {
    if (item.contentType !== contentType || pageOf(item) !== page) return false;
    const itemTab = parseMeta(item.metadata).tab;
    return itemTab === tab || (itemTab === undefined && tab === "monthly");
  });
  const renewal = props.contentItems.find((item) => item.contentType === "renewal_option" && parseMeta(item.metadata).kind === "coupon_renewal");
  return { monthly: groupPackages(byTab("membership_plan", "monthly")), time: groupPackages(byTab("time_pass", "time")), renewalPrice: renewal ? Number(renewal.price) : undefined };
}

function DealBanner({ discount }: { discount: ActiveDiscount }) {
  return <div className="deal-banner" role="note">🏷️ {t("ส่วนลด {{value0}}% ของสัปดาห์นี้ใช้อยู่ · ราคาที่แสดงลดแล้ว ถึง {{value1}}", { value0: discount.percent, value1: formatDate(`${discount.until} 23:59:00`) })}</div>;
}

// เลือกแพ็กเกจ (PPA app analysis V2, item 1): Monthly starts with the 12-month hero card (catalog
// metadata.featured) and its checklist, then the other monthly plans; Time lists the per-visit passes;
// Coupon lists the packs as cards with a green [+] and "ข้อมูลการใช้งาน"; ต่ออายุ pauses a package or renews
// a coupon. Every price opens payment at once.
function ChoosePackageScreen(props: Props) {
  const tab = chooseTabOf(props.tab);
  const page = props.page || "fitness";
  const discount = props.discount && props.discount.scope.includes(page) ? props.discount : null;
  const { monthly, time, renewalPrice } = catalogOf(props, page);
  const featured = monthly.find((group) => parseMeta(group.base.metadata).featured === true);
  const others = monthly.filter((group) => group !== featured);
  return (
    <div className="page plans-page choose-page">
      <Top title={props.title || t("เลือกแพ็กเกจ")} onBack={props.onBack} />
      <div className="plan-tabs four" role="tablist" aria-label={t("ประเภทแพ็กเกจ")}>
        {chooseTabs.map(([key, label]) => (
          <button type="button" role="tab" key={key} aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => props.onTab(key)}>{t(label)}</button>
        ))}
      </div>
      {discount && tab !== "renew" ? <DealBanner discount={discount} /> : null}
      {tab === "monthly" ? (
        <>
          {featured ? <FeaturedPlan group={featured} page={page} discount={discount} onSelect={props.onSelectContent} /> : null}
          {others.map((group) => <PackageBlock key={group.key} kind="monthly" page={page} discount={discount} group={group} onSelect={props.onSelectContent} />)}
          {!monthly.length ? <Empty text={t("ยังไม่มีแพ็กเกจเปิดจำหน่าย")} /> : null}
        </>
      ) : null}
      {tab === "time" ? (
        <>
          <div className="plans-label">{t("TIME · รายครั้ง (FITNESS)")}</div>
          {time.length ? time.map((group) => <PackageBlock key={group.key} kind="time" page={page} discount={discount} group={group} onSelect={props.onSelectContent} />) : <Empty text={t("ยังไม่มีแพ็กเกจเปิดจำหน่าย")} />}
        </>
      ) : null}
      {tab === "coupon" ? <CouponTab cards couponStore={props.couponStore} onBuyCoupon={props.onBuyCoupon} page={page} discount={discount} renewalPrice={renewalPrice} /> : null}
      {tab === "renew" ? <RenewTabPanel {...props} /> : null}
    </div>
  );
}

// แก้ 6 (Fitness) and แก้ 7 (Swim): Package and Coupon tabs. Package lists TIME (per visit / week) and
// MONTHLY plans; every package has its own "Extra" with the bundles (Fitness + Swim / Fitness + Hyrox, or
// Swim + Fitness / Swim + Hyrox). Tapping a price opens the QR payment. Pausing a package and renewing
// coupons stay one tap away below the lists.
export function PackagePlansScreen(props: Props) {
  if (props.variant === "choose") return <ChoosePackageScreen {...props} />;
  const tab = planTabOf(props.tab);
  const page = props.page || "fitness";
  const discount = props.discount && props.discount.scope.includes(page) ? props.discount : null;
  const { monthly, time, renewalPrice } = catalogOf(props, page);
  const renewLink = (
    <button type="button" className="renew-link" onClick={() => props.onTab("renew")}>
      <span aria-hidden="true">⏸️</span><b>{t("พักแพ็กเกจ / ต่ออายุคูปอง")}</b><i aria-hidden="true">›</i>
    </button>
  );
  return (
    <div className="page plans-page">
      <Top title={props.title || (page === "swim" ? t("Swim") : t("Fitness"))} icon={page === "swim" ? "🏊" : "💪"} onBack={props.onBack} />
      {discount && tab !== "renew" ? <DealBanner discount={discount} /> : null}
      {tab === "renew" ? (
        <button type="button" className="renew-back" onClick={() => props.onTab("package")}>‹ {t("กลับไปที่แพ็กเกจ")}</button>
      ) : (
        <div className="plan-tabs" role="tablist" aria-label={t("ประเภทแพ็กเกจ")}>
          {planTabs.map(([key, label]) => (
            <button type="button" role="tab" key={key} aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => props.onTab(key)}>{t(label)}</button>
          ))}
        </div>
      )}
      {tab === "package" ? (
        <>
          <div className="plans-label">{t("TIME · รายครั้ง")}</div>
          {time.length ? time.map((group) => <PackageBlock key={group.key} kind="time" page={page} discount={discount} group={group} onSelect={props.onSelectContent} />) : <Empty text={t("ยังไม่มีแพ็กเกจเปิดจำหน่าย")} />}
          <div className="plans-label">{t("MONTHLY · รายเดือน")}</div>
          {monthly.length ? monthly.map((group) => <PackageBlock key={group.key} kind="monthly" page={page} discount={discount} group={group} onSelect={props.onSelectContent} />) : <Empty text={t("ยังไม่มีแพ็กเกจเปิดจำหน่าย")} />}
          <p className="slot-footnote">{page === "swim" ? t("แตะแพ็กเกจเพื่อชำระเงินทันที · กด Extra เพื่อดูราคาแพ็กเกจรวม Fitness หรือ Hyrox") : t("แตะแพ็กเกจเพื่อชำระเงินทันที · กด Extra เพื่อดูราคาแพ็กเกจรวม Swim หรือ Hyrox")}</p>
          {renewLink}
        </>
      ) : null}
      {tab === "coupon" ? (
        <>
          <CouponTab couponStore={props.couponStore} onBuyCoupon={props.onBuyCoupon} page={page} discount={discount} renewalPrice={renewalPrice} />
          <p className="slot-footnote">{page === "swim" ? t("แตะคูปองเพื่อชำระเงินทันที · กด Extra เพื่อดูราคาคูปองรวม Fitness หรือ Hyrox") : t("แตะคูปองเพื่อชำระเงินทันที · กด Extra เพื่อดูราคาคูปองรวม Swim หรือ Hyrox")}</p>
          {renewLink}
        </>
      ) : null}
      {tab === "renew" ? <RenewTabPanel {...props} /> : null}
    </div>
  );
}
