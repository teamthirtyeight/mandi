// Woven-swatch avatar with the maker's initial. The demo makers are fictional,
// so there are no portrait photos; a real seller's photo could go here instead.
import { swatchStyle } from "@/lib/swatch";

const SIZES = { xs: "h-6 w-6 text-[0.6875rem]", sm: "h-11 w-11 text-lg", lg: "h-20 w-20 text-3xl" } as const;

export function MakerAvatar({ name, craft, size = "lg" }: { name: string; craft?: string | null; size?: keyof typeof SIZES }) {
  return (
    <span
      aria-hidden="true"
      className={`display flex shrink-0 items-center justify-center rounded-full text-white ring-2 ring-paper ${SIZES[size]}`}
      style={swatchStyle(`${name} ${craft ?? ""}`)}
    >
      {name.charAt(0)}
    </span>
  );
}
