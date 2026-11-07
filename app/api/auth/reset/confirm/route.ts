import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmReset } from "@/lib/auth/reset";
import { startSession } from "@/lib/auth/session";

const Body = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(200) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a password of at least 8 characters" }, { status: 400 });
  const userId = await confirmReset(parsed.data.token, parsed.data.password);
  if (!userId) return NextResponse.json({ error: "This reset link has expired or was already used." }, { status: 400 });
  await startSession(userId);
  return NextResponse.json({ ok: true });
}
