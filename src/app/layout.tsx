import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

// Two faces, one job each (UI_DESIGN.md §5.4):
//   Geist — everything a user reads to work: labels, data, controls. Vendored
//   in this repo, so the interface never waits on a font host.
//   Source Serif 4 — page and card titles only. It is what separates this
//   from a dashboard template at a glance. Vendored too (Latin, weights 600
//   and 700, from @fontsource/source-serif-4 5.3.1; SIL Open Font License in
//   fonts/SourceSerif4-OFL.txt): loaded through next/font/google it was
//   downloaded from Google on every build, and a failed download failed the
//   build (CI, 2026-10-21 and 2026-10-22).

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

const display = localFont({
  src: [
    { path: "./fonts/SourceSerif4-Latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/SourceSerif4-Latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ConnectSphere",
  description: "Event planning and venue booking for ConnectSphere",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable}`}
    >
      <body className="min-h-screen bg-ground font-sans text-ink">
        {/* Keyboard users land here first; the sidebar is long on some roles. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <AppShell>
          <div id="main">{children}</div>
        </AppShell>
      </body>
    </html>
  );
}
