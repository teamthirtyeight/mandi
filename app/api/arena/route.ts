// Public red-team arena: GET the target and scoreboard, POST an attack.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ArenaLimit, arenaTarget, attack, hashIp, scoreboard } from "@/lib/arena";
import { errorResponse } from "@/lib/api/errors";
import { clientIp } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ target: await arenaTarget(), scoreboard: await scoreboard() });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({
  text: z.string().trim().min(3, "Write something to the agent.").max(800),
  offer: z.number().positive().max(100000).nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid attack" }, { status: 400 });
  const ip = clientIp(req);
  try {
    const result = await attack({
      text: parsed.data.text,
      offerMinor: parsed.data.offer != null ? Math.round(parsed.data.offer * 100) : null,
      ipHash: hashIp(ip),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ArenaLimit) return NextResponse.json({ error: err.message }, { status: 429 });
    return errorResponse(err);
  }
}
