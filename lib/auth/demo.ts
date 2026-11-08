// Demo accounts created by the seed script. Test data only; the shared
// password comes from DEMO_PASSWORD (see .env.example).
export const DEMO_ACCOUNTS = {
  sarah: { email: "sarah@demo.mandix.test", role: "buyer" as const, name: "Sarah" },
  meera: { email: "meera@demo.mandix.test", role: "seller" as const, name: "Meera" },
  arjun: { email: "arjun@demo.mandix.test", role: "seller" as const, name: "Arjun" },
  fatima: { email: "fatima@demo.mandix.test", role: "seller" as const, name: "Fatima" },
};
export const DEFAULT_DEMO_PASSWORD = "mandix-demo-2026";
