// Demo accounts created by the seed script. Test data only; the shared
// password comes from DEMO_PASSWORD (see .env.example).
export const DEMO_ACCOUNTS = {
  sarah: { email: "sarah@demo.mandi.test", role: "buyer" as const, name: "Sarah" },
  meera: { email: "meera@demo.mandi.test", role: "seller" as const, name: "Meera" },
  arjun: { email: "arjun@demo.mandi.test", role: "seller" as const, name: "Arjun" },
  fatima: { email: "fatima@demo.mandi.test", role: "seller" as const, name: "Fatima" },
};
export const DEFAULT_DEMO_PASSWORD = "mandi-demo-2026";
