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
import { formatDateTime } from "@/lib/format";
import { toLocalInput } from "@/lib/holdExpiry";
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
    updatedAt: "2027-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Dashboard", () => {
  const listed = () => screen.getAllByRole("listitem").filter((li) => li.querySelector("a[href^='/events/']"));
  const listedTitles = () => listed().map((li) => li.querySelector("span")!.textContent);
  /// One list on the dashboard: its heading and everything under it.
  const section = (heading: string) => screen.getByRole("heading", { name: heading }).parentElement as HTMLElement;
  const titlesIn = (heading: string) =>
    within(section(heading))
      .queryAllByRole("listitem")
      .map((li) => li.querySelector("span")!.textContent);
  const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  /// `count` events of one status, each updated a minute after the one before.
  const many = (count: number, overrides: Record<string, unknown>) =>
    Array.from({ length: count }, (_, i) =>
      event(i + 1, { updatedAt: `2027-01-01T00:0${i}:00.000Z`, ...overrides })
    );

  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
    mockApi(signedOut());

    render(<DashboardPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fdashboard"));
  });

  it("[SPM-27][AC1] greets an organiser and sorts their requests into one list per stage", async () => {
    mockApi({
      ...signedInAs("organiser", { name: "Rachel Ng" }),
      "GET /api/events": [
        event(1, { title: "My draft", status: "draft" }),
        event(2, { title: "In review", status: "under_review" }),
        event(3, { title: "Just approved", status: "approved" }),
        event(4, { title: "Being planned", status: "planning" }),
        event(5, { title: "Already confirmed", status: "confirmed" }),
      ],
    });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Welcome, Rachel Ng" })).toBeInTheDocument();
    await waitFor(() => expect(listed()).toHaveLength(4));
    expect(headings().slice(0, 4)).toEqual(["Drafts", "Under review", "Approved", "Planning"]);
    expect(titlesIn("Drafts")).toEqual(["My draft"]);
    expect(titlesIn("Under review")).toEqual(["In review"]);
    expect(titlesIn("Approved")).toEqual(["Just approved"]);
    expect(titlesIn("Planning")).toEqual(["Being planned"]);
    expect(screen.getByRole("link", { name: "New event request" })).toHaveAttribute("href", "/events/new");
    expect(screen.queryByText("Internal view")).not.toBeInTheDocument();
  });

  it("[SPM-27] says what each of an organiser's lists is waiting for when it is empty", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": [] });

    render(<DashboardPage />);

    expect(await screen.findByText("No drafts")).toBeInTheDocument();
    expect(section("Under review")).toHaveTextContent("Nothing under review");
    expect(section("Approved")).toHaveTextContent("Nothing waiting to be planned");
    expect(section("Planning")).toHaveTextContent("Nothing in planning");
    expect(section("Planning")).toHaveTextContent("Events appear here once your coordinator begins planning.");
  });

  it("[SPM-24][AC4] [SPM-31][AC1] opens a draft in the editor and anything else on its detail page", async () => {
    mockApi({
      ...signedInAs("organiser"),
      "GET /api/events": [event(1, { status: "draft" }), event(2, { status: "under_review" })],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(listed()).toHaveLength(2));
    const hrefs = listed().map((li) => li.querySelector("a")!.getAttribute("href"));
    expect(hrefs).toEqual(["/events/EVT-000001/edit", "/events/EVT-000002"]);
  });

  it("[SPM-27] labels an event with no title as untitled", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": [event(1, { status: "draft", title: null })] });

    render(<DashboardPage />);

    expect(await screen.findByText("Untitled event")).toBeInTheDocument();
  });

  describe("as an overview", () => {
    it("[SPM-27] shows only the five most recently changed events of a long list, newest first", async () => {
      mockApi({ ...signedInAs("organiser"), "GET /api/events": many(7, { status: "draft" }) });

      render(<DashboardPage />);

      await waitFor(() => expect(listed()).toHaveLength(5));
      expect(titlesIn("Drafts")).toEqual(["Event 7", "Event 6", "Event 5", "Event 4", "Event 3"]);
      expect(section("Drafts")).toHaveTextContent("Showing the 5 most recently updated of 7.");
      expect(within(section("Drafts")).getByRole("link", { name: "View all in My Events" })).toHaveAttribute(
        "href",
        "/events"
      );
    });

    it("[SPM-27] says nothing about a list that is shown in full", async () => {
      mockApi({ ...signedInAs("organiser"), "GET /api/events": many(5, { status: "draft" }) });

      render(<DashboardPage />);

      await waitFor(() => expect(listed()).toHaveLength(5));
      expect(screen.queryByText(/Showing the/)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /View all/ })).not.toBeInTheDocument();
    });

    it("[SPM-27] counts each list on its own", async () => {
      mockApi({
        ...signedInAs("organiser"),
        "GET /api/events": [...many(6, { status: "planning" }), event(9, { title: "Lone draft", status: "draft" })],
      });

      render(<DashboardPage />);

      await waitFor(() => expect(listed()).toHaveLength(6));
      expect(section("Planning")).toHaveTextContent("Showing the 5 most recently updated of 6.");
      expect(section("Drafts")).not.toHaveTextContent("Showing the");
    });

    it("[SPM-28][AC1] sends a coordinator to the Review Queue for the rest of their reviews, and to All Events otherwise", async () => {
      const me = viewer("coordinator");
      mockApi({
        ...signedInAs("coordinator"),
        "GET /api/events": [
          ...many(6, { status: "under_review", coordinatorId: me.id }),
          ...many(6, { status: "planning", coordinatorId: me.id }),
        ],
      });

      render(<DashboardPage />);

      await waitFor(() => expect(listed()).toHaveLength(10));
      expect(
        within(section("Awaiting your review")).getByRole("link", { name: "View all in Review Queue" })
      ).toHaveAttribute("href", "/queue");
      expect(within(section("Planning")).getByRole("link", { name: "View all in All Events" })).toHaveAttribute(
        "href",
        "/events"
      );
    });

    it("[SPM-27] does not cut short the single list of a role that has no overview", async () => {
      mockApi({ ...signedInAs("ops_manager"), "GET /api/events": many(7, { status: "submitted" }) });

      render(<DashboardPage />);

      await waitFor(() => expect(listed()).toHaveLength(7));
      expect(listedTitles()[0]).toBe("Event 1");
      expect(screen.queryByText(/Showing the/)).not.toBeInTheDocument();
    });

    it("[SPM-27] offers no 'View all' to a role with no events list to go to", async () => {
      mockApi({ ...signedInAs("intern"), "GET /api/events": many(6, { status: "draft" }) });

      render(<DashboardPage />);

      expect(await screen.findByText(/Showing the 5 most recently updated of 6\./)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /View all/ })).not.toBeInTheDocument();
    });
  });

  it("[SPM-30][AC4] shows a coordinator only their own events, by the stage each has reached", async () => {
    const me = viewer("coordinator");
    mockApi({
      ...signedInAs("coordinator"),
      "GET /api/events": [
        event(1, { title: "Mine, to review", status: "under_review", coordinatorId: me.id }),
        event(2, { title: "Mine, approved", status: "approved", coordinatorId: me.id }),
        event(3, { title: "Mine, in planning", coordinatorId: me.id }),
        event(4, { title: "A colleague's", coordinatorId: "someone-else" }),
        event(5, { title: "Nobody's yet", status: "submitted" }),
        event(6, { title: "Mine, confirmed", status: "confirmed", coordinatorId: me.id }),
      ],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(headings().slice(0, 3)).toEqual(["Awaiting your review", "Approved", "Planning"]);
    expect(titlesIn("Awaiting your review")).toEqual(["Mine, to review"]);
    expect(titlesIn("Approved")).toEqual(["Mine, approved"]);
    expect(titlesIn("Planning")).toEqual(["Mine, in planning"]);
    expect(screen.getByText("Internal view")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New event request" })).not.toBeInTheDocument();
  });

  it("[SPM-30] tells a coordinator with nothing on their plate what each list is for", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/events": [] });

    render(<DashboardPage />);

    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(section("Approved")).toHaveTextContent("Events appear here once you approve them.");
    expect(section("Planning")).toHaveTextContent("Events appear here once you begin planning them.");
  });

  it("[SPM-30][AC2] shows the Ops Manager submitted events that have no coordinator", async () => {
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

  // SPM-85: the Safety Officer's work is the events in Safety review.
  it("[SPM-87][AC1] shows the Safety Officer the events awaiting their safety check, with a way to the full list", async () => {
    mockApi({
      ...signedInAs("safety_officer"),
      "GET /api/events": [
        event(1, { title: "Submitted for its check", status: "safety_review", coordinatorId: "c1" }),
        event(2, { title: "Still being planned", status: "planning", coordinatorId: "c1" }),
        event(3, { title: "Already confirmed", status: "confirmed", coordinatorId: "c1" }),
      ],
    });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Awaiting your safety check" })).toBeInTheDocument();
    await waitFor(() => expect(listedTitles()).toEqual(["Submitted for its check"]));
    expect(screen.getByText("Events submitted for an Operational Safety Check.")).toBeInTheDocument();
  });

  it("[SPM-87][AC1] tells the Safety Officer when nothing is waiting for a safety check", async () => {
    mockApi({ ...signedInAs("safety_officer"), "GET /api/events": [event(1, { status: "planning" })] });

    render(<DashboardPage />);

    expect(await screen.findByText("Nothing to check")).toBeInTheDocument();
    expect(screen.getByText("Events appear here once a coordinator submits them for a safety check.")).toBeInTheDocument();
  });

  it.each([
    ["venue_staff", "Upcoming events"],
    ["tech_support", "Upcoming events"],
    ["attendee", "Open for registration"],
  ])("[SPM-22][AC1] gives %s the heading %j", async (role, heading) => {
    mockApi({ ...signedInAs(role), "GET /api/events": [event(1, { status: "confirmed" })] });

    render(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    await waitFor(() => expect(listedTitles()).toEqual(["Event 1"]));
  });

  it("[SPM-22][AC5] does not tell an attendee they are seeing an internal view", async () => {
    mockApi({ ...signedInAs("attendee"), "GET /api/events": [] });

    render(<DashboardPage />);

    await screen.findByText("Nothing needs your attention");
    expect(screen.queryByText("Internal view")).not.toBeInTheDocument();
  });

  it.each(ROLES)("[SPM-22][AC1] links %s to the rest of their navigation, without Dashboard itself", async (role) => {
    mockApi({ ...signedInAs(role), "GET /api/events": [] });

    render(<DashboardPage />);

    const goTo = screen.getByRole("heading", { name: "Go to" }).closest("div.rounded-lg") as HTMLElement;
    const links = () => within(goTo).queryAllByRole("link").map((a) => a.textContent);
    await waitFor(() => expect(links()).toContain("Notifications"));
    expect(links()).not.toContain("Dashboard");
  });

  it("[SPM-22] falls back to the organiser's view for a role it does not recognise", async () => {
    mockApi({ ...signedInAs("intern"), "GET /api/events": [event(1, { status: "draft" })] });

    render(<DashboardPage />);

    await waitFor(() => expect(listed()).toHaveLength(1));
    expect(headings().slice(0, 4)).toEqual(["Drafts", "Under review", "Approved", "Planning"]);
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired mid-visit", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": reply(401, { error: "Not authenticated" }) });

    render(<DashboardPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fdashboard"));
  });

  it("[SPM-27] shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("ops_manager"), "GET /api/events": reply(500, {}) });
    render(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your events.");

    api.on("GET /api/events", [event(1, { status: "submitted", title: "Recovered" })]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[SPM-27] recovers every one of an organiser's lists from a load failure", async () => {
    const api = mockApi({ ...signedInAs("organiser"), "GET /api/events": reply(500, {}) });
    render(<DashboardPage />);
    // One error per list on the organiser's dashboard - all six of them.
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(6));
    for (const alert of screen.getAllByRole("alert")) expect(alert).toHaveTextContent("Could not load your events.");

    api.on("GET /api/events", [event(1, { status: "planning", title: "Recovered" })]);
    await userEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]);

    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(section("Drafts")).toHaveTextContent("No drafts");
  });
});

describe("Events page", () => {
  const statusFilter = () => screen.getByLabelText("Filter by status");
  const optionLabels = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
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

    it("[SPM-24][AC2][AC5] keeps drafts in their own section, with a count, apart from submitted requests", async () => {
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

    it("[SPM-59][AC3][AC5] lists a withdrawn request with its own badge, apart from draft, submitted, approved and rejected ones", async () => {
      renderPage([
        event(1, { title: "Unsent idea", status: "draft" }),
        event(2, { title: "Fresh request", status: "submitted" }),
        event(3, { title: "Go-ahead", status: "approved" }),
        event(4, { title: "Turned down", status: "rejected" }),
        event(5, { title: "Called back", status: "withdrawn" }),
      ]);

      const submitted = await screen.findByRole("table", { name: "Events" });
      const badgeOf = (title: string) => within(submitted).getByText(title).closest("tr") as HTMLElement;
      expect(badgeOf("Fresh request")).toHaveTextContent("Submitted");
      expect(badgeOf("Go-ahead")).toHaveTextContent("Approved");
      expect(badgeOf("Turned down")).toHaveTextContent("Rejected");
      expect(badgeOf("Called back")).toHaveTextContent("Withdrawn");
      expect(within(screen.getByRole("table", { name: "Draft event requests" })).getByText("Unsent idea")).toBeInTheDocument();

      fireEvent.change(statusFilter(), { target: { value: "withdrawn" } });

      const filtered = await screen.findByRole("table", { name: "Events" });
      expect(within(filtered).getByText("Called back")).toBeInTheDocument();
      for (const title of ["Fresh request", "Go-ahead", "Turned down"]) {
        expect(within(filtered).queryByText(title)).not.toBeInTheDocument();
      }
    });

    it("[SPM-27][AC1] shows each event's reference, attendance and status", async () => {
      renderPage([event(3, { title: "Gala Dinner", status: "under_review", expectedAttendance: 250 })]);

      const row = within(await screen.findByRole("table", { name: "Events" })).getAllByRole("row")[1];

      expect(row).toHaveTextContent("EVT-000003");
      expect(row).toHaveTextContent("Gala Dinner");
      expect(row).toHaveTextContent("250");
      expect(row).toHaveTextContent("Under review");
    });

    it("[SPM-24][AC4] opens a draft in the editor", async () => {
      renderPage();
      const drafts = await screen.findByRole("table", { name: "Draft event requests" });

      await userEvent.click(within(drafts).getByText("Unsent idea"));

      expect(router.push).toHaveBeenCalledWith("/events/EVT-000001/edit");
    });

    it("[SPM-31][AC1] opens a submitted request on its detail page", async () => {
      renderPage();
      const submitted = await screen.findByRole("table", { name: "Events" });

      await userEvent.click(within(submitted).getByText("Summit"));

      expect(router.push).toHaveBeenCalledWith("/events/EVT-000004");
    });

    it("[SPM-27][AC1] can filter by status, including Draft", async () => {
      renderPage();
      await screen.findByRole("table", { name: "Events" });

      await userEvent.selectOptions(statusFilter(), "Confirmed");

      expect(optionLabels(statusFilter())).toContain("Draft");
      expect(within(screen.getByRole("table", { name: "Events" })).getAllByRole("row")).toHaveLength(2);
      expect(screen.queryByRole("table", { name: "Draft event requests" })).not.toBeInTheDocument();
    });

    it("[SPM-27] with nothing submitted yet, invites them to create their first request", async () => {
      renderPage([event(1, { status: "draft" })]);

      expect(await screen.findByText("No submitted requests yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create your first request" })).toHaveAttribute("href", "/events/new");
    });

    it("[SPM-22][AC3] has no coordinator filter", async () => {
      renderPage();
      await screen.findByRole("table", { name: "Events" });

      expect(screen.queryByLabelText("Coordinator")).not.toBeInTheDocument();
    });
  });

  describe("for staff", () => {
    it("[SPM-22][AC6][AC3] lists every event under 'All events', with no way to create one", async () => {
      mockApi({ ...signedInAs("coordinator"), "GET /api/events": [event(1), event(2)] });

      render(<EventsPage />);

      expect(await screen.findByRole("heading", { name: "All events" })).toBeInTheDocument();
      expect(await rowTexts()).toHaveLength(2);
      expect(screen.queryByRole("link", { name: "New event request" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Submitted" })).not.toBeInTheDocument();
    });

    it("[SPM-24][AC5] does not offer Draft as a filter - staff never receive drafts", async () => {
      mockApi({ ...signedInAs("coordinator"), "GET /api/events": [] });

      render(<EventsPage />);

      await screen.findByText("No events yet");
      expect(optionLabels(statusFilter())).not.toContain("Draft");
      expect(screen.queryByRole("link", { name: "Create your first request" })).not.toBeInTheDocument();
    });

    it("[SPM-30][AC2] lets the Ops Manager filter to events with no coordinator, or with one", async () => {
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

    it("[SPM-22][AC3] does not give a coordinator the coordinator filter", async () => {
      mockApi({ ...signedInAs("coordinator"), "GET /api/events": [event(1)] });

      render(<EventsPage />);

      await table();
      expect(screen.queryByLabelText("Coordinator")).not.toBeInTheDocument();
    });
  });

  describe("for an attendee", () => {
    // Their list is Browse Events; the event page /events/<ref> stays theirs.
    it("[SPM-22][AC4] is taken to Browse Events, without the events list being shown or loaded", async () => {
      const api = mockApi({ ...signedInAs("attendee"), "GET /api/events": [event(1, { status: "confirmed" })] });

      render(<EventsPage />);

      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/browse"));
      expect(screen.queryByRole("heading", { name: "All events" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Filter by status")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(api.sent("GET /api/events")).toHaveLength(0);
    });
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": reply(401, {}) });

    render(<EventsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents"));
  });

  it("[SPM-27] shows a load failure with a Retry that loads again", async () => {
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

  it.each(ROLES.filter((r) => r !== "coordinator"))("[SPM-28][AC1] refuses %s without requesting the queue", async (role) => {
    const api = mockApi(signedInAs(role));

    render(<QueuePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reviewing event requests is the Event Coordinator's role.");
    expect(api.sent("GET /api/queue")).toHaveLength(0);
  });

  it("[SPM-28][AC1] lists each request with a link to its review page", async () => {
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
  ])("[SPM-28][AC1] shows how long a request %s has waited", async (_case, daysAgo, label) => {
    const submittedAt = new Date(Date.now() - daysAgo * DAY - 60_000 * Math.sign(daysAgo)).toISOString();
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [queued({ submittedAt })] });

    render(<QueuePage />);

    const cells = within(await table()).getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveTextContent(label);
  });

  it("[SPM-28][AC1] copes with a request that has no title, client or submission time", async () => {
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

  it("[SPM-28][AC1] says so when there is nothing to review", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [] });

    render(<QueuePage />);

    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("[SPM-84][AC1] SPM-84-TC06: says the Event Coordinator Lead assigns the requests", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": [] });

    render(<QueuePage />);

    expect(await screen.findByText("Requests appear here once the Event Coordinator Lead assigns them to you.")).toBeInTheDocument();
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/queue": reply(401, {}) });

    render(<QueuePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fqueue"));
  });

  it("[SPM-43] shows a load failure with a Retry that loads again", async () => {
    const api = mockApi({ ...signedInAs("coordinator"), "GET /api/queue": reply(500, {}) });
    render(<QueuePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the review queue.");

    api.on("GET /api/queue", [queued()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(1);
  });
});

describe("Booking Requests", () => {
  const LIST = "GET /api/venue-bookings";
  const VENUES = "GET /api/venues";
  const DECIDE = "PATCH /api/venue-bookings/b1";

  // 13:00-18:00 Singapore time on 4 March 2027.
  const request = (overrides: Record<string, unknown> = {}) => ({
    id: "b1",
    status: "pending",
    startsAt: "2027-03-04T05:00:00.000Z",
    endsAt: "2027-03-04T10:00:00.000Z",
    layoutName: "u_shape",
    requirementsNote: "Stage at the north end",
    requester: { fullName: "Daniel Tan" },
    event: {
      reference: "EVT-000007",
      title: "Town Hall",
      status: "planning",
      startsAt: "2027-03-04T06:00:00.000Z",
      endsAt: "2027-03-04T09:00:00.000Z",
      expectedAttendance: 120,
      organisation: "Acme Pte Ltd",
    },
    session: null,
    venue: { id: "v1", code: "HALL-A", name: "Hall A", setupMinutes: 0, teardownMinutes: 0 },
    conflict: null,
    ...overrides,
  });
  const venueList = [
    { id: "v3", code: "ROOM-C", name: "Room C" },
    { id: "v1", code: "HALL-A", name: "Hall A" },
    { id: "v2", code: "HALL-B", name: "Hall B" },
  ];

  function open(routes: Record<string, unknown> = {}) {
    const api = mockApi({ ...signedInAs("venue_staff"), [LIST]: [request()], [VENUES]: venueList, ...routes });
    render(<BookingsPage />);
    return api;
  }

  /// The card for one request, found by its venue heading.
  const card = async (venue = "Hall A (HALL-A)") =>
    (await screen.findByRole("heading", { name: venue })).closest("div.rounded-lg") as HTMLElement;
  const valueOf = (within_: HTMLElement, label: string) =>
    within(within_).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
  const dialog = () => screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
  const approve = async () => userEvent.click(within(await card()).getByRole("button", { name: "Approve" }));
  const confirmApproval = () =>
    userEvent.click(within(dialog()).getByRole("button", { name: "Approve", hidden: true }));
  const startRejecting = async (venue?: string) =>
    userEvent.click(within(await card(venue)).getByRole("button", { name: "Reject with a reason" }));
  const reason = () => screen.getByLabelText(/Reason for rejection/);
  const giveReason = (text: string) => fireEvent.change(reason(), { target: { value: text } });
  const submitRejection = () => userEvent.click(screen.getByRole("button", { name: "Reject request" }));

  // SPM-82: each pending request is a tentative hold. Venue Staff see when it
  // expires (AC1) and can move that while it is active (AC3).
  describe("the hold's expiry (SPM-82)", () => {
    const EXPIRY = "PATCH /api/venue-bookings/b1/expiry";
    const holding = () => request({ holdExpiresAt: "2027-01-15T01:00:00.000Z" });
    const openExpiry = async () => userEvent.click(within(await card()).getByRole("button", { name: "Change expiry" }));
    const newExpiry = () => screen.getByLabelText("New expiry");
    // A datetime-local value is the browser's own wall clock: derive what is
    // sent and shown from it, so the test reads the same in UTC and in SGT.
    const LOCAL = "2027-01-20T09:00";

    it("[SPM-82][AC1] SPM-82-TC03: shows when the hold expires", async () => {
      open({ [LIST]: [holding()] });

      expect(valueOf(await card(), "Hold expires")).toHaveTextContent("15 Jan 2027, 09:00");
    });

    it("[SPM-82][AC3] says a hold made before expiries were recorded has none, and still offers to set one", async () => {
      open({ [LIST]: [request({ holdExpiresAt: null })] });

      expect(valueOf(await card(), "Hold expires")).toHaveTextContent("No expiry set");

      await openExpiry();

      expect(newExpiry()).toHaveValue("");
    });

    it("[SPM-82][AC3] SPM-82-TC05: saves a new expiry, says so, and shows it on the card", async () => {
      const api = open({ [LIST]: [holding()], [EXPIRY]: { id: "b1", holdExpiresAt: new Date(LOCAL).toISOString() } });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: LOCAL } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      expect(await screen.findByText(`Hold expiry changed to ${formatDateTime(new Date(LOCAL))}.`)).toBeInTheDocument();
      expect(api.sent(EXPIRY).map((c) => c.body)).toEqual([{ holdExpiresAt: new Date(LOCAL).toISOString() }]);
      expect(valueOf(await card(), "Hold expires")).toHaveTextContent(formatDateTime(new Date(LOCAL)));
      expect(screen.queryByLabelText("New expiry")).not.toBeInTheDocument();
    });

    it("[SPM-82][AC3] changes only that request's card", async () => {
      const other = request({
        id: "b2",
        holdExpiresAt: "2027-01-18T01:00:00.000Z",
        venue: { id: "v2", code: "HALL-B", name: "Hall B", setupMinutes: 0, teardownMinutes: 0 },
      });
      open({ [LIST]: [holding(), other], [EXPIRY]: { id: "b1", holdExpiresAt: new Date(LOCAL).toISOString() } });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: LOCAL } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      await screen.findByText(`Hold expiry changed to ${formatDateTime(new Date(LOCAL))}.`);
      expect(valueOf(await card("Hall B (HALL-B)"), "Hold expires")).toHaveTextContent("18 Jan 2027, 09:00");
    });

    it("[SPM-82][AC3] shows the time chosen when the server's answer does not repeat it", async () => {
      open({ [LIST]: [holding()], [EXPIRY]: {} });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: LOCAL } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      expect(await screen.findByText(`Hold expiry changed to ${formatDateTime(new Date(LOCAL))}.`)).toBeInTheDocument();
    });

    it.each([
      ["answers with no readable reason", reply(500)],
      ["cannot be reached", () => { throw new TypeError("Failed to fetch"); }],
    ])("[SPM-82][AC3] keeps the form open with a general message when the server %s", async (_, answer) => {
      open({ [LIST]: [holding()], [EXPIRY]: answer });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: LOCAL } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      expect(await screen.findByText("Could not change the expiry. Try again.")).toBeInTheDocument();
      expect(newExpiry()).toBeInTheDocument();
      expect(valueOf(await card(), "Hold expires")).toHaveTextContent("15 Jan 2027, 09:00");
    });

    it("[SPM-82][AC3] starts the form on the current expiry", async () => {
      open({ [LIST]: [holding()] });

      await openExpiry();

      expect(newExpiry()).toHaveValue(toLocalInput(new Date("2027-01-15T01:00:00.000Z")));
    });

    it("[SPM-82][AC2][AC3] SPM-82-TC04: keeps the form open with the server's reason when the expiry is refused", async () => {
      const message = "The expiry cannot be later than the start of the event (8 Feb 2027, 09:00).";
      open({ [LIST]: [holding()], [EXPIRY]: reply(400, { error: message }) });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: "2027-02-09T09:00" } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(newExpiry()).toBeInTheDocument();
      expect(valueOf(await card(), "Hold expires")).toHaveTextContent("15 Jan 2027, 09:00");
    });

    it("[SPM-82][AC3] asks for a date and time before sending anything", async () => {
      const api = open({ [LIST]: [holding()] });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: "" } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      expect(await screen.findByText("Choose the date and time the hold should expire.")).toBeInTheDocument();
      expect(api.sent(EXPIRY)).toHaveLength(0);
    });

    it("[SPM-82][AC3] SPM-82-TC04: Cancel closes the form and changes nothing", async () => {
      const api = open({ [LIST]: [holding()] });

      await openExpiry();
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByLabelText("New expiry")).not.toBeInTheDocument();
      expect(api.sent(EXPIRY)).toHaveLength(0);
    });

    it("[SPM-22][AC4] sends the user to log in when their session has expired while saving", async () => {
      open({ [LIST]: [holding()], [EXPIRY]: reply(401, {}) });

      await openExpiry();
      fireEvent.change(newExpiry(), { target: { value: LOCAL } });
      await userEvent.click(screen.getByRole("button", { name: "Save expiry" }));

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fbookings"));
    });
  });

  it.each(ROLES.filter((r) => r !== "venue_staff"))("[SPM-22][AC4] refuses %s without requesting the list", async (role) => {
    const api = mockApi(signedInAs(role));

    render(<BookingsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reviewing venue bookings is Venue Staff's role.");
    expect(api.sent(LIST)).toHaveLength(0);
  });

  describe("each request", () => {
    it("[SPM-43][AC2] shows its venue, event, times, schedule, requirements, requester and status", async () => {
      open();

      const it_ = await card();

      expect(within(it_).getByRole("link", { name: "EVT-000007" })).toHaveAttribute("href", "/events/EVT-000007");
      expect(it_).toHaveTextContent("for EVT-000007 Town Hall · Acme Pte Ltd");
      expect(valueOf(it_, "Requested")).toHaveTextContent(/^4 Mar 2027, 13:00–18:00Room in use: 13:00–18:00$/);
      expect(valueOf(it_, "Event time")).toHaveTextContent("4 Mar 2027");
      expect(valueOf(it_, "Event time")).toHaveTextContent("14:00");
      expect(valueOf(it_, "Layout")).toHaveTextContent("U shape");
      expect(valueOf(it_, "Expected attendance")).toHaveTextContent(/^120$/);
      expect(valueOf(it_, "Venue requirements")).toHaveTextContent("Stage at the north end");
      expect(valueOf(it_, "Requested by")).toHaveTextContent("Daniel Tan");
      expect(valueOf(it_, "Requested by")).toHaveTextContent("Event is Planning");
      expect(it_).toHaveTextContent("Pending");
      expect(within(it_).queryByText("Session time")).not.toBeInTheDocument();
    });

    it("[SPM-93][AC8] SPM-93-TC13: shows the times setup and turnaround take either side, and the whole room-in-use period", async () => {
      open({
        [LIST]: [request({ venue: { id: "v1", code: "HALL-A", name: "Hall A", setupMinutes: 30, teardownMinutes: 45 } })],
      });

      const requested = valueOf(await card(), "Requested");

      expect(requested).toHaveTextContent("4 Mar 2027, 13:00–18:00");
      expect(requested).toHaveTextContent("Setup: 12:30–13:00 (30 min)");
      expect(requested).toHaveTextContent("Turnaround: 18:00–18:45 (45 min)");
      expect(requested).toHaveTextContent("Room in use: 12:30–18:45");
      expect(requested).not.toHaveTextContent(/\b(AM|PM|Night)\b/);
    });

    it("[SPM-93][AC8] shows no setup or turnaround line for a venue that needs neither", async () => {
      open();

      expect(within(await card()).queryByText(/Setup:|Turnaround:/)).not.toBeInTheDocument();
    });

    it("[SPM-43][AC2] [SPM-42][AC4] shows a session's own name, time and attendance in place of the event's", async () => {
      open({
        [LIST]: [
          request({
            session: {
              label: "Day 1",
              startsAt: "2027-03-04T07:00:00.000Z",
              endsAt: "2027-03-04T08:00:00.000Z",
              expectedAttendance: 40,
            },
          }),
        ],
      });

      const it_ = await card();

      expect(it_).toHaveTextContent("Session: Day 1");
      expect(valueOf(it_, "Session time")).toHaveTextContent("15:00");
      expect(valueOf(it_, "Expected attendance")).toHaveTextContent(/^40$/);
      expect(within(it_).queryByText("Event time")).not.toBeInTheDocument();
    });

    // SPM-90 (AC5): Venue Staff see what the room is wanted for, and that
    // space's own attendance rather than the event's total.
    it("[SPM-90][AC5] SPM-90-TC06: shows what the space is for, with its own attendance", async () => {
      open({ [LIST]: [request({ purpose: "Breakout room", expectedAttendance: 20, layoutName: "classroom" })] });

      const it_ = await card();

      expect(valueOf(it_, "Space")).toHaveTextContent(/^Breakout room$/);
      expect(valueOf(it_, "Layout")).toHaveTextContent("Classroom");
      expect(valueOf(it_, "Expected attendance")).toHaveTextContent(/^20$/);
    });

    it("[SPM-90][AC7] SPM-90-TC10: says the space was not recorded on a request made before it was asked for", async () => {
      open({ [LIST]: [request({ purpose: null, expectedAttendance: null })] });

      const it_ = await card();

      expect(valueOf(it_, "Space")).toHaveTextContent("Not recorded");
      expect(valueOf(it_, "Expected attendance")).toHaveTextContent(/^120$/);
    });

    it("[SPM-43][AC2] falls back to the event's attendance for a session that gives none, and names an unnamed session", async () => {
      open({
        [LIST]: [
          request({
            session: {
              label: null,
              startsAt: "2027-03-04T07:00:00.000Z",
              endsAt: "2027-03-04T08:00:00.000Z",
              expectedAttendance: null,
            },
          }),
        ],
      });

      const it_ = await card();

      expect(it_).toHaveTextContent("Session: Session");
      expect(valueOf(it_, "Expected attendance")).toHaveTextContent(/^120$/);
    });

    it("[SPM-43][AC2] fills the gaps of a sparse request", async () => {
      open({
        [LIST]: [
          request({
            layoutName: null,
            requirementsNote: null,
            event: {
              reference: "EVT-000008",
              title: null,
              status: "approved",
              startsAt: null,
              endsAt: null,
              expectedAttendance: null,
              organisation: null,
            },
          }),
        ],
      });

      const it_ = await card();

      expect(it_).toHaveTextContent("for EVT-000008 Untitled event");
      expect(it_).not.toHaveTextContent("Untitled event ·");
      expect(valueOf(it_, "Layout")).toHaveTextContent("Not set");
      expect(valueOf(it_, "Expected attendance")).toHaveTextContent("Not set");
      expect(valueOf(it_, "Venue requirements")).toHaveTextContent("None given");
      expect(valueOf(it_, "Requested by")).toHaveTextContent("Event is Approved");
    });
  });

  it.each([
    [1, "1 pending decision."],
    [2, "2 pending decisions."],
  ])("[SPM-43][AC1] counts %i waiting under the title", async (count, subtitle) => {
    open({ [LIST]: [request(), request({ id: "b2" })].slice(0, count) });

    expect(await screen.findByText(subtitle)).toBeInTheDocument();
  });

  it("[SPM-43][AC1] says so when no requests are pending", async () => {
    open({ [LIST]: [] });

    expect(await screen.findByText("No pending booking requests")).toBeInTheDocument();
    expect(screen.getByText("Venue bookings requested by coordinators, waiting for review.")).toBeInTheDocument();
  });

  describe("a request that would clash", () => {
    const clash = "Hall A is already booked for EVT-000003 at this time.";

    it("[SPM-44][AC6][AC9] is flagged, says why, and cannot be approved", async () => {
      open({ [LIST]: [request({ conflict: clash })] });

      const it_ = await card();

      expect(within(it_).getByRole("alert")).toHaveTextContent("This request cannot be approved as it stands");
      expect(within(it_).getByRole("alert")).toHaveTextContent(clash);
      expect(within(it_).getByText("Conflict")).toBeInTheDocument();
      expect(within(it_).queryByText("Pending")).not.toBeInTheDocument();
      expect(within(it_).getByRole("button", { name: "Approve" })).toBeDisabled();
      expect(within(it_).getByRole("button", { name: "Reject with a reason" })).toBeEnabled();
    });

    it("[SPM-44][AC9] links to the venue's calendar on the day requested", async () => {
      open({ [LIST]: [request({ conflict: clash })] });

      expect(within(await card()).getByRole("link", { name: "Open the calendar" })).toHaveAttribute(
        "href",
        "/venues/v1/availability?from=2027-03-04"
      );
    });

    it("[SPM-44][AC10] leaves a request with no clash approvable, with no warning", async () => {
      open();

      const it_ = await card();

      expect(within(it_).getByRole("button", { name: "Approve" })).toBeEnabled();
      expect(within(it_).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(it_).queryByText("Conflict")).not.toBeInTheDocument();
    });
  });

  describe("approving", () => {
    it("[SPM-43][AC3] asks first, naming the room, event and times it books", async () => {
      const api = open({ [DECIDE]: {} });

      await approve();

      expect(dialog().open).toBe(true);
      expect(dialog()).toHaveTextContent("Approve this booking?");
      expect(dialog()).toHaveTextContent(
        "This books Hall A (HALL-A) for EVT-000007 Town Hall on 4 Mar 2027, 13:00–18:00. No other event can then be booked into the room from 13:00 to 18:00."
      );
      expect(api.sent(DECIDE)).toHaveLength(0);
    });

    it("[SPM-93][AC8] SPM-93-TC13: names the room-in-use period, setup and turnaround included, in the question", async () => {
      open({
        [DECIDE]: {},
        [LIST]: [request({ venue: { id: "v1", code: "HALL-A", name: "Hall A", setupMinutes: 30, teardownMinutes: 45 } })],
      });

      await approve();

      expect(dialog()).toHaveTextContent(
        "This books Hall A (HALL-A) for EVT-000007 Town Hall on 4 Mar 2027, 13:00–18:00. No other event can then be booked into the room from 12:30 to 18:45, which includes its setup and turnaround time."
      );
    });

    it("[SPM-43][AC3][AC7] on confirming, approves it, says the room is booked, and reloads the list", async () => {
      const api = open({ [DECIDE]: {} });
      await approve();
      api.on(LIST, []);

      await confirmApproval();

      const notice = await screen.findByText("Booking approved");
      expect(notice.closest("[role]")).toHaveTextContent(
        "Hall A (HALL-A) for EVT-000007 Town Hall on 4 Mar 2027, 13:00–18:00 is now Approved — the room is booked."
      );
      expect(api.sent(DECIDE).map((c) => c.body)).toEqual([{ decision: "approve" }]);
      expect(await screen.findByText("No pending booking requests")).toBeInTheDocument();
      expect(dialog().open).toBe(false);
    });

    // SPM-81 (AC5, AC7): one event's requests are separate cards, and a
    // decision is sent for the one request only - a PATCH for b2 has no route
    // here and would fail the test.
    it("[SPM-81][AC5] SPM-81-TC05: approving one of an event's two requests decides that one alone, and the other stays Pending", async () => {
      const other = request({ id: "b2", venue: { id: "v2", code: "HALL-B", name: "Hall B", setupMinutes: 0, teardownMinutes: 0 } });
      const api = open({ [DECIDE]: {}, [LIST]: [request(), other] });
      expect(await card("Hall B (HALL-B)")).toHaveTextContent("for EVT-000007 Town Hall");
      await approve();
      api.on(LIST, [other]);

      await confirmApproval();

      await screen.findByText("Booking approved");
      expect(api.sent(DECIDE).map((c) => c.body)).toEqual([{ decision: "approve" }]);
      await waitFor(() => expect(screen.queryByRole("heading", { name: "Hall A (HALL-A)" })).not.toBeInTheDocument());
      expect(within(await card("Hall B (HALL-B)")).getByText("Pending")).toBeInTheDocument();
    });

    it("[SPM-43][AC3] names an untitled event as such", async () => {
      open({
        [LIST]: [request({ event: { ...request().event, title: null } })],
      });

      await approve();

      expect(dialog()).toHaveTextContent("for EVT-000007 Untitled event on");
    });

    it("[SPM-43][AC3] does nothing when the question is cancelled", async () => {
      const api = open({ [DECIDE]: {} });
      await approve();

      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel", hidden: true }));

      expect(dialog().open).toBe(false);
      expect(api.sent(DECIDE)).toHaveLength(0);
      expect(api.sent(LIST)).toHaveLength(1);
    });

    it("[SPM-43][AC3] closes a rejection that was being written for another request", async () => {
      open({ [LIST]: [request(), request({ id: "b2", venue: { ...request().venue, id: "v2", code: "HALL-B", name: "Hall B" } })] });
      await startRejecting("Hall B (HALL-B)");
      giveReason("Half-written");

      await approve();

      expect(screen.queryByLabelText(/Reason for rejection/)).not.toBeInTheDocument();
      expect(dialog().open).toBe(true);
    });
  });

  describe("rejecting", () => {
    it("[SPM-43][AC4] opens a form on that request only, in place of its buttons", async () => {
      open({ [LIST]: [request(), request({ id: "b2", venue: { ...request().venue, id: "v2", code: "HALL-B", name: "Hall B" } })] });

      await startRejecting();

      const it_ = await card();
      expect(within(it_).getByLabelText(/Reason for rejection/)).toHaveValue("");
      expect(within(it_).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      expect(within(await card("Hall B (HALL-B)")).getByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(screen.getAllByLabelText(/Reason for rejection/)).toHaveLength(1);
    });

    it("[SPM-43][AC4] moves the form when another request is rejected instead, starting it empty", async () => {
      open({ [LIST]: [request(), request({ id: "b2", venue: { ...request().venue, id: "v2", code: "HALL-B", name: "Hall B" } })] });
      await startRejecting();
      giveReason("Meant for Hall A");

      await startRejecting("Hall B (HALL-B)");

      expect(screen.getAllByLabelText(/Reason for rejection/)).toHaveLength(1);
      expect(within(await card("Hall B (HALL-B)")).getByLabelText(/Reason for rejection/)).toHaveValue("");
    });

    it.each(["", "   "])("[SPM-43][AC5] insists on a reason, refusing %j without asking the server", async (text) => {
      const api = open({ [DECIDE]: {} });
      await startRejecting();
      giveReason(text);

      await submitRejection();

      expect(screen.getByText("A reason is required when rejecting. The Coordinator sees this message.")).toBeInTheDocument();
      expect(reason()).toBeInvalid();
      expect(api.sent(DECIDE)).toHaveLength(0);
    });

    it("[SPM-43][AC5] clears that complaint as soon as the form is edited", async () => {
      open();
      await startRejecting();
      await submitRejection();

      giveReason("The hall is being refitted.");

      expect(screen.queryByText(/A reason is required when rejecting/)).not.toBeInTheDocument();
      expect(screen.getByText("The Coordinator sees this message.")).toBeInTheDocument();
    });

    it("[SPM-43][AC4][AC5] sends the trimmed reason alone, and tells Venue Staff where the Coordinator will see it", async () => {
      const api = open({ [DECIDE]: {} });
      await startRejecting();
      giveReason("  The hall is being refitted.  ");
      api.on(LIST, []);

      await submitRejection();

      const notice = await screen.findByText("Booking request rejected");
      expect(notice.closest("[role]")).toHaveTextContent(
        "Hall A (HALL-A) for EVT-000007 Town Hall on 4 Mar 2027, 13:00–18:00 is now Rejected. The Coordinator can see your reason on the event's Venue tab."
      );
      expect(api.sent(DECIDE).map((c) => c.body)).toEqual([
        { decision: "reject", reason: "The hall is being refitted." },
      ]);
      expect(await screen.findByText("No pending booking requests")).toBeInTheDocument();
    });

    it("[SPM-43][AC6] sends a suggested venue and arrangement with it, and mentions the suggestion", async () => {
      const api = open({ [DECIDE]: {} });
      await startRejecting();
      giveReason("Refit");
      fireEvent.change(screen.getByLabelText("Suggest another venue"), { target: { value: "v2" } });
      fireEvent.change(screen.getByLabelText("Alternative arrangement"), { target: { value: "  Friday instead  " } });

      await submitRejection();

      expect(await screen.findByText(/The Coordinator can see your reason and suggestion on/)).toBeInTheDocument();
      expect(api.sent(DECIDE)[0].body).toEqual({
        decision: "reject",
        reason: "Refit",
        suggestedVenueId: "v2",
        suggestedAlternative: "Friday instead",
      });
    });

    it.each([
      ["only a venue", "v2", "", { suggestedVenueId: "v2" }],
      ["only an arrangement", "", "Friday instead", { suggestedAlternative: "Friday instead" }],
    ])("[SPM-43][AC6] counts %s as a suggestion", async (_case, venue, arrangement, sent) => {
      const api = open({ [DECIDE]: {} });
      await startRejecting();
      giveReason("Refit");
      fireEvent.change(screen.getByLabelText("Suggest another venue"), { target: { value: venue } });
      fireEvent.change(screen.getByLabelText("Alternative arrangement"), { target: { value: arrangement } });

      await submitRejection();

      expect(await screen.findByText(/your reason and suggestion on/)).toBeInTheDocument();
      expect(api.sent(DECIDE)[0].body).toEqual({ decision: "reject", reason: "Refit", ...sent });
    });

    it("[SPM-43][AC6] does not count an arrangement of only spaces as a suggestion", async () => {
      const api = open({ [DECIDE]: {} });
      await startRejecting();
      giveReason("Refit");
      fireEvent.change(screen.getByLabelText("Alternative arrangement"), { target: { value: "   " } });

      await submitRejection();

      expect(await screen.findByText(/The Coordinator can see your reason on the event/)).toBeInTheDocument();
      expect(api.sent(DECIDE)[0].body).toEqual({ decision: "reject", reason: "Refit" });
    });

    it("[SPM-43][AC6] offers every other venue to suggest, by name, and never the one being rejected", async () => {
      open();
      await startRejecting();

      const options = within(screen.getByLabelText("Suggest another venue")).getAllByRole("option");

      expect(options.map((o) => o.textContent)).toEqual(["No venue suggested", "Hall B (HALL-B)", "Room C (ROOM-C)"]);
      expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(["", "v2", "v3"]);
    });

    it.each([
      ["the venues cannot be loaded", reply(500, {})],
      ["the server cannot be reached for them", () => Promise.reject(new Error("offline"))],
    ])("[SPM-43][AC4] still lets a request be rejected when %s", async (_case, answer) => {
      const api = open({ [VENUES]: answer, [DECIDE]: {} });
      await startRejecting();

      expect(within(screen.getByLabelText("Suggest another venue")).getAllByRole("option")).toHaveLength(1);
      giveReason("Refit");
      await submitRejection();

      expect(await screen.findByText("Booking request rejected")).toBeInTheDocument();
      expect(api.sent(DECIDE)).toHaveLength(1);
    });

    it("[SPM-43][AC4] Cancel closes the form and forgets what was typed", async () => {
      const api = open({ [DECIDE]: {} });
      await startRejecting();
      giveReason("Half-written");

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByLabelText(/Reason for rejection/)).not.toBeInTheDocument();
      await startRejecting();
      expect(reason()).toHaveValue("");
      expect(api.sent(DECIDE)).toHaveLength(0);
    });
  });

  describe("when the decision is refused", () => {
    it.each([
      ["reason", /Reason for rejection/, "Give a reason of 2000 characters or fewer."],
      ["suggestedVenueId", "Suggest another venue", "That venue is no longer available to suggest."],
    ])("[SPM-43] shows a complaint about %s under that field, keeping the form", async (field, label, message) => {
      const api = open({ [DECIDE]: reply(400, { error: message, field }) });
      await startRejecting();
      giveReason("Refit");

      await submitRejection();

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInvalid();
      expect(reason()).toHaveValue("Refit");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(api.sent(LIST)).toHaveLength(1);
    });

    it("[SPM-43] shows any other refusal on the request and reloads the list, which may be stale", async () => {
      const api = open({ [DECIDE]: reply(400, { error: "Hall A is no longer free at that time." }) });
      await approve();

      await confirmApproval();

      expect(await within(await card()).findByRole("alert")).toHaveTextContent("Hall A is no longer free at that time.");
      await waitFor(() => expect(api.sent(LIST)).toHaveLength(2));
      expect(dialog().open).toBe(false);
      expect(screen.queryByText("Booking approved")).not.toBeInTheDocument();
    });

    it("[SPM-43] shows the refusal above the list when the request has since left it", async () => {
      const api = open({ [DECIDE]: reply(409, { error: "This booking request has already been decided." }) });
      await approve();
      api.on(LIST, []);

      await confirmApproval();

      expect(await screen.findByRole("alert")).toHaveTextContent("This booking request has already been decided.");
      expect(await screen.findByText("No pending booking requests")).toBeInTheDocument();
    });

    it.each([
      ["the server gives no reason", reply(500, {})],
      ["the server answers with nothing readable", reply(500)],
      ["the server cannot be reached", () => Promise.reject(new Error("offline"))],
    ])("[SPM-43] says the decision could not be saved when %s", async (_case, answer) => {
      open({ [DECIDE]: answer });
      await approve();

      await confirmApproval();

      expect(await within(await card()).findByRole("alert")).toHaveTextContent(
        "Could not save your decision. Please try again."
      );
      expect(dialog().open).toBe(false);
    });

    it("[SPM-43] clears an earlier refusal when a rejection is started", async () => {
      open({ [DECIDE]: reply(400, { error: "Hall A is no longer free at that time." }) });
      await approve();
      await confirmApproval();
      await within(await card()).findByRole("alert");

      await startRejecting();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("[SPM-22][AC4] sends the user to log in when their session expired before deciding", async () => {
      open({ [DECIDE]: reply(401, {}) });
      await approve();

      await confirmApproval();

      await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fbookings"));
      expect(screen.queryByText("Booking approved")).not.toBeInTheDocument();
    });
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    open({ [LIST]: reply(401, {}) });

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fbookings"));
  });

  it("[SPM-43] shows a load failure with a Retry that loads again", async () => {
    const api = open({ [LIST]: reply(500, {}) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load booking requests.");

    api.on(LIST, [request()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await card()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("[SPM-22][AC4] sends an anonymous visitor to log in", async () => {
    mockApi(signedOut());

    render(<EquipmentRequestsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests"));
  });

  it("[SPM-50][AC1] lists each event with its number of equipment lines", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [row()] });

    render(<EquipmentRequestsPage />);
    const cells = within(await table()).getAllByRole("cell");

    expect(cells[0]).toHaveTextContent("Gala Dinner EVT-000012");
    expect(cells[2]).toHaveTextContent("3");
    expect(cells[3]).toHaveTextContent("Planning");
    expect(screen.queryByText("This queue is for Technical Support Staff.")).not.toBeInTheDocument();
  });

  it("[SPM-50][AC1] opens an event's equipment request when its row is clicked", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [row()] });
    render(<EquipmentRequestsPage />);

    await userEvent.click(within(await table()).getByText("Gala Dinner"));

    expect(router.push).toHaveBeenCalledWith("/equipment/requests/EVT-000012");
  });

  it("[SPM-50] shows a dash for an event with no title", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [row({ title: null })] });

    render(<EquipmentRequestsPage />);

    expect(within(await table()).getAllByRole("cell")[0]).toHaveTextContent("— EVT-000012");
  });

  it("[SPM-22][AC4] tells any other role the queue is not theirs, and explains the refusal", async () => {
    mockApi({ ...signedInAs("coordinator"), [ROUTE]: reply(403, { error: "forbidden" }) });

    render(<EquipmentRequestsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only Technical Support Staff can view equipment requests."
    );
    expect(screen.getByText("This queue is for Technical Support Staff.")).toBeInTheDocument();
  });

  it("[SPM-50] says so when no equipment has been requested", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: [] });

    render(<EquipmentRequestsPage />);

    expect(await screen.findByText("No equipment requests yet")).toBeInTheDocument();
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    mockApi({ ...signedInAs("tech_support"), [ROUTE]: reply(401, {}) });

    render(<EquipmentRequestsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fequipment%2Frequests"));
  });

  it("[SPM-50] shows a load failure with a Retry that loads again", async () => {
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

  // CHANGED (SPM-84): `assigned` became `active` (every active event, with or
  // without a coordinator), and `workload` counts each coordinator's events.
  const data = (overrides: Record<string, unknown> = {}) => ({
    awaiting: [item(1, { title: "Gala Dinner" }), item(2)],
    active: [item(3, { title: "Summit", status: "planning", coordinator: daniel })],
    coordinators: [daniel, priya],
    workload: [
      { ...daniel, isActive: true, activeEvents: 1 },
      { ...priya, isActive: true, activeEvents: 0 },
    ],
    ...overrides,
  });

  // CHANGED (SPM-84 AC1): the refusal names the Event Coordinator Lead.
  it.each(ROLES.filter((r) => r !== "ops_manager"))("[SPM-22][AC4] [SPM-84][AC12] refuses %s without requesting the list", async (role) => {
    const api = mockApi(signedInAs(role));

    render(<AssignmentsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Assigning coordinators is the Event Coordinator Lead's role."
    );
    expect(api.sent(ROUTE)).toHaveLength(0);
  });

  it("[SPM-84][AC1] SPM-84-TC01: offers the Lead three tabs", async () => {
    setRoute("/assignments");
    mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data() });

    render(<AssignmentsPage />);

    await table();
    expect(screen.getByRole("link", { name: /^Awaiting assignment/ })).toHaveAttribute("href", "/assignments");
    expect(screen.getByRole("link", { name: "Active events" })).toHaveAttribute("href", "/assignments?view=active");
    expect(screen.getByRole("link", { name: "Coordinators" })).toHaveAttribute("href", "/assignments?view=coordinators");
  });

  describe("awaiting assignment", () => {
    it("[SPM-30][AC2] lists the unassigned events with how long each has waited, and counts them on the tab", async () => {
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

    it("[SPM-30][AC2] links each event to its detail page", async () => {
      setRoute("/assignments");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data() });

      render(<AssignmentsPage />);

      expect(within(await table()).getByRole("link", { name: "Gala Dinner" })).toHaveAttribute(
        "href",
        "/events/EVT-000001"
      );
    });

    it("[SPM-30][AC1][AC3] assigning a coordinator confirms it and reloads the list", async () => {
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

    it("[SPM-30][AC2] says so when every submitted event has a coordinator", async () => {
      setRoute("/assignments");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ awaiting: [] }) });

      render(<AssignmentsPage />);

      expect(await screen.findByText("No events are awaiting assignment")).toBeInTheDocument();
    });

    it("[SPM-30] copes with an event that has no title, client or submission time", async () => {
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

    it("[SPM-30] names an untitled event as such when confirming its assignment", async () => {
      setRoute("/assignments");
      mockApi({
        ...signedInAs("ops_manager"),
        [ROUTE]: data({ awaiting: [item(1, { title: null })] }),
        "PUT /api/events/EVT-000001/coordinator": { status: "under_review", coordinator: daniel, previousCoordinator: null },
      });
      render(<AssignmentsPage />);
      const picker = within(await table()).getByRole("combobox", { name: "Assign to — Untitled event" });

      await userEvent.selectOptions(picker, "Daniel Tan");
      await userEvent.click(within(picker.closest("td")!).getByRole("button", { name: "Assign" }));

      expect(await screen.findByText(/Daniel Tan is now the coordinator for "Untitled event"/)).toBeInTheDocument();
    });

    it.each([
      [0, "Today"],
      [1, "1 day"],
    ])("[SPM-30][AC2] shows a request submitted %i day(s) ago as waiting %j", async (daysAgo, label) => {
      setRoute("/assignments");
      const submittedAt = new Date(Date.now() - daysAgo * DAY - 60_000 * Math.sign(daysAgo)).toISOString();
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ awaiting: [item(1, { submittedAt })] }) });

      render(<AssignmentsPage />);

      expect(within(await table()).getAllByRole("cell")[3]).toHaveTextContent(label);
    });
  });

  // SPM-84 (AC5-AC9, AC11): every active event, filterable by coordinator and
  // status, with Assign / Reassign on each row. Replaces SPM-30's "Assigned"
  // tab, whose tests are kept below with the new data.
  describe("active events", () => {
    const aisha = { id: "c3", fullName: "Aisha Karim" };
    const active = [
      item(3, { title: "Summit", status: "planning", coordinator: daniel }),
      item(4, { title: "SPM84 Harbour Gala", status: "planning", coordinator: aisha, organisation: { name: "Meridian Financial Group" } }),
      item(5, { title: "SPM84 Orchard Forum", status: "under_review", coordinator: aisha }),
      item(6, { title: "SPM84 Unassigned Request", status: "submitted", coordinator: null }),
    ];
    const open = (path = "/assignments?view=active", overrides: Record<string, unknown> = {}) => {
      setRoute(path);
      const api = mockApi({
        ...signedInAs("ops_manager"),
        [ROUTE]: data({ active, coordinators: [aisha, daniel, priya], ...overrides }),
      });
      render(<AssignmentsPage />);
      return api;
    };
    const coordinatorFilter = () => screen.getByLabelText("Coordinator");
    const statusFilter = () => screen.getByLabelText("Status");

    it("[SPM-30][AC3] [SPM-84][AC5] lists every active event with its client, date, status and coordinator", async () => {
      open();
      const rows = await rowTexts();

      expect(rows).toHaveLength(4);
      expect(rows[1]).toContain("SPM84 Harbour Gala");
      expect(rows[1]).toContain("Meridian Financial Group");
      expect(rows[1]).toContain("4 Mar 2027");
      expect(rows[1]).toContain("Planning");
      expect(rows[1]).toContain("Aisha Karim");
      expect(screen.getByRole("link", { name: "Active events" })).toHaveAttribute("aria-current", "page");
    });

    it("[SPM-84][AC5] shows an event with no coordinator as not yet assigned, with Assign instead of Reassign", async () => {
      open();
      const row = within(await table()).getByText("SPM84 Unassigned Request").closest("tr")!;

      expect(row).toHaveTextContent("Not yet assigned");
      expect(within(row).getByRole("combobox", { name: "Assign to — SPM84 Unassigned Request" })).toBeInTheDocument();
    });

    it("[SPM-84][AC5] opens on the Active events tab from SPM-30's old address", async () => {
      open("/assignments?view=assigned");

      expect(await rowTexts()).toHaveLength(4);
      expect(screen.getByRole("link", { name: "Active events" })).toHaveAttribute("aria-current", "page");
    });

    it("[SPM-84][AC7] SPM-84-TC03: filters to one coordinator and keeps it in the address", async () => {
      open();
      await table();

      await userEvent.selectOptions(coordinatorFilter(), "Aisha Karim");

      const rows = await rowTexts();
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r!.includes("Aisha Karim"))).toBe(true);
      expect(router.replace).toHaveBeenLastCalledWith("/assignments?view=active&coordinator=c3");
    });

    it("[SPM-84][AC7] offers any coordinator, not yet assigned, then each coordinator A to Z", async () => {
      open();
      await table();

      expect(within(coordinatorFilter()).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Any coordinator",
        "Not yet assigned",
        "Aisha Karim",
        "Daniel Tan",
        "Priya Raj",
      ]);
    });

    it("[SPM-84][AC6][AC7] SPM-84-TC04: offers only the active statuses", async () => {
      open();
      await table();

      expect(within(statusFilter()).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Any status",
        "Submitted",
        "Under review",
        "Approved",
        "Planning",
        "Safety review",
        "Safety approved",
        "Confirmed",
        "Postponed",
      ]);
    });

    it("[SPM-84][AC7] SPM-84-TC04: combines the coordinator and the status, from the address", async () => {
      open("/assignments?view=active&coordinator=c3&status=planning");
      const rows = await rowTexts();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("SPM84 Harbour Gala");
      expect(coordinatorFilter()).toHaveValue("c3");
      expect(statusFilter()).toHaveValue("planning");
    });

    it("[SPM-84][AC7] writes both filters to the address, and drops one set back to any", async () => {
      open("/assignments?view=active&coordinator=c3");
      await table();

      await userEvent.selectOptions(statusFilter(), "Under review");
      expect(router.replace).toHaveBeenLastCalledWith("/assignments?view=active&coordinator=c3&status=under_review");

      await userEvent.selectOptions(coordinatorFilter(), "Any coordinator");
      expect(router.replace).toHaveBeenLastCalledWith("/assignments?view=active&status=under_review");
    });

    it("[SPM-84][AC7] SPM-84-TC04: keeps the events with no coordinator", async () => {
      open("/assignments?view=active&coordinator=unassigned");
      const rows = await rowTexts();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("SPM84 Unassigned Request");
    });

    it("[SPM-84][AC7] SPM-84-TC04: says so when nothing matches the filters", async () => {
      open("/assignments?view=active&coordinator=c2&status=planning");

      expect(await screen.findByText("No active events match these filters")).toBeInTheDocument();
      expect(screen.getByText("Try another coordinator or status.")).toBeInTheDocument();
    });

    it("[SPM-84][AC7] clears the filters when the Active events tab is clicked", async () => {
      setRoute("/assignments?view=active&coordinator=c3&status=planning");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ active, coordinators: [aisha, daniel, priya] }) });
      const { rerender } = render(<AssignmentsPage />);
      expect(await rowTexts()).toHaveLength(1);

      // The tab's link has no filters in it; the page stays mounted.
      setRoute("/assignments?view=active");
      rerender(<AssignmentsPage />);

      expect(await rowTexts()).toHaveLength(4);
      expect(coordinatorFilter()).toHaveValue("all");
      expect(statusFilter()).toHaveValue("all");
    });

    it("[SPM-84][AC5] ignores a coordinator or status in the address that it does not offer", async () => {
      open("/assignments?view=active&coordinator=nobody&status=draft");

      expect(await rowTexts()).toHaveLength(4);
      expect(coordinatorFilter()).toHaveValue("all");
      expect(statusFilter()).toHaveValue("all");
    });

    it("[SPM-30] [SPM-84][AC5] says so when there are no active events at all", async () => {
      open("/assignments?view=active", { active: [] });

      expect(await screen.findByText("No active events")).toBeInTheDocument();
      expect(screen.getByText("Events appear here once an organiser submits a request.")).toBeInTheDocument();
    });

    it("[SPM-84][AC8] SPM-84-TC03: links each event to its Overview", async () => {
      open();

      expect(within(await table()).getByRole("link", { name: "SPM84 Harbour Gala" })).toHaveAttribute(
        "href",
        "/events/EVT-000004"
      );
    });

    it("[SPM-30][AC6] [SPM-84][AC9][AC11] SPM-84-TC09: reassigning from the list says who it moved from and to, and reloads", async () => {
      const api = open("/assignments?view=active", {
        active: [item(3, { title: "Summit", status: "planning", coordinator: daniel })],
      });
      api.on("PUT /api/events/EVT-000003/coordinator", { status: "planning", coordinator: priya, previousCoordinator: daniel });
      const picker = within(await table()).getByRole("combobox", { name: "Reassign to — Summit" });

      await userEvent.selectOptions(picker, "Priya Raj");
      await userEvent.click(within(picker.closest("td")!).getByRole("button", { name: "Reassign" }));
      const dialog = within(picker.closest("td")!).getByRole("dialog", { hidden: true });
      await userEvent.click(within(dialog).getByRole("button", { name: "Reassign", hidden: true }));

      expect(await screen.findByText('"Summit" has been reassigned from Daniel Tan to Priya Raj.')).toBeInTheDocument();
      await waitFor(() => expect(api.sent(ROUTE)).toHaveLength(2));
    });

    it("[SPM-30] names an untitled event as such", async () => {
      open("/assignments?view=active", { active: [item(3, { title: null, status: "planning", coordinator: daniel })] });

      expect(within(await table()).getByRole("combobox", { name: "Reassign to — Untitled event" })).toBeInTheDocument();
    });
  });

  // SPM-84 (AC4, AC10): every coordinator and their number of active events.
  describe("coordinators", () => {
    const open = (workload: unknown[]) => {
      setRoute("/assignments?view=coordinators");
      mockApi({ ...signedInAs("ops_manager"), [ROUTE]: data({ workload }) });
      render(<AssignmentsPage />);
    };

    it("[SPM-84][AC4][AC10] SPM-84-TC02: lists each coordinator with their active events, zero included", async () => {
      open([
        { id: "c3", fullName: "Aisha Karim", isActive: true, activeEvents: 3 },
        { id: "c5", fullName: "Clara Tay", isActive: true, activeEvents: 0 },
      ]);
      const rows = await rowTexts();

      expect(rows).toEqual(["Aisha Karim3", "Clara Tay0"]);
      expect(screen.getByRole("link", { name: "Coordinators" })).toHaveAttribute("aria-current", "page");
      expect(within(await table()).getByRole("columnheader", { name: "Active events" })).toBeInTheDocument();
    });

    it("[SPM-84][AC4] marks a deactivated coordinator who still holds events", async () => {
      open([{ id: "c6", fullName: "Dennis Ho", isActive: false, activeEvents: 1 }]);

      expect(within(await table()).getByText("Account inactive")).toBeInTheDocument();
    });

    it("[SPM-84][AC4][AC7] links each coordinator to the Active events tab filtered to them", async () => {
      open([{ id: "c3", fullName: "Aisha Karim", isActive: true, activeEvents: 3 }]);

      expect(within(await table()).getByRole("link", { name: "Aisha Karim" })).toHaveAttribute(
        "href",
        "/assignments?view=active&coordinator=c3"
      );
    });

    it("[SPM-84][AC4][AC7] SPM-84-TC02: filters to the coordinator whose name was clicked, without a reload", async () => {
      const aisha = { id: "c3", fullName: "Aisha Karim" };
      setRoute("/assignments?view=coordinators");
      mockApi({
        ...signedInAs("ops_manager"),
        [ROUTE]: data({
          active: [
            item(4, { title: "SPM84 Harbour Gala", status: "planning", coordinator: aisha }),
            item(3, { title: "Summit", status: "planning", coordinator: daniel }),
          ],
          coordinators: [aisha, daniel],
          workload: [{ ...aisha, isActive: true, activeEvents: 1 }],
        }),
      });
      const { rerender } = render(<AssignmentsPage />);
      await table();

      // Following the link changes the address; the page stays mounted.
      setRoute("/assignments?view=active&coordinator=c3");
      rerender(<AssignmentsPage />);

      const rows = await rowTexts();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("SPM84 Harbour Gala");
      expect(screen.getByLabelText("Coordinator")).toHaveValue("c3");
    });

    it("[SPM-84][AC4] says so when there are no coordinators", async () => {
      open([]);

      expect(await screen.findByText("No Event Coordinators")).toBeInTheDocument();
    });
  });

  it("[SPM-22][AC4] sends the user to log in when their session has expired", async () => {
    setRoute("/assignments");
    mockApi({ ...signedInAs("ops_manager"), [ROUTE]: reply(401, {}) });

    render(<AssignmentsPage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fassignments"));
  });

  it("[SPM-30] shows a load failure with a Retry that loads again", async () => {
    setRoute("/assignments");
    const api = mockApi({ ...signedInAs("ops_manager"), [ROUTE]: reply(500, {}) });
    render(<AssignmentsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load assignments.");

    api.on(ROUTE, data());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await rowTexts()).toHaveLength(2);
  });

  it("[SPM-30] shows a general error when the request fails without a reason", async () => {
    setRoute("/assignments");
    mockApi({ ...signedInAs("ops_manager"), [ROUTE]: () => Promise.reject("offline") });

    render(<AssignmentsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

// SPM-86 (AC4): an event in Safety review stays visible wherever its status is
// shown. Decided 2026-10-09: a "Safety review" list after "Planning" on the
// organiser's and coordinator's Dashboard, Safety review in Venue Staff's and
// Technical Support's "Upcoming events", and a "Safety review" status filter.
describe("Safety review across the lists (SPM-86)", () => {
  const section = (heading: string) => screen.getByRole("heading", { name: heading }).parentElement as HTMLElement;
  const titlesIn = (heading: string) =>
    within(section(heading))
      .queryAllByRole("listitem")
      .map((li) => li.querySelector("span")!.textContent);
  const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  it("[SPM-86][AC4] SPM-86-TC03: lists an organiser's event in Safety review under its own heading, after Planning", async () => {
    mockApi({
      ...signedInAs("organiser"),
      "GET /api/events": [
        event(1, { title: "Being planned", status: "planning" }),
        event(2, { title: "Being checked", status: "safety_review" }),
      ],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(titlesIn("Safety review")).toEqual(["Being checked"]));
    expect(headings().slice(0, 5)).toEqual(["Drafts", "Under review", "Approved", "Planning", "Safety review"]);
    expect(titlesIn("Planning")).toEqual(["Being planned"]);
  });

  it("[SPM-86][AC4] tells an organiser what the Safety review list is for when it is empty", async () => {
    mockApi({ ...signedInAs("organiser"), "GET /api/events": [] });

    render(<DashboardPage />);

    await screen.findByText("No drafts");
    expect(section("Safety review")).toHaveTextContent("Nothing in safety review");
    expect(section("Safety review")).toHaveTextContent("Events appear here once your coordinator submits them for a safety check.");
  });

  it("[SPM-86][AC4] lists a coordinator's own events in Safety review, after Planning", async () => {
    const me = { id: "u1" };
    mockApi({
      ...signedInAs("coordinator", me),
      "GET /api/events": [
        event(1, { title: "Mine, being checked", status: "safety_review", coordinatorId: me.id }),
        event(2, { title: "A colleague's, being checked", status: "safety_review", coordinatorId: "someone-else" }),
      ],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(titlesIn("Safety review")).toEqual(["Mine, being checked"]));
    expect(headings().slice(0, 4)).toEqual(["Awaiting your review", "Approved", "Planning", "Safety review"]);
  });

  it("[SPM-86] tells a coordinator what the Safety review list is for when it is empty", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/events": [] });

    render(<DashboardPage />);

    await screen.findByText("Nothing to review");
    expect(section("Safety review")).toHaveTextContent("Events appear here once you submit them for a safety check.");
  });

  it.each(["venue_staff", "tech_support"])(
    "[SPM-86][AC4] SPM-86-TC04: keeps an event in Safety review among %s's upcoming events",
    async (role) => {
      mockApi({ ...signedInAs(role), "GET /api/events": [event(1, { title: "Being checked", status: "safety_review" })] });

      render(<DashboardPage />);

      await waitFor(() => expect(titlesIn("Upcoming events")).toEqual(["Being checked"]));
    }
  );

  it("[SPM-86][AC4] SPM-86-TC04: offers staff a Safety review status filter", async () => {
    mockApi({ ...signedInAs("ops_manager"), "GET /api/events": [] });

    render(<EventsPage />);

    await screen.findByText("No events yet");
    const options = within(screen.getByLabelText("Filter by status")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Safety review");
    expect(options.indexOf("Safety review")).toBe(options.indexOf("Planning") + 1);
  });
});

describe("[SPM-38] the Postponed status filter", () => {
  it.each(["coordinator", "ops_manager"])("[SPM-38][AC1] offers %s a Postponed status filter", async (role) => {
    mockApi({ ...signedInAs(role), "GET /api/events": [] });

    render(<EventsPage />);

    await screen.findByText("No events yet");
    const options = within(screen.getByLabelText("Filter by status")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Postponed");
  });
});

// SPM-87: an approved event shows as "Safety approved" (AC7), and has its own
// list after "Safety review" on the organiser's and coordinator's Dashboard.
describe("Safety approved across the lists (SPM-87)", () => {
  const section = (heading: string) => screen.getByRole("heading", { name: heading }).parentElement as HTMLElement;
  const titlesIn = (heading: string) =>
    within(section(heading))
      .queryAllByRole("listitem")
      .map((li) => li.querySelector("span")!.textContent);

  it("[SPM-87][AC7] SPM-87-TC05: lists an organiser's Safety approved event under its own heading, after Safety review", async () => {
    mockApi({
      ...signedInAs("organiser"),
      "GET /api/events": [event(1, { title: "Being checked", status: "safety_review" }), event(2, { title: "Passed", status: "safety_cleared" })],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(titlesIn("Safety approved")).toEqual(["Passed"]));
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Safety approved")).toBe(headings.indexOf("Safety review") + 1);
    expect(section("Safety approved")).toHaveTextContent("Events the Safety Officer has approved, waiting to be confirmed.");
  });

  it("[SPM-87][AC7] SPM-87-TC04: lists a coordinator's own Safety approved events", async () => {
    const me = { id: "u1" };
    mockApi({
      ...signedInAs("coordinator", me),
      "GET /api/events": [event(1, { title: "Mine, passed", status: "safety_cleared", coordinatorId: me.id })],
    });

    render(<DashboardPage />);

    await waitFor(() => expect(titlesIn("Safety approved")).toEqual(["Mine, passed"]));
  });

  it("[SPM-87][AC7] offers staff a Safety approved status filter, after Safety review", async () => {
    mockApi({ ...signedInAs("ops_manager"), "GET /api/events": [] });

    render(<EventsPage />);

    await screen.findByText("No events yet");
    const options = within(screen.getByLabelText("Filter by status")).getAllByRole("option").map((o) => o.textContent);
    expect(options.indexOf("Safety approved")).toBe(options.indexOf("Safety review") + 1);
  });
});

describe("a request that fails without a reason", () => {
  it.each([
    ["Dashboard", DashboardPage, "ops_manager", { "GET /api/events": () => Promise.reject("offline") }],
    ["Events page", EventsPage, "coordinator", { "GET /api/events": () => Promise.reject("offline") }],
    ["Review Queue", QueuePage, "coordinator", { "GET /api/queue": () => Promise.reject("offline") }],
    [
      "Booking Requests",
      BookingsPage,
      "venue_staff",
      { "GET /api/venue-bookings": () => Promise.reject("offline"), "GET /api/venues": [] },
    ],
    ["Equipment requests queue", EquipmentRequestsPage, "tech_support", { "GET /api/equipment/requests": () => Promise.reject("offline") }],
  ])("[SPM-27] shows a general error on the %s", async (_page, Page, role, routes) => {
    mockApi({ ...signedInAs(role), ...routes });

    render(<Page />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

describe("Events page lists an event with no title", () => {
  it("[SPM-27] as 'Untitled event'", async () => {
    mockApi({ ...signedInAs("coordinator"), "GET /api/events": [event(1, { title: null })] });

    render(<EventsPage />);

    expect(within(await screen.findByRole("table")).getByText("Untitled event")).toBeInTheDocument();
  });
});
