// Made-to-order pieces ("commissions"), billed with a PayPal invoice.
//
// 1. A buyer describes what they want on a product page.
// 2. The seller's agent quotes a price and time. Code keeps the price at or
//    above the listing's private floor (the agent never sees the floor).
// 3. The artisan approves on WhatsApp ("हाँ") or in the dashboard.
// 4. Only then does Mandix's code create and send a PayPal invoice (Agent
//    Toolkit create_invoice + send_invoice). The buyer pays it in PayPal.
// 5. When PayPal says it's paid, the seller is paid out (lib/orders/payout.ts).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { structured } from "@/lib/ai/claude";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/lib/guardrails";
import { gbpInr, inr } from "@/lib/fx";
import { sellerLanguage, SELLER_STRINGS } from "@/lib/i18n/seller";
import { WHATSAPP_REPLIES } from "@/lib/i18n/whatsapp";
import { appUrl, notifyUser } from "@/lib/notify";
import { createPayout } from "@/lib/paypal/rest";
import { runPlatformTool } from "@/lib/paypal/toolkit";
import { feePct, payoutSplit } from "@/lib/orders/payout-split";
import { sendWhatsApp } from "@/lib/whatsapp";

export class CommissionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

const gbp = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

const Quote = z.object({
  priceMinor: z.number().int().describe("Price in pence for the custom piece."),
  readyInDays: z.number().int().min(1).max(120),
  message: z.string().describe("Two short, warm sentences to the buyer about how the piece will be made. No prices or numbers of pounds."),
});

/** The seller agent's quote, with the floor enforced by code. Pure apart from the model call. */
export async function quoteCommission(input: {
  request: string;
  listing: { title: string; description: string; materials: string; listPriceMinor: number; floorPriceMinor: number };
  seller: { name: string; craft: string | null; story: string; shipByDays: number };
}) {
  const out = await structured({
    label: "commission-quote",
    schema: Quote,
    system: `You are the sales agent for ${input.seller.name}, an artisan${input.seller.craft ? ` (${input.seller.craft})` : ""}. A buyer wants a custom piece based on one of their listings.
Listing: ${input.listing.title}. ${input.listing.description} Materials: ${input.listing.materials}. Listed at ${gbp(input.listing.listPriceMinor)}.
Seller's story: ${input.seller.story}
Quote a fair price for the custom piece: start from the listed price and add for extra size, colours or work the buyer asks for. Give realistic making time, at least ${input.seller.shipByDays + 5} days.
${UNTRUSTED_DATA_RULE}`,
    content: wrapUntrusted("buyer_request", input.request),
  });
  // No usable quote: the listed price, standard time.
  const fallback = { priceMinor: input.listing.listPriceMinor, readyInDays: input.seller.shipByDays + 10, message: `${input.seller.name} will make this for you by hand.` };
  const q = out ?? fallback;
  // Guardrail: a quote below the floor, or absurdly high, is replaced with the listed price.
  const price =
    q.priceMinor >= input.listing.floorPriceMinor && q.priceMinor <= input.listing.listPriceMinor * 4 ? q.priceMinor : input.listing.listPriceMinor;
  const message = /£|\d{2,}/.test(q.message) ? fallback.message : q.message;
  return { priceMinor: price, readyInDays: q.readyInDays, message, source: out ? "agent" : "fallback" };
}

export async function requestCommission(input: { listingId: string; buyerUserId: string; request: string }) {
  const [row] = await db
    .select({ listing: schema.listings, seller: schema.sellers })
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.listings.id, input.listingId));
  if (!row) throw new CommissionError("Listing not found", 404);

  const quote = await quoteCommission({ request: input.request, listing: row.listing, seller: row.seller });
  const [c] = await db
    .insert(schema.commissions)
    .values({
      listingId: row.listing.id,
      sellerId: row.seller.id,
      buyerUserId: input.buyerUserId,
      request: input.request,
      priceMinor: quote.priceMinor,
      currency: row.listing.currency,
      readyInDays: quote.readyInDays,
      agentNote: quote.message,
      status: "AWAITING_SELLER",
    })
    .returning();

  // Ask the artisan, in their language.
  const lang = sellerLanguage(row.seller.language);
  const { rate } = await gbpInr();
  const amount = `${inr(quote.priceMinor / 100, rate)} (${gbp(quote.priceMinor)})`;
  const ask = WHATSAPP_REPLIES[lang].commissionAsk(input.request.slice(0, 200), amount, quote.readyInDays);
  const sellerUsers = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.sellerId, row.seller.id));
  for (const u of sellerUsers) await notifyUser(u.id, ask.split("\n")[0], ask.split("\n").slice(1).join(" "), "/dashboard?tab=commissions");
  if (row.seller.whatsappOptIn && row.seller.whatsappNumber) {
    await sendWhatsApp({ sellerId: row.seller.id, to: row.seller.whatsappNumber, body: `${ask}\n\n${SELLER_STRINGS[lang].open}: ${appUrl()}/dashboard` }).catch(
      (err) => console.error("[commission] whatsapp failed", err),
    );
  }
  return c;
}

async function claim(id: string, from: string, to: string) {
  const [c] = await db
    .update(schema.commissions)
    .set({ status: to })
    .where(and(eq(schema.commissions.id, id), eq(schema.commissions.status, from)))
    .returning();
  if (!c) throw new CommissionError("This request has already been answered");
  return c;
}

/** Artisan said yes: create and send the PayPal invoice. */
export async function approveCommission(id: string) {
  const c = await claim(id, "AWAITING_SELLER", "INVOICING");
  try {
    const [row] = await db
      .select({ listing: schema.listings, seller: schema.sellers, buyer: schema.users })
      .from(schema.commissions)
      .innerJoin(schema.listings, eq(schema.listings.id, schema.commissions.listingId))
      .innerJoin(schema.sellers, eq(schema.sellers.id, schema.commissions.sellerId))
      .innerJoin(schema.users, eq(schema.users.id, schema.commissions.buyerUserId))
      .where(eq(schema.commissions.id, id));
    const value = (c.priceMinor / 100).toFixed(2);
    const created = await runPlatformTool<{ id?: string; href?: string; links?: { href: string; rel: string }[] }>(
      "create_invoice",
      {
        currency_code: c.currency,
        invoice_number: `MANDI-${id.slice(0, 8).toUpperCase()}`,
        reference: `commission-${id}`,
        note: `Made to order by ${row.seller.name}, ${row.seller.city}. Ready in about ${c.readyInDays} days. PayPal Buyer Protection applies.`,
        invoicer_business_name: "Mandix",
        primary_recipients: [{ billing_info: { email_address: row.buyer.email, name: { given_name: row.buyer.name } } }],
        items: [
          {
            name: `Custom: ${row.listing.title}`.slice(0, 200),
            description: c.request.slice(0, 1000),
            quantity: "1",
            unit_amount: { currency_code: c.currency, value },
          },
        ],
      },
      { label: `commission ${id.slice(0, 8)}` },
    );
    const invoiceId = created.id ?? created.href?.split("/").pop() ?? created.links?.find((l) => l.rel === "self")?.href.split("/").pop();
    if (!invoiceId) throw new CommissionError("PayPal returned no invoice id", 502);

    const sent = await runPlatformTool<{ href?: string; links?: { href: string; rel: string }[] }>(
      "send_invoice",
      { invoice_id: invoiceId, note: `Hello ${row.buyer.name}, ${row.seller.name} has accepted your request. Pay here and they'll start making it.` },
      { label: `commission ${id.slice(0, 8)}` },
    );
    const payerView = sent.links?.find((l) => l.rel === "payer-view")?.href ?? sent.href ?? (await invoicePayerUrl(invoiceId));

    const [done] = await db
      .update(schema.commissions)
      .set({ status: "INVOICED", invoiceId, invoiceUrl: payerView ?? null })
      .where(eq(schema.commissions.id, id))
      .returning();
    await notifyUser(
      c.buyerUserId,
      `${row.seller.name} accepted your custom order`,
      `${gbp(c.priceMinor)}, ready in about ${c.readyInDays} days. Pay the PayPal invoice to start.`,
      "/orders",
    );
    return done;
  } catch (err) {
    // Put it back so the artisan can try again.
    await db.update(schema.commissions).set({ status: "AWAITING_SELLER" }).where(eq(schema.commissions.id, id));
    throw err;
  }
}

async function invoicePayerUrl(invoiceId: string): Promise<string | null> {
  try {
    const inv = await runPlatformTool<{ detail?: { metadata?: { recipient_view_url?: string } } }>("get_invoice", { invoice_id: invoiceId }, { label: "payer link" });
    return inv.detail?.metadata?.recipient_view_url ?? null;
  } catch {
    return null;
  }
}

export async function declineCommission(id: string) {
  const c = await claim(id, "AWAITING_SELLER", "DECLINED");
  const [seller] = await db.select({ name: schema.sellers.name }).from(schema.sellers).where(eq(schema.sellers.id, c.sellerId));
  await notifyUser(c.buyerUserId, `${seller?.name ?? "The maker"} can't take this custom order`, "You haven't been charged anything.", "/orders");
  return c;
}

/**
 * Checks an invoiced commission with PayPal (get_invoice). When it's paid,
 * marks it PAID and pays the seller their share. Safe to call repeatedly.
 */
export async function refreshCommission(id: string) {
  const [c] = await db.select().from(schema.commissions).where(eq(schema.commissions.id, id));
  if (!c || c.status !== "INVOICED" || !c.invoiceId) return c ?? null;
  const inv = await runPlatformTool<{ status?: string }>("get_invoice", { invoice_id: c.invoiceId }, { label: `check ${id.slice(0, 8)}` });
  if (inv.status !== "PAID" && inv.status !== "MARKED_AS_PAID") return c;
  return markCommissionPaid(id);
}

export async function markCommissionPaid(id: string) {
  const [paid] = await db
    .update(schema.commissions)
    .set({ status: "PAID" })
    .where(and(eq(schema.commissions.id, id), eq(schema.commissions.status, "INVOICED")))
    .returning();
  if (!paid) {
    const [c] = await db.select().from(schema.commissions).where(eq(schema.commissions.id, id));
    return c ?? null;
  }
  const [seller] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, paid.sellerId));
  const split = payoutSplit({ capturedMinor: paid.priceMinor, refundedMinor: 0, debtMinor: 0, feePct: feePct() });
  try {
    await createPayout({
      senderBatchId: `mandi-commission-${id}`,
      receiverEmail: seller.paypalMerchantEmail,
      amountMinor: split.payoutMinor,
      currency: paid.currency,
      subject: "Mandix: custom order paid",
      note: `Your share of a custom order, after Mandix's ${feePct()}% fee.`,
    });
    const lang = sellerLanguage(seller.language);
    const { rate } = await gbpInr();
    const t = SELLER_STRINGS[lang];
    if (seller.whatsappOptIn && seller.whatsappNumber) {
      await sendWhatsApp({ sellerId: seller.id, to: seller.whatsappNumber, body: `*${t.paidOut(inr(split.payoutMinor / 100, rate))}*\n${t.paidOutBody}` });
    }
  } catch (err) {
    console.error("[commission] payout failed", id, err);
  }
  await notifyUser(paid.buyerUserId, "Custom order paid", `${seller.name} has been told to start making it.`, "/orders");
  return paid;
}
