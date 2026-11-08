import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";
import { NotificationBell } from "./NotificationBell";
import { MobileNav, NavLinks } from "./NavLinks";
import { LogoMark } from "./Icons";

export async function SiteNav() {
  const user = await getUser().catch(() => null);
  const links =
    user?.role === "seller"
      ? [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/sell", label: "New listing" },
          { href: "/seller", label: "Phone view" },
          { href: "/agent", label: "My agent" },
        ]
      : user?.role === "buyer"
        ? [
            { href: "/shop", label: "Shop" },
            { href: "/orders", label: "My orders" },
            { href: "/monthly", label: "Monthly" },
            { href: "/agent", label: "My agent" },
          ]
        : [{ href: "/monthly", label: "Monthly" }];
  const all = [{ href: "/browse", label: "Browse" }, ...links, { href: "/arena", label: "Break the agent" }];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-md [--nav-h:61px]">
      <div className="mx-auto flex h-[60px] max-w-[76rem] items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Mandi home">
          <LogoMark size={28} />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.025em]">Mandi</span>
        </Link>
        <NavLinks links={all} />
        <div className="ml-auto flex items-center gap-1.5">
          {user ? (
            <>
              <NotificationBell />
              <span className="mx-1.5 hidden h-6 w-px bg-line md:block" aria-hidden="true" />
              <span className="hidden items-center gap-2.5 md:flex">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-soft text-sm font-semibold text-indigo"
                  aria-hidden="true"
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold">{user.name}</span>
                  <span className="text-xs capitalize text-ink-3">{user.role}</span>
                </span>
              </span>
              <span className="hidden md:block">
                <LogoutButton />
              </span>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-quiet btn-sm hidden sm:inline-flex">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
          <MobileNav links={user ? all : [...all, { href: "/login", label: "Log in" }]}>
            {user && (
              <div className="flex items-center justify-between gap-3 px-3">
                <span className="flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-soft text-sm font-semibold text-indigo"
                    aria-hidden="true"
                  >
                    {user.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-semibold">{user.name}</span>
                    <span className="text-xs capitalize text-ink-3">{user.role}</span>
                  </span>
                </span>
                <LogoutButton />
              </div>
            )}
          </MobileNav>
        </div>
      </div>
    </header>
  );
}
