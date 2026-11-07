"use client";

// Nav links with the current section marked, so people always know where they are.
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav aria-label="Main" className="order-last -mx-2 flex w-full gap-1 overflow-x-auto [scrollbar-width:none] sm:order-none sm:w-auto">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={`rounded-lg px-2.5 py-1.5 text-[0.9375rem] font-medium whitespace-nowrap ${
            active(l.href) ? "bg-indigo-soft text-indigo" : "text-ink-2 hover:text-ink"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
