import type { Metadata } from "next";
import { Anek_Devanagari, Anek_Latin } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { DockedCallLog } from "@/components/DockedCallLog";
import { getUser } from "@/lib/auth/session";

// Anek: one Indian-designed family for Latin and Devanagari, with a width
// axis used for the wide headlines.
const anek = Anek_Latin({ variable: "--font-anek", subsets: ["latin", "latin-ext"], axes: ["wdth"] });
const anekDev = Anek_Devanagari({ variable: "--font-anek-dev", subsets: ["devanagari"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Mandi",
  description: "Your agent haggles with artisan sellers' agents. PayPal holds the money until it ships.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${anek.variable} ${anekDev.variable} min-h-screen antialiased`}
      >
        <SiteNav />
        {children}
        <DockedCallLog signedIn={Boolean(await getUser().catch(() => null))} />
      </body>
    </html>
  );
}
