// @vitest-environment jsdom
//
// SPM-32 Process Event Change Request - the screens:
//   src/app/events/[id]/change-requests/[requestId]/page.tsx   "Review change request" (S-17)
//   src/components/ChangeRequestList.tsx                       each field's outcome, and the Review link
//   src/app/change-requests/page.tsx, src/app/events/[id]/page.tsx   where the Review link appears
// Wording decided for this story: docs/test-cases/SPM-32_test_cases.json open_questions.

import { describe, it, expect } from "vitest";
import ReviewPage from "@/app/events/[id]/change-requests/[requestId]/page";
import ChangeRequestsPage from "@/app/change-requests/page";
import EventOverviewPage from "@/app/events/[id]/page";
import { fireEvent, mockApi, render, reply, router, screen, setRoute, signedInAs, signedOut, userEvent, waitFor, within } from "@/test/ui";

const REF = "EVT-000007";
const RID = "cr-1";
const EVENT = `GET /api/events/${REF}`;
const LIST = `GET /api/events/${REF}/change-requests`;
const SAVE = `POST /api/events/${REF}/change-requests/${RID}/decision`;
const DANIEL = { id: "daniel" };

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-id",
    sequenceNumber: 7,
    title: "SPM32 Harbour Briefing",
    purpose: null,
    category: "meeting",
    status: "planning",
    startsAt: "2027-07-05T01:00:00.000Z",
    endsAt: "2027-07-05T04:00:00.000Z",
    organiserId: "rachel",
    organisationId: "org-id",
    coordinatorId: "daniel",
    ...overrides,
  };
}

const row = (field: string, label: string, current: string, proposed: string, extra: Record<string, unknown> = {}) => ({
  field, label, current, proposed, outcome: null, outcomeReason: null, ...extra,
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: RID,
    kind: "change",
    kindLabel: "Change of details",
    status: "pending",
    reason: "More clients have confirmed and we are adding lunch.",
    requestedAt: "2026-10-20T02:00:00.000Z",
    requestedBy: "Rachel Ng",
    important: true,
    affects: ["Expected attendance"],
    rows: [
      row("title", "Event name", "SPM32 Harbour Briefing", "SPM32 Harbour Briefing and Lunch"),
      row("expectedAttendance", "Expected attendance", "80", "110"),
    ],
    equipmentChanges: null,
    equipmentOutcome: null,
    equipmentOutcomeReason: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    ...overrides,
  };
}

const saved = (overrides: Record<string, unknown> = {}) => ({
  request: request({ status: "approved", reviewedBy: "Daniel Tan", reviewedAt: "2026-10-25T03:00:00.000Z" }),
  statusReverted: false,
  safetyCheckClosed: false,
  flagged: [],
  rescheduled: false,
  equipmentToDo: false,
  ...overrides,
});

function open(routes: Record<string, unknown> = {}, role = "coordinator", who: object = DANIEL) {
  setRoute(`/events/${REF}/change-requests/${RID}`, { id: REF, requestId: RID });
  const api = mockApi({ ...signedInAs(role, who), [EVENT]: event(), [LIST]: [request()], [SAVE]: saved(), ...routes });
  render(<ReviewPage />);
  return api;
}

/// The request has loaded: the heading alone shows while it is still loading.
const heading = () => screen.findByText(/^Requested by Rachel Ng on/);
const decide = (label: string, outcome: "Approve" | "Reject") =>
  userEvent.click(within(screen.getByRole("radiogroup", { name: label })).getByRole("radio", { name: outcome }));
const save = () => userEvent.click(screen.getByRole("button", { name: "Save decision" }));

describe("[SPM-32] Review change request", () => {
  it("sends an anonymous visitor to log in, remembering the page", async () => {
    setRoute(`/events/${REF}/change-requests/${RID}`, { id: REF, requestId: RID });
    mockApi(signedOut());
    render(<ReviewPage />);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/login?next=%2Fevents%2F${REF}%2Fchange-requests%2F${RID}`));
  });

  it("[AC2] shows what was asked for, with Approve and Reject for each field", async () => {
    open();
    await heading();

    expect(screen.getByText("Reason: More clients have confirmed and we are adding lunch.")).toBeInTheDocument();
    expect(screen.getByText("Affects existing arrangements: Expected attendance.")).toBeInTheDocument();
    expect(within(screen.getByRole("radiogroup", { name: "Event name" })).getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText("SPM32 Harbour Briefing and Lunch")).toBeInTheDocument();
    for (const name of ["Approve all", "Reject all", "Save decision"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("[AC3] asks for a reason only once a field is rejected", async () => {
    open();
    await heading();
    expect(screen.queryByLabelText(/Reason for rejecting/)).not.toBeInTheDocument();

    await decide("Event name", "Reject");

    expect(screen.getByLabelText(/Reason for rejecting/)).toBeInTheDocument();
  });

  it("[AC2][AC3] sends a partial decision, each rejection with its reason", async () => {
    const api = open();
    await heading();

    await decide("Event name", "Reject");
    fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "  The invitations have gone out.  " } });
    await decide("Expected attendance", "Approve");
    await save();

    expect(await screen.findByText("Change request processed.")).toBeInTheDocument();
    expect(api.sent(SAVE).map((c) => c.body)).toEqual([
      { decisions: { title: { outcome: "rejected", reason: "The invitations have gone out." }, expectedAttendance: { outcome: "approved" } } },
    ]);
    expect(screen.getByRole("link", { name: "Back to event" })).toHaveAttribute("href", `/events/${REF}`);
  });

  it("[AC2] sets every field at once with Approve all and Reject all", async () => {
    const api = open();
    await heading();

    await userEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(screen.getAllByLabelText(/Reason for rejecting/)).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    expect(screen.queryByLabelText(/Reason for rejecting/)).not.toBeInTheDocument();
    await save();

    await screen.findByText("Change request processed.");
    expect(api.sent(SAVE)[0].body).toEqual({ decisions: { title: { outcome: "approved" }, expectedAttendance: { outcome: "approved" } } });
  });

  it("[AC2] keeps a field's reason when it is switched to Reject again", async () => {
    open();
    await heading();
    await decide("Event name", "Reject");
    fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "Printed already." } });
    await decide("Event name", "Approve");
    await decide("Event name", "Reject");

    expect(screen.getByLabelText(/Reason for rejecting/)).toHaveValue("Printed already.");
  });

  it("refuses to save while a field is undecided", async () => {
    const api = open();
    await heading();
    await decide("Event name", "Approve");
    await save();

    expect(await screen.findByText("Approve or reject every change before saving.")).toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);
  });

  it("[AC3] refuses a rejection with no reason, naming the field, until one is typed", async () => {
    const api = open();
    await heading();
    await userEvent.click(screen.getByRole("button", { name: "Reject all" }));
    await save();

    expect(await screen.findByText("Give a reason for rejecting Event name.")).toBeInTheDocument();
    expect(screen.getByText("Give a reason for rejecting Expected attendance.")).toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);

    fireEvent.change(screen.getAllByLabelText(/Reason for rejecting/)[0], { target: { value: "No." } });
    expect(screen.queryByText("Give a reason for rejecting Event name.")).not.toBeInTheDocument();
  });

  it("[AC3] names a missing reason even while another field is undecided", async () => {
    const api = open();
    await heading();
    await decide("Event name", "Reject");
    await save();

    expect(await screen.findByText("Give a reason for rejecting Event name.")).toBeInTheDocument();
    expect(screen.getByText("Approve or reject every change before saving.")).toBeInTheDocument();
    expect(api.sent(SAVE)).toHaveLength(0);
  });

  it("[AC4] asks first when approving would move a Confirmed event back to Planning", async () => {
    const api = open({ [EVENT]: event({ status: "confirmed" }) });
    await heading();
    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await save();

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toHaveTextContent(
      "SPM32 Harbour Briefing is Confirmed. Saving these changes moves it back to Planning, where it needs a new safety check before it can be confirmed again."
    );
    expect(api.sent(SAVE)).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing", hidden: true }));
    expect(api.sent(SAVE)).toHaveLength(0);

    await save();
    await userEvent.click(within(screen.getByRole("dialog", { hidden: true })).getByRole("button", { name: "Save and move to Planning", hidden: true }));
    await screen.findByText("Change request processed.");
    expect(api.sent(SAVE)).toHaveLength(1);
  });

  it("does not ask when only unimportant fields are approved on a Confirmed event", async () => {
    const api = open({ [EVENT]: event({ status: "confirmed" }) });
    await heading();
    await decide("Event name", "Approve");
    await decide("Expected attendance", "Reject");
    fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "No room." } });
    await save();

    await screen.findByText("Change request processed.");
    expect(api.sent(SAVE)).toHaveLength(1);
  });

  it("[AC4] shows what the approval flagged and that the event is back in Planning", async () => {
    open({
      [EVENT]: event({ status: "confirmed" }),
      [SAVE]: saved({ statusReverted: true, flagged: ["Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed"] }),
    });
    await heading();
    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await save();
    await userEvent.click(within(screen.getByRole("dialog", { hidden: true })).getByRole("button", { name: "Save and move to Planning", hidden: true }));

    expect(await screen.findByText("Flagged for review")).toBeInTheDocument();
    expect(screen.getByText("Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed")).toBeInTheDocument();
    expect(screen.getByText(/The event is back in Planning/)).toBeInTheDocument();
  });

  it("[AC5] notes that approving a Postponed event's new date moves it to Approved, and says so afterwards", async () => {
    open({
      [EVENT]: event({ status: "postponed" }),
      [LIST]: [request({ rows: [row("startsAt", "Starts at", "26 Jul 2027, 10:00", "23 Aug 2027, 10:00")] })],
      [SAVE]: saved({ rescheduled: true }),
    });
    await heading();

    expect(screen.getByText("This event is Postponed. Approving its new date moves it to Approved, ready for planning again.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await save();

    expect(await screen.findByText("The event has moved from Postponed to Approved.")).toBeInTheDocument();
  });

  it("[AC5] makes no Postponed note when the request leaves the date alone", async () => {
    open({ [EVENT]: event({ status: "postponed" }) });
    await heading();

    expect(screen.queryByText(/This event is Postponed/)).not.toBeInTheDocument();
  });

  it("decides the equipment change as an item of its own, and says to update the Equipment tab", async () => {
    const api = open({
      [LIST]: [request({ rows: [], equipmentChanges: "Two more microphones" })],
      [SAVE]: saved({ equipmentToDo: true }),
    });
    await heading();

    await decide("Equipment changes", "Approve");
    await save();

    expect(await screen.findByText("Update the Equipment tab to match the approved equipment change.")).toBeInTheDocument();
    expect(api.sent(SAVE)[0].body).toEqual({ decisions: { equipment: { outcome: "approved" } } });
  });

  it("[AC7] shows a request another coordinator decided meanwhile, as it now is", async () => {
    const api = open({ [SAVE]: reply(409, { error: "This change request has already been processed." }) });
    await heading();
    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    api.on(LIST, [request({ status: "approved", reviewedBy: "Daniel Tan", reviewedAt: "2026-10-25T03:00:00.000Z" })]);
    await save();

    expect(await screen.findByText("This change request has already been processed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save decision" })).not.toBeInTheDocument();
  });

  it.each([
    ["refuses with a field's reason", reply(400, { error: "Give a reason for rejecting Event name.", details: { fieldErrors: { title: ["Give a reason for rejecting Event name."] } } }), "Give a reason for rejecting Event name."],
    ["answers with no reason", reply(500), "Could not save the decision."],
    ["cannot be reached", () => { throw new TypeError("Failed to fetch"); }, "Could not reach the server. Check your connection and try again."],
  ])("says so when the server %s", async (_, answer, message) => {
    open({ [SAVE]: answer });
    await heading();
    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await save();

    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
  });

  it("sends the user to log in when their session ends while saving", async () => {
    open({ [SAVE]: reply(401, {}) });
    await heading();
    await userEvent.click(screen.getByRole("button", { name: "Approve all" }));
    await save();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/login?next=%2Fevents%2F${REF}%2Fchange-requests%2F${RID}`));
  });

  it("[AC7] opens a processed request read-only, with each outcome", async () => {
    open({
      [LIST]: [
        request({
          status: "partially_approved",
          reviewedBy: "Daniel Tan",
          reviewedAt: "2026-10-25T03:00:00.000Z",
          rows: [
            row("title", "Event name", "A", "B", { outcome: "rejected", outcomeReason: "Printed already." }),
            row("expectedAttendance", "Expected attendance", "80", "110", { outcome: "approved" }),
          ],
        }),
      ],
    });

    expect(await screen.findByText("This change request has already been processed.")).toBeInTheDocument();
    expect(screen.getByText("Partly approved")).toBeInTheDocument();
    expect(screen.getByText("Rejected: Printed already.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save decision" })).not.toBeInTheDocument();
  });

  it.each([
    ["another coordinator", "coordinator", { id: "priya" }],
    ["the organiser", "organiser", { id: "rachel" }],
  ])("[AC1] refuses %s, with no decision to make", async (_, role, who) => {
    open({}, role, who);

    expect(await screen.findByText("You can't review this change request")).toBeInTheDocument();
    expect(screen.getByText("Only the coordinator assigned to this event can process its change requests.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save decision" })).not.toBeInTheDocument();
  });

  it("says a request that is not the event's does not exist", async () => {
    open({ [LIST]: [request({ id: "someone-else" })] });
    expect(await screen.findByText("This change request doesn't exist, or you don't have access to it.")).toBeInTheDocument();
  });

  it("says an event the user can't see does not exist", async () => {
    open({ [EVENT]: reply(404, {}) });
    expect(await screen.findByText("This change request doesn't exist, or you don't have access to it.")).toBeInTheDocument();
  });

  it.each([
    ["fails", reply(500, {})],
    ["cannot be reached", () => { throw new TypeError("Failed to fetch"); }],
  ])("says so when loading %s, and retries", async (_, answer) => {
    const api = open({ [LIST]: answer });

    expect(await screen.findByText(/Could not (load this change request|reach the server)/)).toBeInTheDocument();
    api.on(LIST, [request()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("radiogroup", { name: "Event name" })).toBeInTheDocument();
  });

  it("sends the user to log in when their session has ended before loading", async () => {
    open({ [LIST]: reply(401, {}) });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/login?next=%2Fevents%2F${REF}%2Fchange-requests%2F${RID}`));
  });

  describe("a cancellation or postponement request", () => {
    const cancel = request({ kind: "cancel", kindLabel: "Cancellation", rows: [], important: false, affects: [], reason: "The client has withdrawn its budget." });

    it("[AC2] says how a cancellation is approved, and rejects it with a reason", async () => {
      const api = open({ [LIST]: [cancel], [SAVE]: saved({ request: { ...cancel, status: "rejected", reviewNotes: "Paid for already." } }) });
      await heading();

      expect(screen.getByText("To approve it, cancel the event: use Cancel event on its Overview.")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));
      expect(await screen.findByText("Give a reason for rejecting this request.")).toBeInTheDocument();
      expect(api.sent(SAVE)).toHaveLength(0);

      fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "  Paid for already.  " } });
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(await screen.findByText("Change request processed.")).toBeInTheDocument();
      expect(api.sent(SAVE)[0].body).toEqual({ outcome: "rejected", reason: "Paid for already." });
      expect(screen.getByText("Reason for rejecting: Paid for already.")).toBeInTheDocument();
    });

    it("[AC2] keeps the request open and says so when the rejection is not saved", async () => {
      open({ [LIST]: [cancel], [SAVE]: reply(500) });
      await heading();
      fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "Paid for already." } });
      await userEvent.click(screen.getByRole("button", { name: "Reject request" }));

      expect(await screen.findByText("Could not save the decision.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reject request" })).toBeInTheDocument();
    });

    it("[AC2] [SPM-38][AC2] says a postponement is approved by postponing the event", async () => {
      open({ [LIST]: [{ ...cancel, kind: "postpone", kindLabel: "Postponement" }] });
      await heading();

      expect(
        screen.getByText("To approve it, postpone the event: use Postpone event on its Overview.")
      ).toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    });
  });
});

describe("[SPM-32] where the Review link is", () => {
  it("[AC1] links each pending request on the Change Requests page to its review", async () => {
    setRoute("/change-requests");
    mockApi({
      ...signedInAs("coordinator", DANIEL),
      "GET /api/change-requests": [{ ...request(), event: { reference: REF, title: "SPM32 Harbour Briefing", status: "planning" } }],
    });
    render(<ChangeRequestsPage />);

    const item = (await screen.findAllByRole("listitem"))[0];
    expect(within(item).getByRole("link", { name: "Review" })).toHaveAttribute("href", `/events/${REF}/change-requests/${RID}`);
  });

  async function openEventAs(role: string, who: object, requests: object[]) {
    setRoute(`/events/${REF}`, { id: REF });
    mockApi({
      ...signedInAs(role, who),
      [EVENT]: { ...event(), changeRequestCount: requests.length },
      [LIST]: requests,
      "GET /api/assignments": { coordinators: [] },
    });
    render(<EventOverviewPage />);
    return within((await screen.findByRole("heading", { name: "Change requests" })).closest("div.rounded-lg") as HTMLElement);
  }

  it("[AC1] offers the assigned coordinator Review on a pending request on the event", async () => {
    const card = await openEventAs("coordinator", DANIEL, [request()]);
    expect(await card.findByRole("link", { name: "Review" })).toHaveAttribute("href", `/events/${REF}/change-requests/${RID}`);
  });

  it.each([
    ["another coordinator", "coordinator", { id: "priya" }],
    ["the organiser", "organiser", { id: "rachel" }],
  ])("[AC1] offers %s no Review link", async (_, role, who) => {
    const card = await openEventAs(role, who, [request()]);
    await card.findByText("Change of details");
    expect(card.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
  });

  it("[AC3][AC7] shows the organiser each field's outcome, who processed it, and no Review link", async () => {
    const card = await openEventAs("organiser", { id: "rachel" }, [
      request({
        status: "partially_approved",
        reviewedBy: "Daniel Tan",
        reviewedAt: "2026-10-25T03:00:00.000Z",
        rows: [
          row("title", "Event name", "SPM32 Harbour Briefing", "SPM32 Harbour Briefing and Lunch", { outcome: "rejected", outcomeReason: "The invitations have gone out." }),
          row("expectedAttendance", "Expected attendance", "80", "110", { outcome: "approved" }),
        ],
        equipmentChanges: "A lectern",
        equipmentOutcome: "rejected",
        equipmentOutcomeReason: "None free.",
      }),
    ]);

    expect(await card.findByText("Partly approved")).toBeInTheDocument();
    expect(card.getByText("Processed by Daniel Tan on 25 Oct 2026, 11:00")).toBeInTheDocument();
    expect(card.getByRole("columnheader", { name: "Outcome" })).toBeInTheDocument();
    expect(card.getByText("Rejected: The invitations have gone out.")).toBeInTheDocument();
    expect(card.getByText("Approved")).toBeInTheDocument();
    expect(card.getByText("Equipment: A lectern (Rejected: None free.)")).toBeInTheDocument();
    expect(card.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
  });

  it("shows why a request was closed, and an approved one with no reason", async () => {
    const card = await openEventAs("organiser", { id: "rachel" }, [
      request({ status: "withdrawn", reviewNotes: "Closed because the event was cancelled.", reviewedBy: "Daniel Tan", reviewedAt: "2026-10-25T03:00:00.000Z" }),
      request({
        id: "cr-2",
        status: "approved",
        rows: [row("title", "Event name", "A", "B", { outcome: "approved" })],
        equipmentChanges: "A lectern",
        equipmentOutcome: "approved",
      }),
    ]);

    expect(await card.findByText("Closed because the event was cancelled.")).toBeInTheDocument();
    expect(card.getByText("Equipment: A lectern (Approved)")).toBeInTheDocument();
  });

  it("shows a rejected field that has no reason recorded as Rejected", async () => {
    const card = await openEventAs("organiser", { id: "rachel" }, [
      request({ status: "rejected", rows: [row("title", "Event name", "A", "B", { outcome: "rejected" })] }),
    ]);
    expect(await card.findByText("Rejected", { selector: "td" })).toBeInTheDocument();
  });
});
