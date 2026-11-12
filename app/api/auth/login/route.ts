import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { publicUser, startSession } from "@/lib/auth/session";
import { allow, clientIp, MINUTE } from "@/lib/auth/ratelimit";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password" }, { status: 400 });

  // Slows password guessing: per account from one address (so a stranger can't
  // lock someone out with a few wrong guesses), per account overall, per address.
  const ip = clientIp(req);
  if (
    !allow(`login:${parsed.data.email}:${ip}`, 8, 15 * MINUTE) ||
    !allow(`login:${parsed.data.email}`, 100, 15 * MINUTE) ||
    !allow(`login-ip:${ip}`, 30, 15 * MINUTE)
  ) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, parsed.data.email));
  // Same message either way, so the form doesn't reveal which emails exist.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  await startSession(user.id);
  return NextResponse.json({ user: publicUser(user) });
}
