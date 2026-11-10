// Demo logins still work on databases seeded before the Mandix rename
// (@demo.mandi.test), and prefer the current address when both exist.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TRUNCATE_ALL } from "./helpers/fixtures";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("findDemoUser", () => {
  let dbmod: typeof import("@/lib/db");
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    dbmod = await import("@/lib/db");
  });
  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql.raw(TRUNCATE_ALL));
  });
  const add = (email: string, name = "Sarah") =>
    dbmod.db.insert(dbmod.schema.users).values({ email, name, role: "buyer", passwordHash: "x" }).returning();

  it("finds a demo account seeded with the pre-rename address", async () => {
    await add("sarah@demo.mandi.test");
    const { findDemoUser } = await import("@/lib/auth/demo-user");
    expect((await findDemoUser("sarah"))?.email).toBe("sarah@demo.mandi.test");
  });

  it("prefers the current address when both exist", async () => {
    await add("sarah@demo.mandi.test");
    await add("sarah@demo.mandix.test");
    const { findDemoUser } = await import("@/lib/auth/demo-user");
    expect((await findDemoUser("sarah"))?.email).toBe("sarah@demo.mandix.test");
  });

  it("returns nothing when no demo account exists", async () => {
    const { findDemoUser } = await import("@/lib/auth/demo-user");
    expect(await findDemoUser("meera")).toBeUndefined();
  });
});
