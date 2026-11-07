// Only for the order's buyer and seller (the API checks which): checked on the server before the page loads.
import { guardPage } from "@/lib/auth/guard";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await guardPage(`/order/${id}`);
  return children;
}
