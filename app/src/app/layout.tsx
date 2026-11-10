import type { Metadata } from "next";
import localFont from "next/font/local";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Self-hosted (SIL OFL 1.1, licences in src/fonts/)
const plex = localFont({
  src: "../fonts/ibm-plex-sans-latin-wght-normal.woff2",
  variable: "--font-plex",
  weight: "100 700",
  display: "swap",
});
const mono = localFont({
  src: "../fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jbmono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "levtrap",
  description: "Trap frequencies, depth and rates for levitated particles in optical, Paul and hybrid traps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={`${plex.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
