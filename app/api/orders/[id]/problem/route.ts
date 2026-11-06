// Buyer reports a problem (text + optional photo). The seller agent proposes a
// refund; within the seller's cap it is refunded at once, above it the
// proposal waits for the seller (HTTP 202).
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertOrderAccess } from "@/lib/auth/access";
import { reportProblem } from "@/lib/orders/problem";
import type { PhotoInput } from "@/lib/agents/listing";

const Body = z.object({
  description: z.string().trim().min(5).max(500),
  photo: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp|gif);base64,/)
    .max(7_000_000)
    .optional(),
  requestKey: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    await assertOrderAccess(await requireUser(), id, "buyer");
  } catch (err) {
    return errorResponse(err);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the problem in a sentence" }, { status: 400 });

  let photo: PhotoInput | null = null;
  if (parsed.data.photo) {
    const [, mediaType, base64] = parsed.data.photo.match(/^data:(image\/[a-z]+);base64,(.*)$/)!;
    photo = { mediaType: mediaType as PhotoInput["mediaType"], base64 };
  }

  try {
    const result = await reportProblem(id, { description: parsed.data.description, photo, requestKey: parsed.data.requestKey });
    return NextResponse.json(result, { status: result.outcome === "REFUNDED" ? 200 : 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
