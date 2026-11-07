// Only for sellers: checked on the server before the page loads.
import { guardPage } from "@/lib/auth/guard";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await guardPage("/sell", "seller");
  return children;
}
