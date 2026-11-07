// Seller agent's after-sale job: read the buyer's problem report (and photo,
// if any) and propose a partial refund. The proposal is only a number and a
// message; checkRefund and the order service decide whether money moves.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { structured } from "@/lib/ai/claude";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/lib/guardrails";
import type { PhotoInput } from "./listing";

const Proposal = z.object({
  refund_amount: z.number(),
  message: z.string(),
});

export interface RefundProposal {
  amountMinor: number;
  message: string;
  source: "agent" | "fallback";
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

export async function proposeRefund(opts: {
  sellerName: string;
  itemTitle: string;
  paidMinor: number;
  refundableMinor: number;
  capMinor: number;
  currency: string;
  description: string;
  photo: PhotoInput | null;
}): Promise<RefundProposal> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(opts.photo
      ? [{ type: "image" as const, source: { type: "base64" as const, media_type: opts.photo.mediaType, data: opts.photo.base64 } }]
      : []),
    { type: "text", text: `${wrapUntrusted("buyer_complaint", opts.description)}${opts.photo ? "\nThe buyer attached the photo above." : ""}` },
  ];

  const out = await structured({
    label: "refund",
    schema: Proposal,
    effort: "low",
    maxTokens: 1500,
    system: `You are ${opts.sellerName}'s after-sales agent. A buyer reported a problem with "${opts.itemTitle}" (paid ${money(opts.paidMinor, opts.currency)}).
Propose a fair partial refund in major units (e.g. 10 for ${money(1000, opts.currency)}) and a short, warm message to the buyer (at most 2 sentences).
- Small cosmetic issues (a pulled thread, slight colour difference): around 10-15% of the price.
- Clear damage visible in the photo: more, up to ${money(opts.refundableMinor, opts.currency)}.
- If a photo is attached, say briefly what it shows. If it shows no problem, offer a small goodwill amount.
- You can refund up to ${money(opts.capMinor, opts.currency)} on your own; anything above that waits for ${opts.sellerName} to approve.
${UNTRUSTED_DATA_RULE}`,
    content,
  });

  if (out && Number.isFinite(out.refund_amount) && out.refund_amount > 0 && out.message.trim()) {
    const amountMinor = Math.min(opts.refundableMinor, Math.round(out.refund_amount * 100));
    return { amountMinor, message: out.message.trim().slice(0, 400), source: "agent" };
  }

  // No usable proposal: suggest 15% of the price for the seller to review. The
  // guardrails never refund automatically when the model failed.
  const amountMinor = Math.max(
    100,
    Math.min(opts.capMinor, opts.refundableMinor, Math.round((opts.paidMinor * 0.15) / 100) * 100),
  );
  return {
    amountMinor,
    message: `I'm sorry about that. I've asked ${opts.sellerName} to review a refund of ${money(amountMinor, opts.currency)}.`,
    source: "fallback",
  };
}
