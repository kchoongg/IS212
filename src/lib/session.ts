"use client";

// Tiny client-side helper for storing the session token in the browser.
// Kept separate from src/lib/auth.ts, which only runs on the server.

const TOKEN_KEY = "connectsphere_token";

// ADDED: the app shell's useCurrentUser() fetches /api/auth/me once on mount
// and stays mounted across client-side navigations (App Router layouts don't
// remount on router.push). Logging in on /login otherwise leaves that
// already-mounted hook sitting on its stale "anonymous" state — the sidebar
// only reappears once something remounts the tree, i.e. a manual refresh.
// Notifying subscribers here lets every mounted useCurrentUser() instance
// refetch immediately instead of waiting for a fresh page load.
const listeners = new Set<() => void>();

export function onTokenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyTokenChange() {
  listeners.forEach((listener) => listener());
}

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  notifyTokenChange();
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  notifyTokenChange();
}

export async function authedFetch(input: string, init: RequestInit = {}) {
  const token = getToken();
  return fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
}
