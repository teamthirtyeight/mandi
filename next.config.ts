import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A separate build folder lets the e2e server run beside the dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Headless Chrome renders the WhatsApp banner cards (lib/banner.ts).
  serverExternalPackages: ["playwright-core"],
  /* config options here */
};

export default nextConfig;
