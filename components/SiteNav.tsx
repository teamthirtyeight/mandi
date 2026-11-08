import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";
import { NotificationBell } from "./NotificationBell";
import { NavLinks } from "./NavLinks";
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

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-[76rem] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Mandi home">
          <LogoMark size={28} />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.025em]">Mandi</span>
        </Link>
        <NavLinks links={[{ href: "/browse", label: "Browse" }, ...links, { href: "/arena", label: "Break the agent" }]} />
        <div className="ml-auto flex items-center gap-1.5">
          {user ? (
            <>
              <NotificationBell />
              <span className="mx-1.5 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
              <span className="hidden items-center gap-2.5 sm:flex">
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
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-quiet btn-sm">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
