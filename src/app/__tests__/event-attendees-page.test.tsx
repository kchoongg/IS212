// @vitest-environment jsdom
//
// View Registration List (SPM-65): the event's Attendees tab (S-11),
// src/app/events/[id]/attendees/page.tsx. Its data is one request,
// GET /api/events/[ref]/registrations (see
// src/app/api/__tests__/event-registrations-list.test.ts for its shape),
// asked again every 15 seconds while the tab is in view (AC6).
//
// Decided here, not in the story (change the test if the team wants otherwise):
//   - every label and message quoted below
//   - the 15-second refresh, and that a refusal stops it

import { afterEach, describe, it, expect, vi } from "vitest";
import EventAttendeesPage from "@/app/events/[id]/attendees/page";
import { formatDateTime } from "@/lib/format";
import { ROLES, eventTabsFor } from "@/lib/roles";
import {
  breadcrumb,
  act,
  mockApi,
  render,
  reply,
  router,
  screen,
  setRoute,
  signedInAs,
  signedOut,
  userEvent,
  waitFor,
  within,
} from "@/test/ui";

const REF = "EVT-000007";
const LIST = `GET /api/events/${REF}/registrations`;
const LOGIN = "/login?next=%2Fevents%2FEVT-000007%2Fattendees";

const REGISTERED_AT = "2026-10-01T02:00:00.000Z";
const WITHDRAWN_AT = "2026-10-05T03:30:00.000Z";

function registration(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: name,
    status: "registered",
    registeredAt: REGISTERED_AT,
    withdrawnAt: null as string | null,
    attendee: { name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: null },
    addedBy: null,
    ...overrides,
  };
}

const marcus = registration("Marcus Yeo", { attendee: { name: "Marcus Yeo", email: "marcus@example.com", phone: "+65 9123 4567" } });
const aisha = registration("Aisha Rahman", { status: "waitlisted" });
const ben = registration("Ben Lim", { status: "withdrawn", withdrawnAt: WITHDRAWN_AT });
const chloe = registration("Chloe Tan", { status: "attended" });

function payload(registrations = [marcus], overrides: Record<string, unknown> = {}) {
  return {
    event: { sequenceNumber: 7, title: "Harbourfront Seminar", status: "confirmed" },
    registrationEnabled: true,
    registrationCapacity: 40,
    counts: { taken: 12, waitlisted: 3, withdrawn: 1 },
    registrations,
    ...overrides,
  };
}

function open(routes: Record<string, unknown> = {}, role = "organiser") {
  setRoute(`/events/${REF}/attendees`, { id: REF });
  const api = mockApi({ ...signedInAs(role), [LIST]: payload(), ...routes });
  render(<EventAttendeesPage />);
  return api;
}

/// <Table> renders every row twice (table and mobile cards): look in the table.
const table = () => screen.findByRole("table");
async function rowOf(name: string): Promise<HTMLElement> {
  const cell = within(await table()).getByText(name);
  return cell.closest("tr") as HTMLElement;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Attendees tab (SPM-65)", () => {
  describe("who can open it", () => {
    it("sends an anonymous visitor to log in", async () => {
      setRoute(`/events/${REF}/attendees`, { id: REF });
      mockApi(signedOut());

      render(<EventAttendeesPage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(LOGIN));
    });

    // AC9. The roles come from roles.ts, so giving a role the tab moves this with it.
    it.each(ROLES.filter((role) => !eventTabsFor(role).includes("attendees")))(
      "AC9: turns %s away, without asking for the registrations",
      async (role) => {
        const api = open({}, role);

        expect(
          await screen.findByText("You can only view the registrations for events you are responsible for.")
        ).toBeInTheDocument();
        expect(api.sent(LIST)).toHaveLength(0);
      }
    );

    it("AC8: says so when the server refuses an organiser who is not responsible for the event, and stops asking", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const api = open({ [LIST]: reply(403, { error: "Forbidden" }) });

      expect(
        await screen.findByText("You can only view the registrations for events you are responsible for.")
      ).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(30_000));
      expect(api.sent(LIST)).toHaveLength(1);
    });

    it("AC1: shows the tab to the organiser and the coordinator, with Attendees current", async () => {
      open({}, "coordinator");

      expect(await screen.findByRole("heading", { name: "Harbourfront Seminar" })).toBeInTheDocument();
      const tab = screen.getByRole("link", { name: "Attendees" });
      expect(tab).toHaveAttribute("href", "/events/EVT-000007/attendees");
      expect(tab).toHaveAttribute("aria-current", "page");
      expect(screen.getByText("EVT-000007")).toBeInTheDocument();
    });
  });

  // SPM-98: <list> / <event title> / Attendees, in every state.
  describe("its breadcrumb", () => {
    it.each([
      ["organiser", "My Events"],
      ["coordinator", "Events"],
    ])("for %s starts '%s', and links the event's title to its Overview", async (role, list) => {
      open({}, role);
      await screen.findByRole("heading", { name: "Harbourfront Seminar" });

      expect(breadcrumb()).toEqual([
        [list, "/events"],
        ["Harbourfront Seminar", `/events/${REF}`],
        ["Attendees", null],
      ]);
    });

    it.each([
      ["loading", () => { open({ [LIST]: () => new Promise(() => {}) }, "coordinator"); }],
      ["in error", () => { open({ [LIST]: reply(500, {}) }, "coordinator"); }],
    ])("reads 'Event' for the event while %s", async (_case, openIt) => {
      openIt();
      await screen.findByRole("navigation", { name: "Breadcrumb" });

      expect(breadcrumb()).toEqual([
        ["Events", "/events"],
        ["Event", `/events/${REF}`],
        ["Attendees", null],
      ]);
    });

    it("is the same trail when access is refused", async () => {
      open({ [LIST]: reply(403, { error: "Forbidden" }) });
      await screen.findByRole("alert");

      expect(breadcrumb()).toEqual([
        ["My Events", "/events"],
        ["Event", `/events/${REF}`],
        ["Attendees", null],
      ]);
    });
  });

  describe("loading it", () => {
    it("says so when the event does not exist or cannot be seen", async () => {
      open({ [LIST]: reply(404, { error: "Not found" }) });

      expect(await screen.findByText("This event doesn't exist, or you don't have access to it.")).toBeInTheDocument();
    });

    it("says so when the registrations fail to load, and Retry loads them again", async () => {
      const api = open({ [LIST]: reply(500, { error: "Internal server error" }) });

      expect(await screen.findByText("Could not load this event's registrations.")).toBeInTheDocument();

      api.on(LIST, payload());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await rowOf("Marcus Yeo")).toBeInTheDocument();
    });

    it("shows a general error when the server cannot be reached", async () => {
      open({ [LIST]: () => Promise.reject("offline") });

      expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    });

    it("sends the user to log in when the session has ended", async () => {
      open({ [LIST]: reply(401, { error: "Not authenticated" }) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(LOGIN));
    });
  });

  describe("what it lists", () => {
    it("AC2: shows each attendee's name, email, phone and registration date", async () => {
      open();

      const row = await rowOf("Marcus Yeo");
      expect(within(row).getByText("marcus@example.com")).toBeInTheDocument();
      expect(within(row).getByText("+65 9123 4567")).toBeInTheDocument();
      expect(within(row).getByText(formatDateTime(REGISTERED_AT))).toBeInTheDocument();
    });

    it("AC3: tells registered, waitlisted, withdrawn and checked-in attendees apart", async () => {
      open({ [LIST]: payload([marcus, aisha, ben, chloe]) });

      expect(within(await rowOf("Marcus Yeo")).getByText("Registered")).toBeInTheDocument();
      expect(within(await rowOf("Aisha Rahman")).getByText("Waiting list")).toBeInTheDocument();
      expect(within(await rowOf("Ben Lim")).getByText("Withdrawn")).toBeInTheDocument();
      expect(within(await rowOf("Chloe Tan")).getByText("Attended")).toBeInTheDocument();
    });

    it("shows when a withdrawn attendee withdrew", async () => {
      open({ [LIST]: payload([ben]) });

      expect(within(await rowOf("Ben Lim")).getByText(`Withdrew ${formatDateTime(WITHDRAWN_AT)}`)).toBeInTheDocument();
    });

    it("AC4: marks an attendee added on the organiser's behalf, and only them", async () => {
      const added = registration("Daniel Koh", { addedBy: { name: "Evelyn Chen" } });
      open({ [LIST]: payload([marcus, added]) });

      expect(within(await rowOf("Daniel Koh")).getByText("Added by Evelyn Chen")).toBeInTheDocument();
      expect(within(await rowOf("Marcus Yeo")).queryByText(/Added by/)).not.toBeInTheDocument();
    });

    it("AC5: shows the places taken against the capacity, and the waiting list", async () => {
      open();

      expect(await screen.findByText("12 of 40 places taken · 3 on the waiting list")).toBeInTheDocument();
    });

    it("AC5: says there is no limit when no capacity is set", async () => {
      open({ [LIST]: payload([marcus], { registrationCapacity: null }) });

      expect(
        await screen.findByText("12 registered (no capacity limit) · 3 on the waiting list")
      ).toBeInTheDocument();
    });

    it("says so when nobody has registered yet", async () => {
      open({ [LIST]: payload([], { counts: { taken: 0, waitlisted: 0, withdrawn: 0 } }) });

      expect(await screen.findByText("No one has registered yet")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("AC7: says registration is not enabled rather than showing an empty list", async () => {
      open({ [LIST]: payload([], { registrationEnabled: false, counts: { taken: 0, waitlisted: 0, withdrawn: 0 } }) });

      expect(await screen.findByText("Registration is not enabled for this event")).toBeInTheDocument();
      expect(screen.queryByText("No one has registered yet")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText(/places taken/)).not.toBeInTheDocument();
    });

    it("AC7: still lists anyone who registered before registration was turned off", async () => {
      open({ [LIST]: payload([marcus], { registrationEnabled: false }) });

      expect(await screen.findByText("Registration is not enabled for this event")).toBeInTheDocument();
      expect(await rowOf("Marcus Yeo")).toBeInTheDocument();
    });
  });

  describe("AC6: keeping up as registrations change", () => {
    it("asks again every 15 seconds and shows a withdrawal without a reload", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const api = open();
      expect(within(await rowOf("Marcus Yeo")).getByText("Registered")).toBeInTheDocument();

      api.on(LIST, payload([{ ...marcus, status: "withdrawn", withdrawnAt: WITHDRAWN_AT }], {
        counts: { taken: 11, waitlisted: 3, withdrawn: 2 },
      }));
      act(() => void vi.advanceTimersByTime(15_000));

      await waitFor(() => expect(within(screen.getByRole("table")).getByText("Withdrawn")).toBeInTheDocument());
      expect(screen.getByText("11 of 40 places taken · 3 on the waiting list")).toBeInTheDocument();
      expect(api.sent(LIST)).toHaveLength(2);
    });

    it("does not ask while the tab is out of view, and asks as soon as it comes back", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const api = open();
      await rowOf("Marcus Yeo");

      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      act(() => void vi.advanceTimersByTime(45_000));
      expect(api.sent(LIST)).toHaveLength(1);

      hidden.mockReturnValue(false);
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(() => expect(api.sent(LIST)).toHaveLength(2));
      hidden.mockRestore();
    });

    it("does not ask when the tab's visibility changes while it stays out of view", async () => {
      const api = open();
      await rowOf("Marcus Yeo");

      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      act(() => void window.dispatchEvent(new Event("focus")));

      expect(api.sent(LIST)).toHaveLength(1);
      hidden.mockRestore();
    });

    it("keeps the list on screen when a refresh fails", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const api = open();
      await rowOf("Marcus Yeo");

      api.on(LIST, reply(500, { error: "Internal server error" }));
      act(() => void vi.advanceTimersByTime(15_000));

      await waitFor(() => expect(api.sent(LIST)).toHaveLength(2));
      expect(screen.queryByText("Could not load this event's registrations.")).not.toBeInTheDocument();
      expect(within(screen.getByRole("table")).getByText("Marcus Yeo")).toBeInTheDocument();
    });

    it("stops asking once the page is left", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      setRoute(`/events/${REF}/attendees`, { id: REF });
      const api = mockApi({ ...signedInAs("organiser"), [LIST]: payload() });
      const { unmount } = render(<EventAttendeesPage />);
      await rowOf("Marcus Yeo");

      unmount();
      vi.advanceTimersByTime(60_000);

      expect(api.sent(LIST)).toHaveLength(1);
    });
  });
});
