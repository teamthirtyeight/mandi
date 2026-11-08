"use client";

// Main navigation. Inline links on wider screens; a menu button with a
// dropdown sheet on phones, so links are never cut off.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };

function useActive() {
  const path = usePathname();
  return (href: string) => path === href || path.startsWith(`${href}/`);
}

export function NavLinks({ links }: { links: NavLink[] }) {
  const active = useActive();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
            active(l.href) ? "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-ink-2 hover:bg-surface hover:text-ink"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav({ links, children }: { links: NavLink[]; children?: React.ReactNode }) {
  const active = useActive();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // Close the sheet after navigating.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface hover:text-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 top-[var(--nav-h,61px)] z-30 bg-ink/20" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="fixed inset-x-0 top-[var(--nav-h,61px)] z-40 border-b border-line bg-raised px-4 pb-4 pt-2 shadow-[var(--shadow-lg)]"
          >
            <ul className="space-y-0.5">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active(l.href) ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-lg px-3 text-[0.9375rem] font-medium ${
                      active(l.href) ? "bg-surface text-ink" : "text-ink-2 hover:bg-surface hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
          </nav>
        </>
      )}
    </div>
  );
}
