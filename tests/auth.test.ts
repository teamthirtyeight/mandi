import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createToken, readToken, SESSION_TTL_MS } from "@/lib/auth/token";

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("session tokens", () => {
  it("round-trips a user id", () => {
    expect(readToken(createToken("user-1"))).toBe("user-1");
  });

  it("rejects a tampered token", () => {
    const [, exp, mac] = createToken("user-1").split(".");
    expect(readToken(`user-2.${exp}.${mac}`)).toBeNull();
    expect(readToken(`user-1.${Number(exp) + 1000}.${mac}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    const t = createToken("user-1", 0);
    expect(readToken(t, SESSION_TTL_MS + 1)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(readToken(undefined)).toBeNull();
    expect(readToken("not-a-token")).toBeNull();
  });
});
