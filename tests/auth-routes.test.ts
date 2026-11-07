// Where login sends people, and which sessions count.
import { describe, expect, it } from "vitest";
import { pageRole, safeNext } from "@/lib/auth/routes";
import { createToken, readSession } from "@/lib/auth/token";

describe("after login", () => {
  it("goes back to the page that asked, if this role may open it", () => {
    expect(safeNext("/orders", "buyer")).toBe("/orders");
    expect(safeNext("/deal/abc", "buyer")).toBe("/deal/abc");
    expect(safeNext("/dashboard", "seller")).toBe("/dashboard");
    expect(safeNext("/agent", "seller")).toBe("/agent");
    expect(safeNext("/listing/1?x=2", "buyer")).toBe("/listing/1?x=2");
  });
  it("never leaves the site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/ok\n//evil", ""]) {
      expect(safeNext(bad, "buyer")).toBe("/shop");
    }
    expect(safeNext(null, "seller")).toBe("/dashboard");
  });
  it("sends each role home instead of to the other role's pages", () => {
    expect(safeNext("/dashboard", "buyer")).toBe("/shop");
    expect(safeNext("/sell", "buyer")).toBe("/shop");
    expect(safeNext("/orders", "seller")).toBe("/dashboard");
    expect(safeNext("/deal/abc", "seller")).toBe("/dashboard");
  });
  it("knows which pages need which role", () => {
    expect(pageRole("/seller")).toBe("seller");
    expect(pageRole("/sellers-guide")).toBeNull();
    expect(pageRole("/shop")).toBe("buyer");
    expect(pageRole("/browse")).toBeNull();
    expect(pageRole("/monthly")).toBeNull();
  });
});

describe("sessions", () => {
  it("records when a session started, and rejects tampering and expiry", () => {
    process.env.SESSION_SECRET ??= "x".repeat(40);
    const now = Date.UTC(2026, 10, 8);
    const token = createToken("user-1", now);
    expect(readSession(token, now + 1000)).toEqual({ userId: "user-1", issuedAt: now });
    expect(readSession(token.replace("user-1", "user-2"), now)).toBeNull();
    expect(readSession(token, now + 15 * 24 * 3600 * 1000)).toBeNull();
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("password reset", () => {
  it("ends sessions that started before the new password, but not the one it starts", async () => {
    process.env.DATABASE_URL = TEST_DB;
    const dbmod = await import("@/lib/db");
    const { sql, eq } = await import("drizzle-orm");
    const { createHash } = await import("node:crypto");
    const { sessionAccepted } = await import("@/lib/auth/session");
    await dbmod.db.execute(sql`TRUNCATE password_resets, users CASCADE`);
    const [u] = await dbmod.db.insert(dbmod.schema.users).values({ email: "reset@test.local", passwordHash: "x", role: "buyer", name: "R" }).returning();
    const token = "t".repeat(40);
    await dbmod.db.insert(dbmod.schema.passwordResets).values({
      userId: u.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const oldSession = Date.now() - 60_000;
    const { confirmReset } = await import("@/lib/auth/reset");
    expect(await confirmReset(token, "a-new-password")).toBe(u.id);
    const [after] = await dbmod.db.select().from(dbmod.schema.users).where(eq(dbmod.schema.users.id, u.id));
    expect(sessionAccepted(oldSession, after.sessionsValidAfter)).toBe(false);
    expect(sessionAccepted(Date.now(), after.sessionsValidAfter)).toBe(true);
    expect(sessionAccepted(oldSession, null)).toBe(true);
  });
});
