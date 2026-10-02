// @vitest-environment jsdom
//
// SPM-41 / SPM-42: the event's Venue tab and the booking request form. Times
// are written in UTC; Singapore is UTC+8, so 05:30Z-09:00Z on 4 March is
// 13:30-17:00 local - inside the PM slot (13:00-18:00).

import { describe, it, expect } from "vitest";
import EventVenuePage from "@/app/events/[id]/venue/page";
import BookingRequestPage from "@/app/events/[id]/booking/new/page";
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

const REF = "EVT-000007";
const INFO = `GET /api/events/${REF}/venue-bookings`;
const SUITABILITY = `GET /api/events/${REF}/venue-suitability`;
const set = (control: HTMLElement, value: string) => fireEvent.change(control, { target: { value } });

const sessions = [
  { id: "s1", label: "Day 1", startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-04T09:00:00.000Z", preferredLayout: "boardroom" },
  { id: "s2", label: null, startsAt: "2027-03-05T01:00:00.000Z", endsAt: "2027-03-05T03:00:00.000Z", preferredLayout: null },
];

function info(overrides: Record<string, unknown> = {}) {
  return {
    event: { title: "Town Hall", preferredLayout: "theatre" },
    schedule: { startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-04T09:00:00.000Z" },
    sessions: [],
    cannotRequest: null,
    bookings: [],
    ...overrides,
  };
}

describe("Event Venue tab", () => {
  const hallA = {
    venue: { id: "v1", code: "HALL-A", name: "Hall A", building: "Tower 1", floor: "3", maxCapacity: 300, layouts: [{ layoutName: "theatre", capacity: 300 }, { layoutName: "banquet", capacity: 180 }] },
    suitable: true,
    unmet: [],
    optionalMissing: [],
  };
  const roomB = {
    venue: { id: "v2", code: "ROOM-B", name: "Room B", building: "Annex", floor: null, maxCapacity: 40, layouts: [] },
    suitable: false,
    unmet: [
      { kind: "layout", layoutName: "theatre" },
      { kind: "facility", facilityId: "f1", name: "Hearing loop", category: "accessibility" },
    ],
    optionalMissing: [],
  };

  function suitability(results: object[] = [hallA, roomB], eventOverrides: Record<string, unknown> = {}) {
    return {
      event: { expectedAttendance: 100, preferredLayout: "theatre", requirements: [], missing: [], ...eventOverrides },
      results,
    };
  }

  function open(routes: Record<string, unknown> = {}, role = "coordinator") {
    setRoute(`/events/${REF}/venue`, { id: REF });
    const api = mockApi({ ...signedInAs(role), [INFO]: info(), [SUITABILITY]: suitability(), ...routes });
    render(<EventVenuePage />);
    return api;
  }

  const card = async (name: string) => (await screen.findByText(name, { exact: false })).closest("div.rounded-lg") as HTMLElement;

  it("sends an anonymous visitor to log in", async () => {
    setRoute(`/events/${REF}/venue`, { id: REF });
    mockApi(signedOut());

    render(<EventVenuePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
  });

  it("renders nothing until it knows who is looking", () => {
    setRoute(`/events/${REF}/venue`, { id: REF });
    mockApi({ "GET /api/auth/me": () => new Promise(() => {}) });

    const { container } = render(<EventVenuePage />);

    expect(container).toBeEmptyDOMElement();
  });

  it("counts the venues checked and how many suit the event", async () => {
    open();

    expect(await screen.findByText("2 venues checked · 1 suitable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Venue" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Search with filters" })).toHaveAttribute(
      "href",
      "/venues/search?event=EVT-000007"
    );
  });

  it("describes each venue: where it is, its capacity and its layouts", async () => {
    open();

    expect(await card("Hall A")).toHaveTextContent("Tower 1 — 3 · max 300 overall · Theatre 300, Banquet 180");
    expect(await card("Room B")).toHaveTextContent("Annex · max 40 overall");
  });

  it("offers Request booking for a suitable venue only", async () => {
    open();

    const suitable = await card("Hall A");
    const unsuitable = await card("Room B");

    expect(suitable).toHaveTextContent("Suitable");
    expect(within(suitable).getByRole("link", { name: "Request booking" })).toHaveAttribute(
      "href",
      "/events/EVT-000007/booking/new?venue=v1"
    );
    expect(unsuitable).toHaveTextContent("Not suitable");
    expect(within(unsuitable).queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
  });

  it("lists every requirement an unsuitable venue fails, one line each", async () => {
    open();

    const reasons = within(await card("Room B")).getAllByRole("listitem").map((li) => li.textContent);

    expect(reasons).toEqual(["Theatre layout is not offered.", "Missing accessibility feature: Hearing loop."]);
  });

  it("notes a missing nice-to-have without calling the venue unsuitable", async () => {
    open({
      [SUITABILITY]: suitability([
        { ...hallA, optionalMissing: [{ kind: "facility", facilityId: "f2", name: "Stage", category: "facility" }] },
      ]),
    });

    const hall = await card("Hall A");

    expect(hall).toHaveTextContent("Nice-to-have not available. Missing facility: Stage.");
    expect(within(hall).getByRole("link", { name: "Request booking" })).toBeInTheDocument();
  });

  it("says which part of the check was skipped when the event has not said what it needs", async () => {
    open({ [SUITABILITY]: suitability([hallA], { missing: ["expectedAttendance", "preferredLayout"] }) });

    expect(await screen.findByText("This check is incomplete")).toBeInTheDocument();
    expect(screen.getByText(/The event has no expected attendance or preferred layout yet/)).toBeInTheDocument();
  });

  it("explains why booking cannot be requested, and offers no Request booking", async () => {
    open({ [INFO]: info({ cannotRequest: "Only the assigned Coordinator can request a venue booking." }) });

    expect(await screen.findByText("Only the assigned Coordinator can request a venue booking.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Request booking" })).not.toBeInTheDocument();
  });

  it("lists the event's existing booking requests with their slots, layout and status", async () => {
    open({
      [INFO]: info({
        bookings: [
          { id: "b1", status: "pending", startsAt: "2027-03-04T05:00:00.000Z", endsAt: "2027-03-04T10:00:00.000Z", layoutName: "theatre", session: null, venue: { code: "HALL-A", name: "Hall A" } },
          { id: "b2", status: "approved", startsAt: "2027-03-05T05:00:00.000Z", endsAt: "2027-03-05T10:00:00.000Z", layoutName: null, session: { id: "s2", label: null }, venue: { code: "ROOM-B", name: "Room B" } },
        ],
      }),
    });

    const requests = (await screen.findByRole("heading", { name: "Booking requests" })).closest("div.rounded-lg") as HTMLElement;

    expect(requests).toHaveTextContent("4 Mar 2027 · PM (13:00–18:00) · Theatre");
    expect(requests).toHaveTextContent("Pending");
    expect(requests).toHaveTextContent("Session · 5 Mar 2027 · PM (13:00–18:00)");
    expect(requests).toHaveTextContent("Approved");
  });

  it("shows no booking requests card when there are none", async () => {
    open();

    await card("Hall A");

    expect(screen.queryByRole("heading", { name: "Booking requests" })).not.toBeInTheDocument();
  });

  describe("a multi-session event", () => {
    it("has no session picker on an ordinary event", async () => {
      const api = open();

      await card("Hall A");

      expect(screen.queryByLabelText("Session")).not.toBeInTheDocument();
      expect(api.sent(SUITABILITY)[0].url).toBe(`/api/events/${REF}/venue-suitability`);
    });

    it("judges venues for the first session by default, and carries it into Request booking", async () => {
      const api = open({ [INFO]: info({ sessions }) });

      const hall = await card("Hall A");

      expect(api.sent(SUITABILITY)[0].url).toBe(`/api/events/${REF}/venue-suitability?session=s1`);
      expect(screen.getByLabelText("Session")).toHaveValue("s1");
      expect(within(hall).getByRole("link", { name: "Request booking" })).toHaveAttribute(
        "href",
        "/events/EVT-000007/booking/new?venue=v1&session=s1"
      );
    });

    it("names an unlabelled session 'Session', with its times", async () => {
      open({ [INFO]: info({ sessions }) });
      await card("Hall A");

      const options = within(screen.getByLabelText("Session")).getAllByRole("option").map((o) => o.textContent);

      expect(options[0]).toMatch(/^Day 1 — 4 Mar 2027/);
      expect(options[1]).toMatch(/^Session — 5 Mar 2027/);
    });

    it("re-checks every venue when another session is chosen", async () => {
      const api = open({ [INFO]: info({ sessions }) });
      await card("Hall A");

      await userEvent.selectOptions(screen.getByLabelText("Session"), "s2");

      await waitFor(() =>
        expect(api.sent(SUITABILITY).map((c) => c.url)).toContain(`/api/events/${REF}/venue-suitability?session=s2`)
      );
    });
  });

  describe("when it cannot be loaded", () => {
    it.each([
      ["the event is not found", { [INFO]: reply(404, {}) }, "This event doesn't exist, or you don't have access to it."],
      ["the booking requests fail to load", { [INFO]: reply(500, {}) }, "Could not load this event's booking requests."],
      ["the suitability check is refused", { [SUITABILITY]: reply(403, {}) }, "Venue suitability is for ConnectSphere staff."],
      ["the suitability check cannot find the event", { [SUITABILITY]: reply(404, {}) }, "This event doesn't exist, or you don't have access to it."],
      ["the suitability check fails", { [SUITABILITY]: reply(500, {}) }, "Could not check venues for this event."],
    ])("says so when %s", async (_case, routes, message) => {
      open(routes);

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });

    it("offers a Retry that loads again", async () => {
      const api = open({ [SUITABILITY]: reply(500, {}) });
      await screen.findByRole("alert");

      api.on(SUITABILITY, suitability());
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(await card("Hall A")).toBeInTheDocument();
    });

    it.each([INFO, SUITABILITY])("sends the user to log in when %s answers that the session has expired", async (route) => {
      open({ [route]: reply(401, {}) });

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
    });
  });
});

describe("Venue booking request form", () => {
  const VENUE = "GET /api/venues/v1";
  const POST = `POST /api/events/${REF}/venue-bookings`;

  const venue = (overrides: Record<string, unknown> = {}) => ({
    id: "v1",
    code: "HALL-A",
    name: "Hall A",
    setupMinutes: 0,
    teardownMinutes: 0,
    ...overrides,
  });

  function open(routes: Record<string, unknown> = {}, query = "?venue=v1") {
    setRoute(`/events/${REF}/booking/new${query}`, { id: REF });
    const api = mockApi({
      ...signedInAs("coordinator"),
      [INFO]: info(),
      [VENUE]: venue(),
      [POST]: reply(201, { id: "b1" }),
      ...routes,
    });
    render(<BookingRequestPage />);
    return api;
  }

  const date = () => screen.findByLabelText(/^Date/);
  const slot = (name: string) => screen.getByRole("checkbox", { name: new RegExp(`^${name} \\(`) });
  const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit request" }));
  const valueOf = (label: string) =>
    screen.getAllByRole("term").find((t) => t.textContent === label)!.nextElementSibling as HTMLElement;

  it("sends an anonymous visitor to log in", async () => {
    setRoute(`/events/${REF}/booking/new?venue=v1`, { id: REF });
    mockApi(signedOut());

    render(<BookingRequestPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
  });

  it("shows a placeholder while it loads", async () => {
    open({ [VENUE]: () => new Promise(() => {}) });

    expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("opened without a venue in the address, shows an error instead of a form", async () => {
    open({ "GET /api/venues/null": reply(404, {}) }, "");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this");
    expect(screen.queryByLabelText(/^Date/)).not.toBeInTheDocument();
  });

  it.each([
    ["the venue", { [VENUE]: reply(404, {}) }],
    ["the event", { [INFO]: reply(404, {}) }],
  ])("says so when %s cannot be found", async (_case, routes) => {
    open(routes);

    expect(await screen.findByRole("alert")).toHaveTextContent("This event or venue could not be found.");
  });

  it("sends the user to log in when their session has expired", async () => {
    open({ [VENUE]: reply(401, {}) });

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fvenue"));
  });

  describe("what it starts with", () => {
    it("the event, venue and layout being requested", async () => {
      open();
      await date();

      expect(valueOf("Event")).toHaveTextContent("Town Hall");
      expect(valueOf("Venue")).toHaveTextContent("Hall A");
      expect(valueOf("Layout")).toHaveTextContent("Theatre");
      expect(screen.queryByText("Session")).not.toBeInTheDocument();
    });

    it("the event's own date and the slots it runs in", async () => {
      open();

      expect(await date()).toHaveValue("2027-03-04");
      expect(slot("PM")).toBeChecked();
      expect(slot("AM")).not.toBeChecked();
      expect(slot("Night")).not.toBeChecked();
    });

    it("a session's own date, slots and layout when one is named", async () => {
      open({ [INFO]: info({ sessions }) }, "?venue=v1&session=s2");

      // 09:00-11:00 Singapore time on 5 March: the AM slot.
      expect(await date()).toHaveValue("2027-03-05");
      expect(slot("AM")).toBeChecked();
      expect(slot("PM")).not.toBeChecked();
      expect(valueOf("Session")).toHaveTextContent(/^Session — 5 Mar 2027/);
      expect(valueOf("Layout")).toHaveTextContent("Not set");
    });

    it("names a labelled session by its label", async () => {
      open({ [INFO]: info({ sessions }) }, "?venue=v1&session=s1");
      await date();

      expect(valueOf("Session")).toHaveTextContent(/^Day 1 — 4 Mar 2027/);
      expect(valueOf("Layout")).toHaveTextContent("Boardroom");
    });

    it.each([
      ["has no dates yet", { startsAt: null, endsAt: null }],
      ["runs over more than one day", { startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-05T09:00:00.000Z" }],
    ])("nothing chosen when the event %s", async (_case, schedule) => {
      open({ [INFO]: info({ schedule, event: { title: null, preferredLayout: null } }) });

      expect(await date()).toHaveValue("");
      expect(slot("AM")).not.toBeChecked();
      expect(slot("PM")).not.toBeChecked();
      expect(valueOf("Event")).toHaveTextContent("Untitled event");
      expect(valueOf("Layout")).toHaveTextContent("Not set");
    });
  });

  describe("setup and turnaround", () => {
    it("says none is needed at a venue that needs none", async () => {
      open();
      await date();

      expect(screen.getByText("No setup or turnaround needed at this venue.")).toBeInTheDocument();
    });

    it("shows the slots the venue will hold either side, which the coordinator does not choose", async () => {
      open({ [VENUE]: venue({ setupMinutes: 60, teardownMinutes: 30 }) });
      await date();

      expect(screen.getByText("Setup: 4 Mar 2027 AM (07:00–12:00)")).toBeInTheDocument();
      expect(screen.getByText("Turnaround: 4 Mar 2027 Night (19:00–24:00)")).toBeInTheDocument();
    });

    it("follows the chosen slots, crossing into the next day when needed", async () => {
      open({ [VENUE]: venue({ setupMinutes: 60, teardownMinutes: 30 }) });
      await date();

      await userEvent.click(slot("Night"));

      expect(screen.getByText("Turnaround: 5 Mar 2027 AM (07:00–12:00)")).toBeInTheDocument();
    });

    it("shows nothing while no slot is chosen", async () => {
      open({ [VENUE]: venue({ setupMinutes: 60, teardownMinutes: 30 }) });
      await date();

      await userEvent.click(slot("PM"));

      expect(screen.queryByText(/^Setup:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Turnaround:/)).not.toBeInTheDocument();
    });
  });

  describe("submitting", () => {
    it("sends the venue, date, slots and requirements, then confirms it is pending", async () => {
      const api = open();
      set(await date(), "2027-03-06");
      await userEvent.click(slot("Night"));
      set(screen.getByLabelText("Venue requirements"), "Stage at the north end");

      await submit();

      expect(await screen.findByText("Booking request sent to Venue Staff.")).toBeInTheDocument();
      expect(api.sent(POST)[0].body).toEqual({
        venueId: "v1",
        day: "2027-03-06",
        slots: ["PM", "Night"],
        requirementsNote: "Stage at the north end",
      });
      expect(screen.getByText("It is Pending until Venue Staff review it.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to Venue" })).toHaveAttribute("href", "/events/EVT-000007/venue");
      expect(screen.queryByRole("button", { name: "Submit request" })).not.toBeInTheDocument();
    });

    it("sends the session when the request is for one", async () => {
      const api = open({ [INFO]: info({ sessions }) }, "?venue=v1&session=s1");
      await date();

      await submit();

      await waitFor(() => expect(api.sent(POST)).toHaveLength(1));
      expect(api.sent(POST)[0].body).toMatchObject({ venueId: "v1", sessionId: "s1", day: "2027-03-04", slots: ["PM"] });
    });

    it("can un-choose a slot", async () => {
      const api = open();
      await date();

      await userEvent.click(slot("AM"));
      await userEvent.click(slot("PM"));
      await submit();

      await waitFor(() => expect(api.sent(POST)).toHaveLength(1));
      expect((api.sent(POST)[0].body as { slots: string[] }).slots).toEqual(["AM"]);
    });

    it.each([
      ["the server's reason", reply(400, { error: "Hall A is already booked for this time." }), "Hall A is already booked for this time."],
      ["plain words for a validation failure", reply(400, { error: "Validation failed", details: {} }), "Check the date and slots, then try again."],
      ["a network failure", () => Promise.reject(new Error("offline")), "Could not send the request. Try again."],
    ])("shows %s and keeps the form", async (_case, answer, message) => {
      open({ [POST]: answer });
      await date();

      await submit();

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled();
      expect(screen.queryByText("Booking request sent to Venue Staff.")).not.toBeInTheDocument();
    });

    it("shows 'Submitting…' and cannot be pressed twice while in flight", async () => {
      let finish: (value: unknown) => void = () => {};
      const api = open({ [POST]: () => new Promise((resolve) => (finish = resolve)) });
      await date();

      await submit();

      expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
      finish({ id: "b1" });
      await screen.findByText("Booking request sent to Venue Staff.");
      expect(api.sent(POST)).toHaveLength(1);
    });
  });

  it("shows the reason instead of the form when a booking cannot be requested", async () => {
    open({ [INFO]: info({ cannotRequest: "A venue cannot be requested for a completed, cancelled or rejected event." }) });

    expect(
      await screen.findByText("A venue cannot be requested for a completed, cancelled or rejected event.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Date/)).not.toBeInTheDocument();
  });

  it("Cancel goes back to the event's Venue tab", async () => {
    open();
    await date();

    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/events/EVT-000007/venue");
  });
});
