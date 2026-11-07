// Listing photo, or (for listings without photos, like the seeded demo ones) a
// woven swatch in a natural-dye colour (lib/swatch.ts).
import { swatchStyle } from "@/lib/swatch";

export function ListingImage({ src, title, className = "" }: { src: string | null; title: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={title} className={`object-cover ${className}`} />;
  }
  return (
    <div role="img" aria-label={title} className={`relative overflow-hidden ${className}`} style={swatchStyle(title)}>
      <span className="display absolute bottom-2 left-3 text-3xl text-white/80" aria-hidden="true">
        {title.charAt(0)}
      </span>
    </div>
  );
}
