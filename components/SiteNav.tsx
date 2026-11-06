import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { LogoutButton } from "./LogoutButton";

export async function SiteNav() {
  const user = await getUser().catch(() => null);
  const links =
    user?.role === "seller"
      ? [
          { href: "/sell", label: "Sell" },
          { href: "/dashboard", label: "Dashboard" },
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
    <nav className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold">
          Mandi
        </Link>
        <div className="flex items-center gap-5 text-neutral-700">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-neutral-950">
              {l.label}
            </Link>
          ))}
          {user ? (
            <>
              <span className="text-sm text-neutral-500">
                {user.name} · {user.role}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup" className="rounded-lg bg-neutral-900 px-3 py-1.5 text-white">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
