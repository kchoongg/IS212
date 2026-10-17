// @vitest-environment jsdom
//
// The browser-side helpers in src/lib: the stored session token, the
// signed-in-user hook, form error focusing, and which event tabs a role gets.

import { describe, it, expect, vi } from "vitest";
import { authedFetch, clearToken, getToken, onTokenChange, saveToken } from "@/lib/session";
import { loginUrlFor, useCurrentUser } from "@/lib/useCurrentUser";
import { focusFirstError } from "@/lib/formErrors";
import { eventTabItemsFor } from "@/lib/eventTabs";
import { act, mockApi, render, reply, screen, signedInAs, userEvent, waitFor } from "@/test/ui";

describe("session token", () => {
  it("is saved, read back and cleared", () => {
    expect(getToken()).toBeNull();

    saveToken("abc");
    expect(getToken()).toBe("abc");

    clearToken();
    expect(getToken()).toBeNull();
  });

  it("tells subscribers when it changes, until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onTokenChange(listener);

    saveToken("abc");
    clearToken();
    unsubscribe();
    saveToken("def");

    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("authedFetch", () => {
  it("sends the stored token as a Bearer header, with JSON as the content type", async () => {
    const api = mockApi({ "GET /api/events": [] });
    saveToken("abc");

    await authedFetch("/api/events");

    expect(api.calls[0].headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer abc" });
  });

  it("sends no Authorization header when nobody is signed in", async () => {
    const api = mockApi({ "GET /api/events": [] });

    await authedFetch("/api/events");

    expect(api.calls[0].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("passes the method and body through, and lets a caller's headers win", async () => {
    const api = mockApi({ "POST /api/events": reply(201, {}) });

    await authedFetch("/api/events", {
      method: "POST",
      body: JSON.stringify({ title: "Gala" }),
      headers: { "X-Trace": "1", "Content-Type": "text/plain" },
    });

    expect(api.calls[0]).toMatchObject({ method: "POST", body: { title: "Gala" } });
    expect(api.calls[0].headers).toEqual({ "Content-Type": "text/plain", "X-Trace": "1" });
  });
});

describe("loginUrlFor", () => {
  it.each([
    ["/events/EVT-000007", "/login?next=%2Fevents%2FEVT-000007"],
    ["/venues/search?event=EVT-000007", "/login?next=%2Fvenues%2Fsearch%3Fevent%3DEVT-000007"],
    ["/login", "/login"],
    ["", "/login"],
  ])("turns %j into %j", (path, url) => {
    expect(loginUrlFor(path)).toBe(url);
  });
});

describe("useCurrentUser", () => {
  function Probe() {
    const { user, state, refresh, logout } = useCurrentUser();
    return (
      <div>
        <p>state: {state}</p>
        <p>user: {user ? `${user.name} (${user.role})` : "none"}</p>
        <button onClick={() => void refresh()}>refresh</button>
        <button onClick={logout}>logout</button>
      </div>
    );
  }

  it("starts as loading, then reports the signed-in user", async () => {
    mockApi(signedInAs("coordinator", { name: "Daniel Tan" }));

    render(<Probe />);

    expect(screen.getByText("state: loading")).toBeInTheDocument();
    expect(await screen.findByText("state: authenticated")).toBeInTheDocument();
    expect(screen.getByText("user: Daniel Tan (coordinator)")).toBeInTheDocument();
  });

  it.each([
    ["the session is rejected", reply(401, {})],
    ["the server cannot be reached", () => Promise.reject(new Error("offline"))],
  ])("reports anonymous when %s", async (_case, answer) => {
    mockApi({ "GET /api/auth/me": answer });

    render(<Probe />);

    expect(await screen.findByText("state: anonymous")).toBeInTheDocument();
    expect(screen.getByText("user: none")).toBeInTheDocument();
  });

  it("logout forgets the user and the token at once", async () => {
    const api = mockApi(signedInAs("coordinator"));
    render(<Probe />);
    await screen.findByText("state: authenticated");

    // With the token gone, the server would no longer recognise the session.
    api.on("GET /api/auth/me", reply(401, {}));
    await userEvent.click(screen.getByRole("button", { name: "logout" }));

    expect(await screen.findByText("user: none")).toBeInTheDocument();
    expect(screen.getByText("state: anonymous")).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });

  it("refresh asks the server again", async () => {
    const api = mockApi(signedInAs("coordinator", { name: "Daniel Tan" }));
    render(<Probe />);
    await screen.findByText("state: authenticated");

    api.on("GET /api/auth/me", { id: "c1", name: "Daniel T.", email: "d@example.com", role: "coordinator" });
    await userEvent.click(screen.getByRole("button", { name: "refresh" }));

    expect(await screen.findByText("user: Daniel T. (coordinator)")).toBeInTheDocument();
  });

  it("re-checks when the token changes anywhere on the page, and stops once unmounted", async () => {
    const api = mockApi({ "GET /api/auth/me": reply(401, {}) });
    const { unmount } = render(<Probe />);
    await screen.findByText("state: anonymous");

    api.on("GET /api/auth/me", { id: "o1", name: "Rachel Ng", email: "r@example.com", role: "organiser" });
    act(() => saveToken("fresh"));
    expect(await screen.findByText("user: Rachel Ng (organiser)")).toBeInTheDocument();

    const before = api.calls.length;
    unmount();
    saveToken("another");
    await waitFor(() => expect(api.calls).toHaveLength(before));
  });
});

describe("focusFirstError", () => {
  function form() {
    document.body.innerHTML = `
      <form>
        <input name="title" />
        <input name="category" />
        <input aria-invalid="true" data-testid="flagged" />
      </form>`;
    return document.querySelector("form")!;
  }

  it("focuses the field named by the first error", () => {
    const el = form();

    focusFirstError(el, { category: "Choose one", title: "Required" });

    expect(el.querySelector("[name=category]")).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("falls back to the first field marked invalid when no field has that name", () => {
    const el = form();

    focusFirstError(el, { "sessions.0.equipment": "Choose an item" });

    expect(el.querySelector("[data-testid=flagged]")).toHaveFocus();
  });

  it("scrolls the form itself into view when the error belongs to no field", () => {
    const el = form();
    const scroll = vi.spyOn(el, "scrollIntoView");

    focusFirstError(el, {});

    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(document.body).toHaveFocus();
  });

  it("does nothing without a form", () => {
    expect(() => focusFirstError(null, { title: "Required" })).not.toThrow();
  });
});

describe("eventTabItemsFor", () => {
  // As for the organiser who raised the event, or its assigned coordinator.
  const labels = (role: string) => eventTabItemsFor(role, "EVT-000007", true).map((t) => t.label);

  it.each([
    // SPM-33: the Readiness tab is built, and only a coordinator has it
    // (EVENT_TABS_BY_ROLE in roles.ts).
    ["coordinator", ["Overview", "Venue", "Equipment", "Attendees", "Readiness"]],
    ["organiser", ["Overview", "Equipment", "Attendees"]],
    ["venue_staff", ["Overview", "Venue"]],
    ["tech_support", ["Overview", "Equipment"]],
    ["ops_manager", ["Overview"]],
    ["attendee", ["Overview"]],
    ["intern", ["Overview"]],
  ])("gives %s the tabs %j", (role, expected) => {
    expect(labels(role)).toEqual(expected);
  });

  // SPM-65: another organiser at the same client, a coordinator not assigned
  // to the event, or a screen that has not heard back yet.
  it.each([
    ["coordinator", ["Overview", "Venue", "Equipment", "Readiness"]],
    ["organiser", ["Overview", "Equipment"]],
  ])("leaves Attendees out for %s when the registration list is not theirs", (role, expected) => {
    expect(eventTabItemsFor(role, "EVT-000007", false).map((t) => t.label)).toEqual(expected);
    expect(eventTabItemsFor(role, "EVT-000007").map((t) => t.label)).toEqual(expected);
  });

  it("links Overview to the event itself and every other tab beneath it", () => {
    expect(eventTabItemsFor("coordinator", "EVT-000007", true)).toEqual([
      { key: "overview", label: "Overview", href: "/events/EVT-000007" },
      { key: "venue", label: "Venue", href: "/events/EVT-000007/venue" },
      { key: "equipment", label: "Equipment", href: "/events/EVT-000007/equipment" },
      { key: "attendees", label: "Attendees", href: "/events/EVT-000007/attendees" },
      { key: "readiness", label: "Readiness", href: "/events/EVT-000007/readiness" },
    ]);
  });
});
