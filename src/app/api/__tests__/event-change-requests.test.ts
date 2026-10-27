// SPM-35 Request Event Change - the routes (written test-first):
//   src/app/api/events/[id]/change-requests/route.ts   exports POST, GET
//   src/app/api/change-requests/route.ts               exports GET
//
//   POST /api/events/EVT-000007/change-requests
//     body { kind?: "change" | "postpone" | "cancel" (default "change"), reason,
//            changes?: <Update Event Information's fields>, equipmentChanges?: string }
//     -> 401 no session; 404 malformed / unknown / not visible;
//        403 "Only the organiser who owns this event can request a change." for anyone else;
//        400 "A change can only be requested while the event is Approved, Planning, Safety review,
//            Safety approved, Confirmed or Postponed.";
//        400 "Validation failed" + details.fieldErrors.reason ["Give a reason for the change."];
//        400 "Change at least one detail, or describe the equipment change.";
//        400 "Session times and attendance can't be changed here yet - ..." (multi-session event);
//        400 { error, details.fieldErrors.endsAt } "Ends at must be after starts at.";
//        400 "Choose facilities from the list." for a facility that does not exist;
//        201 the request as describeChangeRequest() gives it; 500.
//     Writes eventChangeRequest.create only - never the event, its bookings, equipment or status (AC5, AC6).
//   GET /api/events/EVT-000007/change-requests -> the event's requests, newest first;
//     403 "Change requests are for the event's organisers, its coordinator and the Ops Manager."
//   GET /api/change-requests -> the signed-in coordinator's pending requests, newest first, each
//     with { event: { reference, title, status } }; 403 "Only an Event Coordinator has change requests to process."
// Decided here, not in the story: see docs/test-cases/SPM-35_test_cases.json open_questions.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/events/[id]/change-requests/route";
import { GET as GET_MINE } from "@/app/api/change-requests/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const PATH = `/api/events/${REF}/change-requests`;
const START = new Date("2027-04-12T01:00:00.000Z"); // 12 Apr 2027, 09:00 SGT
const END = new Date("2027-04-12T04:00:00.000Z");
const STAGE = { facilityId: ID.facility, facility: { name: "Raised stage" } };

const owner = () => user("organiser", { id: ID.user, fullName: "Rachel Ng" });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM35 Harbour Townhall",
    category: "meeting",
    purpose: "Quarterly all-hands",
    description: "Leadership update and Q&A.",
    status: "approved",
    organiserId: ID.user,
    organisationId: ID.org,
    coordinatorId: ID.otherUser,
    startsAt: START,
    endsAt: END,
    expectedAttendance: 80,
    preferredLayout: "theatre",
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: false,
    facilityRequirements: [STAGE],
    sessions: [],
    ...overrides,
  };
}

/// What create() hands back: the row it was given, with the requester.
function echoCreate() {
  db.eventChangeRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: ID.request,
    requestedAt: new Date("2026-10-20T02:00:00.000Z"),
    status: "pending",
    proposedStartsAt: null,
    proposedEndsAt: null,
    proposedAttendance: null,
    equipmentChanges: null,
    changes: null,
    ...data,
    requester: { fullName: "Rachel Ng" },
  }));
}

async function post(body: unknown, { as = owner(), ev = event() }: { as?: ReturnType<typeof user>; ev?: unknown } = {}) {
  const token = signIn(as);
  db.event.findUnique.mockResolvedValue(ev);
  echoCreate();
  return POST(req("POST", PATH, { token, body }), params({ id: REF }));
}

const nothingElseWritten = () => {
  expect(db.event.update).not.toHaveBeenCalled();
  expect(db.venueBooking.update).not.toHaveBeenCalled();
  expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
};

describe("[SPM-35] POST /api/events/[id]/change-requests", () => {
  it("refuses a caller with no session", async () => {
    const res = await POST(req("POST", PATH, { body: { reason: "x" } }), params({ id: REF }));
    expect(res.status).toBe(401);
  });

  it.each([["EVT-abc"], ["EVT-000999"]])("answers 404 for %s, an event that cannot be found", async (ref) => {
    const token = signIn(owner());
    db.event.findUnique.mockResolvedValue(null);
    const res = await POST(req("POST", `/api/events/${ref}/change-requests`, { token, body: { reason: "x" } }), params({ id: ref }));
    expect(res.status).toBe(404);
  });

  it("answers 404, not 403, to an organiser from another company", async () => {
    const res = await post({ reason: "x", changes: { title: "New" } }, { as: user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }) });
    expect(res.status).toBe(404);
    expect(db.eventChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a colleague from the same company", () => user("organiser", { id: ID.thirdUser })],
    ["the assigned coordinator", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
  ])("[AC1] refuses %s: only the owner may request a change", async (_, who) => {
    const res = await post({ reason: "x", changes: { title: "New" } }, { as: who() });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only the organiser who owns this event can request a change.");
    expect(db.eventChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each(["submitted", "under_review", "rejected", "withdrawn", "cancelled", "completed"])(
    "[AC1] refuses a request while the event is %s",
    async (status) => {
      const res = await post({ reason: "x", changes: { title: "New" } }, { ev: event({ status }) });

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "A change can only be requested while the event is Approved, Planning, Safety review, Safety approved, Confirmed or Postponed."
      );
      expect(db.eventChangeRequest.create).not.toHaveBeenCalled();
    }
  );

  it.each(["approved", "planning", "safety_review", "safety_cleared", "confirmed", "postponed"])(
    "[AC1] accepts a request while the event is %s",
    async (status) => {
      const res = await post({ reason: "New name", changes: { title: "SPM35 Townhall and Awards" } }, { ev: event({ status }) });
      expect(res.status).toBe(201);
    }
  );

  it("[AC1][AC2] records each changed field with its value now and the value proposed", async () => {
    const res = await post({
      reason: "  We are presenting the staff awards.  ",
      changes: { title: "SPM35 Harbour Townhall and Awards", description: "Leadership update, Q&A and the staff awards.", category: "meeting" },
    });

    expect(res.status).toBe(201);
    expect(callArg(db.eventChangeRequest.create)).toEqual({
      data: {
        eventId: ID.event,
        requestedBy: ID.user,
        kind: "change",
        reason: "We are presenting the staff awards.",
        changes: [
          { field: "title", current: "SPM35 Harbour Townhall", proposed: "SPM35 Harbour Townhall and Awards" },
          { field: "description", current: "Leadership update and Q&A.", proposed: "Leadership update, Q&A and the staff awards." },
        ],
        equipmentChanges: null,
        isSignificant: false,
        status: "pending",
      },
      include: { requester: { select: { fullName: true } } },
    });
    expect(await res.json()).toMatchObject({
      id: ID.request,
      kind: "change",
      kindLabel: "Change of details",
      status: "pending",
      requestedBy: "Rachel Ng",
      important: false,
      rows: [
        { field: "title", label: "Event name", current: "SPM35 Harbour Townhall", proposed: "SPM35 Harbour Townhall and Awards", outcome: null, outcomeReason: null },
        { field: "description", label: "Description", current: "Leadership update and Q&A.", proposed: "Leadership update, Q&A and the staff awards.", outcome: null, outcomeReason: null },
      ],
    });
  });

  it("[AC6] changes nothing about the event, its arrangements or its status", async () => {
    await post({ reason: "Later date", changes: { startsAt: "2027-04-19T01:00:00.000Z", endsAt: "2027-04-19T04:00:00.000Z" } });
    nothingElseWritten();
  });

  it.each([
    ["the date and time", { startsAt: "2027-04-19T01:00:00.000Z", endsAt: "2027-04-19T04:00:00.000Z" }, undefined, ["Date and time"]],
    ["the expected attendance", { expectedAttendance: 120 }, undefined, ["Expected attendance"]],
    ["the preferred layout", { preferredLayout: "banquet" }, undefined, ["Venue requirements"]],
    ["the facilities", { facilityIds: [] }, undefined, ["Venue requirements"]],
    ["the equipment", undefined, "Two more microphones", ["Equipment requirements"]],
  ])("[AC4] marks a request changing %s as Important", async (_, changes, equipmentChanges, affects) => {
    const res = await post({ reason: "Because", changes, equipmentChanges });

    expect(res.status).toBe(201);
    expect(callArg(db.eventChangeRequest.create).data.isSignificant).toBe(true);
    expect(await res.json()).toMatchObject({ important: true, affects });
  });

  it("[AC1] stores the equipment change in the organiser's words, trimmed", async () => {
    await post({ reason: "Panel grew", equipmentChanges: "  Two more handheld microphones.  " });
    expect(callArg(db.eventChangeRequest.create).data).toMatchObject({ changes: [], equipmentChanges: "Two more handheld microphones." });
  });

  it("[AC2] names the proposed facilities", async () => {
    db.facility.findMany.mockResolvedValue([
      { id: ID.facility, name: "Raised stage" },
      { id: ID.equipment, name: "Step-free access" },
    ]);
    const res = await post({ reason: "A guest uses a wheelchair", changes: { facilityIds: [ID.facility, ID.equipment] } });

    expect(callArg(db.facility.findMany)).toEqual({ where: { id: { in: [ID.facility, ID.equipment] } }, select: { id: true, name: true } });
    expect((await res.json()).rows).toEqual([
      { field: "facilityIds", label: "Facilities and accessibility needs", current: "Raised stage", proposed: "Raised stage, Step-free access", outcome: null, outcomeReason: null },
    ]);
  });

  it("refuses a facility that does not exist", async () => {
    db.facility.findMany.mockResolvedValue([]);
    const res = await post({ reason: "x", changes: { facilityIds: [ID.equipment] } });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Choose facilities from the list.");
    expect(db.eventChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
  ])("[AC3] refuses a request whose reason is %s", async (_, reason) => {
    const res = await post({ reason, changes: { title: "New" } });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.reason).toEqual(["Give a reason for the change."]);
    expect(db.eventChangeRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no changes at all", { reason: "x" }],
    ["only values the event already has", { reason: "x", changes: { title: "SPM35 Harbour Townhall", expectedAttendance: 80 } }],
    ["blank equipment text", { reason: "x", equipmentChanges: "  " }],
  ])("refuses a change of details with %s", async (_, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Change at least one detail, or describe the equipment change.");
    expect(db.eventChangeRequest.create).not.toHaveBeenCalled();
  });

  it("refuses an end before the start, measured against the start already saved", async () => {
    const res = await post({ reason: "x", changes: { endsAt: "2027-04-12T00:00:00.000Z" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Ends at must be after starts at.",
      details: { fieldErrors: { endsAt: ["Ends at must be after starts at."] } },
    });
  });

  it("refuses new times or attendance for a multi-session event, as Update Event Information does", async () => {
    const res = await post({ reason: "x", changes: { expectedAttendance: 90 } }, { ev: event({ sessions: [{ id: ID.session }] }) });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Session times and attendance can't be changed here yet - describe the change in Reason for the change."
    );
  });

  it("lets a multi-session event's other details be asked for", async () => {
    const res = await post({ reason: "x", changes: { title: "New name" } }, { ev: event({ sessions: [{ id: ID.session }] }) });
    expect(res.status).toBe(201);
  });

  it("refuses a field Update Event Information cannot change", async () => {
    const res = await post({ reason: "x", changes: { status: "cancelled" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it.each([
    ["postpone", "Postponement"],
    ["cancel", "Cancellation"],
  ])("[AC5] records a request to %s with its reason alone, and leaves the status alone", async (kind, kindLabel) => {
    const res = await post({ kind, reason: "The client withdrew", changes: { title: "Ignored" }, equipmentChanges: "Ignored" }, { ev: event({ status: "confirmed" }) });

    expect(res.status).toBe(201);
    expect(callArg(db.eventChangeRequest.create).data).toEqual({
      eventId: ID.event,
      requestedBy: ID.user,
      kind,
      reason: "The client withdrew",
      equipmentChanges: null,
      isSignificant: false,
      status: "pending",
    });
    expect(await res.json()).toMatchObject({ kind, kindLabel, important: false, rows: [] });
    nothingElseWritten();
  });

  it("[AC3] a postponement still needs a reason", async () => {
    const res = await post({ kind: "postpone", reason: "" });
    expect(res.status).toBe(400);
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(owner());
    db.event.findUnique.mockRejectedValue(new Error("down"));
    const res = await POST(req("POST", PATH, { token, body: { reason: "x" } }), params({ id: REF }));
    expect(res.status).toBe(500);
  });
});

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: ID.request,
  kind: "change",
  status: "pending",
  reason: "Registrations are ahead of forecast.",
  requestedAt: new Date("2026-10-20T02:00:00.000Z"),
  requester: { fullName: "Rachel Ng" },
  changes: [{ field: "expectedAttendance", current: 80, proposed: 120 }],
  equipmentChanges: null,
  isSignificant: true,
  proposedStartsAt: null,
  proposedEndsAt: null,
  proposedAttendance: null,
  ...overrides,
});

describe("[SPM-35][AC2] GET /api/events/[id]/change-requests", () => {
  async function list(as: ReturnType<typeof user>, ev: unknown = event()) {
    const token = signIn(as);
    db.event.findUnique.mockResolvedValue(ev);
    db.eventChangeRequest.findMany.mockResolvedValue([stored()]);
    return GET(req("GET", PATH, { token }), params({ id: REF }));
  }

  it("refuses a caller with no session", async () => {
    expect((await GET(req("GET", PATH), params({ id: REF }))).status).toBe(401);
  });

  it("answers 404 for an event the caller cannot see", async () => {
    const res = await list(user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));
    expect(res.status).toBe(404);
  });

  it.each([
    ["the owner", () => owner()],
    ["a colleague from the same company", () => user("organiser", { id: ID.thirdUser })],
    ["the assigned coordinator", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
  ])("lists the event's requests, newest first, for %s", async (_, who) => {
    const res = await list(who());

    expect(res.status).toBe(200);
    expect(callArg(db.eventChangeRequest.findMany)).toEqual({
      where: { eventId: ID.event },
      orderBy: { requestedAt: "desc" },
      include: { requester: { select: { fullName: true } }, reviewer: { select: { fullName: true } } },
    });
    expect(await res.json()).toEqual([
      expect.objectContaining({
        id: ID.request,
        important: true,
        affects: ["Expected attendance"],
        rows: [{ field: "expectedAttendance", label: "Expected attendance", current: "80", proposed: "120", outcome: null, outcomeReason: null }],
      }),
    ]);
  });

  it.each([
    ["another coordinator", () => user("coordinator", { id: ID.thirdUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.thirdUser })],
    ["the Safety Officer", () => user("safety_officer", { id: ID.thirdUser })],
  ])("refuses %s", async (_, who) => {
    const res = await list(who());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Change requests are for the event's organisers, its coordinator and the Ops Manager.");
    expect(db.eventChangeRequest.findMany).not.toHaveBeenCalled();
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(owner());
    db.event.findUnique.mockRejectedValue(new Error("down"));
    expect((await GET(req("GET", PATH, { token }), params({ id: REF }))).status).toBe(500);
  });
});

describe("[SPM-35][AC4] GET /api/change-requests", () => {
  const coordinator = () => user("coordinator", { id: ID.otherUser });

  it("refuses a caller with no session", async () => {
    expect((await GET_MINE(req("GET", "/api/change-requests"))).status).toBe(401);
  });

  it.each(["organiser", "ops_manager", "venue_staff", "attendee"])("refuses the %s role", async (role) => {
    const token = signIn(user(role));
    const res = await GET_MINE(req("GET", "/api/change-requests", { token }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only an Event Coordinator has change requests to process.");
    expect(db.eventChangeRequest.findMany).not.toHaveBeenCalled();
  });

  it("lists the pending requests on the coordinator's own events, newest first, each marked Important or not", async () => {
    const token = signIn(coordinator());
    db.eventChangeRequest.findMany.mockResolvedValue([
      stored({ event: event({ status: "confirmed" }) }),
      stored({ id: "cr-2", changes: [{ field: "title", current: "A", proposed: "B" }], isSignificant: false, event: event() }),
    ]);

    const res = await GET_MINE(req("GET", "/api/change-requests", { token }));

    expect(res.status).toBe(200);
    const query = callArg(db.eventChangeRequest.findMany);
    expect(query.where).toEqual({ status: "pending", event: { coordinatorId: ID.otherUser } });
    expect(query.orderBy).toEqual({ requestedAt: "desc" });
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: ID.request, important: true, event: { reference: REF, title: "SPM35 Harbour Townhall", status: "confirmed" } }),
      expect.objectContaining({ id: "cr-2", important: false, affects: [], event: { reference: REF, title: "SPM35 Harbour Townhall", status: "approved" } }),
    ]);
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(coordinator());
    db.eventChangeRequest.findMany.mockRejectedValue(new Error("down"));
    expect((await GET_MINE(req("GET", "/api/change-requests", { token }))).status).toBe(500);
  });
});
