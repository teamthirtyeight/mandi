import { NextResponse } from "next/server";
import { getUser, publicUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getUser();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}
