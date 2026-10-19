// @vitest-environment jsdom
//
// S-21, the venue availability calendar (SPM-46), showing actual times since
// SPM-93. The page only lays out what GET /api/venues/[id]/availability worked
// out, so the responses here are built with the same buildAvailability() the
// route uses - the test data cannot drift from the real response shape.
//
// Times are UTC; Singapore is UTC+8, so 05:00Z-10:00Z is 13:00-18:00 local.

import { describe, it, expect } from "vitest";
import VenueAvailabilityPage from "@/app/venues/[id]/availability/page";
import { buildAvailability } from "@/lib/venueAvailability";
import {
  breadcrumb,
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
/// The Schedule cell of a day's row.
const schedule = async (row = 1) => within(within(await grid()).getAllByRole("row")[row]).getAllByRole("cell")[1];
const entries = (cell: HTMLElement) => within(cell).getAllByRole("listitem").map((li) => li.textContent);
const cardOf = (title: string) => screen.getByRole("heading", { name: title }).closest("div.rounded-lg") as HTMLElement;

describe("Venue availability", () => {
  describe("who can open it", () => {
    it("[SPM-22][AC4] sends an anonymous visitor to log in, remembering the venue and range", async () => {
      setRoute("/venues/v1/availability?from=2027-03-01&to=2027-03-07", { id: "v1" });
      mockApi(signedOut());

      render(<VenueAvailabilityPage />);

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith(
          `/login?next=${encodeURIComponent("/venues/v1/availability?from=2027-03-01&to=2027-03-07")}`
        )
      );
    });

    it("[SPM-46][AC6] tells a role without access so, plainly, and shows nothing of the calendar", async () => {
      open(reply(403, { error: "Venue availability is for ConnectSphere staff" }), { role: "organiser" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue availability is for ConnectSphere staff");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Show availability" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Venue")).not.toBeInTheDocument();
      // SPM-98: the same trail as the calendar, 'Venues' still a link.
      expect(breadcrumb()).toEqual([
        ["Venues", "/venues"],
        ["Venue", null],
        ["Availability", null],
      ]);
    });

    it("[SPM-46][AC6] has its own words for the refusal when the server gives none", async () => {
      open(reply(403, {}), { role: "attendee" });

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue availability is for ConnectSphere staff");
    });

    it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
      open(reply(401, {}));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fvenues%2Fv1%2Favailability"));
    });
  });

  describe("the header", () => {
    it("[SPM-46][AC1] names the venue, the range, its opening hours and its turnaround", async () => {
      open({ venue: { setupMinutes: 60, teardownMinutes: 30 }, to: "2027-03-10" });

      expect(await screen.findByRole("heading", { level: 1, name: "Hall A availability" })).toBeInTheDocument();
      expect(screen.getByText("4 Mar 2027 – 10 Mar 2027 · open 07:00–23:59 · setup 60 min, turnaround 30 min")).toBeInTheDocument();
    });

    it("[SPM-22][AC3] links the venue in the breadcrumb to its editor for Venue Staff only", async () => {
      open({}, { role: "venue_staff" });
      await grid();

      expect(breadcrumb()).toEqual([
        ["Venues", "/venues"],
        ["Hall A", "/venues/v1/edit"],
        ["Availability", null],
      ]);
    });

    it("[SPM-22][AC3] names the venue in the breadcrumb without a link for a coordinator", async () => {
      open();
      await grid();

      expect(breadcrumb()).toEqual([
        ["Venues", "/venues"],
        ["Hall A", null],
        ["Availability", null],
      ]);
    });

    it("[SPM-98] calls the venue 'Venue' in the breadcrumb while it loads", async () => {
      open(() => new Promise(() => {}));
      await screen.findByRole("status", { name: "Loading" });

      expect(breadcrumb()).toEqual([
        ["Venues", "/venues"],
        ["Venue", null],
        ["Availability", null],
      ]);
    });

    it("[SPM-46] shows a placeholder and disables the week buttons until the calendar has loaded", async () => {
      open(() => new Promise(() => {}));

      expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous week" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next week" })).toBeDisabled();
    });
  });

  describe("the range", () => {
    it("[SPM-46][AC1] asks for the server's default week when the address gives none, and shows which week that was", async () => {
      const api = open({ from: "2027-03-04", to: "2027-03-10" });

      await grid();

      expect(api.sent(ROUTE)[0].url).toBe("/api/venues/v1/availability?");
      expect(screen.getByLabelText("From")).toHaveValue("2027-03-04");
      expect(screen.getByLabelText("To")).toHaveValue("2027-03-10");
    });

    it("[SPM-46][AC1] asks for the range in the address", async () => {
      const api = open({}, { query: "?from=2027-03-04&to=2027-03-04" });

      await grid();

      expect(api.sent(ROUTE)[0].url).toBe("/api/venues/v1/availability?from=2027-03-04&to=2027-03-04");
    });

    it("[SPM-46][AC1] Previous week and Next week move the whole range by seven days", async () => {
      open({ from: "2027-03-04", to: "2027-03-10" });
      await grid();

      await userEvent.click(screen.getByRole("button", { name: "Next week" }));
      await userEvent.click(screen.getByRole("button", { name: "Previous week" }));

      expect(router.push).toHaveBeenNthCalledWith(1, "/venues/v1/availability?from=2027-03-11&to=2027-03-17");
      expect(router.push).toHaveBeenNthCalledWith(2, "/venues/v1/availability?from=2027-02-25&to=2027-03-03");
    });

    it("[SPM-46][AC1] Show availability navigates to the dates typed in", async () => {
      open();
      await grid();
      set(screen.getByLabelText("From"), "2027-04-01");
      set(screen.getByLabelText("To"), "2027-04-14");

      await userEvent.click(screen.getByRole("button", { name: "Show availability" }));

      expect(router.push).toHaveBeenCalledWith("/venues/v1/availability?from=2027-04-01&to=2027-04-14");
    });

    it("[SPM-46][AC1] Show availability with the dates cleared asks for the server's default week", async () => {
      open();
      await grid();
      set(screen.getByLabelText("From"), "");
      set(screen.getByLabelText("To"), "");

      await userEvent.click(screen.getByRole("button", { name: "Show availability" }));

      expect(router.push).toHaveBeenCalledWith("/venues/v1/availability?");
    });

    it("[SPM-46][AC1] shows the server's sentence for a range it refuses", async () => {
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

    it("[SPM-46][AC1] lists the venues by name with their codes, and starts on the one being shown", async () => {
      open();
      await grid();

      await waitFor(() => expect(optionLabels()).toEqual(["Hall A (HALL-A)", "Room B (ROOM-B)"]));
      expect(screen.getByLabelText("Venue")).toHaveValue("v1");
    });

    it("[SPM-39][AC6] asks for active venues only as a coordinator", async () => {
      const api = open();
      await grid();

      await waitFor(() => expect(api.sent(VENUES)).toHaveLength(1));
      expect(api.sent(VENUES)[0].url).toBe("/api/venues");
    });

    it("[SPM-46][AC1] asks for retired venues too as Venue Staff, and marks them", async () => {
      const api = open({}, {
        role: "venue_staff",
        routes: { [VENUES]: [...catalogue, { id: "v3", code: "OLD", name: "Old Hall", isActive: false }] },
      });
      await grid();

      await waitFor(() => expect(optionLabels()).toContain("Old Hall (OLD) - retired"));
      expect(api.sent(VENUES)[0].url).toBe("/api/venues?includeRetired=true");
    });

    it("[SPM-46][AC1] always includes the venue on screen, even when the list does not", async () => {
      open({ venue: { isActive: false } }, { routes: { [VENUES]: [catalogue[0]] } });
      await grid();

      await waitFor(() => expect(optionLabels()).toEqual(["Hall A (HALL-A) - retired", "Room B (ROOM-B)"]));
    });

    it.each([
      ["answers with an error", reply(500, {})],
      ["cannot be reached", () => Promise.reject(new Error("offline"))],
    ])("[SPM-46][AC1] still shows the calendar when the venue list %s", async (_case, answer) => {
      open({}, { routes: { [VENUES]: answer } });

      expect(await grid()).toBeInTheDocument();
      expect(optionLabels()).toEqual(["Hall A (HALL-A)"]);
    });

    it("[SPM-46][AC1] Show availability goes to the venue that was picked, keeping the range", async () => {
      open();
      await grid();
      await waitFor(() => expect(optionLabels()).toHaveLength(2));

      set(screen.getByLabelText("Venue"), "v2");
      await userEvent.click(screen.getByRole("button", { name: "Show availability" }));

      expect(router.push).toHaveBeenCalledWith("/venues/v2/availability?from=2027-03-04&to=2027-03-04");
    });
  });

  describe("the schedule (SPM-93 AC9)", () => {
    it("[SPM-93][AC9] has a row per day and one Schedule column - no AM, PM or Night columns", async () => {
      open({ to: "2027-03-05" });

      const table = await grid();

      expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Day", "Schedule"]);
      expect(within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td")!.textContent)).toEqual([
        "Thu 4 Mar 2027",
        "Fri 5 Mar 2027",
      ]);
    });

    it("[SPM-93][AC9] says a day with nothing on is Free", async () => {
      open();

      expect(await schedule()).toHaveTextContent(/^Free$/);
    });

    it("[SPM-93][AC9] [SPM-46][AC3] names the event and its actual times in a booking's entry", async () => {
      open({ bookings: [booking()] });

      expect(entries(await schedule())).toEqual(["Booked13:00–18:00· Town Hall"]);
    });

    it("[SPM-93][AC9] SPM-93-TC15: shows a booking's setup and turnaround as their own entries, either side of the booked time", async () => {
      open({ venue: { setupMinutes: 30, teardownMinutes: 45 }, bookings: [booking()] });

      expect(entries(await schedule())).toEqual([
        "Setup12:30–13:00· Town Hall",
        "Booked13:00–18:00· Town Hall",
        "Turnaround18:00–18:45· Town Hall",
      ]);
    });

    it("[SPM-93][AC9] SPM-93-TC15: shows a request not yet approved, with its setup and turnaround, as Requested", async () => {
      open({ venue: { setupMinutes: 30, teardownMinutes: 0 }, holds: [{ id: "h1", eventId: "e2", eventTitle: "Summit", ...PM }] });

      expect(entries(await schedule())).toEqual(["Setup12:30–13:00· Summit", "Requested13:00–18:00· Summit"]);
    });

    it("[SPM-93][AC9] [SPM-46][AC4] SPM-93-TC16: shows an unavailable period at its times, with its reason", async () => {
      open({
        unavailability: [
          { id: "u1", reason: "internal_activity", notes: null, startsAt: new Date("2027-03-04T06:00:00.000Z"), endsAt: new Date("2027-03-04T10:00:00.000Z") },
        ],
      });

      expect(entries(await schedule())).toEqual(["Unavailable14:00–18:00· Internal activity"]);
    });

    it("[SPM-93][AC9] lists everything on a day in time order", async () => {
      open({
        bookings: [booking({ eventTitle: null })],
        unavailability: [{ id: "u1", reason: "maintenance", notes: null, startsAt: new Date("2027-03-04T01:00:00.000Z"), endsAt: new Date("2027-03-04T02:00:00.000Z") }],
      });

      expect(entries(await schedule())).toEqual(["Unavailable09:00–10:00· Maintenance", "Booked13:00–18:00· Untitled event"]);
    });

    it("[SPM-39][AC6] shows an empty day of a retired venue as Closed, never Free", async () => {
      open({ venue: { isActive: false }, to: "2027-03-05", bookings: [booking()] });

      expect(entries(await schedule())).toEqual(["Booked13:00–18:00· Town Hall"]);
      expect(await schedule(2)).toHaveTextContent(/^Closed$/);
      expect(screen.getByText("This venue is retired")).toBeInTheDocument();
    });

    it("[SPM-93][AC9] explains what each kind of entry means", async () => {
      open();
      await grid();

      const key = screen.getByText("nothing on that day").closest("ul") as HTMLElement;

      expect(within(key).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "Bookedan approved booking's own times",
        "Setupthe venue's setup time before a booking or request",
        "Turnaroundthe venue's turnaround time after it",
        "Requestedasked for, not yet approved",
        "Unavailablea recorded unavailable period",
        "Freenothing on that day",
      ]);
    });
  });

  describe("approved bookings", () => {
    it("[SPM-46][AC3][AC7] says so when there are none in the range", async () => {
      open();
      await grid();

      expect(cardOf("Approved bookings")).toHaveTextContent("No approved bookings in this range.");
    });

    it("[SPM-46][AC3][AC7] lists each with its event status, session, times, room-in-use window and layout", async () => {
      open({ bookings: [booking({ sessionLabel: "Day 1" })] });
      await grid();

      const card = cardOf("Approved bookings");

      expect(card).toHaveTextContent("Town Hall");
      expect(card).toHaveTextContent("Planning");
      expect(card).toHaveTextContent("Day 1");
      expect(card).toHaveTextContent("Room in use 13:00–18:00");
      expect(card).toHaveTextContent("Layout: U-shape");
    });

    it("[SPM-93][AC6][AC9] SPM-93-TC15: widens 'Room in use' by the venue's setup and turnaround minutes", async () => {
      open({ venue: { setupMinutes: 30, teardownMinutes: 45 }, bookings: [booking({ layoutName: null })] });
      await grid();

      const card = cardOf("Approved bookings");

      expect(card).toHaveTextContent("4 Mar 2027, 13:00–18:00");
      expect(card).toHaveTextContent("Room in use 12:30–18:45");
      expect(card).not.toHaveTextContent("Layout:");
    });

    it("[SPM-93][AC9] gives both dates when the room is in use across midnight", async () => {
      open({
        venue: { setupMinutes: 60, teardownMinutes: 30 },
        bookings: [booking({ startsAt: new Date("2027-03-04T11:00:00.000Z"), endsAt: new Date("2027-03-04T16:00:00.000Z") })],
      });
      await grid();

      expect(cardOf("Approved bookings")).toHaveTextContent(/Room in use 4 Mar 2027, 18:00 – 5 Mar 2027, 00:30/);
    });

    it("[SPM-93][AC4] SPM-93-TC05: shows a booking in the old lunch gap at its times, with no warning", async () => {
      // 12:15-12:45 Singapore time: once between the AM and PM slots, now an ordinary booking (#126).
      open({ bookings: [booking({ startsAt: new Date("2027-03-04T04:15:00.000Z"), endsAt: new Date("2027-03-04T04:45:00.000Z") })] });

      expect(entries(await schedule())).toEqual(["Booked12:15–12:45· Town Hall"]);
      expect(cardOf("Approved bookings")).not.toHaveTextContent(/slot/i);
    });

    it("[SPM-46][AC5] says nothing about overlaps for a booking that has none", async () => {
      open({ bookings: [booking()] });
      await grid();

      expect(cardOf("Approved bookings")).not.toHaveTextContent("Overlaps with");
    });
  });

  describe("unavailable periods", () => {
    it("[SPM-46][AC4] says so when there are none in the range", async () => {
      open();
      await grid();

      expect(cardOf("Unavailable periods")).toHaveTextContent("No unavailable periods in this range.");
    });

    it("[SPM-46][AC4] SPM-93-TC16: lists each with its reason, notes and times", async () => {
      open({ unavailability: [{ id: "u1", reason: "renovation", notes: "Floor resurfacing", ...PM }] });
      await grid();

      const card = cardOf("Unavailable periods");

      expect(card).toHaveTextContent("Renovation");
      expect(card).toHaveTextContent("Floor resurfacing");
      expect(card).toHaveTextContent("4 Mar 2027, 13:00–18:00");
    });
  });

  describe("overlaps", () => {
    it("[SPM-46][AC5] flags the range and names what each item overlaps with", async () => {
      open({
        bookings: [booking(), booking({ id: "b2", eventId: "e2", eventTitle: "Summit" })],
        unavailability: [{ id: "u1", reason: "maintenance", notes: null, ...PM }],
      });
      await grid();

      expect(screen.getByText("Some bookings or unavailable periods overlap")).toBeInTheDocument();
      const first = within(cardOf("Approved bookings")).getAllByRole("listitem")[0];
      expect(first).toHaveTextContent("Overlaps with: Summit; Maintenance (4 Mar 2027, 13:00–18:00)");
      expect(cardOf("Unavailable periods")).toHaveTextContent("Overlaps with: Town Hall; Summit");
    });

    it("[SPM-46][AC5] names an overlap it has no details for in general words", async () => {
      const body = availability({ bookings: [booking()] });
      body.bookings[0].overlaps = { bookingIds: ["gone"], unavailabilityIds: ["gone-too"] };
      body.hasOverlaps = true;
      open(() => body);
      await grid();

      expect(within(cardOf("Approved bookings")).getAllByRole("listitem")[0]).toHaveTextContent(
        "Overlaps with: another booking; an unavailable period"
      );
    });

    it("[SPM-46][AC5] says nothing about overlaps when there are none", async () => {
      open({ bookings: [booking()] });
      await grid();

      expect(screen.queryByText("Some bookings or unavailable periods overlap")).not.toBeInTheDocument();
    });
  });

  describe("requests not yet approved", () => {
    it("[SPM-93][AC9] are listed on their own card, apart from the approved bookings", async () => {
      open({ holds: [{ id: "h1", eventId: "e2", eventTitle: "Summit", ...PM }, { id: "h2", eventId: "e3", eventTitle: null, ...PM }] });
      await grid();

      const card = cardOf("Requested, not yet approved");

      expect(card).toHaveTextContent("Summit");
      expect(card).toHaveTextContent("Untitled event");
      expect(card).toHaveTextContent("4 Mar 2027, 13:00–18:00");
      expect(card).toHaveTextContent("Room in use 13:00–18:00");
      expect(card).toHaveTextContent("These times are not booked yet, but someone has already asked for this room.");
      expect(cardOf("Approved bookings")).toHaveTextContent("No approved bookings in this range.");
    });

    it("[SPM-93][AC9] have no card at all when there are none", async () => {
      open();
      await grid();

      expect(screen.queryByRole("heading", { name: "Requested, not yet approved" })).not.toBeInTheDocument();
    });
  });

  describe("when it cannot be loaded", () => {
    it("[SPM-46] falls back to a general message when the server gives no reason", async () => {
      open(reply(500, {}));

      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this venue's availability.");
    });

    it("[SPM-46] says the venue was not found", async () => {
      open(reply(404, { error: "Venue not found" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Venue not found");
    });

    it("[SPM-46] explains a network failure", async () => {
      open(() => Promise.reject(new Error("offline")));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not reach the server. Check your connection and try again."
      );
    });
  });
});
