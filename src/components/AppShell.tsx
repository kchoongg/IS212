"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { activeNavHref, navFor, roleLabel } from "@/lib/roles";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { NOTIFICATIONS_CHANGED, unreadBadge } from "@/lib/notificationView";
import { authedFetch } from "@/lib/session";
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
  const bare = BARE_ROUTES.includes(pathname);
  const badge = unreadBadge(useUnreadCount(state === "authenticated" && !!user && !bare, pathname));

  if (bare) {
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
        unreadBadge={badge}
      />

      <div className="mx-auto flex max-w-7xl">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:block">
          <SidebarNav items={items} pathname={pathname} loading={state === "loading"} unreadBadge={badge} />
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
                unreadBadge={badge}
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
  /// SPM-71 (AC3): the unread count as shown, or null for none.
  unreadBadge: string | null;
}

function TopBar({ user, loading, navOpen, onToggleNav, onLogout, unreadBadge }: TopBarProps) {
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
            className="relative rounded-md p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
            aria-label={unreadBadge ? `Notifications, ${unreadBadge} unread` : "Notifications"}
          >
            {unreadBadge && <CountBadge className="absolute -right-1 -top-1">{unreadBadge}</CountBadge>}
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
  // Every part is non-empty (filtered above), so each has a first letter.
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

interface SidebarNavProps {
  items: Array<{ href: string; label: string }>;
  pathname: string;
  loading: boolean;
  /// Set by the mobile slide-over so following a link dismisses it.
  onNavigate?: () => void;
  /// SPM-71 (AC3): shown on the Notifications link; null for none.
  unreadBadge?: string | null;
}

function SidebarNav({ items, pathname, loading, onNavigate, unreadBadge = null }: SidebarNavProps) {
  if (loading) {
    return (
      <nav className="flex flex-col gap-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </nav>
    );
  }

  // One highlighted link only - the most specific match (activeNavHref).
  const activeHref = activeNavHref(items, pathname);

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {items.map((item) => {
        const active = item.href === activeHref;

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
            {item.href === "/notifications" && unreadBadge && (
              <>
                <CountBadge className="ml-2">{unreadBadge}</CountBadge>
                <span className="sr-only">, {unreadBadge} unread</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/// SPM-71 (AC3): the number on the bell and the sidebar's Notifications link.
/// Hidden from assistive technology - each link says ", 3 unread" in words.
function CountBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-5 text-white",
        className
      )}
    >
      {children}
    </span>
  );
}

/// SPM-71 (AC3): how many of the signed-in user's notifications are unread.
/// Asked again on every page change, and as soon as the Notifications page
/// marks something read (NOTIFICATIONS_CHANGED). The count is a courtesy: if it
/// cannot be loaded the shell carries on and simply shows no number.
function useUnreadCount(signedIn: boolean, pathname: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await authedFetch("/api/notifications/unread-count");
        if (!res.ok) return;
        const body: { unread?: unknown } = await res.json();
        if (!cancelled) setCount(typeof body.unread === "number" ? body.unread : 0);
      } catch {
        // Leave the last count in place.
      }
    };
    void refresh();
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [signedIn, pathname]);

  return signedIn ? count : 0;
}
