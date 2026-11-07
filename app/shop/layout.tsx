// Only for buyers: checked on the server before the page loads.
import { guardPage } from "@/lib/auth/guard";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await guardPage("/shop", "buyer");
  return children;
}
