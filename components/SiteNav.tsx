import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";
import { NotificationBell } from "./NotificationBell";
import { NavLinks } from "./NavLinks";

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
            { href: "/agent", label: "My agent" },
          ]
        : [];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2" aria-label="Mandi home">
          <span className="display text-2xl">Mandi</span>
          <span lang="hi" className="text-base text-ink-3">
            मंडी
          </span>
        </Link>
        <NavLinks links={[{ href: "/browse", label: "Browse" }, ...links]} />
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <NotificationBell />
              <span className="hidden items-center gap-2 pl-1 text-sm sm:flex">
                <span className="font-semibold">{user.name}</span>
                <span className="chip">{user.role}</span>
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-quiet btn-sm">
                Log in
              </Link>
              <Link href="/signup" className="btn btn-primary btn-sm">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
