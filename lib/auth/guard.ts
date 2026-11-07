// Server-side page guard, used by the layouts of pages that need an account.
// Not signed in → the login page, coming back here afterwards. Signed in with
// the wrong kind of account → the login page with a note, so they can switch.
import { redirect } from "next/navigation";
import { getUser, type SessionUser } from "./session";
import type { Role } from "./routes";

export async function guardPage(path: string, role?: Role): Promise<SessionUser> {
  const user = await getUser().catch(() => null);
  if (!user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (role && user.role !== role) redirect(`/login?next=${encodeURIComponent(path)}&needs=${role}`);
  if (role === "seller" && !user.sellerId) redirect(`/login?next=${encodeURIComponent(path)}&needs=seller`);
  return user;
}
