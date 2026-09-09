import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConnectSphere",
  description: "Event management for ConnectSphere",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <header className="border-b bg-white px-6 py-4">
          <Link href="/" className="text-lg font-semibold">ConnectSphere</Link>
        </header>
        <main className="mx-auto max-w-3xl p-6">{children}</main>
      </body>
    </html>
  );
}
