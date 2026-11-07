// The buyer's shipping address from PayPal, for the seller.
export interface Shipping {
  name: string | null;
  lines: string[];
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

export function ShippingAddress({ shipping, label = "Ship to" }: { shipping: Shipping | null; label?: string }) {
  if (!shipping) return null;
  const cityLine = [shipping.city, shipping.region, shipping.postalCode].filter(Boolean).join(", ");
  return (
    <address className="not-italic leading-snug">
      <p className="mb-1 text-sm text-ink-3">{label}</p>
      {shipping.name && <p className="font-semibold">{shipping.name}</p>}
      {shipping.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {cityLine && <p>{cityLine}</p>}
      {shipping.countryCode && <p>{shipping.countryCode}</p>}
    </address>
  );
}
