// PayPal Agent Toolkit, used for the catalog product at publish time. It is
// called from deterministic server code with a narrow tool set (products and
// shipment tracking only); no agent can reach capture, refund or void.
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { checkToolset } from "@/lib/guardrails";
import { logPaypalEvent } from "./log";

let toolkit: PayPalAgentToolkit | null = null;

function getToolkit(): PayPalAgentToolkit | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (!toolkit) {
    const tk = new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: {
        actions: { products: { create: true }, shipment: { create: true }, disputes: { list: true, get: true } },
        context: { sandbox: process.env.PAYPAL_ENV !== "live" },
      },
    });
    // Guardrails: refuse to start with any tool outside the seller allowlist
    // (no capture, refund or order tools, ever).
    const check = checkToolset("seller", Object.keys(tk.getTools()));
    if (check.verdict !== "ALLOW") throw new Error(check.reason);
    toolkit = tk;
  }
  return toolkit;
}

/** Creates a PayPal catalog product for a published listing. Returns its id, or null. */
export async function createCatalogProduct(listing: {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  homeUrl?: string;
}): Promise<string | null> {
  const tk = getToolkit();
  if (!tk) return null;
  const tool = tk.getTools()["create_product"];
  try {
    const result: unknown = await tool.execute!(
      {
        name: listing.title.slice(0, 127),
        type: "PHYSICAL",
        description: listing.description.slice(0, 256),
        category: "CLOTHING",
        ...(listing.imageUrl ? { image_url: listing.imageUrl } : {}),
        ...(listing.homeUrl ? { home_url: listing.homeUrl } : {}),
      },
      { toolCallId: `publish-${listing.id}`, messages: [] },
    );
    const body = typeof result === "string" ? JSON.parse(result) : (result as Record<string, unknown>);
    const id = typeof body?.id === "string" ? body.id : null;
    await logPaypalEvent({
      direction: "call",
      method: "TOOL",
      endpoint: "agent-toolkit create_product",
      httpStatus: id ? 201 : 500,
      summary: id ? `Catalog product ${id} created` : "create_product returned no id",
    });
    return id;
  } catch (err) {
    await logPaypalEvent({
      direction: "call",
      method: "TOOL",
      endpoint: "agent-toolkit create_product",
      httpStatus: 500,
      summary: `create_product failed: ${(err as Error).message}`.slice(0, 200),
    });
    return null;
  }
}

export interface DisputeSummary {
  id: string;
  status: string;
  reason: string;
  amount: string | null;
  transactionId: string | null;
}

/** Open PayPal disputes for the merchant, via the Agent Toolkit. Null if unavailable. */
export async function listDisputes(): Promise<DisputeSummary[] | null> {
  const tk = getToolkit();
  if (!tk) return null;
  try {
    const result: unknown = await tk.getTools()["list_disputes"].execute!({ page_size: 20 }, { toolCallId: "dashboard-disputes", messages: [] });
    const body = (typeof result === "string" ? JSON.parse(result) : result) as { items?: Record<string, unknown>[] };
    return (body.items ?? []).map((d) => {
      const amount = d.dispute_amount as { value?: string; currency_code?: string } | undefined;
      const tx = (d.disputed_transactions as { seller_transaction_id?: string }[] | undefined)?.[0];
      return {
        id: String(d.dispute_id ?? ""),
        status: String(d.status ?? ""),
        reason: String(d.reason ?? ""),
        amount: amount?.value ? `${amount.currency_code ?? ""} ${amount.value}`.trim() : null,
        transactionId: tx?.seller_transaction_id ?? null,
      };
    });
  } catch (err) {
    console.error("[toolkit] list_disputes failed", err);
    return null;
  }
}

// ---- Platform toolkit: fixed server code, never an agent ----
//
// Invoices, subscriptions, reporting and order lookups run through a second
// Agent Toolkit instance that only Mandi's own server code calls (no model
// chooses these calls). It has its own allowlist: the toolkit must not hand it
// order-creation, capture, refund or payout tools, and the agents' toolset
// above never gets any of these.
export const PLATFORM_TOOLS = [
  "create_invoice",
  "send_invoice",
  "get_invoice",
  "create_product",
  "create_subscription_plan",
  "show_subscription_plan_details",
  "create_subscription",
  "show_subscription_details",
  "cancel_subscription",
  "get_order",
  "list_transactions",
] as const;
export type PlatformTool = (typeof PLATFORM_TOOLS)[number];

let platform: PayPalAgentToolkit | null = null;

function getPlatformToolkit(): PayPalAgentToolkit | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (!platform) {
    const tk = new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: {
        actions: {
          invoices: { create: true, send: true, get: true },
          products: { create: true },
          subscriptionPlans: { create: true, show: true },
          subscriptions: { create: true, show: true, cancel: true },
          orders: { get: true },
          transactions: { list: true },
        },
        context: { sandbox: process.env.PAYPAL_ENV !== "live" },
      },
    });
    const extra = Object.keys(tk.getTools()).filter((name) => !(PLATFORM_TOOLS as readonly string[]).includes(name));
    if (extra.length) throw new Error(`Platform toolkit refused: unexpected tools ${extra.join(", ")}`);
    platform = tk;
  }
  return platform;
}

export class ToolkitError extends Error {}

const FEATURE: Partial<Record<PlatformTool, string>> = {
  create_invoice: "Invoicing",
  send_invoice: "Invoicing",
  get_invoice: "Invoicing",
  list_transactions: "Transaction Search",
  create_subscription_plan: "Subscriptions",
  create_subscription: "Subscriptions",
};

/** Runs one platform tool, logs it to the PayPal call panel, and returns PayPal's response body. */
export async function runPlatformTool<T = Record<string, unknown>>(
  name: PlatformTool,
  args: Record<string, unknown>,
  opts: { label: string; orderId?: string | null },
): Promise<T> {
  const tk = getPlatformToolkit();
  if (!tk) throw new ToolkitError("PayPal is not configured");
  const tool = tk.getTools()[name];
  if (!tool?.execute) throw new ToolkitError(`Toolkit tool ${name} is not available`);
  let body: Record<string, unknown> | null = null;
  let failure: string | null = null;
  try {
    const raw: unknown = await tool.execute(args, { toolCallId: `${opts.label}`.slice(0, 60), messages: [] });
    body = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
    // The toolkit reports failures as { ok: false, code, message } or { error: { message } }.
    const err = body?.error as { message?: string } | undefined;
    if (err) failure = err.message ?? JSON.stringify(err).slice(0, 300);
    else if (body?.ok === false) failure = String(body.message ?? body.code ?? "PayPal refused the request");
    else if (body == null || (typeof body === "object" && Object.keys(body).length === 0 && name !== "cancel_subscription")) {
      failure = "PayPal returned nothing";
    }
  } catch (err) {
    failure = (err as Error).message;
  }
  await logPaypalEvent({
    direction: "call",
    method: "TOOL",
    endpoint: `agent-toolkit ${name}`,
    httpStatus: failure ? 500 : 200,
    orderId: opts.orderId ?? null,
    summary: (failure ? `${name} failed: ${failure}` : `${name}: ${opts.label}`).slice(0, 200),
  });
  if (failure) {
    // "X: X" duplicates from the toolkit, and a plain sentence for a missing app permission.
    const parts = failure.split(": ");
    const clean = parts.length === 2 && parts[0].replace(/\.$/, "") === parts[1].replace(/\.$/, "") ? parts[0] : failure;
    if (/insufficient permissions|NOT_AUTHORIZED|PERMISSION_DENIED/i.test(clean)) {
      throw new ToolkitError(`${FEATURE[name] ?? name} isn't switched on for Mandi's PayPal app yet (PayPal developer dashboard → Apps & Credentials → Features).`);
    }
    throw new ToolkitError(clean);
  }
  return body as T;
}

export const platformToolkitConfigured = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
