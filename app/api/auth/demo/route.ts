// One-click demo logins for judges: the seeded sandbox buyer (Sarah) and
// sellers (Meera, Arjun, Fatima). Disable with DEMO_LOGINS=0.
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publicUser, startSession } from "@/lib/auth/session";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo";

const Body = z.object({ as: z.enum(["sarah", "meera", "arjun", "fatima"]) });

export async function POST(req: Request) {
  if (process.env.DEMO_LOGINS === "0") return NextResponse.json({ error: "Demo logins are off" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown demo account" }, { status: 400 });

  const email = DEMO_ACCOUNTS[parsed.data.as].email;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) return NextResponse.json({ error: "Demo accounts aren't seeded. Run npm run db:seed." }, { status: 404 });
  await startSession(user.id);
  return NextResponse.json({ user: publicUser(user) });
}
