// Shared setup for UI tests (pages and components).
//
// A UI test renders the real component into jsdom and drives it the way a
// person would - by its labels, buttons and text - with the network faked:
//
//   // @vitest-environment jsdom
//   import { mockApi, render, screen, signedInAs, userEvent } from "@/test/ui";
//
//   const api = mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [] });
//   render(<QueuePage />);
//   expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
//
// `next/navigation` is replaced by src/test/navigation.ts for every test;
// import `router` and `setRoute` from here to drive and inspect it.

import { vi, type Mock } from "vitest";

export { render, screen, waitFor, within, act, fireEvent } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
export { router, setRoute } from "./navigation";

export interface ApiReply {
  status: number;
  body?: unknown;
}

/// A non-200 answer: `"POST /api/events": reply(400, { error: "..." })`.
export function reply(status: number, body?: unknown): ApiReply & { __reply: true } {
  return { __reply: true, status, body };
}

function isReply(value: unknown): value is ApiReply {
  return typeof value === "object" && value !== null && "__reply" in value;
}

export interface ApiCall {
  method: string;
  /// Path without the query string.
  path: string;
  /// Path with the query string, exactly as the screen requested it.
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = unknown | ((call: ApiCall) => unknown);

export interface MockApi {
  /// Every request the screen made, in order.
  calls: ApiCall[];
  /// The requests matching "METHOD /path", e.g. api.sent("POST /api/events").
  sent: (route: string) => ApiCall[];
  /// Add or replace a route after the screen has rendered.
  on: (route: string, handler: Handler) => void;
  fetch: Mock;
}

/// Replaces `fetch`. Keys are "METHOD /path" (the query string is ignored
/// unless the key includes one). A value is the JSON to answer 200 with, a
/// reply(status, body), or a function of the request returning either. A
/// request with no matching route fails the test rather than hanging it.
export function mockApi(routes: Record<string, Handler> = {}): MockApi {
  const table = new Map(Object.entries(routes));
  const calls: ApiCall[] = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];
    const call: ApiCall = {
      method,
      path,
      url,
      body: typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);

    const key = table.has(`${method} ${url}`) ? `${method} ${url}` : `${method} ${path}`;
    if (!table.has(key)) {
      throw new Error(`mockApi: no route for ${method} ${url}`);
    }
    const handler = table.get(key);
    const result = typeof handler === "function" ? await (handler as (c: ApiCall) => unknown)(call) : handler;

    const answer = isReply(result) ? result : { status: 200, body: result };
    const { status, body } = answer;
    // 204 and friends may not carry a body at all.
    return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    calls,
    sent: (route) => calls.filter((c) => `${c.method} ${c.path}` === route),
    on: (route, handler) => void table.set(route, handler),
    fetch: fetchMock,
  };
}

export interface TestViewer {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function viewer(role: string, overrides: Partial<TestViewer> = {}): TestViewer {
  return { id: `${role}-id`, name: `Test ${role}`, email: `${role}@example.com`, role, ...overrides };
}

/// Routes that make the app believe `role` is signed in: a stored token and a
/// /api/auth/me that answers with that user. Spread into mockApi().
export function signedInAs(role: string, overrides: Partial<TestViewer> = {}): Record<string, Handler> {
  localStorage.setItem("connectsphere_token", "test-token");
  return { "GET /api/auth/me": viewer(role, overrides) };
}

/// Routes for a visitor with no session: /api/auth/me answers 401.
export function signedOut(): Record<string, Handler> {
  return { "GET /api/auth/me": reply(401, { error: "Not authenticated" }) };
}
