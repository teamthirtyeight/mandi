import type { Metadata } from "next";
import {
  Anek_Bangla,
  Anek_Devanagari,
  Anek_Gujarati,
  Anek_Gurmukhi,
  Anek_Kannada,
  Anek_Latin,
  Anek_Malayalam,
  Anek_Odia,
  Anek_Tamil,
  Anek_Telugu,
  Inter,
} from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { DockedCallLog } from "@/components/DockedCallLog";
import { getUser } from "@/lib/auth/session";

// Inter for all Latin text. Anek, an Indian-designed family, covers Devanagari
// and the other Indian scripts sellers write in.
const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"], axes: ["opsz"], display: "swap" });
const anek = Anek_Latin({ variable: "--font-anek", subsets: ["latin", "latin-ext"], preload: false });
const anekDev = Anek_Devanagari({ variable: "--font-anek-dev", subsets: ["devanagari"] });
// Other Indian scripts for sellers' languages. Not preloaded: a page only
// downloads the script it actually shows.
const anekBn = Anek_Bangla({ variable: "--font-anek-bn", subsets: ["bengali"], preload: false });
const anekTa = Anek_Tamil({ variable: "--font-anek-ta", subsets: ["tamil"], preload: false });
const anekTe = Anek_Telugu({ variable: "--font-anek-te", subsets: ["telugu"], preload: false });
const anekGu = Anek_Gujarati({ variable: "--font-anek-gu", subsets: ["gujarati"], preload: false });
const anekKn = Anek_Kannada({ variable: "--font-anek-kn", subsets: ["kannada"], preload: false });
const anekMl = Anek_Malayalam({ variable: "--font-anek-ml", subsets: ["malayalam"], preload: false });
const anekPa = Anek_Gurmukhi({ variable: "--font-anek-pa", subsets: ["gurmukhi"], preload: false });
const anekOr = Anek_Odia({ variable: "--font-anek-or", subsets: ["oriya"], preload: false });
const scripts = [anekBn, anekTa, anekTe, anekGu, anekKn, anekMl, anekPa, anekOr];

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
        className={`${inter.variable} ${anek.variable} ${anekDev.variable} ${scripts.map((f) => f.variable).join(" ")} min-h-screen antialiased`}
      >
        <SiteNav />
        {children}
        <DockedCallLog signedIn={Boolean(await getUser().catch(() => null))} />
      </body>
    </html>
  );
}
