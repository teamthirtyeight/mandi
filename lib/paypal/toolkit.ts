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
