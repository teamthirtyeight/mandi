// In-app notifications for buyers and sellers, written at each step of an
// order. Sellers get them in their language (Hindi for Meera) with rupees.
// The bell in the nav shows them and, with permission, the browser raises a
// system notification. Failures here never block the money flow.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { gbpInr, inr } from "@/lib/fx";

export type OrderEvent = "held" | "captured" | "refunded" | "refund_pending" | "voided";

const gbp = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

async function parties(orderId: string) {
  const [row] = await db
    .select({
      order: schema.orders,
      title: schema.listings.title,
      sellerId: schema.sellers.id,
      language: schema.sellers.language,
      shipByDays: schema.sellers.shipByDays,
      buyerUserId: schema.mandates.buyerUserId,
    })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .where(eq(schema.orders.id, orderId));
  if (!row) return null;
  const sellerUsers = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.sellerId, row.sellerId));
  return { ...row, sellerUserIds: sellerUsers.map((u) => u.id) };
}

function sellerText(e: OrderEvent, hi: boolean, title: string, amountMinor: number, extraMinor: number, shipByDays: number, rate: number) {
  const money = `${inr(amountMinor / 100, rate)} (${gbp(amountMinor)})`;
  const extra = `${inr(extraMinor / 100, rate)} (${gbp(extraMinor)})`;
  if (hi) {
    switch (e) {
      case "held":
        return { title: `बिक गया! ${money}`, body: `${title} — कृपया ${shipByDays} दिन में भेजें। पैसा PayPal में सुरक्षित है।` };
      case "captured":
        return { title: `भुगतान मिल गया: ${money}`, body: title };
      case "refund_pending":
        return { title: `${extra} रिफंड की मंज़ूरी चाहिए`, body: `${title} — खरीदार ने शिकायत की है।` };
      case "refunded":
        return { title: `रिफंड किया: ${extra}`, body: title };
      case "voided":
        return { title: "होल्ड रद्द हुआ", body: `${title} — समय पर नहीं भेजा गया; खरीदार से पैसा नहीं लिया गया।` };
    }
  }
  switch (e) {
    case "held":
      return { title: `Sold for ${money}!`, body: `${title}. Please ship within ${shipByDays} days; the money is held by PayPal.` };
    case "captured":
      return { title: `Payment received: ${money}`, body: title };
    case "refund_pending":
      return { title: `Approve a ${extra} refund?`, body: `${title}: the buyer reported a problem.` };
    case "refunded":
      return { title: `Refunded ${extra}`, body: title };
    case "voided":
      return { title: "Hold released", body: `${title}: not shipped in time, so the buyer wasn't charged.` };
  }
}

function buyerText(e: OrderEvent, title: string, amountMinor: number, extraMinor: number, tracking: string | null) {
  switch (e) {
    case "held":
      return { title: `${gbp(amountMinor)} held`, body: `${title}. Nothing is paid until the seller ships.` };
    case "captured":
      return { title: "Shipped!", body: `${title}${tracking ? `, tracking ${tracking}` : ""}. Your payment went through.` };
    case "refunded":
      return { title: `Refund: ${gbp(extraMinor)}`, body: `${title}. It's on its way back to your PayPal account.` };
    case "voided":
      return { title: "Order cancelled", body: `${title}: the seller couldn't ship in time. You weren't charged.` };
    case "refund_pending":
      return null; // the buyer already sees "waiting for the seller" on the order page
  }
}

/** Notifies both sides of an order event. extraMinor = refund amount. */
export async function notifyOrder(orderId: string, event: OrderEvent, extraMinor = 0): Promise<void> {
  try {
    const p = await parties(orderId);
    if (!p) return; // test orders have no buyer or seller
    const link = `/order/${orderId}`;
    const rows: (typeof schema.notifications.$inferInsert)[] = [];
    const { rate } = await gbpInr();
    const s = sellerText(event, p.language === "hi", p.title, p.order.amountMinor, extraMinor, p.shipByDays, rate);
    for (const userId of p.sellerUserIds) rows.push({ userId, ...s, link: event === "held" ? "/seller" : link });
    const b = buyerText(event, p.title, p.order.amountMinor, extraMinor, p.order.trackingNumber);
    if (b && p.buyerUserId) rows.push({ userId: p.buyerUserId, ...b, link });
    if (rows.length) await db.insert(schema.notifications).values(rows);
  } catch (err) {
    console.error("[notify] failed", err);
  }
}

export async function notifyUser(userId: string | null, title: string, body: string, link: string): Promise<void> {
  if (!userId) return;
  try {
    await db.insert(schema.notifications).values({ userId, title, body, link });
  } catch (err) {
    console.error("[notify] failed", err);
  }
}
