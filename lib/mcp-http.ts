// HTTP side of the MCP server (lib/mcp.ts): auth, single or batched JSON-RPC.
import { NextResponse } from "next/server";
import { handleRpc, userForKey } from "@/lib/mcp";

export async function mcpPost(req: Request, keyFromPath: string | null) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const user = await userForKey(keyFromPath ?? bearer);
  if (!user) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unknown Mandix key. Create one on Mandix under My agent → Connect your AI assistant." } },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((r) => handleRpc(user, r)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new Response(null, { status: 202 });
  }
  const out = await handleRpc(user, body);
  return out ? NextResponse.json(out) : new Response(null, { status: 202 });
}

/** MCP clients may open a GET stream for server messages; Mandix has none to send. */
export const mcpGet = () => new Response("Mandix's MCP server answers POST requests only.", { status: 405, headers: { Allow: "POST" } });
