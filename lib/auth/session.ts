// Session helpers for route handlers. Every API route that acts for a buyer
// or seller resolves the user here and checks ownership of what it touches.
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createToken, readSession, SESSION_TTL_MS } from "./token";

export const SESSION_COOKIE = "mandix_session";

export type SessionUser = typeof schema.users.$inferSelect;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

export async function getUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) return null;
  return sessionAccepted(session.issuedAt, user.sessionsValidAfter) ? user : null;
}

/** A password change ends every session that started before it. */
export function sessionAccepted(issuedAt: number, validAfter: Date | null): boolean {
  return !validAfter || issuedAt >= validAfter.getTime();
}

export async function requireUser(role?: "buyer" | "seller"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new AuthError("Please log in", 401);
  if (role && user.role !== role) throw new AuthError(`This needs a ${role} account`, 403);
  if (role === "seller" && !user.sellerId) throw new AuthError("No seller profile on this account", 403);
  return user;
}

export async function startSession(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, createToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Public view of the user, for the browser. */
export const publicUser = (u: SessionUser) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  sellerId: u.sellerId,
  shipToCountry: u.shipToCountry,
});
