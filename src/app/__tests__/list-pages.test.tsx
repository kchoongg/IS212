// @vitest-environment jsdom
//
// The screens that load a list and show it: dashboard, events, review queue,
// booking requests, equipment requests and assignments. Each <Table> renders
// its rows twice (a table for desktop, cards for mobile), so row assertions
// look inside the table.

import { describe, it, expect } from "vitest";
import DashboardPage from "@/app/dashboard/page";
import EventsPage from "@/app/events/page";
import QueuePage from "@/app/queue/page";
import BookingsPage from "@/app/bookings/page";
import EquipmentRequestsPage from "@/app/equipment/requests/page";
import AssignmentsPage from "@/app/assignments/page";
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
  viewer,
  waitFor,
  within,
} from "@/test/ui";

const DAY = 86_400_000;
const table = () => screen.findByRole("table");
const rowTexts = async () =>
  within(await table())
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);

function event(sequenceNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `event-${sequenceNumber}`,
    sequenceNumber,
    title: `Event ${sequenceNumber}`,
    status: "planning",
    category: "conference",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    expectedAttendance: 100,
    coordinatorId: null,
    ...overrides,
  };
}

describe("Dashboard", () => {
  const listed = () => screen.getAllByRole("listitem").filter((li) => li.querySelector("a[href^='/events/']"));
  const listedTitles = () => listed().map((li) => li.querySelector("span")!.textContent);

  it("sends an anonymous visitor to log in", async () => {
    mockApi(signedOut());

    render(<DashboardPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fdashboard"));
  });

  it("greets an organiser and surfaces their drafts and requests under review", async () => {
    mockApi({
      ...signedInAs("organiser", { name: "Rachel Ng" }),
      "GET /api/events": [
        event(1, { title: "My draft", status: "draft" }),
        event(2, { title: "In review", status: "under_review" }),
        event(3, { title: "Already confirmed", status: "confirmed" }),
      ],
    });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Welcome, Rachel Ng" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs your attention" })).toBeInTheDocument();
    await waitFor(() => expect(listedTitles()).toEqual(["My draft", "In review"]));
    expect(screen.getByRole("link", { name: "New event request" })).toHaveAttribute("href", "/events/new");
    expect(screen.queryByText("Internal view")).not.toBeInTheDocument();
  });

  it("opens a draft in the editor and anything else on its detail page", async () => {
    mockApi({
      ...signedInAs("organiser"),
      "GET /api/events": [event(1, { status: "draft" }), event(2, { status: "under_review" })],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(listed()).toHaveLength(2));
    const hrefs = listed().map((li) => li.querySelector("a")!.getAttribute("href"));
    expect(hrefs).toEqual(["/events/EVT-000001/edit", "/events/EVT-000002"]);
  });

  it("labels an event with no title as untitled", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": [event(1, { status: "draft", title: null })] });

    render(<DashboardPage />);

    expect(await screen.findByText("Untitled event")).toBeInTheDocument();
  });

  it("shows a coordinator only the unconfirmed events assigned to them", async () => {
    const me = viewer("coordinator");
    mockApi({
      ...signedInAs("coordinator"),
      "GET /api/events": [
        event(1, { title: "Mine, in planning", coordinatorId: me.id }),
        event(2, { title: "A colleague's", coordinatorId: "someone-else" }),
        event(3, { title: "Nobody's yet", status: "submitted" }),
        event(4, { title: "Mine, confirmed", status: "confirmed", coordinatorId: me.id }),
      ],
    });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Awaiting your review" })).toBeInTheDocument();
    await waitFor(() => expect(listedTitles()).toEqual(["Mine, in planning"]));
    expect(screen.getByText("Internal view")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New event request" })).not.toBeInTheDocument();
  });

  it("shows the Ops Manager submitted events that have no coordinator", async () => {
    mockApi({
      ...signedInAs("ops_manager"),
      "GET /api/events": [
        event(1, { title: "Waiting", status: "submitted" }),
        event(2, { title: "Submitted but assigned", status: "submitted", coordinatorId: "c1" }),
        event(3, { title: "Past that stage", status: "planning" }),
      ],
    });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Awaiting assignment" })).toBeInTheDocument();
    await waitFor(() => expect(listedTitles()).toEqual(["Waiting"]));
  });

  it.each([
    ["venue_staff", "Upcoming events"],
    ["tech_support", "Upcoming events"],
    ["attendee", "Open for registration"],
  ])("gives %s the heading %j", async (role, heading) => {
    mockApi({ ...signedInAs(role), "GET /api/events": [event(1, { status: "confirmed" })] });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    await waitFor(() => expect(listedTitles()).toEqual(["Event 1"]));
  });

  it("does not tell an attendee they are seeing an internal view", async () => {
    mockApi({ ...signedInAs("attendee"), "GET /api/events": [] });

    render(<DashboardPage />);

    await screen.findByText("Nothing needs your attention");
    expect(screen.queryByText("Internal view")).not.toBeInTheDocument();
  });

  it.each(ROLES)("links %s to the rest of their navigation, without Dashboard itself", async (role) => {
    mockApi({ ...signedInAs(role), "GET /api/events": [] });

    render(<DashboardPage />);

    await screen.findByText("Nothing needs your attention");
    const goTo = screen.getByRole("heading", { name: "Go to" }).closest("div.rounded-lg") as HTMLElement;
    const links = within(goTo).getAllByRole("link").map((a) => a.textContent);
    expect(links).not.toContain("Dashboard");
    expect(links).toContain("Notifications");
  });

  it("falls back to the organiser's view for a role it does not recognise", async () => {
    mockApi({ ...signedInAs("intern"), "GET /api/events": [event(1, { status: "draft" })] });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Needs your attention" })).toBeInTheDocument();
  });

  it("sends the user to log in when their session has expired mid-visit", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": reply(401, { error: "Not authenticated" }) });

    render(<DashboardPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fdashboard"));
  });

  it("shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("organiser"), "GET /api/events": reply(500, {}) });
    render(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your events.");

    api.on("GET /api/events", [event(1, { status: "draft", title: "Recovered" })]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Events page", () => {
  const statusFilter = () => screen.getByLabelText("Filter by status");
  const optionLabels = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

  it("sends an anonymous visitor to log in", async () => {
    mockApi(signedOut());

    render(<EventsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents"));
  });

  describe("for an organiser", () => {
    const events = [
      event(1, { title: "Unsent idea", status: "draft" }),
      event(2, { title: "Second draft", status: "draft" }),
      event(3, { title: "Gala Dinner", status: "under_review" }),
      event(4, { title: "Summit", status: "confirmed" }),
    ];

    function renderPage(list: object[] = events) {
      mockApi({ ...signedInAs("organiser"), "GET /api/events": list });
      render(<EventsPage />);
    }

    it("keeps drafts in their own section, with a count, apart from submitted requests", async () => {
      renderPage();

      expect(await screen.findByRole("heading", { name: "Drafts — not yet submitted (2)" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "My events" })).toBeInTheDocument();
      const drafts = screen.getByRole("table", { name: "Draft event requests" });
      const submitted = screen.getByRole("table", { name: "Events" });
      expect(within(drafts).getByText("Unsent idea")).toBeInTheDocument();
      expect(within(drafts).queryByText("Gala Dinner")).not.toBeInTheDocument();
      expect(within(submitted).getByText("Gala Dinner")).toBeInTheDocument();
      expect(within(submitted).queryByText("Unsent idea")).not.toBeInTheDocument();
    });

    it("shows each event's reference, attendance and status", async () => {
      renderPage([event(3, { title: "Gala Dinner", status: "under_review", expectedAttendance: 250 })]);

      const row = within(await screen.findByRole("table", { name: "Events" })).getAllByRole("row")[1];

      expect(row).toHaveTextContent("EVT-000003");
      expect(row).toHaveTextContent("Gala Dinner");
      expect(row).toHaveTextContent("250");
      expect(row).toHaveTextContent("Under review");
    });

    it("opens a draft in the editor", async () => {
      renderPage();
      const drafts = await screen.findByRole("table", { name: "Draft event requests" });

      await userEvent.click(within(drafts).getByText("Unsent idea"));

      expect(router.push).toHaveBeenCalledWith("/events/EVT-000001/edit");
    });

    it("opens a submitted request on its detail page", async () => {
      renderPage();
      const submitted = await screen.findByRole("table", { name: "Events" });

      await userEvent.click(within(submitted).getByText("Summit"));

      expect(router.push).toHaveBeenCalledWith("/events/EVT-000004");
    });

    it("can filter by status, including Draft", async () => {
      renderPage();
      await screen.findByRole("table", { name: "Events" });

      await userEvent.selectOptions(statusFilter(), "Confirmed");

      expect(optionLabels(statusFilter())).toContain("Draft");
      expect(within(screen.getByRole("table", { name: "Events" })).getAllByRole("row")).toHaveLength(2);
      expect(screen.queryByRole("table", { name: "Draft event requests" })).not.toBeInTheDocument();
    });

    it("with nothing submitted yet, invites them to create their first request", async () => {
      renderPage([event(1, { status: "draft" })]);

      expect(await screen.findByText("No submitted requests yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create your first request" })).toHaveAttribute("href", "/events/new");
    });

    it("has no coordinator filter", async () => {
      renderPage();
      await screen.findByRole("table", { name: "Events" });

      expect(screen.queryByLabelText("Coordinator")).not.toBeInTheDocument();
    });
  });

  describe("for staff", () => {
    it("lists every event under 'All events', with no way to create one", async () => {
      mockApi({ ...signedInAs("coordinator"), "GET /api/events": [event(1), event(2)] });

      render(<EventsPage />);

      expect(await screen.findByRole("heading", { name: "All events" })).toBeInTheDocument();
      expect(await rowTexts()).toHaveLength(2);
      expect(screen.queryByRole("link", { name: "New event request" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Submitted" })).not.toBeInTheDocument();
    });

    it("does not offer Draft as a filter - staff never receive drafts", async () => {
      mockApi({ ...signedInAs("coordinator"), "GET /api/events": [] });

      render(<EventsPage />);

      await screen.findByText("No events yet");
      expect(optionLabels(statusFilter())).not.toContain("Draft");
      expect(screen.queryByRole("link", { name: "Create your first request" })).not.toBeInTheDocument();
    });

    it("lets the Ops Manager filter to events with no coordinator, or with one", async () => {
      mockApi({
        ...signedInAs("ops_manager"),
        "GET /api/events": [
          event(1, { title: "Unassigned", status: "submitted" }),
          event(2, { title: "Assigned", coordinatorId: "c1" }),
        ],
      });
      render(<EventsPage />);
      await table();

      await userEvent.selectOptions(screen.getByLabelText("Coordinator"), "Not yet assigned");
      const unassigned = await rowTexts();
      await userEvent.selectOptions(screen.getByLabelText("Coordinator"), "Assigned");
      const assigned = await rowTexts();

      expect(unassigned).toHaveLength(1);
      expect(unassigned[0]).toContain("Unassigned");
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toContain("Assigned");
    });

    it("does not give a coordinator the coordinator filter", async () => {
      mockApi({ ...signedInAs("coordinator"), "GET /api/events": [event(1)] });

      render(<EventsPage />);

      await table();
      expect(screen.queryByLabelText("Coordinator")).not.toBeInTheDocument();
    });
  });

  it("sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": reply(401, {}) });

    render(<EventsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents"));
  });

  it("shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("coordinator"), "GET /api/events": reply(500, {}) });
    render(<EventsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load events.");

    api.on("GET /api/events", [event(1)]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(1);
  });
});

describe("Review Queue", () => {
  const queued = (overrides: Record<string, unknown> = {}) => ({
    id: "e7",
    sequenceNumber: 7,
    title: "Gala Dinner",
    status: "under_review",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    submittedAt: new Date().toISOString(),
    organisation: { name: "Meridian" },
    ...overrides,
  });

  it.each(ROLES.filter((r) => r !== "coordinator"))("refuses %s without requesting the queue", async (role) => {
    const api = mockApi(signedInAs(role));

    render(<QueuePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reviewing event requests is the Event Coordinator's role.");
    expect(api.sent("GET /api/queue")).toHaveLength(0);
  });

  it("lists each request with a link to its review page", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [queued()] });

    render(<QueuePage />);
    const link = within(await table()).getByRole("link", { name: "Gala Dinner" });

    expect(link).toHaveAttribute("href", "/events/EVT-000007/review");
    expect((await rowTexts())[0]).toContain("Meridian");
    expect((await rowTexts())[0]).toContain("Under review");
  });

  it.each([
    ["submitted just now", 0, "Today"],
    ["submitted yesterday", 1, "1 day"],
    ["submitted four days ago", 4, "4 days"],
  ])("shows how long a request %s has waited", async (_case, daysAgo, label) => {
    const submittedAt = new Date(Date.now() - daysAgo * DAY - 60_000 * Math.sign(daysAgo)).toISOString();
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [queued({ submittedAt })] });

    render(<QueuePage />);

    const cells = within(await table()).getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveTextContent(label);
  });

  it("copes with a request that has no title, client or submission time", async () => {
    mockApi({
      ...signedInAs("coordinator"),
      "GET /api/queue": [queued({ title: null, organisation: null, submittedAt: null })],
    });

    render(<QueuePage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("Untitled event");
    expect(cells[1]).toHaveTextContent("—");
    expect(cells[4]).toHaveTextContent("—");
  });

  it("says so when there is nothing to review", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [] });

    render(<QueuePage />);

    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": reply(401, {}) });

    render(<QueuePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fqueue"));
  });

  it("shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("coordinator"), "GET /api/queue": reply(500, {}) });
    render(<QueuePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the review queue.");

    api.on("GET /api/queue", [queued()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(1);
  });
});

describe("Booking Requests", () => {
  // 13:00-18:00 Singapore time on 4 March 2027: the PM slot.
  const request = (overrides: Record<string, unknown> = {}) => ({
    id: "b1",
    status: "pending",
    startsAt: "2027-03-04T05:00:00.000Z",
    endsAt: "2027-03-04T10:00:00.000Z",
    layoutName: "u_shape",
    requirementsNote: "Stage at the north end",
    requester: { fullName: "Daniel Tan" },
    event: { reference: "EVT-000007", title: "Town Hall" },
    session: null,
    venue: { code: "HALL-A", name: "Hall A", setupMinutes: 0, teardownMinutes: 0 },
    ...overrides,
  });

  it.each(ROLES.filter((r) => r !== "venue_staff"))("refuses %s without requesting the list", async (role) => {
    const api = mockApi(signedInAs(role));

    render(<BookingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reviewing venue bookings is Venue Staff's role.");
    expect(api.sent("GET /api/venue-bookings")).toHaveLength(0);
  });

  it("shows the event, venue, slots, requirements, requester and status of each request", async () => {
    mockApi({ ...signedInAs("venue_staff"), "GET /api/venue-bookings": [request()] });

    render(<BookingsPage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(within(cells[0]).getByRole("link", { name: "EVT-000007" })).toHaveAttribute("href", "/events/EVT-000007");
    expect(cells[0]).toHaveTextContent("Town Hall");
    expect(cells[1]).toHaveTextContent("Hall A");
    expect(cells[1]).toHaveTextContent("PM (13:00–18:00)");
    expect(cells[2]).toHaveTextContent("Layout: U shape");
    expect(cells[2]).toHaveTextContent("Stage at the north end");
    expect(cells[3]).toHaveTextContent("Daniel Tan");
    expect(cells[4]).toHaveTextContent("Pending");
  });

  it("shows no setup or turnaround line for a venue that needs neither", async () => {
    mockApi({ ...signedInAs("venue_staff"), "GET /api/venue-bookings": [request()] });

    render(<BookingsPage />);

    expect(within(await table()).queryByText(/Setup:|Turnaround:/)).not.toBeInTheDocument();
  });

  it("shows the slots a venue's setup and turnaround take either side", async () => {
    mockApi({
      ...signedInAs("venue_staff"),
      "GET /api/venue-bookings": [
        request({ venue: { code: "HALL-A", name: "Hall A", setupMinutes: 60, teardownMinutes: 30 } }),
      ],
    });

    render(<BookingsPage />);
    const venueCell = within(await table()).getAllByRole("cell")[1];

    expect(venueCell).toHaveTextContent("Setup: 4 Mar 2027 AM (07:00–12:00)");
    expect(venueCell).toHaveTextContent("Turnaround: 4 Mar 2027 Night (19:00–24:00)");
  });

  it("names the session, and fills the gaps of a sparse request", async () => {
    mockApi({
      ...signedInAs("venue_staff"),
      "GET /api/venue-bookings": [
        request({
          layoutName: null,
          requirementsNote: null,
          event: { reference: "EVT-000008", title: null },
          session: { label: "Day 1" },
        }),
        request({ id: "b2", session: { label: null } }),
      ],
    });

    render(<BookingsPage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("Untitled event");
    expect(cells[0]).toHaveTextContent("Session: Day 1");
    expect(cells[2]).toHaveTextContent("Layout: Not set");
    expect(cells[2]).toHaveTextContent("None given");
    expect(cells[5]).toHaveTextContent("Session: Session");
  });

  it("says so when no requests are pending", async () => {
    mockApi({ ...signedInAs("venue_staff"), "GET /api/venue-bookings": [] });

    render(<BookingsPage />);

    expect(await screen.findByText("No pending booking requests")).toBeInTheDocument();
  });

  it("sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("venue_staff"), "GET /api/venue-bookings": reply(401, {}) });

    render(<BookingsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fbookings"));
  });

  it("shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("venue_staff"), "GET /api/venue-bookings": reply(500, {}) });
    render(<BookingsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load booking requests.");

    api.on("GET /api/venue-bookings", [request()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(1);
  });
});

describe("Equipment requests queue", () => {
  const ROUTE = "GET /api/equipment/requests";
  const row = (overrides: Record<string, unknown> = {}) => ({
    sequenceNumber: 12,
    title: "Gala Dinner",
    status: "planning",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    requestCount: 3,
    ...overrides,
  });

  it("sends an anonymous visitor to log in", async () => {
    mockApi(signedOut());

    render(<EquipmentRequestsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests"));
  });

  it("lists each event with its number of equipment lines", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [row()] });

    render(<EquipmentRequestsPage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("Gala Dinner EVT-000012");
    expect(cells[2]).toHaveTextContent("3");
    expect(cells[3]).toHaveTextContent("Planning");
    expect(screen.queryByText("This queue is for Technical Support Staff.")).not.toBeInTheDocument();
  });

  it("opens an event's equipment request when its row is clicked", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [row()] });
    render(<EquipmentRequestsPage />);

    await userEvent.click(within(await table()).getByText("Gala Dinner"));

    expect(router.push).toHaveBeenCalledWith("/equipment/requests/EVT-000012");
  });

  it("shows a dash for an event with no title", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [row({ title: null })] });

    render(<EquipmentRequestsPage />);

    expect(within(await table()).getAllByRole("cell")[0]).toHaveTextContent("— EVT-000012");
  });

  it("tells any other role the queue is not theirs, and explains the refusal", async () => {
    mockApi({ ...signedInAs("coordinator"), [ROUTE]: reply(403, { error: "forbidden" }) });

    render(<EquipmentRequestsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only Technical Support Staff can view equipment requests."
    );
    expect(screen.getByText("This queue is for Technical Support Staff.")).toBeInTheDocument();
  });

  it("says so when no equipment has been requested", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [] });

    render(<EquipmentRequestsPage />);

    expect(await screen.findByText("No equipment requests yet")).toBeInTheDocument();
  });

  it("sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: reply(401, {}) });

    render(<EquipmentRequestsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests"));
  });

  it("shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("tech_support"), [ROUTE]: reply(500, {}) });
    render(<EquipmentRequestsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load equipment requests.");

    api.on(ROUTE, [row()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(1);
  });
});

describe("Assignments", () => {
  const ROUTE = "GET /api/assignments";
  const daniel = { id: "c1", fullName: "Daniel Tan" };
  const priya = { id: "c2", fullName: "Priya Raj" };

  const item = (sequenceNumber: number, overrides: Record<string, unknown> = {}) => ({
    id: `e${sequenceNumber}`,
    sequenceNumber,
    title: `Event ${sequenceNumber}`,
    status: "submitted",
    startsAt: "2027-03-04T01:00:00.000Z",
    endsAt: "2027-03-04T09:00:00.000Z",
    submittedAt: new Date(Date.now() - 2 * DAY - 60_000).toISOString(),
    organisation: { name: "Meridian" },
    coordinator: null,
    ...overrides,
  });

  const data = (overrides: Record<string, unknown> = {}) => ({
    awaiting: [item(1, { title: "Gala Dinner" }), item(2)],
    assigned: [item(3, { title: "Summit", status: "planning", coordinator: daniel })],
    coordinators: [daniel, priya],
    ...overrides,
  });

  it.each(ROLES.filter((r) => r !== "ops_manager"))("refuses %s without requesting the list", async (role) => {
    const api = mockApi(signedInAs(role));

    render(<AssignmentsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Assigning coordinators is the Event Operations Manager's role."
    );
    expect(api.sent(ROUTE)).toHaveLength(0);
  });

  describe("awaiting assignment", () => {
    it("lists the unassigned events with how long each has waited, and counts them on the tab", async () => {
      setRoute("/assignments");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data() });

      render(<AssignmentsPage />);
      const rows = await rowTexts();

      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("Gala Dinner");
      expect(rows[0]).toContain("EVT-000001");
      expect(rows[0]).toContain("Meridian");
      expect(rows[0]).toContain("2 days");
      expect(screen.getByRole("link", { name: /Awaiting assignment/ })).toHaveTextContent("2");
      expect(screen.getByRole("link", { name: /Awaiting assignment/ })).toHaveAttribute("aria-current", "page");
    });

    it("links each event to its detail page", async () => {
      setRoute("/assignments");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data() });

      render(<AssignmentsPage />);

      expect(within(await table()).getByRole("link", { name: "Gala Dinner" })).toHaveAttribute(
        "href",
        "/events/EVT-000001"
      );
    });

    it("assigning a coordinator confirms it and reloads the list", async () => {
      setRoute("/assignments");
      const api = mockApi({
        ...signedInAs("ops_manager"),
        [ROUTE]: data(),
        "PUT /api/events/EVT-000001/coordinator": { status: "under_review", coordinator: daniel, previousCoordinator: null },
      });
      render(<AssignmentsPage />);
      const picker = within(await table()).getByRole("combobox", { name: "Assign to — Gala Dinner" });

      await userEvent.selectOptions(picker, "Daniel Tan");
      await userEvent.click(within(picker.closest("td")!).getByRole("button", { name: "Assign" }));

      expect(await screen.findByText(/Daniel Tan is now the coordinator for "Gala Dinner"/)).toHaveTextContent(
        "It has moved to Under review."
      );
      await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(2));
    });

    it("says so when every submitted event has a coordinator", async () => {
      setRoute("/assignments");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ awaiting: [] }) });

      render(<AssignmentsPage />);

      expect(await screen.findByText("No events are awaiting assignment")).toBeInTheDocument();
    });

    it("copes with an event that has no title, client or submission time", async () => {
      setRoute("/assignments");
      mockApi({
        ...signedInAs("ops_manager"),
        [ROUTE]: data({ awaiting: [item(1, { title: null, organisation: null, submittedAt: null })] }),
      });

      render(<AssignmentsPage />);
      const cells = within(await table()).getAllByRole("cell");

      expect(cells[0]).toHaveTextContent("Untitled event");
      expect(cells[1]).toHaveTextContent("—");
      expect(cells[3]).toHaveTextContent("—");
      expect(within(cells[4]).getByRole("combobox", { name: "Assign to — Untitled event" })).toBeInTheDocument();
    });

    it.each([
      [0, "Today"],
      [1, "1 day"],
    ])("shows a request submitted %i day(s) ago as waiting %j", async (daysAgo, label) => {
      setRoute("/assignments");
      const submittedAt = new Date(Date.now() - daysAgo * DAY - 60_000 * Math.sign(daysAgo)).toISOString();
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ awaiting: [item(1, { submittedAt })] }) });

      render(<AssignmentsPage />);

      expect(within(await table()).getAllByRole("cell")[3]).toHaveTextContent(label);
    });
  });

  describe("assigned", () => {
    it("lists events that have a coordinator, with their status and who it is", async () => {
      setRoute("/assignments?view=assigned");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data() });

      render(<AssignmentsPage />);
      const rows = await rowTexts();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("Summit");
      expect(rows[0]).toContain("Planning");
      expect(rows[0]).toContain("Daniel Tan");
      expect(screen.getByRole("link", { name: "Assigned" })).toHaveAttribute("aria-current", "page");
    });

    it("reassigning confirms who it moved from and to", async () => {
      setRoute("/assignments?view=assigned");
      mockApi({
        ...signedInAs("ops_manager"),
        [ROUTE]: data(),
        "PUT /api/events/EVT-000003/coordinator": { status: "planning", coordinator: priya, previousCoordinator: daniel },
      });
      render(<AssignmentsPage />);
      const picker = within(await table()).getByRole("combobox", { name: "Reassign to — Summit" });

      await userEvent.selectOptions(picker, "Priya Raj");
      await userEvent.click(within(picker.closest("td")!).getByRole("button", { name: "Reassign" }));
      const dialog = within(picker.closest("td")!).getByRole("dialog", { hidden: true });
      await userEvent.click(within(dialog).getByRole("button", { name: "Reassign", hidden: true }));

      expect(await screen.findByText('"Summit" has been reassigned from Daniel Tan to Priya Raj.')).toBeInTheDocument();
    });

    it("says so when no event has a coordinator yet", async () => {
      setRoute("/assignments?view=assigned");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ assigned: [] }) });

      render(<AssignmentsPage />);

      expect(await screen.findByText("No assigned events")).toBeInTheDocument();
    });
  });

  it("sends the user to log in when their session has expired", async () => {
    setRoute("/assignments");
    mockApi({ ...signedInAs("ops_manager"), [ROUTE]: reply(401, {}) });

    render(<AssignmentsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fassignments"));
  });

  it("shows a load failure with a Retry that loads again", async () => {
    setRoute("/assignments");
    const api = mockApi({ ...signedInAs("ops_manager"), [ROUTE]: reply(500, {}) });
    render(<AssignmentsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load assignments.");

    api.on(ROUTE, data());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(2);
  });
});
