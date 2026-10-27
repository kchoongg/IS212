// SPM-32 Process Event Change Request - the route (written test-first):
//   src/app/api/events/[id]/change-requests/[requestId]/decision/route.ts   exports POST
//
//   POST /api/events/EVT-000007/change-requests/<request id>/decision
//     change of details:          { decisions: { "<field>" | "equipment": { outcome: "approved" | "rejected", reason? } } }
//     postponement, cancellation: { outcome: "rejected", reason }
//   -> 401 no session; 404 unseen event, or a request that is not this event's;
//      403 "Only the coordinator assigned to this event can process its change requests.";
//      409 "This change request has already been processed." (AC7) - also when another save got there first;
//      400 "Approve or reject every change before saving." / "Give a reason for rejecting <label>." (+ details.fieldErrors);
//      400 "This event is <status>, so its changes can no longer be approved.";
//      400 "With these decisions the event would end before it starts. …" / SPM-62's registration message;
//      400 approving a cancellation ("To approve it, cancel the event …") or a postponement ("Postponing an event isn't available yet …");
//      400 "Give a reason for rejecting this request."; 400 "Validation failed";
//      200 { request, statusReverted, safetyCheckClosed, flagged, rescheduled, equipmentToDo }; 500.
//   Writes, in one transaction: eventChangeRequest.updateMany({ where: { id, status: "pending" } }) first,
//   then applyEventInformation() with the approved fields (SPM-62's rules, AC4), then - for a Postponed
//   event given a new date - event.updateMany to Approved with a status history row (AC5).
//   No notifications: telling the organiser is Receive Event Notifications (SPM-53).
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { POST } from "@/app/api/events/[id]/change-requests/[requestId]/decision/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const REQUEST_ID = ID.request;
const PATH = `/api/events/${REF}/change-requests/${REQUEST_ID}/decision`;
const coordinator = () => user("coordinator", { id: ID.otherUser, fullName: "Daniel Tan" });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM32 Harbour Briefing",
    category: "meeting",
    purpose: "Client briefing",
    description: "Quarterly briefing for wealth clients.",
    status: "planning",
    organiserId: ID.user,
    organisationId: ID.org,
    coordinatorId: ID.otherUser,
    startsAt: new Date("2027-07-05T01:00:00.000Z"),
    endsAt: new Date("2027-07-05T04:00:00.000Z"),
    expectedAttendance: 80,
    preferredLayout: "theatre",
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: false,
    registrationOpensAt: null,
    registrationClosesAt: null,
    registrationReviewReason: null,
    confirmedAt: null,
    facilityRequirements: [],
    ...overrides,
  };
}

const CHANGES = [
  { field: "title", current: "SPM32 Harbour Briefing", proposed: "SPM32 Harbour Briefing and Lunch" },
  { field: "expectedAttendance", current: 80, proposed: 110 },
];

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    eventId: ID.event,
    kind: "change",
    status: "pending",
    reason: "More clients have confirmed.",
    requestedAt: new Date("2026-10-20T02:00:00.000Z"),
    requester: { fullName: "Rachel Ng" },
    reviewer: null,
    changes: CHANGES,
    equipmentChanges: null,
    isSignificant: true,
    proposedStartsAt: null,
    proposedEndsAt: null,
    proposedAttendance: null,
    decisions: null,
    reviewNotes: null,
    reviewedAt: null,
    ...overrides,
  };
}

/// A save that claims the pending request, and reads it back as decided.
function givenSaveSucceeds(row = request()) {
  db.eventChangeRequest.updateMany.mockResolvedValue({ count: 1 });
  db.event.update.mockResolvedValue({});
  db.event.updateMany.mockResolvedValue({ count: 1 });
  db.eventChangeRequest.findUnique.mockImplementation(async () => {
    const saved = callArg(db.eventChangeRequest.updateMany)?.data;
    return saved ? { ...row, ...saved, reviewer: { fullName: "Daniel Tan" } } : row;
  });
}

async function decide(body: unknown, { as = coordinator(), ev = event(), row = request() } = {}) {
  const token = signIn(as);
  db.event.findUnique.mockResolvedValue(ev);
  givenSaveSucceeds(row);
  return POST(req("POST", PATH, { token, body }), params({ id: REF, requestId: REQUEST_ID }));
}

const approveBoth = { decisions: { title: { outcome: "approved" }, expectedAttendance: { outcome: "approved" } } };
const nothingWritten = () => {
  expect(db.eventChangeRequest.updateMany).not.toHaveBeenCalled();
  expect(db.event.update).not.toHaveBeenCalled();
};

describe("[SPM-32] POST …/change-requests/[requestId]/decision", () => {
  // What applyEventInformation (SPM-62) reads for an important change: nothing
  // arranged yet, unless a test says otherwise.
  beforeEach(() => {
    db.venueBooking.findMany.mockResolvedValue([]);
    db.equipmentRequest.findMany.mockResolvedValue([]);
    db.registration.count.mockResolvedValue(0);
    db.safetyCheck.updateMany.mockResolvedValue({ count: 0 });
  });

  it("refuses a caller with no session", async () => {
    const res = await POST(req("POST", PATH, { body: approveBoth }), params({ id: REF, requestId: REQUEST_ID }));
    expect(res.status).toBe(401);
  });

  it("answers 404 for an event the caller cannot see", async () => {
    const res = await decide(approveBoth, { as: user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }) });
    expect(res.status).toBe(404);
    nothingWritten();
  });

  it("answers 404 for an event reference that is not one", async () => {
    const token = signIn(coordinator());
    const res = await POST(req("POST", PATH, { token, body: approveBoth }), params({ id: "not-an-event", requestId: REQUEST_ID }));
    expect(res.status).toBe(404);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("answers 404 for a request that belongs to another event", async () => {
    const res = await decide(approveBoth, { row: request({ eventId: "another-event" }) });
    expect(res.status).toBe(404);
    nothingWritten();
  });

  it("answers 404 for a request that does not exist", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());
    db.eventChangeRequest.findUnique.mockResolvedValue(null);
    const res = await POST(req("POST", PATH, { token, body: approveBoth }), params({ id: REF, requestId: REQUEST_ID }));
    expect(res.status).toBe(404);
  });

  it.each([
    ["another coordinator", () => user("coordinator", { id: ID.thirdUser })],
    ["the organiser who raised it", () => user("organiser", { id: ID.user })],
    ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
  ])("[AC1] refuses %s", async (_, who) => {
    const res = await decide(approveBoth, { as: who() });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only the coordinator assigned to this event can process its change requests.");
    nothingWritten();
  });

  it.each(["approved", "rejected", "partially_approved", "withdrawn"])("[AC7] refuses a request that is already %s", async (status) => {
    const res = await decide(approveBoth, { row: request({ status }) });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This change request has already been processed.");
    nothingWritten();
  });

  it("[AC7] refuses a save another coordinator's save got to first, writing nothing to the event", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(event());
    db.eventChangeRequest.findUnique.mockResolvedValue(request());
    db.eventChangeRequest.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(req("POST", PATH, { token, body: approveBoth }), params({ id: REF, requestId: REQUEST_ID }));

    expect(res.status).toBe(409);
    expect(db.event.update).not.toHaveBeenCalled();
  });

  it("[AC2][AC4] approving every change saves it as Approved and applies it with Update Event Information's rules", async () => {
    const res = await decide(approveBoth);

    expect(res.status).toBe(200);
    const claim = callArg(db.eventChangeRequest.updateMany);
    expect(claim.where).toEqual({ id: REQUEST_ID, status: "pending" });
    expect(claim.data).toMatchObject({
      status: "approved",
      decisions: { title: { outcome: "approved", reason: null }, expectedAttendance: { outcome: "approved", reason: null } },
      reviewedBy: ID.otherUser,
    });
    expect(claim.data.reviewedAt).toBeInstanceOf(Date);
    expect(callArg(db.event.update).data).toMatchObject({ title: "SPM32 Harbour Briefing and Lunch", expectedAttendance: 110 });
    const body = await res.json();
    expect(body).toMatchObject({ statusReverted: false, safetyCheckClosed: false, rescheduled: false, equipmentToDo: false });
    expect(body.request).toMatchObject({
      status: "approved",
      reviewedBy: "Daniel Tan",
      rows: [
        expect.objectContaining({ field: "title", outcome: "approved", outcomeReason: null }),
        expect.objectContaining({ field: "expectedAttendance", outcome: "approved" }),
      ],
    });
  });

  it("[AC3][AC6] a partial approval applies only the approved field and keeps each rejection's reason", async () => {
    const res = await decide({
      decisions: {
        title: { outcome: "rejected", reason: "  The invitations have gone out.  " },
        expectedAttendance: { outcome: "approved" },
      },
    });

    expect(res.status).toBe(200);
    expect(callArg(db.eventChangeRequest.updateMany).data).toMatchObject({
      status: "partially_approved",
      decisions: {
        title: { outcome: "rejected", reason: "The invitations have gone out." },
        expectedAttendance: { outcome: "approved", reason: null },
      },
    });
    const saved = callArg(db.event.update).data;
    expect(saved).toMatchObject({ expectedAttendance: 110 });
    expect(saved).not.toHaveProperty("title");
    expect((await res.json()).request.rows[0]).toMatchObject({ outcome: "rejected", outcomeReason: "The invitations have gone out." });
  });

  it("[AC6] rejecting every change saves it as Rejected and leaves the event alone", async () => {
    const res = await decide({
      decisions: { title: { outcome: "rejected", reason: "No." }, expectedAttendance: { outcome: "rejected", reason: "No room." } },
    });

    expect(res.status).toBe(200);
    expect(callArg(db.eventChangeRequest.updateMany).data.status).toBe("rejected");
    expect(db.event.update).not.toHaveBeenCalled();
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  });

  it("[AC4] moves a Confirmed event back to Planning and flags its booking when a new date is approved", async () => {
    db.venueBooking.findMany.mockResolvedValue([
      { id: ID.booking, status: "approved", endsAt: new Date("2027-07-12T14:00:00.000Z"), reviewReason: null, session: null, venue: { name: "Orchard Seminar Room", code: "ORC-SEM" } },
    ]);
    db.equipmentRequest.findMany.mockResolvedValue([]);
    db.registration.count.mockResolvedValue(0);
    const dates = [
      { field: "startsAt", current: "2027-07-12T10:00:00.000Z", proposed: "2027-07-19T10:00:00.000Z" },
      { field: "endsAt", current: "2027-07-12T14:00:00.000Z", proposed: "2027-07-19T14:00:00.000Z" },
    ];

    const res = await decide(
      { decisions: { startsAt: { outcome: "approved" }, endsAt: { outcome: "approved" } } },
      {
        ev: event({ status: "confirmed", startsAt: new Date("2027-07-12T10:00:00.000Z"), endsAt: new Date("2027-07-12T14:00:00.000Z") }),
        row: request({ changes: dates }),
      }
    );

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toMatchObject({ status: "planning", confirmedAt: null });
    expect(callArg(db.venueBooking.update).data).toMatchObject({ needsReview: true });
    expect(await res.json()).toMatchObject({
      statusReverted: true,
      flagged: ["Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed"],
    });
  });

  it("[AC5] approving a new date for a Postponed event applies it and moves the event to Approved", async () => {
    const dates = [
      { field: "startsAt", current: "2027-07-26T02:00:00.000Z", proposed: "2027-08-23T02:00:00.000Z" },
      { field: "endsAt", current: "2027-07-26T08:00:00.000Z", proposed: "2027-08-23T08:00:00.000Z" },
    ];

    const res = await decide(
      { decisions: { startsAt: { outcome: "approved" }, endsAt: { outcome: "approved" } } },
      {
        ev: event({ status: "postponed", startsAt: new Date("2027-07-26T02:00:00.000Z"), endsAt: new Date("2027-07-26T08:00:00.000Z") }),
        row: request({ changes: dates }),
      }
    );

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toMatchObject({
      startsAt: new Date("2027-08-23T02:00:00.000Z"),
      endsAt: new Date("2027-08-23T08:00:00.000Z"),
    });
    expect(callArg(db.event.updateMany)).toEqual({ where: { id: ID.event, status: "postponed" }, data: { status: "approved" } });
    expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
      eventId: ID.event,
      fromStatus: "postponed",
      toStatus: "approved",
      changedBy: ID.otherUser,
      reason: "Rescheduled: change request approved",
    });
    expect((await res.json()).rescheduled).toBe(true);
  });

  it("[AC5] leaves a Postponed event Postponed when its new date is rejected", async () => {
    const dates = [{ field: "startsAt", current: "2027-07-26T02:00:00.000Z", proposed: "2027-07-26T01:00:00.000Z" }];

    const res = await decide({ decisions: { startsAt: { outcome: "rejected", reason: "Not yet." } } }, {
      ev: event({ status: "postponed", startsAt: new Date("2027-07-26T02:00:00.000Z"), endsAt: new Date("2027-07-26T08:00:00.000Z") }),
      row: request({ changes: dates }),
    });

    expect(res.status).toBe(200);
    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect((await res.json()).rescheduled).toBe(false);
  });

  it("does not record a reschedule another change already made", async () => {
    const dates = [{ field: "startsAt", current: "2027-07-26T02:00:00.000Z", proposed: "2027-07-26T01:00:00.000Z" }];
    const token = signIn(coordinator());
    db.event.findUnique.mockResolvedValue(
      event({ status: "postponed", startsAt: new Date("2027-07-26T02:00:00.000Z"), endsAt: new Date("2027-07-26T08:00:00.000Z") })
    );
    givenSaveSucceeds(request({ changes: dates }));
    db.event.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(req("POST", PATH, { token, body: { decisions: { startsAt: { outcome: "approved" } } } }), params({ id: REF, requestId: REQUEST_ID }));

    expect((await res.json()).rescheduled).toBe(false);
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
  });

  it("records an approved equipment change and says to make it on the Equipment tab", async () => {
    const res = await decide({ decisions: { equipment: { outcome: "approved" } } }, {
      row: request({ changes: [], equipmentChanges: "Two more microphones" }),
    });

    expect(res.status).toBe(200);
    expect(callArg(db.eventChangeRequest.updateMany).data.decisions).toEqual({ equipment: { outcome: "approved", reason: null } });
    expect(db.event.update).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ equipmentToDo: true, request: { equipmentOutcome: "approved" } });
  });

  it("decides a request made before SPM-35 from its proposed attendance", async () => {
    const res = await decide({ decisions: { expectedAttendance: { outcome: "approved" } } }, {
      row: request({ changes: null, proposedAttendance: 120 }),
    });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toMatchObject({ expectedAttendance: 120 });
  });

  it.each([
    ["undecided", { decisions: { title: { outcome: "approved" } } }, "Approve or reject every change before saving."],
    ["rejected without a reason", { decisions: { title: { outcome: "rejected" }, expectedAttendance: { outcome: "approved" } } }, "Give a reason for rejecting Event name."],
    ["about a field it does not change", { decisions: { title: { outcome: "approved" }, expectedAttendance: { outcome: "approved" }, category: { outcome: "approved" } } }, "Type of event is not part of this change request."],
    ["without any decisions", {}, "Approve or reject every change before saving."],
  ])("[AC3] refuses a decision %s", async (_, body, error) => {
    const res = await decide(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    nothingWritten();
  });

  it("[AC3] names the rejected field that needs a reason", async () => {
    const res = await decide({ decisions: { title: { outcome: "rejected", reason: " " }, expectedAttendance: { outcome: "approved" } } });
    expect((await res.json()).details.fieldErrors).toEqual({ title: ["Give a reason for rejecting Event name."] });
  });

  it.each(["completed", "cancelled", "rejected", "withdrawn"])("refuses to approve a change once the event is %s, but lets it be rejected", async (status) => {
    const refused = await decide(approveBoth, { ev: event({ status }) });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/^This event is .+, so its changes can no longer be approved\.$/);
    nothingWritten();

    const rejected = await decide(
      { decisions: { title: { outcome: "rejected", reason: "Closed." }, expectedAttendance: { outcome: "rejected", reason: "Closed." } } },
      { ev: event({ status }) }
    );
    expect(rejected.status).toBe(200);
  });

  it("refuses approved times that would end the event before it starts", async () => {
    const res = await decide({ decisions: { startsAt: { outcome: "approved" } } }, {
      row: request({ changes: [{ field: "startsAt", current: "2027-07-05T01:00:00.000Z", proposed: "2027-07-06T01:00:00.000Z" }] }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "With these decisions the event would end before it starts. Decide Starts at and Ends at together."
    );
    nothingWritten();
  });

  it("refuses a field the request does not change but the body names in a bad shape", async () => {
    const res = await decide({ decisions: { title: { outcome: "maybe" } } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  describe("a postponement or cancellation request", () => {
    it.each([
      ["cancel", "To approve it, cancel the event: use Cancel event on its Overview."],
      ["postpone", "Postponing an event isn't available yet (Postpone Event, SPM-38), so a postponement request can only be rejected for now."],
    ])("[AC2] is not approved here: a %s request says how it is carried out", async (kind, error) => {
      const res = await decide({ outcome: "approved" }, { row: request({ kind, changes: null }) });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
      nothingWritten();
    });

    it.each(["cancel", "postpone"])("[AC2] a %s request is rejected with its reason, leaving the event alone", async (kind) => {
      const res = await decide({ outcome: "rejected", reason: "  Let's discuss a smaller format.  " }, { row: request({ kind, changes: null }) });

      expect(res.status).toBe(200);
      const claim = callArg(db.eventChangeRequest.updateMany);
      expect(claim.where).toEqual({ id: REQUEST_ID, status: "pending" });
      expect(claim.data).toMatchObject({ status: "rejected", reviewNotes: "Let's discuss a smaller format.", reviewedBy: ID.otherUser });
      expect(db.event.update).not.toHaveBeenCalled();
      expect((await res.json()).request).toMatchObject({ status: "rejected", reviewNotes: "Let's discuss a smaller format." });
    });

    it.each([[undefined], ["   "]])("needs a reason to be rejected (%j)", async (reason) => {
      const res = await decide({ outcome: "rejected", reason }, { row: request({ kind: "cancel", changes: null }) });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Give a reason for rejecting this request.");
      nothingWritten();
    });

    it("[AC7] is not rejected twice when another save got there first", async () => {
      const token = signIn(coordinator());
      db.event.findUnique.mockResolvedValue(event());
      db.eventChangeRequest.findUnique.mockResolvedValue(request({ kind: "cancel", changes: null }));
      db.eventChangeRequest.updateMany.mockResolvedValue({ count: 0 });

      const res = await POST(req("POST", PATH, { token, body: { outcome: "rejected", reason: "No." } }), params({ id: REF, requestId: REQUEST_ID }));

      expect(res.status).toBe(409);
    });
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(coordinator());
    db.event.findUnique.mockRejectedValue(new Error("down"));
    const res = await POST(req("POST", PATH, { token, body: approveBoth }), params({ id: REF, requestId: REQUEST_ID }));
    expect(res.status).toBe(500);
  });
});
