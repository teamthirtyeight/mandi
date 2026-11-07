// MCP server endpoint with "Authorization: Bearer <key>" (see lib/mcp.ts).
import { mcpGet, mcpPost } from "@/lib/mcp-http";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => mcpPost(req, null);
export const GET = mcpGet;
