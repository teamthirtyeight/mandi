// Which pages need which kind of account, and where each role lands after
// logging in. Client-safe: used by the login panel and the server page guards.
export type Role = "buyer" | "seller";

export const ROLE_HOME: Record<Role, string> = { buyer: "/shop", seller: "/dashboard" };

const SELLER_PAGES = ["/dashboard", "/sell", "/seller"];
const BUYER_PAGES = ["/shop", "/orders", "/deal"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}?`);

/** The role a page needs, or null if any signed-in user (or anyone) may open it. */
export function pageRole(path: string): Role | null {
  if (SELLER_PAGES.some((b) => under(path, b))) return "seller";
  if (BUYER_PAGES.some((b) => under(path, b))) return "buyer";
  return null;
}

/**
 * Where to go after logging in. Only a path on this site ("/…", never "//…" or
 * "/\…", which browsers treat as another site), and only one this role may open;
 * otherwise the role's home page.
 */
export function safeNext(next: string | null | undefined, role: Role): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f\s]/.test(next)) {
    return ROLE_HOME[role];
  }
  const needs = pageRole(next);
  return needs && needs !== role ? ROLE_HOME[role] : next;
}
