// Sign-up. Buyers give a name and ship-to country. Sellers also create their
// seller profile: the story their agent tells, where they're paid, their
// language, how fast they ship, and the refund cap their agent may grant.
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { publicUser, startSession } from "@/lib/auth/session";

const Common = z.object({
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(8).max(200),
  name: z.string().trim().min(1).max(60),
});

const Body = z.discriminatedUnion("role", [
  Common.extend({ role: z.literal("buyer"), shipToCountry: z.string().trim().length(2).toUpperCase().default("GB") }),
  Common.extend({
    role: z.literal("seller"),
    city: z.string().trim().min(1).max(60),
    country: z.string().trim().length(2).toUpperCase().default("IN"),
    story: z.string().trim().min(10).max(600),
    paypalEmail: z.string().trim().toLowerCase().email().max(120),
    language: z.enum(["en", "hi"]).default("en"),
    shipByDays: z.number().int().min(1).max(3).default(3),
    transitDays: z.number().int().min(1).max(30).default(7),
    refundCap: z.number().min(0).max(1000).default(10),
  }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "Invalid sign-up" }, { status: 400 });
  }
  const b = parsed.data;

  const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, b.email));
  if (taken) return NextResponse.json({ error: "That email already has an account. Log in instead." }, { status: 409 });

  const passwordHash = await hashPassword(b.password);
  const user = await db.transaction(async (tx) => {
    let sellerId: string | null = null;
    if (b.role === "seller") {
      const [seller] = await tx
        .insert(schema.sellers)
        .values({
          name: b.name,
          city: b.city,
          country: b.country,
          story: b.story,
          paypalMerchantEmail: b.paypalEmail,
          language: b.language,
          shipByDays: b.shipByDays,
          transitDays: b.transitDays,
          refundCapMinor: Math.round(b.refundCap * 100),
        })
        .returning({ id: schema.sellers.id });
      sellerId = seller.id;
    }
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: b.email,
        passwordHash,
        role: b.role,
        name: b.name,
        sellerId,
        shipToCountry: b.role === "buyer" ? b.shipToCountry : "GB",
      })
      .returning();
    return u;
  });

  await startSession(user.id);
  return NextResponse.json({ user: publicUser(user) });
}
