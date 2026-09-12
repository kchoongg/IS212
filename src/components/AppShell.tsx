"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { navFor, roleLabel } from "@/lib/roles";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { Skeleton } from "./ui/DataState";

// The chrome from UI_DESIGN.md §4.1: a top bar identical for every role, and a
// sidebar whose items come from NAV_BY_ROLE. Roles differ in what they can
// reach, never in how the application looks.

/// Screens shown before sign-in render without chrome — there is no navigation
/// to offer yet, and a sidebar of links that all bounce to /login is noise.
const BARE_ROUTES = ["/", "/login", "/register"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const { user, state, logout } = useCurrentUser();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (BARE_ROUTES.includes(pathname)) {
    return (
      <div className="min-h-screen bg-ground">
        <PublicTopBar />
        <main className="mx-auto max-w-md px-4 py-12">{children}</main>
      </div>
    );
  }

  const items = user ? navFor(user.role) : [];

  return (
    <div className="min-h-screen bg-ground">
      <TopBar
        user={user}
        loading={state === "loading"}
        onLogout={logout}
        onToggleNav={() => setMobileNavOpen((open) => !open)}
        navOpen={mobileNavOpen}
      />

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
          <SidebarNav items={items} pathname={pathname} loading={state === "loading"} />
        </aside>

        {/* Mobile slide-over */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-ink/40"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
            <aside className="absolute left-0 top-0 h-full w-64 border-r border-line bg-surface shadow-raised">
              {/* Closing on navigation rather than in an effect on pathname:
                  leaving the slide-over open would cover the screen the user
                  just asked for. */}
              <SidebarNav
                items={items}
                pathname={pathname}
                loading={state === "loading"}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-7 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

/// The mark. A serif wordmark with the brand dot — enough identity for a
/// product this size without inventing a logo we would have to maintain.
function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-clay-600" aria-hidden="true" />
      <span className="font-display text-lg font-semibold tracking-tight text-ink">
        ConnectSphere
      </span>
    </span>
  );
}

function PublicTopBar() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl items-center px-4 py-3.5 sm:px-6">
        <Link href="/">
          <Wordmark />
        </Link>
      </div>
    </header>
  );
}

interface TopBarProps {
  user: { name: string; role: string } | null;
  loading: boolean;
  navOpen: boolean;
  onToggleNav: () => void;
  onLogout: () => void;
}

function TopBar({ user, loading, navOpen, onToggleNav, onLogout }: TopBarProps) {
  const router = useRouter();

  function handleLogout() {
    onLogout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={onToggleNav}
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
          className="-ml-1 rounded-md p-2 text-ink-2 hover:bg-surface-2 md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link href="/dashboard">
          <Wordmark />
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/notifications"
            className="rounded-md p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
            aria-label="Notifications"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
          </Link>

          {loading && <Skeleton className="h-9 w-28" />}

          {!loading && user && (
            <div className="flex items-center gap-3">
              {/* The role label is here so someone testing two accounts always
                  knows which one they are signed in as. */}
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-sm font-medium text-ink">{user.name}</p>
                <p className="text-xs text-ink-3">{roleLabel(user.role)}</p>
              </div>
              <span
                aria-hidden="true"
                className="hidden h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-100 sm:flex"
              >
                {initials(user.name)}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 shadow-sm hover:bg-surface-2 hover:text-ink"
              >
                Log out
              </button>
            </div>
          )}

          {!loading && !user && (
            <Link
              href="/login"
              className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-2 shadow-sm hover:bg-surface-2"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

interface SidebarNavProps {
  items: Array<{ href: string; label: string }>;
  pathname: string;
  loading: boolean;
  /// Set by the mobile slide-over so following a link dismisses it.
  onNavigate?: () => void;
}

function SidebarNav({ items, pathname, loading, onNavigate }: SidebarNavProps) {
  if (loading) {
    return (
      <nav className="flex flex-col gap-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {items.map((item) => {
        // "/events" must stay highlighted on "/events/123", but "/" would
        // otherwise match everything, so exact-match the root.
        const active =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              // The active item gets a teal rule rather than a grey fill: it
              // reads as a position in the product, not as a pressed button.
              "relative rounded-md py-2 pl-4 pr-3 text-sm transition-colors",
              "before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:content-['']",
              active
                ? "bg-brand-50 font-medium text-brand-700 before:bg-brand-600"
                : "text-ink-2 before:bg-transparent hover:bg-surface-2 hover:text-ink"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
