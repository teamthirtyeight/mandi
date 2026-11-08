// Payout maths, kept free of imports so it can be tested on its own.

/** Mandix's fee, in percent of the captured amount. */
export const feePct = () => {
  const pct = Number((process.env.MANDIX_FEE_PCT ?? process.env.MANDI_FEE_PCT) ?? 5);
  return Number.isFinite(pct) && pct >= 0 && pct < 50 ? pct : 5;
};

/** Pure split: what Mandix keeps, what the seller's debt absorbs, what is paid out. */
export function payoutSplit(input: { capturedMinor: number; refundedMinor: number; debtMinor: number; feePct: number }) {
  const netMinor = Math.max(0, input.capturedMinor - input.refundedMinor);
  const feeMinor = Math.round((netMinor * input.feePct) / 100);
  const beforeDebt = netMinor - feeMinor;
  const debtUsedMinor = Math.min(Math.max(0, input.debtMinor), beforeDebt);
  return { feeMinor, debtUsedMinor, payoutMinor: beforeDebt - debtUsedMinor };
}


/**
 * Where a seller's payout goes: their PayPal merchant id if they connected
 * PayPal (PayPal doesn't always share the account's email), else their email.
 */
export function payoutReceiver(seller: { paypalMerchantEmail: string; paypalMerchantId: string | null }) {
  return { receiverEmail: seller.paypalMerchantEmail, receiverPaypalId: seller.paypalMerchantId };
}

/** Whether Mandi has anywhere to send this seller's money. */
export const canPaySeller = (seller: { paypalMerchantEmail: string; paypalMerchantId: string | null }) =>
  Boolean(seller.paypalMerchantId) || seller.paypalMerchantEmail.includes("@");
