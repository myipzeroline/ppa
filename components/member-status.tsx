"use client";
import { useCallback, useEffect, useState } from "react";
import { Empty, LoadingNote, money, Top } from "@/components/member-ui";
import { TabBar } from "@/components/member-schedule";
import type { MemberTierView, SkillRating } from "@/components/member-types";
import { localeTag, t } from "@/lib/i18n";

// Page 1, points 4 and 5: the member level (Visit, Gold, Platinum, Wisdom) from money spent in the last
// 12 months with the way to the next level, Coins and points, and the Skill Rating Matrix (Buffet Rank
// rating and skill tier per sport). Transaction history lists every payment of every channel.

const tierTone: Record<string, string> = { visit: "visit", gold: "gold", platinum: "platinum", wisdom: "wisdom" };

export function MemberStatusScreen({ tier, ratings, tiers, coinBalance, pointBalance, onBack, onRewards, onHistory, onBuffetRank }: {
  tier?: MemberTierView;
  ratings: SkillRating[];
  tiers: { name: string; min: number }[];
  coinBalance: number;
  pointBalance: number;
  onBack: () => void;
  onRewards: () => void;
  onHistory: () => void;
  onBuffetRank: () => void;
}) {
  return (
    <div className="page status-page">
      <Top title={t("ระดับสมาชิก & ฝีมือ")} icon="💎" onBack={onBack} />
      {tier ? (
        <section className={`tier-card ${tierTone[tier.name.toLowerCase()] || "visit"}`}>
          <small>{t("ระดับสมาชิกของคุณ")}</small>
          <b>{t(tier.name)}</b>
          <span>{t("ยอดใช้จ่าย 12 เดือน {{value0}} ฿", { value0: money(tier.spend) })}</span>
          {tier.next ? (
            <>
              <div className="tier-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tier.progress} aria-label={t("ความคืบหน้าสู่ระดับถัดไป")}><i style={{ width: `${tier.progress}%` }} /></div>
              <small>{t("อีก {{value0}} ฿ เพื่อเป็น {{value1}}", { value0: money(tier.next.remaining), value1: t(tier.next.name) })}</small>
            </>
          ) : <small>{t("คุณอยู่ในระดับสูงสุดแล้ว")}</small>}
        </section>
      ) : null}
      {tier ? (
        <section className="tier-ladder" aria-label={t("ระดับสมาชิกทั้งหมด")}>
          {tier.tiers.map((row) => (
            <div key={row.name} className={row.name === tier.name ? "on" : ""}>
              <b>{t(row.name)}</b>
              <small>{row.min ? t("ตั้งแต่ {{value0}} ฿", { value0: money(row.min) }) : t("เริ่มต้น")}</small>
              {row.benefits.length ? <ul>{row.benefits.map((benefit) => <li key={benefit}>{t(benefit)}</li>)}</ul> : null}
            </div>
          ))}
          {!tier.benefits.length ? <p className="slot-footnote">{t("สิทธิประโยชน์ของแต่ละระดับประกาศโดยคลับ")}</p> : null}
        </section>
      ) : null}
      <div className="status-balances">
        <button type="button" onClick={onRewards}><b>{money(coinBalance)}</b><small>{t("Coin สะสม · แลกรางวัล")}</small></button>
        <button type="button" onClick={onHistory}><b>{money(pointBalance)}</b><small>{t("คะแนน · ประวัติธุรกรรม")}</small></button>
      </div>
      <h2 className="status-heading">{t("ระดับฝีมือกีฬา (Skill Rating)")}</h2>
      {ratings.length ? (
        <div className="skill-matrix" role="table" aria-label={t("ระดับฝีมือกีฬา (Skill Rating)")}>
          <div role="row" className="head"><span role="columnheader">{t("กีฬา")}</span><span role="columnheader">{t("ระดับ")}</span><span role="columnheader">{t("คะแนน")}</span><span role="columnheader">{t("ชนะ–แพ้")}</span></div>
          {ratings.map((row) => (
            <div role="row" key={row.sportId}>
              <span role="cell">{row.icon} {t(row.name)}</span>
              <span role="cell"><em className="level-badge">{t(row.tier)}</em></span>
              <span role="cell">{money(row.rating)}</span>
              <span role="cell">{row.wins}–{row.losses}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="skill-empty">
          <p>{t("ยังไม่มีคะแนน เข้าร่วม Buffet Rank เพื่อเริ่มสะสมคะแนนฝีมือ")}</p>
          <button type="button" className="ghost" onClick={onBuffetRank}>{t("ไปที่ Buffet Rank")}</button>
        </div>
      )}
      <section className="tier-ladder skill" aria-label={t("เกณฑ์ระดับฝีมือ")}>
        {tiers.map((row) => <div key={row.name}><b>{t(row.name)}</b><small>{t("{{value0}} คะแนนขึ้นไป", { value0: money(row.min) })}</small></div>)}
      </section>
      <p className="slot-footnote">{t("คะแนนเริ่มต้น 1,000 · ชนะคู่ที่เก่งกว่าได้คะแนนมากกว่า (ELO) · เจ้าหน้าที่บันทึกผลทุกเกม")}</p>
    </div>
  );
}

type PaymentRow = { id: number; paymentNo: string; method: string; amount: number; status: string; createdAt: string; paidAt: string | null; itemName: string | null; itemType: string | null; refundStatus: string | null; refundTo: string | null; cancelReason: string | null };
type CoinRow = { id: number; kind: string; coinDelta: number; note: string | null; createdAt: string };
type Filter = "all" | "payments" | "topups" | "refunds" | "coins";

const methodLabels: Record<string, string> = { wallet: "เครดิตในแอป", promptpay: "พร้อมเพย์", cash: "เงินสด", card: "บัตร", line_pay: "LINE Pay" };
const statusLabels: Record<string, string> = { paid: "สำเร็จ", created: "รอยืนยัน", cancelled: "ยกเลิก", refunded: "คืนเงินแล้ว", failed: "ไม่สำเร็จ" };

function when(value: string | null) {
  if (!value) return "";
  const time = Date.parse(value.includes("T") || value.endsWith("Z") ? value : `${value.replace(" ", "T")}+07:00`);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleString(localeTag(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}

async function fetchHistory(kind: Filter, before: number | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ kind, ...(before ? { before: String(before) } : {}) });
  const response = await fetch(`/api/wallet/history?${params}`, { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("load");
  return response.json() as Promise<{ payments?: PaymentRow[]; coins?: CoinRow[]; next: number | null }>;
}

export function TransactionHistoryScreen({ onBack }: { onBack: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<(PaymentRow | CoinRow)[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const apply = useCallback((kind: Filter, before: number | null, body: { payments?: PaymentRow[]; coins?: CoinRow[]; next: number | null }) => {
    const list = (kind === "coins" ? body.coins : body.payments) || [];
    setRows((current) => (before ? [...current, ...list] : list));
    setNext(body.next);
    setState("ready");
  }, []);
  // First page of the chosen filter (again after "ลองใหม่").
  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(filter, null, controller.signal).then((body) => apply(filter, null, body)).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [filter, attempt, apply]);
  const more = () => {
    if (!next) return;
    setState("loading");
    fetchHistory(filter, next).then((body) => apply(filter, next, body)).catch(() => setState("error"));
  };
  const choose = (value: Filter) => {
    setRows([]);
    setNext(null);
    setState("loading");
    setFilter(value);
  };
  return (
    <div className="page history-page">
      <Top title={t("ประวัติธุรกรรม")} icon="🧾" onBack={onBack} />
      <TabBar label={t("ประเภทธุรกรรม")} value={filter} onChange={choose} tabs={[["all", t("ทั้งหมด")], ["payments", t("ชำระเงิน")], ["topups", t("เติมเงิน")], ["refunds", t("คืนเงิน")], ["coins", "Coin"]]} />
      <div className="history-list">
        {rows.map((row) => ("coinDelta" in row ? (
          <article key={`c-${row.id}`} className="history-row">
            <span><b>{t(row.note) || (row.coinDelta > 0 ? t("ได้รับ Coin") : t("ใช้ Coin"))}</b><small>{when(row.createdAt)}</small></span>
            <strong className={row.coinDelta > 0 ? "plus" : "minus"}>{row.coinDelta > 0 ? "+" : ""}{row.coinDelta} Coin</strong>
          </article>
        ) : (
          <article key={`p-${row.id}`} className="history-row">
            <span>
              <b>{t(row.itemName) || row.paymentNo}</b>
              <small>{when(row.paidAt || row.createdAt)} · {t(methodLabels[row.method] || row.method)}{row.refundTo === "wallet" ? ` · ${t("คืนเข้าเครดิตในแอป")}` : ""}</small>
              {row.cancelReason && row.status !== "paid" ? <small>{t(row.cancelReason)}</small> : null}
            </span>
            <strong className={row.itemType === "wallet_topup" ? "plus" : "minus"}>{row.itemType === "wallet_topup" ? "+" : "-"}{money(row.amount)} ฿</strong>
            <em className={`history-status ${row.status}`}>{t(statusLabels[row.status] || row.status)}</em>
          </article>
        )))}
        {state === "ready" && !rows.length ? <Empty text={t("ยังไม่มีธุรกรรม")} /> : null}
      </div>
      {state === "loading" ? <LoadingNote text={t("กำลังโหลดข้อมูล")} /> : null}
      {state === "error" ? <div role="alert" className="calendar-error">{t("โหลดข้อมูลไม่สำเร็จ")}<button type="button" onClick={() => { setRows([]); setState("loading"); setAttempt((value) => value + 1); }}>{t("ลองใหม่")}</button></div> : null}
      {next && state === "ready" ? <button type="button" className="ghost" onClick={more}>{t("โหลดเพิ่ม")}</button> : null}
    </div>
  );
}
