// Display-only currency conversion for the seller's view. Money always moves
// in the order's currency (GBP); this is just what Meera sees in rupees.
// Set NEXT_PUBLIC_MANDI_GBP_INR to the current rate before recording.
export const GBP_INR = Number(process.env.NEXT_PUBLIC_MANDI_GBP_INR ?? 112);

export const inr = (gbp: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(gbp * GBP_INR);
