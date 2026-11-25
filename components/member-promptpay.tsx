"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { money, Top, LoadingNote } from "@/components/member-ui";
import { localeTag, t } from "@/lib/i18n";

type PromptPayQr = { paymentNo: string; amount: number; itemName?: string | null; qr: string | null; qrExpired?: boolean; qrExpiresIn?: number | null; payee: { name: string; account: string }; slipUploadedAt?: string | null; holdSeconds?: number | null; original?: number | null };
type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: PromptPayQr; expiresAt: number | null }
  | { status: "expired" }
  | { status: "unconfigured" }
  | { status: "closed" }
  | { status: "error" };

// แก้ 6: "สแกนชำระเงิน" — the amount, the item, the PromptPay QR of PPA Power Play Sport Club, how long
// the QR is valid ("QR หมดอายุใน 04:56") and a button to save the QR. The member then attaches the
// transfer slip for staff to confirm (rights are granted only after confirmation). A court or class
// booking shows its 15-minute hold; a package QR lasts 15 minutes and can be issued again.
const clock = (time: number) => new Date(time).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const countdown = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function readyState(data: PromptPayQr): LoadState {
  // A booking's QR lasts as long as its hold (servers before the QR window only sent holdSeconds).
  const seconds = typeof data.qrExpiresIn === "number" ? data.qrExpiresIn : typeof data.holdSeconds === "number" ? data.holdSeconds : null;
  return { status: "ready", data, expiresAt: seconds !== null && seconds > 0 ? Date.now() + seconds * 1000 : null };
}

export function PromptPayScreen({ paymentNo, onBack, onDone }: { paymentNo: string; onBack: () => void; onDone: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/payments/promptpay?paymentNo=${encodeURIComponent(paymentNo)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (response.ok) {
          setState(readyState(body as PromptPayQr));
          setUploaded(Boolean(body.slipUploadedAt));
        } else if (response.status === 409 && body.code === "BOOKING_EXPIRED") setState({ status: "expired" });
        else if (response.status === 404 && body.code === "PROMPTPAY_NOT_CONFIGURED") setState({ status: "unconfigured" });
        else if (response.status === 409) setState({ status: "closed" });
        else setState({ status: "error" });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [paymentNo, revision]);

  // The countdown runs while the QR is on screen.
  const expiresAt = state.status === "ready" ? state.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - tick) / 1000)) : null;
  const ready = state.status === "ready" ? state.data : null;
  const isBooking = typeof ready?.holdSeconds === "number";
  const qrGone = Boolean(ready && (ready.qrExpired || !ready.qr || (secondsLeft === 0 && !uploaded)));

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setMessage("ไฟล์สลิปต้องไม่เกิน 5 MB");
      return;
    }
    setUploading(true);
    setMessage("");
    const form = new FormData();
    form.set("paymentNo", paymentNo);
    form.set("file", file);
    try {
      const response = await fetch("/api/payments/slip", { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(response.status === 413 ? "ไฟล์สลิปต้องไม่เกิน 5 MB" : body.message || "อัปโหลดสลิปไม่สำเร็จ");
        return;
      }
      setUploaded(true);
      setMessage(body.bookingHeld ? "ส่งสลิปแล้ว สนามถูกกันไว้ให้จนกว่าเจ้าหน้าที่จะยืนยัน" : "ส่งสลิปแล้ว เจ้าหน้าที่จะตรวจสอบและยืนยันโดยเร็ว");
    } catch {
      setMessage("network.error");
    } finally {
      setUploading(false);
    }
  }

  async function renewQr() {
    if (renewing) return;
    setRenewing(true);
    setMessage("");
    try {
      const response = await fetch("/api/payments/promptpay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentNo }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setState(readyState(body as PromptPayQr));
      else if (response.status === 409) setState({ status: "closed" });
      else setMessage(body.message || "สร้าง QR ใหม่ไม่สำเร็จ");
    } catch {
      setMessage("network.error");
    } finally {
      setRenewing(false);
    }
  }

  const slipInput = (
    <label className={uploaded ? "slip-upload done" : "slip-upload"}>
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      <span>{uploading ? t("กำลังอัปโหลด...") : uploaded ? t("✓ ส่งสลิปแล้ว (แตะเพื่อเปลี่ยนรูป)") : t("📎 แนบสลิปการโอน")}</span>
    </label>
  );
  const slipMessage = message ? <p role="status" className="slip-message">{t(message)}</p> : null;

  return (
    <div className="page pay-qr-page">
      <Top title={t("สแกนชำระเงิน")} onBack={onBack} />
      {state.status === "loading" ? (
        <div className="pay-qr-card pay-qr-loading">
          <i className="sk sk-line" aria-hidden="true" />
          <i className="sk sk-line title" aria-hidden="true" />
          <i className="sk sk-qr pay" aria-hidden="true" />
          <LoadingNote text={t("กำลังโหลด QR...")} />
        </div>
      ) : null}
      {ready ? (
        <>
          <div className="pay-scan">
            <span className="pay-scan-label">{t("ยอดชำระ")}</span>
            <strong className="pay-scan-amount">{money(ready.amount)} ฿</strong>
            {ready.original ? <small className="pay-scan-discount">{t("ลดแล้วจาก {{value0}} ฿ (ดีลประจำสัปดาห์)", { value0: money(ready.original) })}</small> : null}
            {ready.itemName ? <small className="pay-scan-item">{t(ready.itemName)}</small> : null}
            {ready.qr && !qrGone ? (
              <div className="pay-scan-qr"><Image unoptimized width={240} height={240} className="pay-qr-image" alt={t("QR พร้อมเพย์สำหรับชำระเงิน")} src={ready.qr} /></div>
            ) : (
              <div className="pay-scan-qr expired" role="status">
                <b>{t("QR หมดอายุแล้ว")}</b>
                <small>{isBooking ? t("หมดเวลาชำระของการจองนี้แล้ว") : t("กดสร้าง QR ใหม่เพื่อชำระยอดเดิม")}</small>
              </div>
            )}
            <div className="pay-scan-payee"><span className="pay-scan-brand">PromptPay</span><small>{ready.payee.name || t("พร้อมเพย์ {{value0}}", { value0: ready.payee.account })}</small></div>
            {secondsLeft !== null && !uploaded && !qrGone ? <p className="pay-scan-expiry">{t("QR หมดอายุใน")} <b>{countdown(secondsLeft)}</b></p> : null}
            <small className="pay-scan-ref">{t("พร้อมเพย์ {{value0}}", { value0: ready.payee.account })} · {t("เลขที่รายการ {{value0}}", { value0: ready.paymentNo })}</small>
          </div>
          {qrGone && !isBooking && !uploaded ? <button type="button" className="primary" disabled={renewing} onClick={() => void renewQr()}>{renewing ? t("กำลังสร้าง QR...") : t("สร้าง QR ใหม่")}</button> : null}
          {ready.qr && !qrGone ? <a className="ghost pay-qr-save" href={ready.qr} download={`PPA-${ready.paymentNo}.png`}>{t("บันทึกรูป QR")}</a> : null}
          {ready.holdSeconds && !uploaded && expiresAt ? <p className="pay-deadline" role="note">{t("⏱ ชำระและแนบสลิปภายใน {{value0}} น. ระบบจะกันสนามไว้ให้จนเจ้าหน้าที่ยืนยัน", { value0: clock(expiresAt) })}</p> : null}
          {slipInput}
          {slipMessage}
          <p className="pay-scan-help">{t("สแกน QR หรือบันทึกรูปแล้วเปิดในแอปธนาคาร โอนยอดให้ตรง แล้วแนบสลิป เจ้าหน้าที่จะยืนยันและเปิดสิทธิ์ให้")}</p>
        </>
      ) : null}
      {state.status === "expired" ? (
        <>
          <div className="secure-note"><strong>{t("หมดเวลาชำระของการจองนี้แล้ว")}</strong><small>{t("กรุณาอย่าโอนเงินเพิ่ม หากโอนไปแล้วให้แนบสลิปด้านล่าง ระบบจะกันสนามให้หากช่วงเวลานั้นยังว่าง")}</small></div>
          {slipInput}
          {slipMessage}
        </>
      ) : null}
      {state.status === "unconfigured" ? (
        <div className="secure-note"><strong>{t("รอการยืนยัน")}</strong><small>{t("ระบบบันทึกรายการแล้ว กรุณาชำระที่เคาน์เตอร์หรือช่องทางที่เจ้าหน้าที่แจ้ง สิทธิ์จะเปิดเมื่อยืนยันการชำระเงิน")}</small></div>
      ) : null}
      {state.status === "closed" ? <div className="secure-note"><strong>{t("รายการนี้ไม่ได้รอชำระแล้ว")}</strong><small>{t("ได้รับการยืนยันหรือยกเลิกแล้ว ตรวจสอบได้ในรายการของฉัน")}</small></div> : null}
      {state.status === "error" ? <div role="alert" className="calendar-error">{t("โหลด QR ไม่สำเร็จ")}<button type="button" onClick={() => { setState({ status: "loading" }); setRevision((value) => value + 1); }}>{t("ลองใหม่")}</button></div> : null}
      <button type="button" className="ghost" onClick={onDone}>{t("👛 ดูสถานะในวอลเล็ต")}</button>
    </div>
  );
}
