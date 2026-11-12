// A buyer's key for connecting their own AI assistant to Mandix's MCP server.
// GET says whether one exists; POST makes a new one, which replaces the old.
// Only the key's hash is stored, so the key itself is shown once, when made.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { hashApiKey, newApiKey } from "@/lib/mcp";
import { appUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

const view = (key: string | null, exists: boolean) => ({ key, exists, url: key ? `${appUrl()}/api/mcp/${key}` : null, endpoint: `${appUrl()}/api/mcp` });

export async function GET() {
  try {
    const user = await requireUser("buyer");
    return NextResponse.json(view(null, Boolean(user.apiKey)));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser("buyer");
    const key = newApiKey();
    await db.update(schema.users).set({ apiKey: hashApiKey(key) }).where(eq(schema.users.id, user.id));
    return NextResponse.json(view(key, true));
  } catch (err) {
    return errorResponse(err);
  }
}
