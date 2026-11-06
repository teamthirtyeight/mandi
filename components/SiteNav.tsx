import Link from "next/link";

const LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/sell", label: "Sell" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteNav() {
  return (
    <nav className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold">
          Mandi
        </Link>
        <div className="flex gap-5 text-neutral-700">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-neutral-950">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
