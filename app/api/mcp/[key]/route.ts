// MCP server endpoint with the key in the URL, for clients that can't send headers (see lib/mcp.ts).
import { mcpGet, mcpPost } from "@/lib/mcp-http";

export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  return mcpPost(req, (await params).key);
}
export const GET = mcpGet;
