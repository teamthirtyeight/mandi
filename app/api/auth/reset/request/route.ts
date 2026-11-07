import { NextResponse } from "next/server";
import { z } from "zod";
import { requestReset } from "@/lib/auth/reset";
import { allow, clientIp, MINUTE } from "@/lib/auth/ratelimit";

const Body = z.object({ email: z.string().trim().toLowerCase().email() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email" }, { status: 400 });
  if (!allow(`reset:${clientIp(req)}`, 5, 15 * MINUTE)) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes." }, { status: 429 });
  }
  await requestReset(parsed.data.email, new URL(req.url).origin);
  // Same answer whether or not the account exists.
  return NextResponse.json({ ok: true });
}
