// @vitest-environment jsdom
//
// Track Outstanding Arrangements (SPM-33): the event's Readiness tab (S-18).
//
// CONTRACT (SPM-33, written before the code) - what these tests expect to exist:
//   src/app/events/[id]/readiness/page.tsx   default export, the Readiness tab
//   src/lib/eventTabs.ts                     "readiness" added to IMPLEMENTED_TABS
//
//   The page makes ONE request for its data, GET /api/events/[ref]/arrangements
//   (see src/app/api/__tests__/event-arrangements.test.ts for its shape), and
//   PATCH to the same address to mark an arrangement. The PATCH answers with
//   the list again, and the page shows that answer.
//
//   On the page:
//   - the event's title and reference, and the tabs with Readiness current
//   - a summary: "2 arrangements still block confirmation",
//     "1 arrangement still blocks confirmation" or "Nothing is blocking confirmation"
//   - one list, labelled "Arrangements", with one list item per arrangement:
//     its name, its session (if any), its own status ("Pending", "Reserved"...),
//     its state ("Complete", "Outstanding" or "Not required"), and for an
//     outstanding one what is missing
//   - on one marked as not required, who marked it and when:
//     "Marked as not required by Daniel Tan on 8 Oct 2026, 11:00"
//   - "Mark as not required" on an arrangement that can be, and "Mark as
//     required" on one that is marked - only when the answer says canManage
//
// Decided here, not in the story (change the test if the team wants otherwise):
//   - it is the Readiness tab, at /events/[ref]/readiness, for coordinators only
//   - every label and message quoted below
//   - marking takes one click and asks nothing first: it is undone the same way
//   - there is no Confirm event button here; it stays on the Overview (SPM-34)
//
// The Operational Safety Check (AC6, AC9; added 2026-10-12) is one more item
// in the list, with its own status ("Awaiting review", "Changes requested"...)
// and the note of who submitted it. It never has a button. While Confirm does
// not wait for it (SPM-88), it is not counted in the summary, and its item
// says "Confirm event does not wait for it yet.".

import { describe, it, expect } from "vitest";
import EventReadinessPage from "@/app/events/[id]/readiness/page";
import { formatDateTime } from "@/lib/format";
import { ROLES, eventTabsFor } from "@/lib/roles";
import {
  breadcrumb,
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
const LIST = `GET /api/events/${REF}/arrangements`;
const MARK = `PATCH /api/events/${REF}/arrangements`;
const LOGIN = "/login?next=%2Fevents%2FEVT-000007%2Freadiness";

interface Arrangement {
  kind: string;
  id: string | null;
  name: string;
  session: { id: string; label: string | null } | null;
  status: string | null;
  state: "complete" | "outstanding" | "not_required";
  required: boolean;
  complete: boolean;
  missing: string;
  /// SPM-90: what a venue booking's space is for.
  purpose?: string | null;
  flagReason: string;
  waivable: boolean;
  waived: boolean;
  notRequiredBy: string | null;
  notRequiredAt: string | null;
  blocksConfirmation: boolean;
  note: string;
}

const MARKED_AT = "2026-10-08T03:00:00.000Z";

function arrangement(overrides: Partial<Arrangement> = {}): Arrangement {
  return {
    kind: "venue",
    id: "b1",
    name: "Marina Auditorium",
    session: null,
    status: "approved",
    state: "complete",
    required: true,
    complete: true,
    missing: "",
    flagReason: "",
    waivable: false,
    waived: false,
    notRequiredBy: null,
    notRequiredAt: null,
    blocksConfirmation: true,
    note: "",
    ...overrides,
  };
}

/// The state is applied last, so an existing arrangement can be passed in to
/// say "the same one, now outstanding" or "now marked as not required".
const outstanding = (overrides: Partial<Arrangement>) =>
  arrangement({
    waivable: true,
    ...overrides,
    state: "outstanding",
    required: true,
    complete: false,
    notRequiredBy: null,
    notRequiredAt: null,
  });
const notRequired = (overrides: Partial<Arrangement>) =>
  arrangement({
    ...overrides,
    state: "not_required",
    required: false,
    complete: false,
    waivable: false,
    waived: true,
    missing: "",
    notRequiredBy: "Daniel Tan",
    notRequiredAt: MARKED_AT,
  });

const auditorium = arrangement();
const studioPending = outstanding({
  id: "b2",
  name: "Orchard Studio",
  status: "pending",
  missing: "Orchard Studio for this event is still awaiting a decision from Venue Staff",
});
const micReserved = arrangement({ kind: "equipment", id: "r1", name: "Handheld Wireless Mic", status: "reserved" });
const deskRequested = outstanding({
  kind: "equipment",
  id: "r2",
  name: "Audio Mixing Desk",
  status: "requested",
  missing: "Audio Mixing Desk for this event is not reserved yet",
});
const stageWaived = notRequired({ kind: "equipment", id: "r3", name: "Portable Stage", status: "unavailable" });
const registrationIncomplete = outstanding({
  kind: "registration",
  id: null,
  name: "Registration setup",
  status: null,
  missing: "registration is enabled but has no capacity",
});
const noVenue = outstanding({
  id: null,
  name: "No venue booked",
  status: null,
  missing: "no venue is booked for this event",
  waivable: false,
});

function payload(arrangements: Arrangement[], overrides: Record<string, unknown> = {}) {
  return {
    event: { sequenceNumber: 7, title: "Gala Dinner", status: "planning" },
    canManage: true,
    blocking: arrangements.filter((a) => a.required && !a.complete && a.blocksConfirmation).length,
    arrangements,
    ...overrides,
  };
}

function open(arrangements: Arrangement[] = [auditorium], routes: Record<string, unknown> = {}, role = "coordinator") {
  setRoute(`/events/${REF}/readiness`, { id: REF });
  const api = mockApi({ ...signedInAs(role), [LIST]: payload(arrangements), ...routes });
  render(<EventReadinessPage />);
  return api;
}

/// Every arrangement, whichever section it is in (venue bookings, equipment...).
const list = () => screen.findByRole("region", { name: "Arrangements" });
/// The list item for one arrangement, found by its name.
async function row(name: string): Promise<HTMLElement> {
  const items = within(await list()).getAllByRole("listitem");
  const found = items.find((item) => within(item).queryByText(name));
  if (!found) throw new Error(`No arrangement named "${name}" is listed`);
  return found;
}
const markNotRequired = (item: HTMLElement) => within(item).getByRole("button", { name: "Mark as not required" });
const markRequired = (item: HTMLElement) => within(item).getByRole("button", { name: "Mark as required" });

describe("Event Readiness tab (SPM-33)", () => {
  describe("who can open it", () => {
    it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
      setRoute(`/events/${REF}/readiness`, { id: REF });
      mockApi(signedOut());

      render(<EventReadinessPage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(LOGIN));
    });

    it("[SPM-33] renders nothing until it knows who is looking", () => {
      setRoute(`/events/${REF}/readiness`, { id: REF });
      mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

      const { container } = render(<EventReadinessPage />);

      expect(container).toBeEmptyDOMElement();
    });

    // The roles come from roles.ts, so giving a role the tab moves this with it.
    it.each(ROLES.filter((role) => !eventTabsFor(role).includes("readiness")))(
      "[SPM-22][AC4] turns %s away, without asking for the arrangements",
      async (role) => {
        const api = open([auditorium], {}, role);

        expect(await screen.findByText("You don't have access to this event.")).toBeInTheDocument();
        expect(screen.queryByText("Marina Auditorium")).not.toBeInTheDocument();
        expect(api.sent(LIST)).toHaveLength(0);
      }
    );
  });

  // SPM-98: <list> / <event title> / Readiness, in every state.
  describe("its breadcrumb", () => {
    it.each([
      ["coordinator", "Events"],
    ])("[SPM-98] for %s starts '%s', and links the event's title to its Overview", async (role, list) => {
      open([auditorium], {}, role);
      await screen.findByRole("heading", { name: "Gala Dinner" });

      expect(breadcrumb()).toEqual([
        [list, "/events"],
        ["Gala Dinner", `/events/${REF}`],
        ["Readiness", null],
      ]);
    });

    it.each([
      ["loading", () => { open([auditorium], { [LIST]: () => new Promise(() => {}) }); }],
      ["in error", () => { open([auditorium], { [LIST]: reply(500, {}) }); }],
    ])("[SPM-98] reads 'Event' for the event while %s", async (_case, openIt) => {
      openIt();
      await screen.findByRole("navigation", { name: "Breadcrumb" });

      expect(breadcrumb()).toEqual([
        ["Events", "/events"],
        ["Event", `/events/${REF}`],
        ["Readiness", null],
      ]);
    });

    it("[SPM-98] is the same trail when access is refused", async () => {
      open([auditorium], {}, "organiser");
      await screen.findByRole("alert");

      expect(breadcrumb()).toEqual([
        ["My Events", "/events"],
        ["Event", `/events/${REF}`],
        ["Readiness", null],
      ]);
    });
  });

  describe("loading it", () => {
    it("[SPM-33] shows the event, its reference and its tabs, with Readiness current", async () => {
      open();

      expect(await screen.findByRole("heading", { name: "Gala Dinner" })).toBeInTheDocument();
      expect(screen.getByText("EVT-000007")).toBeInTheDocument();
      const tab = screen.getByRole("link", { name: "Readiness" });
      expect(tab).toHaveAttribute("href", "/events/EVT-000007/readiness");
      expect(tab).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/events/EVT-000007");
    });

    // SPM-65: the Attendees tab only where the server says the list is theirs.
    it.each([
      ["the assigned coordinator", true],
      ["a coordinator not assigned to the event", false],
    ])("[SPM-22][AC2] offers %s the Attendees tab only when the registrations are theirs", async (_who, canView) => {
      open([auditorium], { [LIST]: payload([auditorium], { canViewRegistrationList: canView }) });

      await screen.findByRole("heading", { name: "Gala Dinner" });
      const tabs = within(screen.getByRole("navigation", { name: "Sections" })).getAllByRole("link");
      expect(tabs.map((t) => t.textContent)).toEqual(
        canView ? ["Overview", "Venue", "Equipment", "Attendees", "Readiness"] : ["Overview", "Venue", "Equipment", "Readiness"]
      );
    });

    it("[SPM-33] says so when the event does not exist or cannot be seen", async () => {
      open([], { [LIST]: reply(404, { error: "Not found" }) });

      expect(
        await screen.findByText("This event doesn't exist, or you don't have access to it.")
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Event" })).toBeInTheDocument();
    });

    it("[SPM-33] shows a general error when loading fails without a reason", async () => {
      open([], { [LIST]: () => Promise.reject("offline") });

      expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    });

    it("[SPM-33] says so when the arrangements fail to load, and Retry loads them again", async () => {
      const api = open([], { [LIST]: reply(500, { error: "Internal server error" }) });

      expect(await screen.findByText("Could not load this event's arrangements.")).toBeInTheDocument();

      api.on(LIST, payload([auditorium]));
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await row("Marina Auditorium")).toBeInTheDocument();
      expect(screen.queryByText("Could not load this event's arrangements.")).not.toBeInTheDocument();
    });

    it("[SPM-22][AC4] sends the coordinator to log in when the session has ended", async () => {
      open([], { [LIST]: reply(401, { error: "Not authenticated" }) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(LOGIN));
    });
  });

  describe("what it lists", () => {
    // SPM-90 AC5 (written before the code).
    it("[SPM-90][AC5] SPM-90-TC07: shows what each booked space is for, before its booking status", async () => {
      open([
        { ...auditorium, purpose: "Main programme" },
        { ...studioPending, purpose: "Breakout room" },
      ]);

      expect(await row("Marina Auditorium")).toHaveTextContent("Space: Main programme · Booking status: Approved");
      expect(await row("Orchard Studio")).toHaveTextContent("Space: Breakout room · Booking status: Pending");
    });

    it("[SPM-90][AC7] SPM-90-TC10: shows no space for a booking made without one", async () => {
      open([{ ...auditorium, purpose: null }]);

      expect(await row("Marina Auditorium")).not.toHaveTextContent("Space:");
    });

    // AC1, AC2.
    it("[SPM-33][AC2] lists each venue booking separately, with its own status", async () => {
      open([auditorium, studioPending]);

      const approved = await row("Marina Auditorium");
      const pending = await row("Orchard Studio");

      expect(approved).not.toBe(pending);
      expect(approved).toHaveTextContent("Approved");
      expect(approved).toHaveTextContent("Complete");
      expect(pending).toHaveTextContent("Pending");
      expect(pending).toHaveTextContent("Outstanding");
      expect(pending).toHaveTextContent(/still awaiting a decision from Venue Staff/i);
    });

    it("[SPM-33][AC1] says no venue is booked when the event has none", async () => {
      open([noVenue]);

      const item = await row("No venue booked");

      expect(item).toHaveTextContent("Outstanding");
      expect(item).toHaveTextContent(/no venue is booked for this event/i);
    });

    it("[SPM-33][AC2] shows which session a booking belongs to", async () => {
      open([
        arrangement({ session: { id: "s1", label: "Day 1" } }),
        { ...noVenue, session: { id: "s2", label: "Day 2" }, missing: "no venue is booked for the Day 2 session" },
      ]);

      expect(await row("Marina Auditorium")).toHaveTextContent("Day 1");
      expect(await row("No venue booked")).toHaveTextContent("Day 2");
    });

    it("[SPM-33][AC2] still says which part of the event an arrangement is for when the session has no name", async () => {
      open([arrangement({ session: { id: "s1", label: null } })]);

      expect(await row("Marina Auditorium")).toHaveTextContent("Session");
    });

    // AC3.
    it("[SPM-33][AC3] lists each equipment line with its own status, and what is still outstanding", async () => {
      open([auditorium, micReserved, deskRequested]);

      const mic = await row("Handheld Wireless Mic");
      const desk = await row("Audio Mixing Desk");

      expect(mic).toHaveTextContent("Reserved");
      expect(mic).toHaveTextContent("Complete");
      expect(desk).toHaveTextContent("Requested");
      expect(desk).toHaveTextContent("Outstanding");
      expect(desk).toHaveTextContent(/not reserved yet/i);
    });

    it("[SPM-33][AC3] shows an equipment line Technical Support cannot provide as outstanding", async () => {
      open([
        auditorium,
        outstanding({
          kind: "equipment",
          id: "r3",
          name: "Portable Stage",
          status: "unavailable",
          missing: "Portable Stage for this event is not reserved yet",
        }),
      ]);

      const stage = await row("Portable Stage");

      expect(stage).toHaveTextContent("Cannot be provided");
      expect(stage).toHaveTextContent("Outstanding");
      expect(stage).toHaveTextContent(/not reserved yet/i);
    });

    // Held, as for Confirm and Submit for safety check (SPM-86): nothing to mark.
    it("[SPM-33][AC3][AC7] shows a partly reserved equipment line as complete, with nothing to mark", async () => {
      open([auditorium, arrangement({ kind: "equipment", id: "r4", name: "Audio Mixing Desk", status: "partially_fulfilled" })]);

      const desk = await row("Audio Mixing Desk");

      expect(desk).toHaveTextContent("Partially fulfilled");
      expect(desk).toHaveTextContent("Complete");
      expect(within(desk).queryByRole("button")).not.toBeInTheDocument();
    });

    // AC4.
    it("[SPM-33][AC4] shows a flagged booking as outstanding, with why it was flagged", async () => {
      open([
        outstanding({
          flagReason: "the date or time changed",
          missing: "Marina Auditorium for this event is flagged for review: the date or time changed",
        }),
      ]);

      const item = await row("Marina Auditorium");

      expect(item).toHaveTextContent("Approved");
      expect(item).toHaveTextContent("Outstanding");
      expect(item).not.toHaveTextContent("Complete");
      expect(item).toHaveTextContent(/flagged for review: the date or time changed/i);
    });

    it("[SPM-33][AC4] shows flagged equipment as outstanding, with why it was flagged", async () => {
      open([
        auditorium,
        outstanding({
          ...micReserved,
          waivable: true,
          flagReason: "the date or time changed",
          missing: "Handheld Wireless Mic for this event is flagged for review: the date or time changed",
        }),
      ]);

      const mic = await row("Handheld Wireless Mic");

      expect(mic).toHaveTextContent("Reserved");
      expect(mic).toHaveTextContent("Outstanding");
      expect(mic).toHaveTextContent(/flagged for review: the date or time changed/i);
    });

    // SPM-68: a flagged arrangement is kept here or on the Flagged
    // Arrangements page, and replaced from there. Keep is offered only while
    // it still meets the event's requirements - the live result comes from
    // the same request the Flagged Arrangements page makes.
    describe("reviewing a flagged arrangement (SPM-68)", () => {
      const FLAGGED = "GET /api/flagged-arrangements";
      const KEEP = "POST /api/flagged-arrangements";
      const flaggedBooking = outstanding({
        flagReason: "the date or time changed",
        missing: "Marina Auditorium for this event is flagged for review: the date or time changed",
      });
      const flaggedMic = outstanding({
        ...micReserved,
        flagReason: "the date or time changed",
        missing: "Handheld Wireless Mic for this event is flagged for review: the date or time changed",
      });
      const fits = { ok: true, unmet: [] as string[] };
      /// The Flagged Arrangements list, as far as this page reads it.
      const live = (
        venueBookings: object[] = [{ id: flaggedBooking.id, suitability: fits, availability: fits }],
        equipmentRequests: object[] = []
      ) => ({ venueBookings, equipmentRequests, registrations: [] });

      function openWith(
        arrangements: Arrangement[],
        { overrides = { canReviewFlags: true }, routes = {} }: { overrides?: Record<string, unknown>; routes?: Record<string, unknown> } = {}
      ) {
        return open(arrangements, { [LIST]: payload(arrangements, overrides), [FLAGGED]: live(), ...routes });
      }
      const reviewLink = (item: HTMLElement) => within(item).queryByRole("link", { name: "Review in Flagged Arrangements" });
      const keepButton = (item: HTMLElement, name = "Keep booking") => within(item).queryByRole("button", { name });

      it("[SPM-68][AC1] links a flagged booking to the Venue bookings tab of Flagged Arrangements", async () => {
        openWith([flaggedBooking]);

        expect(reviewLink(await row("Marina Auditorium"))).toHaveAttribute("href", "/flagged?tab=venue");
      });

      it("[SPM-68][AC1] links flagged equipment to the Equipment reservations tab", async () => {
        openWith([auditorium, flaggedMic]);

        expect(reviewLink(await row("Handheld Wireless Mic"))).toHaveAttribute("href", "/flagged?tab=equipment");
        // The booking beside it is not flagged, so it has neither link nor Keep.
        expect(reviewLink(await row("Marina Auditorium"))).not.toBeInTheDocument();
        expect(keepButton(await row("Marina Auditorium"))).not.toBeInTheDocument();
      });

      it("[SPM-68][AC6] offers Keep booking on a flagged booking that still meets the event's requirements", async () => {
        openWith([flaggedBooking]);

        const item = await row("Marina Auditorium");
        await waitFor(() => expect(keepButton(item)).toBeInTheDocument());
        expect(item).not.toHaveTextContent("can't be kept");
        // Marking it as not required is still there too: that is a different decision.
        expect(keepButton(item, "Mark as not required")).toBeInTheDocument();
      });

      it("[SPM-68][AC6] offers Keep reservation on flagged equipment that is still available", async () => {
        openWith([auditorium, flaggedMic], {
          routes: { [FLAGGED]: live([], [{ id: flaggedMic.id, availability: { ok: true, summary: "2 reserved, 4 available for these dates." } }]) },
        });

        const item = await row("Handheld Wireless Mic");
        await waitFor(() => expect(keepButton(item, "Keep reservation")).toBeInTheDocument());
      });

      it("[SPM-68][AC7] offers no Keep on a booking that no longer fits, and says what is unmet", async () => {
        openWith([flaggedBooking], {
          routes: {
            [FLAGGED]: live([
              {
                id: flaggedBooking.id,
                suitability: { ok: false, unmet: ["Theatre capacity is 100 - this space expects 150."] },
                availability: { ok: false, unmet: ["Marina Auditorium has been retired."] },
              },
            ]),
          },
        });

        const item = await row("Marina Auditorium");
        await waitFor(() =>
          expect(item).toHaveTextContent("This booking can't be kept while it doesn't meet the event's requirements.")
        );
        expect(item).toHaveTextContent("Theatre capacity is 100 - this space expects 150.");
        expect(item).toHaveTextContent("Marina Auditorium has been retired.");
        expect(keepButton(item)).not.toBeInTheDocument();
        expect(reviewLink(item)).toBeInTheDocument();
      });

      it("[SPM-68][AC7] offers no Keep on equipment that can no longer be covered, and names the shortfall", async () => {
        openWith([auditorium, flaggedMic], {
          routes: { [FLAGGED]: live([], [{ id: flaggedMic.id, availability: { ok: false, summary: "2 reserved, 1 available for these dates." } }]) },
        });

        const item = await row("Handheld Wireless Mic");
        await waitFor(() =>
          expect(item).toHaveTextContent("This reservation can't be kept while it doesn't meet the event's requirements.")
        );
        expect(item).toHaveTextContent("2 reserved, 1 available for these dates.");
        expect(keepButton(item, "Keep reservation")).not.toBeInTheDocument();
      });

      it("[SPM-68][AC6] keeps the booking, says the flag is cleared, and shows the list as it now stands", async () => {
        const api = openWith([flaggedBooking], { routes: { [KEEP]: { cleared: true } } });
        const item = await row("Marina Auditorium");
        await waitFor(() => expect(keepButton(item)).toBeInTheDocument());
        api.on(LIST, payload([auditorium], { canReviewFlags: true }));

        await userEvent.click(keepButton(item)!);

        expect(await screen.findByText("Flag cleared")).toBeInTheDocument();
        expect(screen.getByText("Marina Auditorium was kept as it is.")).toBeInTheDocument();
        expect(api.sent(KEEP)[0].body).toEqual({ kind: "venue_booking", id: flaggedBooking.id });
        const after = await row("Marina Auditorium");
        await waitFor(() => expect(after).toHaveTextContent("Complete"));
        expect(keepButton(after)).not.toBeInTheDocument();
        expect(reviewLink(after)).not.toBeInTheDocument();
      });

      it("[SPM-68][AC6] keeps equipment by its own kind", async () => {
        const api = openWith([auditorium, flaggedMic], {
          routes: {
            [FLAGGED]: live([], [{ id: flaggedMic.id, availability: { ok: true, summary: "2 reserved, 4 available for these dates." } }]),
            [KEEP]: { cleared: true },
          },
        });
        const item = await row("Handheld Wireless Mic");
        await waitFor(() => expect(keepButton(item, "Keep reservation")).toBeInTheDocument());

        await userEvent.click(keepButton(item, "Keep reservation")!);

        await waitFor(() => expect(api.sent(KEEP)[0].body).toEqual({ kind: "equipment_request", id: flaggedMic.id }));
        expect(await screen.findByText("Handheld Wireless Mic was kept as it is.")).toBeInTheDocument();
      });

      // The page's result was out of date: the server still decides (AC7).
      it("[SPM-68][AC7] shows the server's refusal, and clears nothing", async () => {
        const refusal = "Marina Auditorium no longer meets this event's requirements: Theatre capacity is 100 - this space expects 150.";
        openWith([flaggedBooking], { routes: { [KEEP]: reply(400, { error: refusal }) } });
        const item = await row("Marina Auditorium");
        await waitFor(() => expect(keepButton(item)).toBeInTheDocument());

        await userEvent.click(keepButton(item)!);

        expect(await screen.findByText(refusal)).toBeInTheDocument();
        expect(screen.queryByText("Flag cleared")).not.toBeInTheDocument();
      });

      it.each([
        ["gives no reason", reply(500, {}), "Could not clear the flag. Try again."],
        ["answers with an empty body", reply(500), "Could not clear the flag. Try again."],
        [
          "cannot be reached",
          () => {
            throw new Error("offline");
          },
          "Could not reach the server. Check your connection and try again.",
        ],
      ])("[SPM-68] says so when the server %s", async (_what, answer, message) => {
        openWith([flaggedBooking], { routes: { [KEEP]: answer } });
        const item = await row("Marina Auditorium");
        await waitFor(() => expect(keepButton(item)).toBeInTheDocument());

        await userEvent.click(keepButton(item)!);

        expect(await screen.findByText(message)).toBeInTheDocument();
      });

      it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
        openWith([flaggedBooking], { routes: { [KEEP]: reply(401, {}) } });
        const item = await row("Marina Auditorium");
        await waitFor(() => expect(keepButton(item)).toBeInTheDocument());

        await userEvent.click(keepButton(item)!);

        await waitFor(() => expect(router.push).toHaveBeenCalledWith(LOGIN));
      });

      it.each([
        ["answers with an error", reply(500, {})],
        [
          "cannot be reached",
          () => {
            throw new Error("offline");
          },
        ],
      ])("[SPM-68][AC7] keeps the link and offers no Keep when the live result %s", async (_what, answer) => {
        const api = openWith([flaggedBooking], { routes: { [FLAGGED]: answer } });

        const item = await row("Marina Auditorium");
        await waitFor(() => expect(api.sent(FLAGGED)).toHaveLength(1));
        expect(reviewLink(item)).toBeInTheDocument();
        expect(keepButton(item)).not.toBeInTheDocument();
        expect(item).not.toHaveTextContent("can't be kept");
      });

      it("[SPM-68] offers no Keep on a flagged arrangement the live list does not have", async () => {
        const api = openWith([flaggedBooking], { routes: { [FLAGGED]: live([]) } });

        const item = await row("Marina Auditorium");
        await waitFor(() => expect(api.sent(FLAGGED)).toHaveLength(1));
        expect(keepButton(item)).not.toBeInTheDocument();
      });

      it("[SPM-33][AC4] still links a flagged request Venue Staff have not decided, which is outstanding for that reason", async () => {
        openWith([
          outstanding({
            status: "pending",
            flagReason: "the date or time changed",
            missing: "Marina Auditorium for this event is still awaiting a decision from Venue Staff",
          }),
        ]);

        expect(reviewLink(await row("Marina Auditorium"))).toBeInTheDocument();
      });

      it("[SPM-68] does not ask for the live result when nothing on the event is flagged", async () => {
        const api = openWith([outstanding({ status: "pending", missing: "Marina Auditorium for this event is still awaiting a decision from Venue Staff" })]);

        const item = await row("Marina Auditorium");
        expect(reviewLink(item)).not.toBeInTheDocument();
        expect(api.sent(FLAGGED)).toHaveLength(0);
      });

      // Marking as not required waives it for confirmation; the flag is still there.
      it("[SPM-68][AC6] [SPM-33][AC10] keeps the link and Keep on a flagged arrangement that is marked as not required", async () => {
        openWith([arrangement({ flagReason: "the date or time changed", state: "not_required", required: false, complete: false, waived: true })]);

        const item = await row("Marina Auditorium");
        expect(reviewLink(item)).toBeInTheDocument();
        await waitFor(() => expect(keepButton(item)).toBeInTheDocument());
        expect(keepButton(item, "Mark as required")).toBeInTheDocument();
      });

      it.each([
        ["another coordinator, who would not find it listed", { canReviewFlags: false }],
        ["an answer that does not say", {}],
      ])("[SPM-68] has neither link nor Keep for %s, and does not ask for the live result", async (_who, overrides) => {
        const api = openWith([flaggedBooking], { overrides });

        const item = await row("Marina Auditorium");
        expect(reviewLink(item)).not.toBeInTheDocument();
        expect(keepButton(item)).not.toBeInTheDocument();
        expect(api.sent(FLAGGED)).toHaveLength(0);
      });

      it("[SPM-68] has no link on a kind the Flagged Arrangements page has no tab for", async () => {
        openWith([outstanding({ kind: "registration", id: null, name: "Registration setup", status: null, flagReason: "the date or time changed", missing: "registration setup is incomplete" })]);

        expect(reviewLink(await row("Registration setup"))).not.toBeInTheDocument();
      });
    });

    // AC5.
    it("[SPM-33][AC5] shows registration that is enabled but incomplete as outstanding", async () => {
      open([auditorium, registrationIncomplete]);

      const item = await row("Registration setup");

      expect(item).toHaveTextContent("Outstanding");
      expect(item).toHaveTextContent(/registration is enabled but has no capacity/i);
    });

    // The account that marked it has since been removed: the time still stands.
    it("[SPM-33][AC10] still says when an arrangement was marked as not required if nobody is named", async () => {
      open([auditorium, { ...stageWaived, notRequiredBy: null }]);

      const stage = await row("Portable Stage");

      expect(stage).toHaveTextContent(`Marked as not required on ${formatDateTime(MARKED_AT)}`);
      expect(stage).not.toHaveTextContent("Marked as not required by");
    });

    // AC7, AC10.
    it("[SPM-33][AC7][AC10] tells complete, outstanding and not-required arrangements apart", async () => {
      open([auditorium, deskRequested, stageWaived]);

      const complete = await row("Marina Auditorium");
      const waiting = await row("Audio Mixing Desk");
      const waived = await row("Portable Stage");

      expect(complete).toHaveTextContent("Complete");
      expect(complete).not.toHaveTextContent("Outstanding");
      expect(complete).not.toHaveTextContent("Not required");

      expect(waiting).toHaveTextContent("Outstanding");
      expect(waiting).not.toHaveTextContent("Complete");
      expect(waiting).not.toHaveTextContent("Not required");

      expect(waived).toHaveTextContent("Not required");
      expect(waived).not.toHaveTextContent("Outstanding");
      expect(waived).not.toHaveTextContent("Complete");
      // Its own status is still shown: Technical Support could not provide it.
      expect(waived).toHaveTextContent("Cannot be provided");
    });

    // Briefing 8f (Auditability), customer answer #14: who did it, and when.
    it("[SPM-33][AC10] says who marked an arrangement as not required, and when", async () => {
      open([auditorium, deskRequested, stageWaived]);

      expect(await row("Portable Stage")).toHaveTextContent(
        `Marked as not required by Daniel Tan on ${formatDateTime(MARKED_AT)}`
      );
      expect(await row("Marina Auditorium")).not.toHaveTextContent("Marked as not required by");
      expect(await row("Audio Mixing Desk")).not.toHaveTextContent("Marked as not required by");
    });
  });

  // AC11.
  describe("what is preventing confirmation", () => {
    it("[SPM-33][AC11] counts the outstanding arrangements, leaving out those marked as not required", async () => {
      open([auditorium, studioPending, deskRequested, stageWaived]);

      expect(await screen.findByText("2 arrangements still block confirmation")).toBeInTheDocument();
    });

    it("[SPM-33][AC11] counts a single one in the singular", async () => {
      open([auditorium, deskRequested]);

      expect(await screen.findByText("1 arrangement still blocks confirmation")).toBeInTheDocument();
    });

    it("[SPM-33][AC11] says nothing is blocking once everything is complete or not required", async () => {
      open([auditorium, micReserved, stageWaived]);

      expect(await screen.findByText("Nothing is blocking confirmation")).toBeInTheDocument();
      expect(screen.queryByText(/still block/)).not.toBeInTheDocument();
    });
  });

  // Cleaned up 2026-10-12 so a first-time user can read it.
  describe("how it is laid out", () => {
    it("[SPM-33] groups the arrangements into sections, in the order they are worked through", async () => {
      open([auditorium, deskRequested, registrationIncomplete]);

      await row("Marina Auditorium");
      expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
        "Venue bookings",
        "Equipment",
        "Registration",
      ]);
      expect(within(screen.getByRole("list", { name: "Equipment" })).getByText("Audio Mixing Desk")).toBeInTheDocument();
    });

    it("[SPM-33][AC7][AC10] says what each state means", async () => {
      open();

      await row("Marina Auditorium");
      const key = screen.getByText("In place.").closest("dl") as HTMLElement;
      expect(key).toHaveTextContent("CompleteIn place.");
      expect(key).toHaveTextContent("OutstandingStill to be done.");
      expect(key).toHaveTextContent("Not requiredMarked as not needed for this event.");
    });

    it("[SPM-33] says what an arrangement's own status is the status of", async () => {
      open([
        auditorium,
        arrangement({ session: { id: "s1", label: "Day 1" }, id: "b9", name: "Orchard Studio", status: "pending" }),
        deskRequested,
      ]);

      expect(await row("Marina Auditorium")).toHaveTextContent("Booking status: Approved");
      expect(await row("Orchard Studio")).toHaveTextContent("Session: Day 1 · Booking status: Pending");
      expect(await row("Audio Mixing Desk")).toHaveTextContent("Request status: Requested");
    });

    it("[SPM-33][AC3][AC5] says when the event has no equipment, or registration is not enabled", async () => {
      open([auditorium]);

      expect(await screen.findByText("No equipment has been recorded for this event.")).toBeInTheDocument();
      expect(screen.getByText("Registration is not enabled for this event.")).toBeInTheDocument();
    });

    // SPM-64: registration that is off is not required, but nobody waived it.
    it("[SPM-33][AC5][AC10] shows registration that is not enabled as not required, with nothing to mark", async () => {
      open([
        auditorium,
        arrangement({
          state: "not_required",
          required: false,
          complete: false,
          kind: "registration",
          id: null,
          name: "Registration setup",
          status: null,
          waived: false,
          notRequiredBy: null,
          notRequiredAt: null,
          note: "Registration is not enabled for this event.",
        }),
      ]);

      const item = await row("Registration setup");

      expect(item).toHaveTextContent("Not required");
      expect(item).toHaveTextContent("Registration is not enabled for this event.");
      expect(within(item).queryByRole("button")).not.toBeInTheDocument();
    });

    it("[SPM-33] gives an arrangement of a kind it does not know a section of its own", async () => {
      open([auditorium, arrangement({ kind: "catering", id: "c1", name: "Lunch for 30", status: null })]);

      expect(await row("Lunch for 30")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Catering" })).toBeInTheDocument();
    });

    it("[SPM-33] tells a confirmed event that it is confirmed, not what blocks confirmation", async () => {
      open([], {
        [LIST]: payload([auditorium], { canManage: false, event: { sequenceNumber: 7, title: "Gala Dinner", status: "confirmed" } }),
      });

      expect(await screen.findByText("This event is confirmed")).toBeInTheDocument();
      expect(screen.getByText("What this event was confirmed with.")).toBeInTheDocument();
      expect(screen.queryByText("Nothing is blocking confirmation")).not.toBeInTheDocument();
    });
  });

  // AC6, AC9.
  describe("the Operational Safety Check", () => {
    const safety = (status: string, overrides: Partial<Arrangement> = {}) =>
      arrangement({
        kind: "safety_check",
        id: status === "safety_not_submitted" ? null : "sc1",
        name: "Operational Safety Check",
        status,
        state: status === "safety_approved" ? "complete" : "outstanding",
        complete: status === "safety_approved",
        missing: status === "safety_approved" ? "" : "the Operational Safety Check has not been submitted yet",
        blocksConfirmation: false,
        note: status === "safety_not_submitted" ? "" : "Submitted by Daniel Tan on 9 Oct 2026, 14:30",
        ...overrides,
      });

    it.each([
      ["safety_not_submitted", "Not submitted", "Outstanding"],
      ["safety_awaiting_review", "Awaiting review", "Outstanding"],
      ["safety_approved", "Approved", "Complete"],
      ["safety_changes_requested", "Changes requested", "Outstanding"],
      ["safety_rejected", "Rejected", "Outstanding"],
    ])("[SPM-33][AC6] shows a check that is %s as '%s'", async (status, label, state) => {
      open([auditorium, safety(status)]);

      const item = await row("Operational Safety Check");

      expect(item).toHaveTextContent(label);
      expect(item).toHaveTextContent(state);
    });

    it("[SPM-33][AC6] says who submitted it and when", async () => {
      open([auditorium, safety("safety_awaiting_review")]);

      expect(await row("Operational Safety Check")).toHaveTextContent("Submitted by Daniel Tan on 9 Oct 2026, 14:30");
    });

    it("[SPM-33][AC9] never offers to mark it as not required, even to the assigned coordinator", async () => {
      open([deskRequested, safety("safety_not_submitted")]);

      const item = await row("Operational Safety Check");

      expect(within(item).queryByRole("button")).not.toBeInTheDocument();
      expect(markNotRequired(await row("Audio Mixing Desk"))).toBeEnabled();
    });

    it("[SPM-33][AC6] says Confirm does not wait for it yet, and leaves it out of the count", async () => {
      open([auditorium, safety("safety_not_submitted")]);

      expect(await row("Operational Safety Check")).toHaveTextContent("Confirm event does not wait for it yet.");
      expect(await screen.findByText("Nothing is blocking confirmation")).toBeInTheDocument();
    });

    it("[SPM-33][AC6][AC11] counts a check awaiting review as blocking, without saying Confirm does not wait", async () => {
      open([auditorium, safety("safety_awaiting_review", { blocksConfirmation: true })]);

      expect(await screen.findByText("1 arrangement still blocks confirmation")).toBeInTheDocument();
      expect(await row("Operational Safety Check")).not.toHaveTextContent("does not wait for it");
    });

    it("[SPM-33][AC6] does not say so once the check is approved", async () => {
      open([auditorium, safety("safety_approved")]);

      expect(await row("Operational Safety Check")).not.toHaveTextContent("does not wait for it");
    });
  });

  // AC8.
  describe("marking an arrangement as not required", () => {
    it("[SPM-33][AC8] offers it on every outstanding booking, equipment line and registration setup", async () => {
      open([studioPending, deskRequested, registrationIncomplete]);

      for (const name of ["Orchard Studio", "Audio Mixing Desk", "Registration setup"]) {
        expect(markNotRequired(await row(name))).toBeEnabled();
      }
    });

    it("[SPM-33][AC8] does not offer it on a complete arrangement, or on a missing venue", async () => {
      open([noVenue, micReserved]);

      for (const name of ["No venue booked", "Handheld Wireless Mic"]) {
        const item = await row(name);
        expect(within(item).queryByRole("button", { name: "Mark as not required" })).not.toBeInTheDocument();
        expect(within(item).queryByRole("button", { name: "Mark as required" })).not.toBeInTheDocument();
      }
    });

    it("[SPM-33][AC8][AC11] sends the equipment line, then shows it as not required and no longer blocking", async () => {
      const api = open([auditorium, deskRequested], {
        [MARK]: payload([auditorium, notRequired(deskRequested)]),
      });

      await userEvent.click(markNotRequired(await row("Audio Mixing Desk")));

      await waitFor(() => expect(api.sent(MARK)).toHaveLength(1));
      expect(api.sent(MARK)[0].body).toEqual({ kind: "equipment", id: "r2", notRequired: true });
      await waitFor(async () => expect(await row("Audio Mixing Desk")).toHaveTextContent("Not required"));
      expect(await row("Audio Mixing Desk")).toHaveTextContent("Marked as not required by Daniel Tan on");
      expect(await screen.findByText("Nothing is blocking confirmation")).toBeInTheDocument();
      expect(markRequired(await row("Audio Mixing Desk"))).toBeEnabled();
    });

    it("[SPM-33][AC8] [SPM-81][AC7] sends a venue booking by its own id, so the event's other bookings are untouched", async () => {
      const api = open([auditorium, studioPending], {
        [MARK]: payload([auditorium, notRequired(studioPending)]),
      });

      await userEvent.click(markNotRequired(await row("Orchard Studio")));

      await waitFor(() => expect(api.sent(MARK)).toHaveLength(1));
      expect(api.sent(MARK)[0].body).toEqual({ kind: "venue", id: "b2", notRequired: true });
      await waitFor(async () => expect(await row("Orchard Studio")).toHaveTextContent("Not required"));
      expect(await row("Marina Auditorium")).toHaveTextContent("Complete");
    });

    it("[SPM-33][AC8] sends registration setup without an id", async () => {
      const api = open([auditorium, registrationIncomplete], {
        [MARK]: payload([auditorium, notRequired(registrationIncomplete)]),
      });

      await userEvent.click(markNotRequired(await row("Registration setup")));

      await waitFor(() => expect(api.sent(MARK)).toHaveLength(1));
      expect(api.sent(MARK)[0].body).toEqual({ kind: "registration", notRequired: true });
    });

    it("[SPM-33][AC8] reverses the decision: the arrangement is outstanding and blocking again", async () => {
      const api = open([auditorium, stageWaived], {
        [MARK]: payload([
          auditorium,
          outstanding({ ...stageWaived, waivable: true, missing: "Portable Stage for this event is not reserved yet" }),
        ]),
      });

      expect(await screen.findByText("Nothing is blocking confirmation")).toBeInTheDocument();
      await userEvent.click(markRequired(await row("Portable Stage")));

      await waitFor(() => expect(api.sent(MARK)).toHaveLength(1));
      expect(api.sent(MARK)[0].body).toEqual({ kind: "equipment", id: "r3", notRequired: false });
      await waitFor(async () => expect(await row("Portable Stage")).toHaveTextContent("Outstanding"));
      expect(await row("Portable Stage")).not.toHaveTextContent("Marked as not required by");
      expect(await screen.findByText("1 arrangement still blocks confirmation")).toBeInTheDocument();
    });

    it("[SPM-33][AC8] shows the server's reason when it refuses, and leaves the arrangement as it was", async () => {
      open([auditorium, deskRequested], {
        [MARK]: reply(400, { error: "Arrangements can only be marked as not required while the event is in Planning." }),
      });

      await userEvent.click(markNotRequired(await row("Audio Mixing Desk")));

      expect(
        await screen.findByText("Arrangements can only be marked as not required while the event is in Planning.")
      ).toBeInTheDocument();
      expect(await row("Audio Mixing Desk")).toHaveTextContent("Outstanding");
      expect(screen.getByText("1 arrangement still blocks confirmation")).toBeInTheDocument();
    });

    it("[SPM-33][AC8] says the arrangement could not be updated when the server gives no reason", async () => {
      open([auditorium, deskRequested], { [MARK]: reply(500, {}) });

      await userEvent.click(markNotRequired(await row("Audio Mixing Desk")));

      expect(await screen.findByText("Could not update this arrangement.")).toBeInTheDocument();
    });

    it("[SPM-33][AC8] says so when the server cannot be reached", async () => {
      open([auditorium, deskRequested], {
        [MARK]: () => {
          throw new TypeError("Failed to fetch");
        },
      });

      await userEvent.click(markNotRequired(await row("Audio Mixing Desk")));

      expect(
        await screen.findByText("Could not reach the server. Check your connection and try again.")
      ).toBeInTheDocument();
      expect(await row("Audio Mixing Desk")).toHaveTextContent("Outstanding");
    });

    it("[SPM-22][AC4] sends the coordinator to log in when the session has ended", async () => {
      open([auditorium, deskRequested], { [MARK]: reply(401, { error: "Not authenticated" }) });

      await userEvent.click(markNotRequired(await row("Audio Mixing Desk")));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith(LOGIN));
    });
  });

  describe("for a coordinator who cannot manage the event", () => {
    it.each([
      ["another coordinator's event", { canManage: false }],
      ["an event that is already Confirmed", { canManage: false, event: { sequenceNumber: 7, title: "Gala Dinner", status: "confirmed" } }],
    ])("[SPM-33][AC8] lists the arrangements of %s but offers nothing to change", async (_case, overrides) => {
      open([], { [LIST]: payload([auditorium, deskRequested, stageWaived], overrides) });

      expect(await row("Audio Mixing Desk")).toHaveTextContent("Outstanding");
      expect(await row("Portable Stage")).toHaveTextContent("Not required");
      expect(screen.queryByRole("button", { name: "Mark as not required" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark as required" })).not.toBeInTheDocument();
    });
  });
});
