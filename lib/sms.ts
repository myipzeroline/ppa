// Text messages for one-time codes (PPA Member verification, part 12). Off until configured:
//   SMS_PROVIDER=thaibulksms  SMS_API_KEY, SMS_API_SECRET, SMS_SENDER (ThaiBulkSMS API v2; SMS_API_URL
//                             overrides https://api-v2.thaibulksms.com/sms)
//   SMS_PROVIDER=webhook      SMS_WEBHOOK_URL (+ SMS_WEBHOOK_TOKEN sent as a Bearer token) receives
//                             {"to": "0812345678", "message": "..."} and sends it with any provider.
// Without a provider, development shows the code on screen; production refuses to send.

export type SmsResult = { sent: true } | { sent: false; reason: "not_configured" | "failed" };

export function smsProvider() {
  const provider = (process.env.SMS_PROVIDER || "").toLowerCase();
  if (provider === "thaibulksms" && process.env.SMS_API_KEY && process.env.SMS_API_SECRET) return "thaibulksms";
  if (provider === "webhook" && /^https:\/\//.test(process.env.SMS_WEBHOOK_URL || "")) return "webhook";
  return null;
}

// 0812345678 / +66812345678 / 081-234-5678 → 0812345678; null when it is not a Thai mobile number.
export function thaiMobile(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  const local = digits.startsWith("+66") ? `0${digits.slice(3)}` : digits.startsWith("66") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  return /^0[689]\d{8}$/.test(local) ? local : null;
}

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const provider = smsProvider();
  const to = thaiMobile(phone);
  if (!provider || !to) return { sent: false, reason: "not_configured" };
  try {
    if (provider === "thaibulksms") {
      const auth = Buffer.from(`${process.env.SMS_API_KEY}:${process.env.SMS_API_SECRET}`).toString("base64");
      const body = new URLSearchParams({ msisdn: to, message, ...(process.env.SMS_SENDER ? { sender: process.env.SMS_SENDER } : {}) });
      const response = await fetch(process.env.SMS_API_URL || "https://api-v2.thaibulksms.com/sms", {
        method: "POST",
        headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return response.ok ? { sent: true } : { sent: false, reason: "failed" };
    }
    const response = await fetch(process.env.SMS_WEBHOOK_URL!, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.SMS_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ to, message }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? { sent: true } : { sent: false, reason: "failed" };
  } catch {
    return { sent: false, reason: "failed" };
  }
}
