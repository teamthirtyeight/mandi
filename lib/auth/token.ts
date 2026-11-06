// Signed session token: "<userId>.<expiresAtMs>.<hmac>". No server-side store;
// the HMAC (SESSION_SECRET) makes it tamper-proof and the expiry bounds it.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 14 * DAY_MS;

const g = globalThis as unknown as { mandiDevSecret?: string };
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ chars) is required in production");
  // Dev only: a per-process secret, so sessions end when the dev server restarts.
  return (g.mandiDevSecret ??= randomBytes(32).toString("hex"));
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function createToken(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the user id if the token is authentic and unexpired. */
export function readToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!(Number(exp) > now)) return null;
  return userId;
}
