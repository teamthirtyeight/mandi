// PayPal Agent Toolkit, used for the catalog product at publish time. It is
// called from deterministic server code with a narrow tool set (products and
// shipment tracking only); no agent can reach capture, refund or void.
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { logPaypalEvent } from "./log";

let toolkit: PayPalAgentToolkit | null = null;

function getToolkit(): PayPalAgentToolkit | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  toolkit ??= new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: { products: { create: true }, shipment: { create: true } },
      context: { sandbox: process.env.PAYPAL_ENV !== "live" },
    },
  });
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
