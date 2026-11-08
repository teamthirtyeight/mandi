// Mandix as an MCP server, so a buyer's own AI assistant (Claude, ChatGPT,
// Cursor, any MCP client) can shop at Mandix: search, send Mandix's buyer agent
// to negotiate, follow the deal, check orders, ask for a custom piece.
//
// What it can't do is the point: no tool pays. Every deal ends with a link the
// human opens to approve the payment in PayPal, and PayPal holds the money
// until the piece ships. Floors and budgets never appear in any tool result.
//
// Transport: stateless JSON-RPC over HTTP POST (MCP "Streamable HTTP", JSON
// responses only), at /api/mcp/<key> or /api/mcp with "Authorization: Bearer <key>".
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, ilike, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { parseMandate } from "@/lib/agents/mandate";
import { openNegotiations } from "@/lib/negotiation/runner";
import { enqueue } from "@/lib/jobs/queue";
import { getMandateSnapshot } from "@/lib/negotiation/snapshot";
import { appUrl } from "@/lib/notify";
import { paypalOrderStatus } from "@/lib/reporting";
import { requestCommission } from "@/lib/commissions";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "mandix", title: "Mandix: handmade from India, bargained by agents", version: "1.0.0" };

type User = typeof schema.users.$inferSelect;

export function newApiKey() {
  return `mk_${randomBytes(24).toString("hex")}`;
}

export async function userForKey(key: string | null | undefined): Promise<User | null> {
  if (!key || !/^mk_[0-9a-f]{48}$/.test(key)) return null;
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.apiKey, key), eq(schema.users.role, "buyer")));
  return u ?? null;
}

const gbp = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

// ---- Tools ----

const TOOLS = [
  {
    name: "search_listings",
    title: "Search Mandix",
    description: "Search handmade pieces from artisans in India. Returns titles, makers, list prices in GBP and links. Prices are open to negotiation: use start_shopping to bargain.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, e.g. 'silk scarf' or 'block-printed tablecloth'." },
        max_price_gbp: { type: "number", description: "Optional: only pieces listed at or under this price." },
      },
      required: ["query"],
    },
  },
  {
    name: "start_shopping",
    title: "Send Mandix's buyer agent to negotiate",
    description:
      "Give one sentence with what to buy, the budget in £ and the deadline, e.g. 'silk scarf for my mum, under £90, by 20 Dec'. Mandix's buyer agent bargains with up to three artisans' agents and never goes over the budget. Returns a deal id; call get_deal after about a minute. Nothing is paid: the human approves the final deal in PayPal.",
    inputSchema: {
      type: "object",
      properties: { request: { type: "string", description: "One sentence: item, budget in £, deadline." } },
      required: ["request"],
    },
  },
  {
    name: "get_deal",
    title: "Follow a negotiation",
    description:
      "Status of a negotiation started with start_shopping: each seller's latest offers, agreed prices, and the recommended deal. When a deal is recommended, give the human the approve_url: they approve the payment in PayPal themselves, and PayPal holds it until the piece ships.",
    inputSchema: { type: "object", properties: { deal_id: { type: "string" } }, required: ["deal_id"] },
  },
  {
    name: "get_orders",
    title: "My orders",
    description: "The human's Mandix orders, with live status from PayPal (held, captured after shipping, refunded) and tracking.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "request_custom_piece",
    title: "Ask for a made-to-order piece",
    description:
      "Ask the artisan behind a listing to make something custom (colour, size, design). Their agent quotes; the artisan approves on WhatsApp; the human then gets a PayPal invoice to pay. Use a listing_id from search_listings.",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: { type: "string" },
        request: { type: "string", description: "What should be made, in a sentence or two." },
      },
      required: ["listing_id", "request"],
    },
  },
] as const;

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean };

const ok = (summary: string, data: unknown): ToolResult => ({ content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

async function searchListings(args: unknown): Promise<ToolResult> {
  const a = z.object({ query: z.string().min(1).max(200), max_price_gbp: z.number().positive().optional() }).safeParse(args);
  if (!a.success) return fail("Give a query, e.g. 'silk scarf'.");
  const words = a.data.query.split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
  const match = or(...words.flatMap((w) => [ilike(schema.listings.title, `%${w}%`), ilike(schema.listings.description, `%${w}%`), ilike(schema.listings.category, `%${w}%`)]));
  const rows = await db
    .select({ l: schema.listings, s: schema.sellers })
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(
      and(
        eq(schema.listings.status, "active"),
        gt(schema.listings.stock, 0),
        words.length ? match : undefined,
        a.data.max_price_gbp ? lte(schema.listings.listPriceMinor, Math.round(a.data.max_price_gbp * 100)) : undefined,
      ),
    )
    .limit(60);
  // Best matches first: words in the title count double.
  const score = (l: (typeof rows)[number]["l"]) =>
    words.reduce((n, w) => {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      return n + (re.test(l.title) ? 2 : 0) + (re.test(`${l.description} ${l.category}`) ? 1 : 0);
    }, 0);
  const ranked = rows
    .map((r) => ({ ...r, score: score(r.l) }))
    .sort((a, b) => b.score - a.score)
    .filter((r, _, all) => r.score >= Math.max(1, all[0].score / 2))
    .slice(0, 8);
  const items = ranked.map(({ l, s }) => ({
    listing_id: l.id,
    title: l.title,
    maker: `${s.name}, ${s.city}`,
    craft: s.craft,
    list_price: gbp(l.listPriceMinor),
    materials: l.materials,
    url: `${appUrl()}/listing/${l.id}`,
  }));
  return ok(items.length ? `${items.length} pieces found. List prices are where bargaining starts.` : "Nothing matched. Try a broader word.", { items });
}

async function startShopping(user: User, args: unknown): Promise<ToolResult> {
  const a = z.object({ request: z.string().trim().min(5).max(300) }).safeParse(args);
  if (!a.success) return fail("Describe what to buy in one sentence, with a budget in £.");
  const draft = await parseMandate(a.data.request);
  if (!draft) return fail('No budget found. Try: "silk scarf for my mum, under £90, by Dec 20".');
  if (draft.currency !== "GBP") return fail("Mandix's sellers price in pounds for now. Give the budget in £.");
  const [mandate] = await db
    .insert(schema.mandates)
    .values({
      buyerName: user.name,
      buyerUserId: user.id,
      requestText: a.data.request,
      query: draft.item_query,
      maxPriceMinor: Math.round(draft.max_price * 100),
      currency: draft.currency,
      deadline: draft.deadline,
      shipToCountry: user.shipToCountry,
    })
    .returning();
  const negotiations = await openNegotiations(mandate.id);
  if (!negotiations || negotiations.length === 0) {
    return fail("No seller can deliver that by the deadline. Try a later date or a broader item.");
  }
  await enqueue("negotiate", { mandateId: mandate.id }, { maxAttempts: 1 });
  return ok(`Mandix's agent is now negotiating with ${negotiations.length} artisan${negotiations.length === 1 ? "" : "s"}. Call get_deal in about a minute.`, {
    deal_id: mandate.id,
    understood: { item: draft.item_query, budget: gbp(Math.round(draft.max_price * 100)), deadline: draft.deadline },
    watch_live: `${appUrl()}/deal/${mandate.id}`,
  });
}

async function getDeal(user: User, args: unknown): Promise<ToolResult> {
  const a = z.object({ deal_id: z.string().uuid() }).safeParse(args);
  if (!a.success) return fail("deal_id must be the id start_shopping returned.");
  const [m] = await db.select({ buyerUserId: schema.mandates.buyerUserId }).from(schema.mandates).where(eq(schema.mandates.id, a.data.deal_id));
  if (!m || m.buyerUserId !== user.id) return fail("No deal with that id on your account.");
  const snap = await getMandateSnapshot(a.data.deal_id);
  if (!snap) return fail("No deal with that id.");
  const lastPrice = (negId: string, who: "buyer" | "seller") =>
    [...snap.turns].reverse().find((t) => t.negotiation_id === negId && t.from === who && t.final_price != null && !t.guardrail_result.startsWith("ADDON"))
      ?.final_price ?? null;
  const rec = snap.mandate.recommendation as { best?: { negotiationId: string; agreedMinor: number; reasons: string[] } | null } | null;
  const best = rec?.best ? snap.negotiations.find((n) => n.id === rec.best!.negotiationId) : null;
  const status = snap.order
    ? "paid: PayPal is holding the money until the seller ships"
    : snap.mandate.status === "recommended"
      ? "deal ready: the human must approve it in PayPal"
      : snap.mandate.status === "cancelled"
        ? "cancelled"
        : "agents are negotiating";
  return ok(best ? `Recommended: ${best.seller.name}, ${gbp(rec!.best!.agreedMinor)}. Ask the human to open approve_url to pay with PayPal.` : `Status: ${status}.`, {
    status,
    budget: gbp(Math.round(snap.mandate.maxPrice * 100)),
    sellers: snap.negotiations.map((n) => ({
      seller: `${n.seller.name}, ${n.seller.city}`,
      item: n.listing.title,
      list_price: gbp(Math.round(n.listing.listPrice * 100)),
      state: n.state,
      seller_asks: lastPrice(n.id, "seller"),
      your_agent_offers: lastPrice(n.id, "buyer"),
      agreed_price: n.agreedPrice,
    })),
    recommended: best
      ? { seller: best.seller.name, item: best.listing.title, price: gbp(rec!.best!.agreedMinor), why: rec!.best!.reasons }
      : null,
    approve_url: best && !snap.order ? `${appUrl()}/deal/${snap.mandate.id}` : null,
    order_id: snap.order?.id ?? null,
  });
}

async function getOrders(user: User): Promise<ToolResult> {
  const rows = await db
    .select({ o: schema.orders, title: schema.listings.title, seller: schema.sellers.name })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.mandates.buyerUserId, user.id))
    .orderBy(desc(schema.orders.createdAt))
    .limit(10);
  const orders = [];
  for (const { o, title, seller } of rows.filter((r) => r.o.status !== "CREATED")) {
    let paypal: unknown = null;
    if (o.paypalOrderId && orders.length < 5) {
      paypal = await paypalOrderStatus(o.paypalOrderId, o.id).catch(() => null);
    }
    orders.push({
      order_id: o.id,
      item: title,
      seller,
      amount: gbp(o.amountMinor),
      refunded: o.refundedMinor ? gbp(o.refundedMinor) : null,
      status: o.status,
      tracking: o.trackingNumber ? `${o.carrier} ${o.trackingNumber}` : null,
      paypal,
      url: `${appUrl()}/order/${o.id}`,
    });
  }
  return ok(orders.length ? `${orders.length} order${orders.length === 1 ? "" : "s"}.` : "No orders yet.", { orders });
}

async function customPiece(user: User, args: unknown): Promise<ToolResult> {
  const a = z.object({ listing_id: z.string().uuid(), request: z.string().trim().min(10).max(600) }).safeParse(args);
  if (!a.success) return fail("Give a listing_id from search_listings and a sentence about what to make.");
  const c = await requestCommission({ listingId: a.data.listing_id, buyerUserId: user.id, request: a.data.request });
  return ok("Sent to the artisan. Their agent has quoted; once they approve on WhatsApp, a PayPal invoice arrives by email.", {
    request_id: c.id,
    status: "waiting for the artisan",
    track: `${appUrl()}/orders`,
  });
}

// ---- JSON-RPC ----

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function handleRpc(user: User, req: RpcRequest): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: req.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code, message } });
  if (req.id === undefined) return null; // notification: no response

  switch (req.method) {
    case "initialize":
      return reply({
        protocolVersion: typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Mandix sells handmade pieces from artisans in India. Prices are bargained by agents. You can search and start negotiations, but you cannot pay: always hand the human the approve_url so they approve the payment in PayPal themselves.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};
      try {
        switch (name) {
          case "search_listings":
            return reply(await searchListings(args));
          case "start_shopping":
            return reply(await startShopping(user, args));
          case "get_deal":
            return reply(await getDeal(user, args));
          case "get_orders":
            return reply(await getOrders(user));
          case "request_custom_piece":
            return reply(await customPiece(user, args));
          default:
            return error(-32602, `Unknown tool: ${String(name)}`);
        }
      } catch (err) {
        console.error("[mcp] tool failed", name, err);
        return reply(fail(`That didn't work: ${(err as Error).message}`));
      }
    }
    default:
      return error(-32601, `Method not found: ${req.method}`);
  }
}
