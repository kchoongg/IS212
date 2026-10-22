// @vitest-environment jsdom
//
// SPM-35 Request Event Change - the screens:
//   src/app/events/[id]/change-request/page.tsx   "Request a change" (S-10), the owning organiser's form
//   src/app/events/[id]/page.tsx                  the "Request a change" button and the "Change requests" card
//   src/app/change-requests/page.tsx              "Change Requests", the coordinator's pending requests
// Wording decided for this story: docs/test-cases/SPM-35_test_cases.json open_questions.

import { describe, it, expect } from "vitest";
import RequestChangePage from "@/app/events/[id]/change-request/page";
import EventOverviewPage from "@/app/events/[id]/page";
import ChangeRequestsPage from "@/app/change-requests/page";
import { ROLES } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { fireEvent, mockApi, render, reply, router, screen, setRoute, signedInAs, signedOut, userEvent, waitFor, within } from "@/test/ui";

const REF = "EVT-000007";
const EVENT = `GET /api/events/${REF}`;
const SEND = `POST /api/events/${REF}/change-requests`;
const LIST = `GET /api/events/${REF}/change-requests`;
const MINE = "GET /api/change-requests";
const OWNER = { id: "rachel" };
const iso = (local: string) => new Date(local).toISOString();

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "SPM35 Harbour Townhall",
    category: "meeting",
    purpose: "Quarterly all-hands",
    description: "Leadership update and Q&A.",
    status: "approved",
    startsAt: iso("2027-04-12T09:00"),
    endsAt: iso("2027-04-12T12:00"),
    expectedAttendance: 80,
    preferredLayout: "theatre",
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    organiserId: "rachel",
    organisationId: "org-id",
    coordinatorId: "daniel",
    facilityRequirements: [{ facilityId: "f-stage", isMandatory: true, facility: { id: "f-stage", name: "Raised stage", category: "facility" } }],
    equipmentRequests: [],
    sessions: [],
    ...overrides,
  };
}

const facilities = [
  { id: "f-stage", name: "Raised stage", category: "facility" },
  { id: "f-loop", name: "Hearing induction loop", category: "accessibility" },
];

const described = (overrides: Record<string, unknown> = {}) => ({
  id: "cr-1",
  kind: "change",
  kindLabel: "Change of details",
  status: "pending",
  reason: "We are presenting the staff awards at the townhall.",
  requestedAt: "2026-10-20T02:00:00.000Z",
  requestedBy: "Rachel Ng",
  important: false,
  affects: [],
  rows: [{ field: "title", label: "Event name", current: "SPM35 Harbour Townhall", proposed: "SPM35 Harbour Townhall and Awards" }],
  equipmentChanges: null,
  ...overrides,
});

describe("[SPM-35] Request a change", () => {
  function open(eventRow: unknown = event(), routes: Record<string, unknown> = {}, role = "organiser", who: object = OWNER) {
    setRoute(`/events/${REF}/change-request`, { id: REF });
    const api = mockApi({
      ...signedInAs(role, who),
      [EVENT]: eventRow,
      "GET /api/facilities": facilities,
      [SEND]: described(),
      ...routes,
    });
    render(<RequestChangePage />);
    return api;
  }
  const form = () => screen.findByRole("radiogroup", { name: "What do you need?" });
  const reason = () => screen.getByLabelText(/Reason for the change/);
  const send = () => userEvent.click(screen.getByRole("button", { name: "Send change request" }));

  it("sends an anonymous visitor to log in, remembering the page", async () => {
    setRoute(`/events/${REF}/change-request`, { id: REF });
    mockApi(signedOut());

    render(<RequestChangePage />);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fchange-request"));
  });

  it("[AC1] opens on a change of details, filled in with the event's present values", async () => {
    open();

    expect(await form()).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Change the event's details" })).toBeChecked();
    expect(screen.getByLabelText(/Event name/)).toHaveValue("SPM35 Harbour Townhall");
    expect(screen.getByLabelText(/Expected attendance/)).toHaveValue(80);
    expect(screen.getByLabelText("Equipment changes")).toHaveValue("");
    expect(reason()).toHaveValue("");
  });

  it.each([
    ["a colleague who does not own it", "organiser", { id: "james" }, "Only the organiser who owns this event can request a change."],
    ["the coordinator", "coordinator", { id: "daniel" }, "Only the organiser who owns this event can request a change."],
  ])("[AC1] refuses %s, with no form", async (_, role, who, message) => {
    open(event(), {}, role, who);

    expect(await screen.findByText("You can't request a change to this event")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send change request" })).not.toBeInTheDocument();
  });

  it.each(["submitted", "under_review", "cancelled"])("[AC1] refuses while the event is %s", async (status) => {
    open(event({ status }));

    expect(
      await screen.findByText(
        "A change can only be requested while the event is Approved, Planning, Safety review, Safety approved, Confirmed or Postponed."
      )
    ).toBeInTheDocument();
  });

  it("[AC1][AC2] sends only the fields changed, the equipment change and the reason", async () => {
    const api = open();
    await form();

    fireEvent.change(screen.getByLabelText(/Event name/), { target: { value: "SPM35 Harbour Townhall and Awards" } });
    fireEvent.change(screen.getByLabelText(/Expected attendance/), { target: { value: "95" } });
    fireEvent.change(screen.getByLabelText("Equipment changes"), { target: { value: "A second lectern" } });
    fireEvent.change(reason(), { target: { value: "We are presenting the staff awards." } });
    await send();

    expect(await screen.findByText("Change request sent to your coordinator.")).toBeInTheDocument();
    expect(screen.getByText("Nothing about the event changes until your coordinator processes the request.")).toBeInTheDocument();
    expect(api.sent(SEND).map((c) => c.body)).toEqual([
      {
        kind: "change",
        reason: "We are presenting the staff awards.",
        changes: { title: "SPM35 Harbour Townhall and Awards", expectedAttendance: 95 },
        equipmentChanges: "A second lectern",
      },
    ]);
    expect(screen.getByRole("link", { name: "Back to event" })).toHaveAttribute("href", `/events/${REF}`);
  });

  it("[AC1] can propose every detail Update Event Information edits", async () => {
    const api = open();
    await form();

    fireEvent.change(screen.getByLabelText(/Type of event/), { target: { value: "conference" } });
    fireEvent.change(screen.getByLabelText(/Purpose/), { target: { value: "All-hands and awards" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Leadership update, Q&A and awards." } });
    fireEvent.change(screen.getByLabelText(/Starts at/), { target: { value: "2027-04-19T09:00" } });
    fireEvent.change(screen.getByLabelText(/Ends at/), { target: { value: "2027-04-19T12:00" } });
    fireEvent.change(screen.getByLabelText(/Preferred room layout/), { target: { value: "banquet" } });
    fireEvent.change(screen.getByLabelText(/Other accessibility notes/), { target: { value: "Two wheelchair users" } });
    fireEvent.change(screen.getByLabelText(/Anything else about the space/), { target: { value: "A lectern" } });
    fireEvent.change(reason(), { target: { value: "The awards are moving to the townhall." } });
    await send();

    await screen.findByText("Change request sent to your coordinator.");
    expect(api.sent(SEND)[0].body).toMatchObject({
      changes: {
        category: "conference",
        purpose: "All-hands and awards",
        description: "Leadership update, Q&A and awards.",
        startsAt: iso("2027-04-19T09:00"),
        endsAt: iso("2027-04-19T12:00"),
        preferredLayout: "banquet",
        accessibilityNotes: "Two wheelchair users",
        specialRequirements: "A lectern",
      },
    });
  });

  it("[AC1] can propose dropping a facility the event has", async () => {
    const api = open();
    await form();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Raised stage" }));
    fireEvent.change(reason(), { target: { value: "No speeches after all." } });
    await send();

    await screen.findByText("Change request sent to your coordinator.");
    expect(api.sent(SEND)[0].body).toMatchObject({ changes: { facilityIds: [] } });
  });

  it("[AC1] sends a new set of facilities", async () => {
    const api = open();
    await form();

    await userEvent.click(await screen.findByRole("checkbox", { name: "Hearing induction loop" }));
    fireEvent.change(reason(), { target: { value: "A guest uses a hearing aid." } });
    await send();

    await screen.findByText("Change request sent to your coordinator.");
    expect(api.sent(SEND)[0].body).toMatchObject({ changes: { facilityIds: ["f-stage", "f-loop"] } });
  });

  it("[AC3] refuses to send without a reason", async () => {
    const api = open();
    await form();

    fireEvent.change(screen.getByLabelText(/Expected attendance/), { target: { value: "95" } });
    fireEvent.change(reason(), { target: { value: "   " } });
    await send();

    expect(await screen.findByText("Give a reason for the change.")).toBeInTheDocument();
    expect(api.sent(SEND)).toHaveLength(0);
  });

  it("clears the reason's error once a reason is typed", async () => {
    open();
    await form();
    await send();
    expect(await screen.findByText("Give a reason for the change.")).toBeInTheDocument();

    fireEvent.change(reason(), { target: { value: "Because" } });

    expect(screen.queryByText("Give a reason for the change.")).not.toBeInTheDocument();
  });

  it("refuses to send a change of details that changes nothing", async () => {
    const api = open();
    await form();

    fireEvent.change(reason(), { target: { value: "Just checking the form." } });
    await send();

    expect(await screen.findByText("Change at least one detail, or describe the equipment change.")).toBeInTheDocument();
    expect(api.sent(SEND)).toHaveLength(0);
  });

  it("checks the details as Edit event information does", async () => {
    const api = open();
    await form();

    fireEvent.change(screen.getByLabelText(/Event name/), { target: { value: " " } });
    fireEvent.change(reason(), { target: { value: "x" } });
    await send();

    expect(await screen.findByText("Give the event a name so you can find it again.")).toBeInTheDocument();
    expect(api.sent(SEND)).toHaveLength(0);
  });

  it.each([
    ["postpone", "Postpone the event", "Your coordinator decides whether to postpone the event. It stays Confirmed until then."],
    ["cancel", "Cancel the event", "Your coordinator decides whether to cancel the event. It stays Confirmed until then."],
  ])("[AC5] asks to %s with a reason alone", async (kind, label, note) => {
    const api = open(event({ status: "confirmed" }));
    await form();

    await userEvent.click(screen.getByRole("radio", { name: label }));

    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Event name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Equipment changes")).not.toBeInTheDocument();

    fireEvent.change(reason(), { target: { value: "The client has withdrawn its sponsorship." } });
    await send();

    await screen.findByText("Change request sent to your coordinator.");
    expect(api.sent(SEND).map((c) => c.body)).toEqual([{ kind, reason: "The client has withdrawn its sponsorship." }]);
  });

  it("[AC3] a postponement still needs a reason", async () => {
    const api = open(event({ status: "confirmed" }));
    await form();

    await userEvent.click(screen.getByRole("radio", { name: "Postpone the event" }));
    await send();

    expect(await screen.findByText("Give a reason for the change.")).toBeInTheDocument();
    expect(api.sent(SEND)).toHaveLength(0);
  });

  it("does not offer a multi-session event's times and attendance", async () => {
    open(
      event({
        sessions: [
          { id: "s1", label: "Day 1", startsAt: iso("2027-04-12T09:00"), endsAt: iso("2027-04-12T12:00"), expectedAttendance: 80 },
          { id: "s2", label: null, startsAt: iso("2027-04-13T09:00"), endsAt: iso("2027-04-13T12:00"), expectedAttendance: 60 },
        ],
      })
    );
    await form();

    expect(
      screen.getByText("Session times and attendance can't be changed here yet - describe the change in Reason for the change.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Starts at/)).not.toBeInTheDocument();
    expect(screen.getByText(/Day 1:/)).toBeInTheDocument();
  });

  it("shows the server's refusal under its field and keeps the form", async () => {
    open(event(), {
      [SEND]: reply(400, { error: "Ends at must be after starts at.", details: { fieldErrors: { endsAt: ["Ends at must be after starts at."] } } }),
    });
    await form();

    fireEvent.change(screen.getByLabelText(/Expected attendance/), { target: { value: "95" } });
    fireEvent.change(reason(), { target: { value: "x" } });
    await send();

    expect(await screen.findAllByText("Ends at must be after starts at.")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Send change request" })).toBeInTheDocument();
  });

  it.each([
    ["answers with no reason", reply(500), "Could not send the change request."],
    ["cannot be reached", () => { throw new TypeError("Failed to fetch"); }, "Could not reach the server. Check your connection and try again."],
  ])("says so when the server %s", async (_, answer, message) => {
    open(event(), { [SEND]: answer });
    await form();

    fireEvent.change(screen.getByLabelText(/Expected attendance/), { target: { value: "95" } });
    fireEvent.change(reason(), { target: { value: "x" } });
    await send();

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("sends the user to log in when their session ends while sending", async () => {
    open(event(), { [SEND]: reply(401, {}) });
    await form();

    fireEvent.change(screen.getByLabelText(/Expected attendance/), { target: { value: "95" } });
    fireEvent.change(reason(), { target: { value: "x" } });
    await send();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fchange-request"));
  });

  it("goes back to the event without sending anything", async () => {
    const api = open();
    await form();

    await userEvent.click(screen.getByRole("button", { name: "Back to event" }));

    expect(router.push).toHaveBeenCalledWith(`/events/${REF}`);
    expect(api.sent(SEND)).toHaveLength(0);
  });

  it.each([
    ["is not found", reply(404, {}), "This event doesn't exist, or you don't have access to it."],
    ["fails", reply(500, {}), "Could not load this event."],
    ["cannot be reached", () => { throw new TypeError("Failed to fetch"); }, "Could not reach the server. Check your connection and try again."],
  ])("says so when the event %s, and retries", async (_, answer, message) => {
    const api = open(answer);

    expect(await screen.findByText(message)).toBeInTheDocument();
    api.on(EVENT, event());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await form()).toBeInTheDocument();
  });

  it("sends the user to log in when their session has ended before the event loads", async () => {
    open(reply(401, {}));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fevents%2FEVT-000007%2Fchange-request"));
  });

  it.each([
    ["cannot be reached", () => { throw new TypeError("Failed to fetch"); }],
    ["fail to load", reply(500, {})],
  ])("still works when the facilities %s", async (_, answer) => {
    open(event(), { "GET /api/facilities": answer });
    expect(await form()).toBeInTheDocument();
  });
});

describe("[SPM-35] the event page", () => {
  function open(role: string, eventRow: unknown, who: object, routes: Record<string, unknown> = {}) {
    setRoute(`/events/${REF}`, { id: REF });
    const api = mockApi({ ...signedInAs(role, who), [EVENT]: eventRow, "GET /api/assignments": { coordinators: [] }, ...routes });
    render(<EventOverviewPage />);
    return api;
  }
  const heading = () => screen.findByRole("heading", { level: 1, name: "SPM35 Harbour Townhall" });

  it.each(["approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"])(
    "[AC1] offers the owning organiser 'Request a change' while the event is %s",
    async (status) => {
      open("organiser", event({ status }), OWNER);
      await heading();

      expect(screen.getByRole("link", { name: "Request a change" })).toHaveAttribute("href", `/events/${REF}/change-request`);
    }
  );

  it.each([
    ["the owner, while it is Under review", "organiser", OWNER, "under_review"],
    ["the owner, once it is Cancelled", "organiser", OWNER, "cancelled"],
    ["a colleague who does not own it", "organiser", { id: "james" }, "approved"],
    ["the coordinator", "coordinator", { id: "daniel" }, "approved"],
  ])("[AC1] does not offer it to %s", async (_, role, who, status) => {
    open(role, event({ status }), who);
    await heading();

    expect(screen.queryByRole("link", { name: "Request a change" })).not.toBeInTheDocument();
  });

  it("[AC2][AC4] lists the event's change requests when it has some", async () => {
    open("organiser", event({ changeRequestCount: 2 }), OWNER, {
      [LIST]: [
        described({ id: "cr-2", important: true, affects: ["Date and time"], rows: [
          { field: "startsAt", label: "Starts at", current: "12 Apr 2027, 09:00", proposed: "19 Apr 2027, 09:00" },
        ], equipmentChanges: "One more projector" }),
        described(),
      ],
    });

    const card = (await screen.findByRole("heading", { name: "Change requests" })).closest("div.rounded-lg") as HTMLElement;
    const [important, plain] = await within(card).findAllByRole("listitem");

    expect(within(important).getByText("Important")).toBeInTheDocument();
    expect(important).toHaveTextContent("Affects existing arrangements: Date and time.");
    expect(important).toHaveTextContent("Starts at12 Apr 2027, 09:0019 Apr 2027, 09:00");
    expect(important).toHaveTextContent("Equipment: One more projector");
    expect(within(plain).queryByText("Important")).not.toBeInTheDocument();
    expect(plain).toHaveTextContent("Change of details");
    expect(plain).toHaveTextContent("Pending");
    expect(plain).toHaveTextContent("Requested by Rachel Ng on 20 Oct 2026, 10:00");
    expect(plain).toHaveTextContent("Reason: We are presenting the staff awards at the townhall.");
    expect(within(plain).getByRole("columnheader", { name: "Current" })).toBeInTheDocument();
    expect(plain).toHaveTextContent("Event nameSPM35 Harbour TownhallSPM35 Harbour Townhall and Awards");
  });

  it("[AC5] shows a postponement as its reason alone", async () => {
    open("organiser", event({ changeRequestCount: 1 }), OWNER, {
      [LIST]: [described({ kind: "postpone", kindLabel: "Postponement", rows: [], reason: "Speaker unwell." })],
    });

    const item = await screen.findByText("Postponement");
    const row = item.closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Reason: Speaker unwell.");
    expect(within(row).queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not ask for change requests when the event has none", async () => {
    const api = open("organiser", event(), OWNER);
    await heading();

    expect(screen.queryByRole("heading", { name: "Change requests" })).not.toBeInTheDocument();
    expect(api.sent(LIST)).toHaveLength(0);
  });

  it("says so when the change requests cannot be loaded, and retries", async () => {
    const api = open("organiser", event({ changeRequestCount: 1 }), OWNER, { [LIST]: reply(500, {}) });

    expect(await screen.findByText("Could not load the change requests.")).toBeInTheDocument();
    api.on(LIST, [described()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Change of details")).toBeInTheDocument();
  });
});

describe("[SPM-35][AC4] Change Requests", () => {
  function open(routes: Record<string, unknown> = {}) {
    setRoute("/change-requests");
    const api = mockApi({ ...signedInAs("coordinator", { id: "daniel" }), [MINE]: [], ...routes });
    render(<ChangeRequestsPage />);
    return api;
  }

  it.each(ROLES.filter((role) => !can(role, "event:confirm")))("refuses %s without asking for the requests", async (role) => {
    setRoute("/change-requests");
    const api = mockApi(signedInAs(role));

    render(<ChangeRequestsPage />);

    expect(await screen.findByText("You do not have access to this")).toBeInTheDocument();
    expect(api.sent(MINE)).toHaveLength(0);
  });

  it("lists the pending requests with their event, marking the Important ones", async () => {
    open({
      [MINE]: [
        { ...described({ id: "cr-2", important: true, affects: ["Expected attendance"] }), event: { reference: REF, title: "SPM35 Requests Showcase", status: "confirmed" } },
        { ...described(), event: { reference: REF, title: null, status: "confirmed" } },
      ],
    });

    expect(await screen.findByRole("heading", { name: "Change Requests" })).toBeInTheDocument();
    const [important, plain] = await screen.findAllByRole("listitem");
    expect(important).toHaveTextContent(`for ${REF} SPM35 Requests Showcase`);
    expect(within(important).getByRole("link", { name: REF })).toHaveAttribute("href", `/events/${REF}`);
    expect(within(important).getByText("Important")).toBeInTheDocument();
    expect(plain).toHaveTextContent("Untitled event");
    expect(within(plain).queryByText("Important")).not.toBeInTheDocument();
  });

  it("says when nothing is waiting", async () => {
    open();
    expect(await screen.findByText("No change requests waiting")).toBeInTheDocument();
  });

  it("says so when the requests cannot be loaded, and retries", async () => {
    const api = open({ [MINE]: reply(500, {}) });

    expect(await screen.findByText("Could not load the change requests.")).toBeInTheDocument();
    api.on(MINE, []);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No change requests waiting")).toBeInTheDocument();
  });

  it("sends the user to log in when their session has ended", async () => {
    open({ [MINE]: reply(401, {}) });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/login?next=%2Fchange-requests"));
  });
});
