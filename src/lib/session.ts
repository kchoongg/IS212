"use client";

// Tiny client-side helper for storing the session token in the browser.
// Kept separate from src/lib/auth.ts, which only runs on the server.

const TOKEN_KEY = "connectsphere_token";

export function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
