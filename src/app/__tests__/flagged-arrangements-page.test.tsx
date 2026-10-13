// @vitest-environment jsdom
//
// CONTRACT (SPM-68, written before the code) - what these tests expect to exist:
//   src/app/flagged/page.tsx   the Event Coordinator's "Flagged Arrangements" page, at /flagged
//   It reads GET /api/flagged-arrangements and sends POST /api/flagged-arrangements { kind, id }
//   (the shapes are in src/app/api/__tests__/flagged-arrangements.test.ts).
// Decided here, not in the story (change the test if the team wants otherwise):
//   - gated on event:confirm with <RequirePermission>, like Safety Checks (SPM-85)
//   - one list per kind - "Flagged venue bookings", "Flagged equipment reservations",
//     "Flagged registrations" - under the headings "Venue bookings", "Equipment reservations"
//     and "Registrations"; a kind with nothing flagged has no heading and no list
//   - every label, button and message asserted below
//   - after a keep or a review the list is read again, and "Flag cleared" says what was kept
// NOT here: a "Release booking" action (AC12) waits for SPM-67 to be in main.

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
    startsAt: "2027-09-08T01:00:00.000Z",
    endsAt: "2027-09-08T09:00:00.000Z",
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

function open(payload: unknown = flagged(), routes: Record<string, unknown> = {}) {
  setRoute("/flagged");
  const api = mockApi({ ...signedInAs("coordinator"), [LIST]: payload, ...routes });
  render(<FlaggedArrangementsPage />);
  return api;
}

const bookings = () => screen.findByRole("list", { name: "Flagged venue bookings" });
const kit = () => screen.findByRole("list", { name: "Flagged equipment reservations" });
const registrationList = () => screen.findByRole("list", { name: "Flagged registrations" });
const itemsOf = (list: HTMLElement) => within(list).getAllByRole("listitem");
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
      expect(screen.getByRole("heading", { name: "Venue bookings" })).toBeInTheDocument();
      const [item] = itemsOf(await bookings());
      expect(within(item).getByRole("link", { name: "Harbour Summit" })).toHaveAttribute("href", "/events/EVT-000041");
      expect(item).toHaveTextContent("EVT-000041");
      expect(item).toHaveTextContent("Hall (HALL)");
      expect(item).toHaveTextContent("8 Sep 2027, 09:00–17:00");
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
              suitability: { ok: false, unmet: ["Theatre capacity is 100 - your event expects 150."] },
              availability: { ok: false, unmet: ["Hall has been retired."] },
            }),
          ],
        })
      );

      const [item] = itemsOf(await bookings());
      expect(item).toHaveTextContent("Suitability: Not suitable");
      expect(item).toHaveTextContent("Theatre capacity is 100 - your event expects 150.");
      expect(item).toHaveTextContent("Availability: Not available");
      expect(item).toHaveTextContent("Hall has been retired.");
      // Still offered: the server decides, and its refusal names the requirement (AC7).
      expect(within(item).getByRole("button", { name: "Keep booking" })).toBeInTheDocument();
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

      expect(await screen.findByRole("heading", { name: "Equipment reservations" })).toBeInTheDocument();
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

      expect(await screen.findByRole("heading", { name: "Registrations" })).toBeInTheDocument();
      const [item] = itemsOf(await registrationList());
      expect(within(item).getByRole("link", { name: "Harbour Summit" })).toHaveAttribute("href", "/events/EVT-000041");
      expect(item).toHaveTextContent("12 registered, 3 on the waiting list");
      expect(item).toHaveTextContent(
        "Flagged because: the registration capacity was lowered below the number registered or waitlisted"
      );
      expect(within(item).getByRole("button", { name: "Mark as reviewed" })).toBeInTheDocument();
      expect(within(item).queryByRole("button", { name: /^Keep/ })).not.toBeInTheDocument();
    });

    it("leaves out the heading and list of a kind with nothing flagged", async () => {
      open(flagged({ registrations: [registrations()] }));

      await registrationList();
      expect(screen.queryByRole("heading", { name: "Venue bookings" })).not.toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Flagged venue bookings" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Equipment reservations" })).not.toBeInTheDocument();
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
      // What was not touched is still there.
      expect(itemsOf(await registrationList())).toHaveLength(1);
    });

    // AC7.
    it("shows the server's refusal in the item, and leaves it listed", async () => {
      const refusal = "Hall no longer meets this event's requirements: Theatre capacity is 100 - your event expects 150.";
      const api = open(
        flagged({ venueBookings: [booking({ suitability: { ok: false, unmet: ["Theatre capacity is 100 - your event expects 150."] } })] }),
        { [KEEP]: reply(400, { error: refusal, unmet: ["Theatre capacity is 100 - your event expects 150."] }) }
      );
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

  describe("when it cannot load", () => {
    it("sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fflagged"));
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
