// Only for buyers (the API also checks it's theirs): checked on the server before the page loads.
import { guardPage } from "@/lib/auth/guard";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await guardPage(`/deal/${id}`, "buyer");
  return children;
}
