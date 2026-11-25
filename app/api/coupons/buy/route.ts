import { NextResponse } from "next/server";
import { z } from "zod";
import { assertApiUser, authErrorResponse } from "@/lib/auth";
import { createPublicId, pool } from "@/lib/db";
import { checkRateLimit, clientIp, parseJsonBody, validationErrorResponse } from "@/lib/security";
import { findPaymentByRequest, isDuplicateEntry, requestIdPattern } from "@/lib/wallet";
import { couponMeta } from "@/lib/class-programs";
import { parseMeta } from "@/lib/package-presentation";
import { activeDiscount, couponScope, priceWithDiscount } from "@/lib/promotions";

const schema = z.object({ couponId: z.number().int().positive(), method: z.enum(["wallet", "promptpay"]).default("wallet"), requestId: z.string().regex(requestIdPattern).optional() });

export async function POST(req: Request) {
  const limited = checkRateLimit({ key: `coupon-buy:${await clientIp()}`, limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  let user;
  try {
    user = await assertApiUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  let input: z.infer<typeof schema>;
  try {
    input = await parseJsonBody(req, schema);
  } catch (error) {
    return validationErrorResponse(error);
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const replay = await findPaymentByRequest(conn, user.id, input.requestId);
    if (replay) {
      await conn.rollback();
      return NextResponse.json({ ok: true, ...replay, replayed: true });
    }
    const [couponRows] = await conn.execute(
      "SELECT id, price, total_uses totalUses, validity_days validityDays, name, CAST(metadata AS CHAR) metadata FROM coupons WHERE id = ? AND active = TRUE LIMIT 1 FOR UPDATE",
      [input.couponId],
    );
    const coupon = (couponRows as { id: number; price: number; totalUses: number; validityDays: number; name: string; metadata?: string | null }[])[0];
    const terms = couponMeta(coupon || {});
    if (!coupon || parseMeta(coupon.metadata).grantOnly === true) {
      await conn.rollback();
      return NextResponse.json({ message: "ไม่พบคูปอง" }, { status: 404 });
    }
    // A trial pack each member may buy once (bought before, or a purchase still waiting for payment).
    if (terms.oncePerMember) {
      const [owned] = await conn.execute(
        "SELECT id FROM user_coupons WHERE user_id = ? AND coupon_id = ? UNION ALL SELECT id FROM payments WHERE user_id = ? AND status IN ('created','paid') AND JSON_VALUE(metadata, '$.couponId') = ? LIMIT 1",
        [user.id, coupon.id, user.id, String(coupon.id)],
      );
      if ((owned as unknown[]).length) {
        await conn.rollback();
        return NextResponse.json({ message: "แพ็กเกจทดลองนี้ซื้อได้คนละ 1 ครั้ง" }, { status: 409 });
      }
    }
    // A weekly discount deal the member claimed takes its percent off coupon packs in its scope (the
    // Fitness/Swim coupon tab, or the service of the class a pack is for).
    const read = async (sql: string, params?: unknown[]) => {
      const [rows] = await conn.execute(sql, params as never);
      return Array.isArray(rows) ? rows : [];
    };
    let programService: string | null = null;
    if (terms.program) {
      const [program] = await read("SELECT CAST(metadata AS CHAR) metadata FROM app_content_items WHERE content_type = 'class_program' AND slug = ? LIMIT 1", [terms.program]) as { metadata: string | null }[];
      const service = parseMeta(program?.metadata).service;
      programService = typeof service === "string" ? service : null;
    }
    const scope = couponScope(coupon, programService);
    const priced = priceWithDiscount(Number(coupon.price), scope, scope ? await activeDiscount(read, user.id) : null);
    const price = priced.amount;
    const paymentNo = createPublicId("PAY");
    const paid = input.method === "wallet";
    // Snapshot the coupon terms so a later staff approval grants what the member saw.
    const metadata = { itemName: coupon.name, itemType: "coupon", couponId: coupon.id, totalUses: Number(coupon.totalUses), validityDays: Number(coupon.validityDays), ...(priced.discount ? { discount: priced.discount } : {}) };
    const [payment] = await conn.execute(
      "INSERT INTO payments (payment_no, user_id, method, amount, status, provider_ref, request_id, metadata, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? = 'paid', NOW(), NULL))",
      [paymentNo, user.id, input.method, price, paid ? "paid" : "created", createPublicId("REF"), input.requestId || null, JSON.stringify(metadata), paid ? "paid" : "created"],
    );
    const paymentId = (payment as { insertId: number }).insertId;
    if (input.method === "wallet") {
      const [walletRows] = await conn.execute("SELECT balance FROM wallet_accounts WHERE user_id = ? FOR UPDATE", [user.id]);
      const balance = Number((walletRows as { balance: number }[])[0]?.balance ?? 0);
      if (balance < price) {
        await conn.rollback();
        return NextResponse.json({ message: "ยอดเงินใน Wallet ไม่พอ" }, { status: 409 });
      }
      await conn.execute("UPDATE wallet_accounts SET balance = balance - ?, coin_balance = coin_balance + 1, point_balance = point_balance + ? WHERE user_id = ?", [
        price,
        Math.floor(price),
        user.id,
      ]);
      await conn.execute(
        "INSERT INTO wallet_ledger (user_id, kind, amount, coin_delta, point_delta, ref_type, ref_id, note) VALUES (?, 'payment', ?, 1, ?, 'payment', ?, ?)",
        [user.id, -price, Math.floor(price), paymentId, `ซื้อคูปอง ${coupon.name}`],
      );
      await conn.execute(
        "INSERT INTO user_coupons (user_id, coupon_id, total_uses, payment_id, remaining_uses, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))",
        [user.id, coupon.id, coupon.totalUses, paymentId, coupon.totalUses, coupon.validityDays],
      );
    }
    await conn.commit();
    return NextResponse.json({ ok: true, paymentNo, status: input.method === "wallet" ? "paid" : "created", amount: price, ...(priced.discount ? { discount: priced.discount } : {}) });
  } catch (error) {
    await conn.rollback();
    const winner = isDuplicateEntry(error) ? await findPaymentByRequest(conn, user.id, input.requestId) : null;
    if (winner) return NextResponse.json({ ok: true, ...winner, replayed: true });
    throw error;
  } finally {
    conn.release();
  }
}
