// @vitest-environment jsdom
//
// S-21, the venue availability calendar (SPM-46). The page only lays out what
// GET /api/venues/[id]/availability worked out, so the responses here are
// built with the same buildAvailability() the route uses - the test data
// cannot drift from the real response shape.
//
// Times are UTC; Singapore is UTC+8, so 05:00Z-10:00Z is the PM slot.

import { describe, it, expect } from "vitest";
import VenueAvailabilityPage from "@/app/venues/[id]/availability/page";
import { buildAvailability } from "@/lib/venueAvailability";
import {
  fireEvent,
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

const ROUTE = "GET /api/venues/v1/availability";
const VENUES = "GET /api/venues";
const DAY = "2027-03-04";
const PM = { startsAt: new Date("2027-03-04T05:00:00.000Z"), endsAt: new Date("2027-03-04T10:00:00.000Z") };
const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

const hallA = (overrides: Record<string, unknown> = {}) => ({
  id: "v1",
  code: "HALL-A",
  name: "Hall A",
  opensAt: "07:00",
  closesAt: "23:59",
  setupMinutes: 0,
  teardownMinutes: 0,
  isActive: true,
  ...overrides,
});

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  eventId: "e1",
  eventTitle: "Town Hall",
  eventStatus: "planning",
  sessionLabel: null,
  layoutName: "u_shape",
  ...PM,
  ...overrides,
});

interface Scenario {
  venue?: Record<string, unknown>;
  from?: string;
  to?: string;
  bookings?: object[];
  unavailability?: object[];
  holds?: object[];
}

function availability({ venue = {}, from = DAY, to = DAY, bookings = [], unavailability = [], holds = [] }: Scenario = {}) {
  return buildAvailability({
    venue: hallA(venue) as never,
    from,
    to,
    timeZone: "Asia/Singapore",
    bookings: bookings as never,
    unavailability: unavailability as never,
    holds: holds as never,
  });
}

const catalogue = [
  { id: "v2", code: "ROOM-B", name: "Room B", isActive: true },
  { id: "v1", code: "HALL-A", name: "Hall A", isActive: true },
];

function open(scenario: Scenario | unknown = {}, { role = "coordinator", query = "", routes = {} as Record<string, unknown> } = {}) {
  setRoute(`/venues/v1/availability${query}`, { id: "v1" });
  const body = typeof scenario === "object" && scenario !== null && !("__reply" in scenario) && typeof scenario !== "function"
    ? availability(scenario as Scenario)
    : scenario;
  const api = mockApi({ ...signedInAs(role), [ROUTE]: body, [VENUES]: catalogue, ...routes });
  render(<VenueAvailabilityPage />);
  return api;
}

const grid = () => screen.findByRole("table");
const cell = async (slot: "AM" | "PM" | "Night", row = 1) => {
  const index = { AM: 1, PM: 2, Night: 3 }[slot];
  return within(within(await grid()).getAllByRole("row")[row]).getAllByRole("cell")[index];
};
const cardOf = (title: string) => screen.getByRole("heading", { name: title }).closest("div.rounded-lg") as HTMLElement;

describe("Venue availability", () => {
  describe("who can open it", () => {
    it("sends an anonymous visitor to log in, remembering the venue and range", async () => {
      setRoute("/venues/v1/availability?from=2027-03-01&to=2027-03-07", { id: "v1" });
      mockApi(signedOut());

      render(<VenueAvailabilityPage />);

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith(
          `/login?next=${encodeURIComponent("/venues/v1/availability?from=2027-03-01&to=2027-03-07")}`
        )
      );
    });

    it("tells a role without access so, plainly, and shows nothing of the calendar", async () => {
      open(reply(403, { error: "Venue availability is for ConnectSphere staff" }), { role: "organiser" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue availability is for ConnectSphere staff");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Show availability" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Venue")).not.toBeInTheDocument();
    });

    it("has its own words for the refusal when the server gives none", async () => {
      open(reply(403, {}), { role: "attendee" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue availability is for ConnectSphere staff");
    });

    it("sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fv1%2Favailability"));
    });
  });

  describe("the header", () => {
    it("names the venue, the range, its opening hours and its turnaround", async () => {
      open({ venue: { setupMinutes: 60, teardownMinutes: 30 }, to: "2027-03-10" });

      expect(await screen.findByRole("heading", { level: 1, name: "Hall A availability" })).toBeInTheDocument();
      expect(screen.getByText("4 Mar 2027 – 10 Mar 2027 · open 07:00–23:59 · setup 60 min, teardown 30 min")).toBeInTheDocument();
    });

    it("links the venue in the breadcrumb to its editor for Venue Staff only", async () => {
      open({}, { role: "venue_staff" });

      expect(await screen.findByRole("link", { name: "Hall A" })).toHaveAttribute("href", "/venues/v1/edit");
    });

    it("names the venue in the breadcrumb without a link for a coordinator", async () => {
      open();

      await grid();

      expect(screen.queryByRole("link", { name: "Hall A" })).not.toBeInTheDocument();
      expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Hall A")).toBeInTheDocument();
    });

    it("shows a placeholder and disables the week buttons until the calendar has loaded", async () => {
      open(() => new Promise(() => {}));

      expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous week" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    });
  });

  describe("the range", () => {
    it("asks for the server's default week when the address gives none, and shows which week that was", async () => {
      const api = open({ from: "2027-03-04", to: "2027-03-10" });

      await grid();

      expect(api.sent(ROUTE)[0].url).toBe("/api/venues/v1/availability?");
      expect(screen.getByLabelText("From")).toHaveValue("2027-03-04");
      expect(screen.getByLabelText("To")).toHaveValue("2027-03-10");
    });

    it("asks for the range in the address", async () => {
      const api = open({}, { query: "?from=2027-03-04&to=2027-03-04" });

      await grid();

      expect(api.sent(ROUTE)[0].url).toBe("/api/venues/v1/availability?from=2027-03-04&to=2027-03-04");
    });

    it("Previous week and Next week move the whole range by seven days", async () => {
      open({ from: "2027-03-04", to: "2027-03-10" });
      await grid();

      await userEvent.click(screen.getByRole("button", { name: "Next week" }));
      await userEvent.click(screen.getByRole("button", { name: "Previous week" }));

      expect(router.push).toHaveBeenNthCalledWith(1, "/venues/v1/availability?from=2027-03-11&to=2027-03-17");
      expect(router.push).toHaveBeenNthCalledWith(2, "/venues/v1/availability?from=2027-02-25&to=2027-03-03");
    });

    it("Show availability navigates to the dates typed in", async () => {
      open();
      await grid();
      set(screen.getByLabelText("From"), "2027-04-01");
      set(screen.getByLabelText("To"), "2027-04-14");

      await userEvent.click(screen.getByRole("button", { name: "Show availability" }));

      expect(router.push).toHaveBeenCalledWith("/venues/v1/availability?from=2027-04-01&to=2027-04-14");
    });

    it("shows the server's sentence for a range it refuses", async () => {
      open(reply(400, { error: "Choose a range of 62 days or fewer - this one is 63." }), {
        query: "?from=2027-01-01&to=2027-03-04",
      });

      expect(await screen.findByRole("alert")).toHaveTextContent("Choose a range of 62 days or fewer - this one is 63.");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show availability" })).toBeInTheDocument();
    });
  });

  describe("the venue picker", () => {
    const optionLabels = () => within(screen.getByLabelText("Venue")).getAllByRole("option").map((o) => o.textContent);

    it("lists the venues by name with their codes, and starts on the one being shown", async () => {
      open();
      await grid();

      await waitFor(() => expect(optionLabels()).toEqual(["Hall A (HALL-A)", "Room B (ROOM-B)"]));
      expect(screen.getByLabelText("Venue")).toHaveValue("v1");
    });

    it("asks for active venues only as a coordinator", async () => {
      const api = open();
      await grid();

      await waitFor(() => expect(api.sent(VENUES)).toHaveLength(1));
      expect(api.sent(VENUES)[0].url).toBe("/api/venues");
    });

    it("asks for retired venues too as Venue Staff, and marks them", async () => {
      const api = open({}, {
        role: "venue_staff",
        routes: { [VENUES]: [...catalogue, { id: "v3", code: "OLD", name: "Old Hall", isActive: false }] },
      });
      await grid();

      await waitFor(() => expect(optionLabels()).toContain("Old Hall (OLD) - retired"));
      expect(api.sent(VENUES)[0].url).toBe("/api/venues?includeRetired=true");
    });

    it("always includes the venue on screen, even when the list does not", async () => {
      open({ venue: { isActive: false } }, { routes: { [VENUES]: [catalogue[0]] } });
      await grid();

      await waitFor(() => expect(optionLabels()).toEqual(["Hall A (HALL-A) - retired", "Room B (ROOM-B)"]));
    });

    it.each([
      ["answers with an error", reply(500, {})],
      ["cannot be reached", () => Promise.reject(new Error("offline"))],
    ])("still shows the calendar when the venue list %s", async (_case, answer) => {
      open({}, { routes: { [VENUES]: answer } });

      expect(await grid()).toBeInTheDocument();
      expect(optionLabels()).toEqual(["Hall A (HALL-A)"]);
    });

    it("Show availability goes to the venue that was picked, keeping the range", async () => {
      open();
      await grid();
      await waitFor(() => expect(optionLabels()).toHaveLength(2));

      set(screen.getByLabelText("Venue"), "v2");
      await userEvent.click(screen.getByRole("button", { name: "Show availability" }));

      expect(router.push).toHaveBeenCalledWith("/venues/v2/availability?from=2027-03-04&to=2027-03-04");
    });
  });

  describe("the grid", () => {
    it("has a row per day and a column per slot, each with its hours", async () => {
      open({ to: "2027-03-05" });

      const table = await grid();

      expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
        "Day",
        "AM 07:00–12:00",
        "PM 13:00–18:00",
        "Night 19:00–24:00",
      ]);
      expect(within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent)).toEqual([
        "Thu 4 Mar 2027",
        "Fri 5 Mar 2027",
      ]);
    });

    it("says an empty slot is Free", async () => {
      open();

      expect(await cell("AM")).toHaveTextContent(/^Free$/);
    });

    it("says when a free slot is only partly within opening hours", async () => {
      open({ venue: { opensAt: "09:00", closesAt: "15:00" } });

      expect(await cell("AM")).toHaveTextContent("FreeOpen from 09:00");
      expect(await cell("PM")).toHaveTextContent("FreeOpen until 15:00");
      expect(await cell("Night")).toHaveTextContent(/^Closed$/);
    });

    it("names the event in a booked slot", async () => {
      open({ bookings: [booking()] });

      expect(await cell("PM")).toHaveTextContent("BookedTown Hall");
      expect(await cell("AM")).toHaveTextContent(/^Free$/);
    });

    it("marks the slots a booking's setup and teardown take", async () => {
      open({ venue: { setupMinutes: 60, teardownMinutes: 30 }, bookings: [booking()] });

      expect(await cell("AM")).toHaveTextContent("TurnaroundSetup or teardown: Town Hall");
      expect(await cell("Night")).toHaveTextContent("TurnaroundSetup or teardown: Town Hall");
    });

    it("names the reason in an unavailable slot, and still names a booking sharing it", async () => {
      open({
        bookings: [booking({ eventTitle: null })],
        unavailability: [{ id: "u1", reason: "internal_activity", notes: null, ...PM }],
      });

      const pm = await cell("PM");

      expect(pm).toHaveTextContent("Unavailable");
      expect(pm).toHaveTextContent("Internal activity");
      expect(pm).toHaveTextContent("Untitled event");
    });

    it("keeps a requested slot Free, but says who has asked for it", async () => {
      open({ holds: [{ id: "h1", eventId: "e2", eventTitle: "Summit", ...PM }, { id: "h2", eventId: "e3", eventTitle: null, ...PM }] });

      const pm = await cell("PM");

      expect(pm).toHaveTextContent("Free");
      expect(pm).toHaveTextContent("Requested: Summit");
      expect(pm).toHaveTextContent("Requested: another event");
    });

    it("shows every empty slot of a retired venue as Closed, never Free", async () => {
      open({ venue: { isActive: false }, bookings: [booking()] });

      expect(await cell("AM")).toHaveTextContent(/^Closed$/);
      expect(await cell("PM")).toHaveTextContent("BookedTown Hall");
      expect(screen.getByText("This venue is retired")).toBeInTheDocument();
    });

    it("explains what each status means", async () => {
      open();
      await grid();

      const key = screen.getByText("the room can be requested").closest("ul") as HTMLElement;

      expect(within(key).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "Freethe room can be requested",
        "Bookedan approved booking's own times",
        "Turnaroundonly setup or teardown time",
        "Unavailablea recorded unavailable period",
        "Closedoutside opening hours, or a retired venue",
      ]);
    });
  });

  describe("approved bookings", () => {
    it("says so when there are none in the range", async () => {
      open();
      await grid();

      expect(cardOf("Approved bookings")).toHaveTextContent("No approved bookings in this range.");
    });

    it("lists each with its event status, session, times, room-in-use window and layout", async () => {
      open({ bookings: [booking({ sessionLabel: "Day 1" })] });
      await grid();

      const card = cardOf("Approved bookings");

      expect(card).toHaveTextContent("Town Hall");
      expect(card).toHaveTextContent("Planning");
      expect(card).toHaveTextContent("Day 1");
      expect(card).toHaveTextContent("Room in use 13:00–18:00");
      expect(card).toHaveTextContent("Layout: U-shape");
    });

    it("widens 'Room in use' by the venue's setup and teardown, across days when needed", async () => {
      open({
        venue: { setupMinutes: 60, teardownMinutes: 30 },
        bookings: [booking({ startsAt: new Date("2027-03-04T11:00:00.000Z"), endsAt: new Date("2027-03-04T16:00:00.000Z"), layoutName: null })],
      });
      await grid();

      const card = cardOf("Approved bookings");

      // Night on the 4th, plus PM before for setup and the next day's AM after.
      expect(card).toHaveTextContent(/Room in use 4 Mar 2027.*5 Mar 2027/);
      expect(card).not.toHaveTextContent("Layout:");
    });

    it("warns about a booking that touches no slot at all, since the grid cannot show it", async () => {
      // 12:15-12:45 Singapore time: wholly inside the gap between AM and PM.
      open({ bookings: [booking({ startsAt: new Date("2027-03-04T04:15:00.000Z"), endsAt: new Date("2027-03-04T04:45:00.000Z") })] });
      await grid();

      expect(cardOf("Approved bookings")).toHaveTextContent(
        /30 minutes of this booking fall outside the AM, PM and Night slots/
      );
      expect(await cell("AM")).toHaveTextContent(/^Free$/);
      expect(await cell("PM")).toHaveTextContent(/^Free$/);
    });

    it("does not warn about a booking that merely crosses the lunch gap", async () => {
      // 09:00-17:00 Singapore time: holds AM and PM in full.
      open({ bookings: [booking({ startsAt: new Date("2027-03-04T01:00:00.000Z"), endsAt: new Date("2027-03-04T09:00:00.000Z") })] });
      await grid();

      expect(cardOf("Approved bookings")).not.toHaveTextContent("fall outside");
      expect(await cell("AM")).toHaveTextContent("BookedTown Hall");
      expect(await cell("PM")).toHaveTextContent("BookedTown Hall");
    });

    it("says nothing about slots for a booking that sits inside them", async () => {
      open({ bookings: [booking()] });
      await grid();

      expect(cardOf("Approved bookings")).not.toHaveTextContent("fall outside");
      expect(cardOf("Approved bookings")).not.toHaveTextContent("Overlaps with");
    });
  });

  describe("unavailable periods", () => {
    it("says so when there are none in the range", async () => {
      open();
      await grid();

      expect(cardOf("Unavailable periods")).toHaveTextContent("No unavailable periods in this range.");
    });

    it("lists each with its reason, notes and dates", async () => {
      open({ unavailability: [{ id: "u1", reason: "renovation", notes: "Floor resurfacing", ...PM }] });
      await grid();

      const card = cardOf("Unavailable periods");

      expect(card).toHaveTextContent("Renovation");
      expect(card).toHaveTextContent("Floor resurfacing");
      expect(card).toHaveTextContent("4 Mar 2027 to 4 Mar 2027");
    });
  });

  describe("overlaps", () => {
    it("flags the range and names what each item overlaps with", async () => {
      open({
        bookings: [booking(), booking({ id: "b2", eventId: "e2", eventTitle: "Summit" })],
        unavailability: [{ id: "u1", reason: "maintenance", notes: null, ...PM }],
      });
      await grid();

      expect(screen.getByText("Some bookings or unavailable periods overlap")).toBeInTheDocument();
      const first = within(cardOf("Approved bookings")).getAllByRole("listitem")[0];
      expect(first).toHaveTextContent("Overlaps with: Summit; Maintenance (4 Mar 2027 to 4 Mar 2027)");
      expect(cardOf("Unavailable periods")).toHaveTextContent("Overlaps with: Town Hall; Summit");
    });

    it("says nothing about overlaps when there are none", async () => {
      open({ bookings: [booking()] });
      await grid();

      expect(screen.queryByText("Some bookings or unavailable periods overlap")).not.toBeInTheDocument();
    });
  });

  describe("requests not yet approved", () => {
    it("are listed on their own card, apart from the approved bookings", async () => {
      open({ holds: [{ id: "h1", eventId: "e2", eventTitle: "Summit", ...PM }, { id: "h2", eventId: "e3", eventTitle: null, ...PM }] });
      await grid();

      const card = cardOf("Requested, not yet approved");

      expect(card).toHaveTextContent("Summit");
      expect(card).toHaveTextContent("Untitled event");
      expect(card).toHaveTextContent("These slots are still free, but someone has already asked for this room.");
      expect(cardOf("Approved bookings")).toHaveTextContent("No approved bookings in this range.");
    });

    it("have no card at all when there are none", async () => {
      open();
      await grid();

      expect(screen.queryByRole("heading", { name: "Requested, not yet approved" })).not.toBeInTheDocument();
    });
  });

  describe("when it cannot be loaded", () => {
    it("falls back to a general message when the server gives no reason", async () => {
      open(reply(500, {}));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this venue's availability.");
    });

    it("says the venue was not found", async () => {
      open(reply(404, { error: "Venue not found" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue not found");
    });

    it("explains a network failure", async () => {
      open(() => Promise.reject(new Error("offline")));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not reach the server. Check your connection and try again."
      );
    });
  });
});
