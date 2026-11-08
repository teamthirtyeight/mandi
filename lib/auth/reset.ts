// Password reset: a random single-use token, valid for 30 minutes, stored only
// as a hash. The link is emailed via Resend when RESEND_API_KEY is set;
// otherwise it is written to the server log (no email provider in the demo).
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashPassword } from "./password";

const TTL_MS = 30 * 60 * 1000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function requestReset(email: string, origin: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (!user) return; // same response either way
  const token = randomBytes(32).toString("base64url");
  await db.insert(schema.passwordResets).values({ userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MS) });
  const link = `${origin}/reset/${token}`;

  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: email,
        subject: "Reset your Mandix password",
        text: `Reset your password within 30 minutes: ${link}\n\nIf you didn't ask for this, ignore this email.`,
      }),
    });
    if (!res.ok) console.error("[reset] email failed", res.status);
  } else {
    console.info(`[reset] no email provider configured; reset link for ${email}: ${link}`);
  }
}

/** Sets the new password if the token is valid; false otherwise. */
export async function confirmReset(token: string, password: string): Promise<string | null> {
  const [row] = await db
    .update(schema.passwordResets)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.passwordResets.tokenHash, sha256(token)),
        isNull(schema.passwordResets.usedAt),
        gt(schema.passwordResets.expiresAt, new Date()),
      ),
    )
    .returning({ userId: schema.passwordResets.userId });
  if (!row) return null;
  // New password: sessions started before now (on any device) stop working.
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), sessionsValidAfter: new Date(Date.now() - 1000) })
    .where(eq(schema.users.id, row.userId));
  return row.userId;
}
