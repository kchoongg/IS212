// @vitest-environment jsdom
//
// SPM-68, Review Flagged Arrangements. Written before the code; what these tests hold it to:
//   src/app/flagged/page.tsx   the Event Coordinator's "Flagged Arrangements" page, at /flagged
//   It reads GET /api/flagged-arrangements and sends POST /api/flagged-arrangements { kind, id }
//   (the shapes are in src/app/api/__tests__/flagged-arrangements.test.ts).
// Decided here, not in the story (change the test if the team wants otherwise):
//   - gated on event:confirm with <RequirePermission>, like Safety Checks (SPM-85)
//   - one tab per kind (changed 2026-10-13, from three stacked sections): "Venue bookings",
//     "Equipment reservations" and "Registrations", each a link to /flagged?tab=venue,
//     ?tab=equipment or ?tab=registrations with how many are flagged. Only the open tab's
//     list is on the page: "Flagged venue bookings", "Flagged equipment reservations" or
//     "Flagged registrations". Opened without a tab, the page shows the first kind that has
//     something flagged
//   - every label, button and message asserted below
//   - Keep is offered only while the arrangement still meets the event's requirements (changed
//     2026-10-13). Where it does not, the item lists what is unmet, says it can't be kept and
//     has no Keep button. The server's refusal (AC7) still shows if the page's result was stale
//   - after a keep or a review the list is read again, and "Flag cleared" says what was kept
//   - AC12's release (changed 2026-10-13): this page clears flags and never changes an
//     arrangement. A flagged booking links to its event's Venue tab ("Open Venue tab"), where
//     SPM-67's Release booking / Withdraw request already are. There is no release or
//     withdraw button here.

import { describe, it, expect } from "vitest";
import FlaggedArrangementsPage from "@/app/flagged/page";
import { can } from "@/lib/permissions";
import { ROLES } from "@/lib/roles";
import {
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

const LIST = "GET /api/flagged-arrangements";
const KEEP = "POST /api/flagged-arrangements";
const OTHER_ROLES = ROLES.filter((role) => !can(role, "event:confirm"));

const EVENT = { reference: "EVT-000041", title: "Harbour Summit", status: "planning" };

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    status: "approved",
    // 09:00-17:00 in Singapore.
    startsAt: "2027-10-08T01:00:00.000Z",
    endsAt: "2027-10-08T09:00:00.000Z",
    layoutName: "theatre",
    flaggedAt: "2026-10-12T02:00:00.000Z",
    reasons: ["the expected attendance changed"],
    event: EVENT,
    session: null,
    venue: { id: "v1", code: "HALL", name: "Hall" },
    suitability: { ok: true, unmet: [] },
    availability: { ok: true, unmet: [] },
    ...overrides,
  };
}

function equipment(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    status: "reserved",
    quantityRequested: 2,
    quantityReserved: 2,
    flaggedAt: "2026-10-12T02:00:00.000Z",
    reasons: ["the date or time changed"],
    event: EVENT,
    session: null,
    equipment: { id: "i1", name: "Projector" },
    availability: { ok: true, needed: 2, available: 4, summary: "2 reserved, 4 available for these dates." },
    ...overrides,
  };
}

function registrations(overrides: Record<string, unknown> = {}) {
  return {
    event: { id: "event-id", ...EVENT },
    registered: 12,
    waitlisted: 3,
    reasons: ["the date or time changed"],
    ...overrides,
  };
}

const flagged = (parts: { venueBookings?: object[]; equipmentRequests?: object[]; registrations?: object[] } = {}) => ({
  venueBookings: [],
  equipmentRequests: [],
  registrations: [],
  ...parts,
});

/// `tab` is the address's ?tab=…; without one the page picks the first kind with something in it.
function open(payload: unknown = flagged(), routes: Record<string, unknown> = {}, tab?: string) {
  setRoute(tab ? `/flagged?tab=${tab}` : "/flagged");
  const api = mockApi({ ...signedInAs("coordinator"), [LIST]: payload, ...routes });
  render(<FlaggedArrangementsPage />);
  return api;
}

const bookings = () => screen.findByRole("list", { name: "Flagged venue bookings" });
const kit = () => screen.findByRole("list", { name: "Flagged equipment reservations" });
const registrationList = () => screen.findByRole("list", { name: "Flagged registrations" });
const itemsOf = (list: HTMLElement) => within(list).getAllByRole("listitem");
/// A tab is a link; its name is its label followed by how many are flagged.
const tabLink = (label: string) => screen.findByRole("link", { name: new RegExp(`^${label}`) });
const click = (name: string, inside: HTMLElement) => userEvent.click(within(inside).getByRole("button", { name }));

describe("Flagged Arrangements (SPM-68)", () => {
  describe("who can open it", () => {
    it("sends an anonymous visitor to log in, remembering where they were going", async () => {
      setRoute("/flagged");
      mockApi(signedOut());

      render(<FlaggedArrangementsPage />);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fflagged"));
    });

    it.each(OTHER_ROLES)("refuses %s, and never asks for the list", async (role) => {
      setRoute("/flagged");
      const api = mockApi(signedInAs(role));

      render(<FlaggedArrangementsPage />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("You do not have access to this");
      expect(alert).toHaveTextContent(
        "Reviewing flagged arrangements is the Event Coordinator's role. You can still see the events you are involved in from your Dashboard."
      );
      expect(screen.getByRole("heading", { name: "Flagged Arrangements" })).toBeInTheDocument();
      expect(api.sent(LIST)).toHaveLength(0);
    });
  });

  describe("the list", () => {
    // AC1, AC2, AC4.
    it("shows a flagged venue booking with its event, the booking, why it was flagged and its current result", async () => {
      open(flagged({ venueBookings: [booking({ reasons: ["the date or time changed", "the expected attendance changed"] })] }));

      expect(await screen.findByRole("heading", { name: "Flagged Arrangements" })).toBeInTheDocument();
      // The title is there before the list has loaded; the tabs come with it.
      expect(await tabLink("Venue bookings")).toHaveAttribute("aria-current", "page");
      const [item] = itemsOf(await bookings());
      expect(within(item).getByRole("link", { name: "Harbour Summit" })).toHaveAttribute("href", "/events/EVT-000041");
      expect(item).toHaveTextContent("EVT-000041");
      expect(item).toHaveTextContent("Hall (HALL)");
      expect(item).toHaveTextContent("8 Oct 2027, 09:00–17:00");
      expect(item).toHaveTextContent("Theatre");
      expect(item).toHaveTextContent("Flagged because: the date or time changed; the expected attendance changed");
      expect(item).toHaveTextContent("Suitability: Suitable");
      expect(item).toHaveTextContent("Availability: Available");
      expect(within(item).getByRole("button", { name: "Keep booking" })).toBeInTheDocument();
    });

    it("names what a booking no longer meets under suitability and availability", async () => {
      open(
        flagged({
          venueBookings: [
            booking({
              suitability: { ok: false, unmet: ["Theatre capacity is 100 - this space expects 150."] },
              availability: { ok: false, unmet: ["Hall has been retired."] },
            }),
          ],
        })
      );

      const [item] = itemsOf(await bookings());
      expect(item).toHaveTextContent("Suitability: Not suitable");
      expect(item).toHaveTextContent("Theatre capacity is 100 - this space expects 150.");
      expect(item).toHaveTextContent("Availability: Not available");
      expect(item).toHaveTextContent("Hall has been retired.");
    });

    // AC7: a booking that no longer fits is not offered Keep at all.
    it.each([
      ["not suitable", { suitability: { ok: false, unmet: ["Theatre capacity is 100 - this space expects 150."] } }],
      ["not available", { availability: { ok: false, unmet: ["Hall has been retired."] } }],
    ])("offers no Keep booking for a booking that is %s, and says why it can't be kept", async (_what, result) => {
      open(flagged({ venueBookings: [booking(result)] }));

      const [item] = itemsOf(await bookings());
      expect(within(item).queryByRole("button", { name: "Keep booking" })).not.toBeInTheDocument();
      expect(item).toHaveTextContent("This booking can't be kept while it doesn't meet the event's requirements.");
      // The ways out are still there.
      expect(within(item).getByRole("link", { name: "Find a replacement venue" })).toBeInTheDocument();
      expect(within(item).getByRole("link", { name: "Open Venue tab" })).toBeInTheDocument();
    });

    it("says nothing about keeping a booking that still fits", async () => {
      open(flagged({ venueBookings: [booking()] }));

      const [item] = itemsOf(await bookings());
      expect(item).not.toHaveTextContent("can't be kept");
      expect(within(item).getByRole("button", { name: "Keep booking" })).toBeInTheDocument();
    });

    it("offers no Keep reservation for equipment that can no longer be covered, and links to the Equipment tab", async () => {
      open(
        flagged({
          equipmentRequests: [
            equipment({ id: "q1" }),
            equipment({ id: "q2", availability: { ok: false, summary: "2 reserved, 1 available for these dates." } }),
          ],
        })
      );

      const [covered, short] = itemsOf(await kit());
      expect(within(covered).getByRole("button", { name: "Keep reservation" })).toBeInTheDocument();
      expect(covered).not.toHaveTextContent("can't be kept");
      expect(within(short).queryByRole("button", { name: "Keep reservation" })).not.toBeInTheDocument();
      expect(short).toHaveTextContent("This reservation can't be kept while it doesn't meet the event's requirements.");
      for (const item of [covered, short]) {
        expect(within(item).getByRole("link", { name: "Open Equipment tab" })).toHaveAttribute(
          "href",
          "/events/EVT-000041/equipment"
        );
      }
    });

    it("says when a flagged booking or reservation is marked as not required, and still offers to keep it", async () => {
      const note = "Marked as not required for this event, so it does not block confirmation.";
      open(flagged({ venueBookings: [booking({ notRequired: true }), booking({ id: "b2" })] }));

      const [waived, required] = itemsOf(await bookings());
      expect(waived).toHaveTextContent(note);
      expect(within(waived).getByRole("button", { name: "Keep booking" })).toBeInTheDocument();
      expect(required).not.toHaveTextContent("Marked as not required");
    });

    it("says so for equipment marked as not required too", async () => {
      open(flagged({ equipmentRequests: [equipment({ notRequired: true })] }));

      expect(itemsOf(await kit())[0]).toHaveTextContent("Marked as not required for this event");
    });

    it("says which space a booking is for (SPM-90)", async () => {
      open(flagged({ venueBookings: [booking({ purpose: "Breakout room" }), booking({ id: "b2", purpose: null })] }));

      const [named, unnamed] = itemsOf(await bookings());
      expect(named).toHaveTextContent("Space: Breakout room · 8 Oct 2027, 09:00–17:00");
      expect(unnamed).not.toHaveTextContent("Space:");
    });

    it("says which session a session's booking is for", async () => {
      open(flagged({ venueBookings: [booking({ session: { id: "s1", label: "Day 1" } })] }));

      expect(itemsOf(await bookings())[0]).toHaveTextContent("Day 1");
    });

    // AC3: the page shows what it is given - one item per flagged booking, nothing else.
    it("gives each flagged booking its own item, in the order they were read", async () => {
      open(
        flagged({
          venueBookings: [
            booking({ id: "b1", venue: { id: "v1", code: "HALL", name: "Hall" } }),
            booking({ id: "b2", venue: { id: "v2", code: "ANX", name: "Annex" }, event: { ...EVENT, title: "Partner Day" } }),
          ],
        })
      );

      const items = itemsOf(await bookings());
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("Hall (HALL)");
      expect(items[1]).toHaveTextContent("Annex (ANX)");
      expect(items[1]).toHaveTextContent("Partner Day");
    });

    // AC11.
    it("links a flagged booking to a venue search for its replacement", async () => {
      open(flagged({ venueBookings: [booking()] }));

      const [item] = itemsOf(await bookings());
      expect(within(item).getByRole("link", { name: "Find a replacement venue" })).toHaveAttribute(
        "href",
        "/venues/search?event=EVT-000041&booking=b1"
      );
    });

    // AC2, AC5.
    it("shows a flagged equipment reservation with its event, the item, why and its current availability", async () => {
      open(flagged({ equipmentRequests: [equipment()] }));

      expect(await tabLink("Equipment reservations")).toHaveAttribute("aria-current", "page");
      const [item] = itemsOf(await kit());
      expect(within(item).getByRole("link", { name: "Harbour Summit" })).toHaveAttribute("href", "/events/EVT-000041");
      expect(item).toHaveTextContent("Projector");
      expect(item).toHaveTextContent("Flagged because: the date or time changed");
      expect(item).toHaveTextContent("Availability: 2 reserved, 4 available for these dates.");
      expect(within(item).getByRole("button", { name: "Keep reservation" })).toBeInTheDocument();
      expect(within(item).queryByRole("link", { name: "Find a replacement venue" })).not.toBeInTheDocument();
    });

    // AC8.
    it("shows flagged registrations with how many are registered and waitlisted, and why", async () => {
      open(
        flagged({
          registrations: [
            registrations({ reasons: ["the registration capacity was lowered below the number registered or waitlisted"] }),
          ],
        })
      );

      expect(await tabLink("Registrations")).toHaveAttribute("aria-current", "page");
      const [item] = itemsOf(await registrationList());
      expect(within(item).getByRole("link", { name: "Harbour Summit" })).toHaveAttribute("href", "/events/EVT-000041");
      expect(item).toHaveTextContent("12 registered, 3 on the waiting list");
      expect(item).toHaveTextContent(
        "Flagged because: the registration capacity was lowered below the number registered or waitlisted"
      );
      expect(within(item).getByRole("button", { name: "Mark as reviewed" })).toBeInTheDocument();
      expect(within(item).queryByRole("button", { name: /^Keep/ })).not.toBeInTheDocument();
      // Where the registration settings are changed (SPM-64).
      expect(within(item).getByRole("link", { name: "Open Overview" })).toHaveAttribute("href", "/events/EVT-000041");
    });

    it("says which session an unnamed session's booking is for", async () => {
      open(flagged({ venueBookings: [booking({ session: { id: "s2", label: null }, layoutName: null })] }));

      expect(itemsOf(await bookings())[0]).toHaveTextContent("Session · 8 Oct 2027, 09:00–17:00");
    });

    it("says which session an equipment line is for, and calls an unnamed session 'Session'", async () => {
      open(
        flagged({
          equipmentRequests: [
            equipment({ id: "q1", session: { id: "s1", label: "Day 1" } }),
            equipment({ id: "q2", session: { id: "s2", label: null }, availability: { ok: false, summary: "2 reserved, 1 available for these dates." } }),
          ],
        })
      );

      const [named, unnamed] = itemsOf(await kit());
      expect(named).toHaveTextContent("Day 1");
      expect(unnamed).toHaveTextContent("Session");
      expect(unnamed).toHaveTextContent("Availability: 2 reserved, 1 available for these dates.");
    });

    it("copes with an event that has no title", async () => {
      open(flagged({ venueBookings: [booking({ event: { ...EVENT, title: null } })] }));

      const [item] = itemsOf(await bookings());
      expect(within(item).getByRole("link", { name: "Untitled event" })).toHaveAttribute("href", "/events/EVT-000041");
    });

    it("says so when nothing is flagged", async () => {
      open();

      expect(await screen.findByText("Nothing is flagged")).toBeInTheDocument();
      expect(
        screen.getByText("Arrangements appear here when a change to an event, a venue or equipment means they need another look.")
      ).toBeInTheDocument();
    });
  });

  describe("the tabs", () => {
    const everything = () =>
      flagged({
        venueBookings: [booking({ id: "b1" }), booking({ id: "b2" })],
        equipmentRequests: [equipment()],
        registrations: [registrations()],
      });

    it("has one tab per kind, each a link saying how many are flagged", async () => {
      open(everything());

      const venue = await tabLink("Venue bookings");
      expect(venue).toHaveAttribute("href", "/flagged?tab=venue");
      expect(venue).toHaveTextContent(/Venue bookings\s*2$/);
      const kitTab = await tabLink("Equipment reservations");
      expect(kitTab).toHaveAttribute("href", "/flagged?tab=equipment");
      expect(kitTab).toHaveTextContent(/Equipment reservations\s*1$/);
      const registrationTab = await tabLink("Registrations");
      expect(registrationTab).toHaveAttribute("href", "/flagged?tab=registrations");
      expect(registrationTab).toHaveTextContent(/Registrations\s*1$/);
    });

    it("opens on Venue bookings, and shows that kind alone", async () => {
      open(everything());

      expect(itemsOf(await bookings())).toHaveLength(2);
      expect(await tabLink("Venue bookings")).toHaveAttribute("aria-current", "page");
      expect(await tabLink("Equipment reservations")).not.toHaveAttribute("aria-current");
      expect(screen.queryByRole("list", { name: "Flagged equipment reservations" })).not.toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Flagged registrations" })).not.toBeInTheDocument();
    });

    it.each([
      ["equipment", "Equipment reservations", "Flagged equipment reservations"],
      ["registrations", "Registrations", "Flagged registrations"],
      ["venue", "Venue bookings", "Flagged venue bookings"],
    ])("shows the tab named in the address: %s", async (tab, label, list) => {
      open(everything(), {}, tab);

      expect(await screen.findByRole("list", { name: list })).toBeInTheDocument();
      expect(await tabLink(label)).toHaveAttribute("aria-current", "page");
      expect(screen.getAllByRole("list")).toHaveLength(1);
    });

    it("opens on the first kind that has something flagged when no tab is named", async () => {
      open(flagged({ registrations: [registrations()] }));

      expect(itemsOf(await registrationList())).toHaveLength(1);
      expect(await tabLink("Registrations")).toHaveAttribute("aria-current", "page");
      // The other tabs are still there to open, with no count beside them.
      expect(await tabLink("Venue bookings")).toHaveTextContent(/^Venue bookings$/);
      expect(await tabLink("Equipment reservations")).toHaveTextContent(/^Equipment reservations$/);
    });

    it("says so on a tab with nothing flagged, when it is the one asked for", async () => {
      open(flagged({ registrations: [registrations()] }), {}, "venue");

      expect(await screen.findByText("No venue bookings are flagged")).toBeInTheDocument();
      expect(screen.getByText("Nothing of this kind needs another look right now.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Flagged registrations" })).not.toBeInTheDocument();
      expect(screen.queryByText("Nothing is flagged")).not.toBeInTheDocument();
    });

    it.each([
      ["equipment", "No equipment reservations are flagged"],
      ["registrations", "No registrations are flagged"],
    ])("words the empty %s tab for its own kind", async (tab, words) => {
      open(flagged({ venueBookings: [booking()] }), {}, tab);

      expect(await screen.findByText(words)).toBeInTheDocument();
    });

    it("ignores a tab it does not know, and opens the first kind with something flagged", async () => {
      open(flagged({ equipmentRequests: [equipment()] }), {}, "safety");

      expect(itemsOf(await kit())).toHaveLength(1);
    });

    it("has no tabs when nothing at all is flagged", async () => {
      open();

      expect(await screen.findByText("Nothing is flagged")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^Venue bookings/ })).not.toBeInTheDocument();
    });
  });

  describe("keeping a venue booking", () => {
    // AC6.
    it("asks the server to keep it, then says the flag is cleared and reads the list again", async () => {
      const api = open(flagged({ venueBookings: [booking()], registrations: [registrations()] }), { [KEEP]: { cleared: true } });
      const [item] = itemsOf(await bookings());
      api.on(LIST, flagged({ registrations: [registrations()] }));

      await click("Keep booking", item);

      expect(await screen.findByText("Hall for Harbour Summit was kept as it is.")).toBeInTheDocument();
      expect(screen.getByText("Flag cleared")).toBeInTheDocument();
      expect(api.sent(KEEP)).toHaveLength(1);
      expect(api.sent(KEEP)[0].body).toEqual({ kind: "venue_booking", id: "b1" });
      await waitFor(() => expect(screen.queryByRole("list", { name: "Flagged venue bookings" })).not.toBeInTheDocument());
      // No tab was named, so the page moves on to what is still flagged.
      expect(itemsOf(await registrationList())).toHaveLength(1);
      expect(await tabLink("Registrations")).toHaveAttribute("aria-current", "page");
    });

    // AC7.
    // The booking fitted when the page loaded; the event's attendance was raised since.
    it("shows the server's refusal in the item, and leaves it listed", async () => {
      const refusal = "Hall no longer meets this event's requirements: Theatre capacity is 100 - this space expects 150.";
      const api = open(flagged({ venueBookings: [booking()] }), {
        [KEEP]: reply(400, { error: refusal, unmet: ["Theatre capacity is 100 - this space expects 150."] }),
      });
      const [item] = itemsOf(await bookings());

      await click("Keep booking", item);

      expect(await within(item).findByRole("alert")).toHaveTextContent(refusal);
      expect(screen.queryByText("Flag cleared")).not.toBeInTheDocument();
      expect(itemsOf(await bookings())).toHaveLength(1);
      expect(api.sent(KEEP)).toHaveLength(1);
    });

    it("puts a refusal on the item that was refused, not on its neighbour", async () => {
      open(
        flagged({ venueBookings: [booking({ id: "b1" }), booking({ id: "b2", venue: { id: "v2", code: "ANX", name: "Annex" } })] }),
        { [KEEP]: reply(400, { error: "Annex no longer meets this event's requirements: Annex has been retired." }) }
      );
      const [first, second] = itemsOf(await bookings());

      await click("Keep booking", second);

      expect(await within(second).findByRole("alert")).toHaveTextContent("Annex has been retired.");
      expect(within(first).queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says so when the request could not be sent at all", async () => {
      open(flagged({ venueBookings: [booking()] }), { [KEEP]: reply(500, {}) });
      const [item] = itemsOf(await bookings());

      await click("Keep booking", item);

      expect(await within(item).findByRole("alert")).toHaveTextContent("Could not clear the flag. Try again.");
    });

    it("says so when the server answers with an empty body", async () => {
      open(flagged({ venueBookings: [booking()] }), { [KEEP]: reply(500) });
      const [item] = itemsOf(await bookings());

      await click("Keep booking", item);

      expect(await within(item).findByRole("alert")).toHaveTextContent("Could not clear the flag. Try again.");
    });

    it("says so when the network fails", async () => {
      open(flagged({ venueBookings: [booking()] }), {
        [KEEP]: () => {
          throw new Error("offline");
        },
      });
      const [item] = itemsOf(await bookings());

      await click("Keep booking", item);

      expect(await within(item).findByRole("alert")).toHaveTextContent("Could not clear the flag. Try again.");
    });

    it("names an untitled event as such in what it says afterwards", async () => {
      const api = open(flagged({ venueBookings: [booking({ event: { ...EVENT, title: null } })] }), { [KEEP]: { cleared: true } });
      const [item] = itemsOf(await bookings());
      api.on(LIST, flagged());

      await click("Keep booking", item);

      expect(await screen.findByText("Hall for Untitled event was kept as it is.")).toBeInTheDocument();
    });

    it("sends the user to log in when their session has expired", async () => {
      open(flagged({ venueBookings: [booking()] }), { [KEEP]: reply(401, {}) });
      const [item] = itemsOf(await bookings());

      await click("Keep booking", item);

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fflagged"));
    });
  });

  describe("keeping an equipment reservation", () => {
    // AC6.
    it("asks the server to keep it and says the flag is cleared", async () => {
      const api = open(flagged({ equipmentRequests: [equipment()] }), { [KEEP]: { cleared: true } });
      const [item] = itemsOf(await kit());
      api.on(LIST, flagged());

      await click("Keep reservation", item);

      expect(await screen.findByText("Projector for Harbour Summit was kept as it is.")).toBeInTheDocument();
      expect(api.sent(KEEP)[0].body).toEqual({ kind: "equipment_request", id: "q1" });
      expect(await screen.findByText("Nothing is flagged")).toBeInTheDocument();
    });

    // AC7.
    it("shows the server's refusal in the item, and leaves it listed", async () => {
      const refusal = "Projector no longer meets this event's requirements: 2 reserved, 1 available for these dates.";
      open(flagged({ equipmentRequests: [equipment()] }), { [KEEP]: reply(400, { error: refusal }) });
      const [item] = itemsOf(await kit());

      await click("Keep reservation", item);

      expect(await within(item).findByRole("alert")).toHaveTextContent(refusal);
      expect(itemsOf(await kit())).toHaveLength(1);
    });
  });

  describe("marking registrations as reviewed", () => {
    // AC9.
    it("asks the server to clear the event's flag and says no registration was changed", async () => {
      const api = open(flagged({ registrations: [registrations()] }), { [KEEP]: { cleared: true } });
      const [item] = itemsOf(await registrationList());
      api.on(LIST, flagged());

      await click("Mark as reviewed", item);

      expect(
        await screen.findByText("Registrations for Harbour Summit were marked as reviewed. No registration was changed.")
      ).toBeInTheDocument();
      expect(screen.getByText("Flag cleared")).toBeInTheDocument();
      expect(api.sent(KEEP)[0].body).toEqual({ kind: "registrations", id: "event-id" });
      expect(await screen.findByText("Nothing is flagged")).toBeInTheDocument();
    });
  });

  // AC12: the flagged booking stays until the coordinator releases it - on
  // the event's Venue tab (SPM-67), not here.
  describe("releasing or withdrawing a flagged booking", () => {
    it("links each flagged booking to its event's Venue tab, where it is released or withdrawn", async () => {
      open(
        flagged({
          venueBookings: [booking({ id: "b1" }), booking({ id: "b2", status: "pending", event: { ...EVENT, reference: "EVT-000052" } })],
        })
      );

      const [approved, pending] = itemsOf(await bookings());
      expect(within(approved).getByRole("link", { name: "Open Venue tab" })).toHaveAttribute("href", "/events/EVT-000041/venue");
      expect(within(pending).getByRole("link", { name: "Open Venue tab" })).toHaveAttribute("href", "/events/EVT-000052/venue");
    });

    it("has no button that releases or withdraws a booking", async () => {
      open(flagged({ venueBookings: [booking(), booking({ id: "b2", status: "pending" })] }));

      await bookings();
      expect(screen.queryByRole("button", { name: "Release booking" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Withdraw request" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument();
    });

    it.each([
      ["an equipment reservation", "equipment"],
      ["registrations", "registrations"],
    ])("offers no Venue tab link on %s", async (_what, tab) => {
      open(flagged({ equipmentRequests: [equipment()], registrations: [registrations()] }), {}, tab);

      await screen.findByRole("list");
      expect(screen.queryByRole("link", { name: "Open Venue tab" })).not.toBeInTheDocument();
    });
  });

  describe("when it cannot load", () => {
    it("sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fflagged"));
    });

    it("says so when the network fails", async () => {
      open(() => {
        throw new Error("offline");
      });

      expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    });

    it("says something went wrong when the failure carries no message", async () => {
      open(() => {
        throw "offline";
      });

      expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    });

    it("shows the failure with a Retry that loads again", async () => {
      const api = open(reply(500, {}));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the flagged arrangements.");

      api.on(LIST, flagged({ venueBookings: [booking()] }));
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(itemsOf(await bookings())).toHaveLength(1);
    });
  });
});
