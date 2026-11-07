// A buyer's key for connecting their own AI assistant to Mandi's MCP server.
// GET shows whether one exists (and the connection URL); POST makes a new one,
// which replaces the old.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { newApiKey } from "@/lib/mcp";
import { appUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

const view = (key: string | null) => ({ key, url: key ? `${appUrl()}/api/mcp/${key}` : null, endpoint: `${appUrl()}/api/mcp` });

export async function GET() {
  try {
    const user = await requireUser("buyer");
    return NextResponse.json(view(user.apiKey));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser("buyer");
    const key = newApiKey();
    await db.update(schema.users).set({ apiKey: key }).where(eq(schema.users.id, user.id));
    return NextResponse.json(view(key));
  } catch (err) {
    return errorResponse(err);
  }
}
