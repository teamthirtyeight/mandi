// Finds a seeded demo account. Databases seeded before the Mandix rename still
// hold the old @demo.mandi.test addresses, so fall back to those.
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo";

export async function findDemoUser(key: keyof typeof DEMO_ACCOUNTS) {
  const email = DEMO_ACCOUNTS[key].email;
  const legacy = email.replace("@demo.mandix.test", "@demo.mandi.test");
  const rows = await db.select().from(schema.users).where(inArray(schema.users.email, [email, legacy]));
  return rows.find((u) => u.email === email) ?? rows[0];
}
