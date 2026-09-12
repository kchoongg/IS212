import type { Metadata } from "next";
import localFont from "next/font/local";
import { Source_Serif_4 } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

// Two faces, one job each (UI_DESIGN.md §5.4):
//   Geist — everything a user reads to work: labels, data, controls. Vendored
//   in this repo, so the interface never waits on a font host.
//   Source Serif 4 — page and card titles only. It is what separates this
//   from a dashboard template at a glance.

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

const display = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700"],
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
