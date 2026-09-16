"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, clearToken, onTokenChange } from "./session";

// Who is signed in, for the chrome and for role-gating screens.
//
// This is a convenience for rendering, NOT an access control mechanism. Every
// API route re-checks the session and the user's relationship to the record
// (customer briefing §8b); hiding a nav item only keeps the interface honest,
// it does not protect anything.

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export type AuthState = "loading" | "authenticated" | "anonymous";

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [state, setState] = useState<AuthState>("loading");

  const load = useCallback(async () => {
    try {
      const res = await authedFetch("/api/auth/me");
      if (!res.ok) {
        // 401 here means no token or an expired one. Both are "anonymous" as
        // far as the chrome is concerned; the redirect is the caller's call.
        setUser(null);
        setState("anonymous");
        return;
      }
      setUser(await res.json());
      setState("authenticated");
    } catch {
      setUser(null);
      setState("anonymous");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // ADDED: re-check whenever saveToken/clearToken runs anywhere — e.g. the
    // login page, which doesn't call this hook itself — so an
    // already-mounted shell picks up the new session without a page reload.
    return onTokenChange(() => void load());
  }, [load]);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setState("anonymous");
  }, []);

  return { user, state, refresh: load, logout };
}

/// Builds the login URL that returns the user to where they were once they
/// sign back in (UI_DESIGN.md §7.4, session expiry).
export function loginUrlFor(pathname: string): string {
  if (!pathname || pathname === "/login") return "/login";
  return `/login?next=${encodeURIComponent(pathname)}`;
}
