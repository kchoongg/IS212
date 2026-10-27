// SPM-37 - Cancel Event: what the Cancel event dialog says cancelling will do.
//
// CONTRACT (SPM-37, written before the code) - what these tests expect to exist:
//   src/app/api/events/[id]/cancellation/route.ts   exports GET
//     GET -> 200 { consequences: string[] }  from cancellationConsequences()
//            (src/lib/eventCancellation.ts); [] when there is nothing to release
//            401; 404 malformed reference, missing or unseen event (canViewEvent);
//            403 "Only the assigned Coordinator can cancel this event."
//            400 transitionError(status, "cancelled")   (the event can't be cancelled)
//     Reads, each by eventId: venueBooking.findMany (with venue name and code,
//     and session label), equipmentRequest.findMany (with equipment name),
//     eventChangeRequest.count (status "pending"), safetyCheck.count (status
//     "pending") and registration.groupBy by status.
//   Cancelling itself is PATCH /api/events/[id] { status: "cancelled", reason? }
//   (event-detail.test.ts, "cancelling (SPM-37)").
// Decided here, not in the story (change the test if the team wants otherwise):
//   - a separate read-only route, so the dialog lists exactly what the server
//     will release; the 403 wording

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET } from "@/app/api/events/[id]/cancellation/route";
import { db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";

const assignedCoordinator = () => user("coordinator", { id: ID.user, fullName: "Daniel Tan" });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM37 Harbour Summit",
    status: "planning",
    organiserId: ID.otherUser,
    organisationId: ID.org,
    coordinatorId: ID.user,
    registrationEnabled: false,
    ...overrides,
  };
}

// 2 Nov 2027, 09:00-12:00 Singapore time.
const booking = (status: string, name: string, code: string) => ({
  status,
  startsAt: new Date("2027-11-02T01:00:00.000Z"),
  endsAt: new Date("2027-11-02T04:00:00.000Z"),
  venue: { name, code },
  session: null,
});

const line = (status: string, name: string, quantityRequested: number, quantityReserved: number | null) => ({
  status,
  quantityRequested,
  quantityReserved,
  equipment: { name },
});

const preview = (token?: string, reference = REF) =>
  GET(req("GET", `/api/events/${reference}/cancellation`, { token }), params({ id: reference }));

function given(
  row: object | null = event(),
  actor = assignedCoordinator(),
  held: {
    bookings?: object[];
    equipment?: object[];
    changeRequests?: number;
    cancellationRequests?: number;
    safetyChecks?: number;
    registrations?: { status: string; _count: { _all: number } }[];
  } = {}
) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue(row);
  db.venueBooking.findMany.mockResolvedValue(held.bookings ?? []);
  db.equipmentRequest.findMany.mockResolvedValue(held.equipment ?? []);
  // All pending requests, and (SPM-32) the cancellation requests among them.
  db.eventChangeRequest.count.mockImplementation(async ({ where }: { where: { kind?: string } }) =>
    where.kind === "cancel" ? (held.cancellationRequests ?? 0) : (held.changeRequests ?? 0) + (held.cancellationRequests ?? 0)
  );
  db.safetyCheck.count.mockResolvedValue(held.safetyChecks ?? 0);
  db.registration.groupBy.mockResolvedValue(held.registrations ?? []);
  return token;
}

describe("GET /api/events/[id]/cancellation", () => {
  it("[SPM-32][AC2] lists the organiser's cancellation request as approved, apart from the other pending requests", async () => {
    const token = given(event(), assignedCoordinator(), { changeRequests: 2, cancellationRequests: 1 });

    const res = await preview(token);

    expect((await res.json()).consequences).toEqual(["Approve 1 cancellation request", "Close 2 pending change requests"]);
  });

  it("[SPM-37][AC2] is 401 without a session", async () => {
    expect((await preview()).status).toBe(401);
  });

  it.each(["not-a-reference", "EVT-99999999999"])("[SPM-37][AC2] is 404 for the malformed reference %s", async (reference) => {
    const token = given();

    expect((await preview(token, reference)).status).toBe(404);
  });

  it("[SPM-37][AC2] is 404 for an event that does not exist", async () => {
    const token = given(null);

    expect((await preview(token)).status).toBe(404);
  });

  it("[SPM-37][AC2] is 404, not 403, for an organiser of another client", async () => {
    const token = given(event(), user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));

    expect((await preview(token)).status).toBe(404);
  });

  it.each([
    ["a coordinator it is not assigned to", () => user("coordinator", { id: ID.thirdUser })],
    ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
    ["the organiser who owns it", () => user("organiser", { id: ID.otherUser, organisationId: ID.org })],
    ["Venue Staff", () => user("venue_staff", { id: ID.thirdUser })],
    ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
    ["the Safety Officer", () => user("safety_officer", { id: ID.thirdUser })],
  ])("[SPM-37][AC2] refuses %s", async (_who, actor) => {
    const token = given(event(), actor());

    const res = await preview(token);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only the assigned Coordinator can cancel this event.");
  });

  it.each([
    ["completed", "This event is Completed and can't be moved to Cancelled."],
    ["cancelled", "This event is Cancelled and can't be moved to Cancelled."],
    ["rejected", "This event is Rejected and can't be moved to Cancelled."],
  ])("[SPM-37][AC1][AC9] refuses an event that is %s", async (status, message) => {
    const token = given(event({ status }));

    const res = await preview(token);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
  });

  it("[SPM-37][AC1] lists nothing for an event that holds nothing", async () => {
    const token = given(event({ status: "approved" }));

    const res = await preview(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ consequences: [] });
  });

  it("[SPM-37][AC3][AC4][AC5][AC6][AC7] lists everything the event holds, as the dialog shows it", async () => {
    const token = given(event({ status: "safety_review", registrationEnabled: true }), assignedCoordinator(), {
      bookings: [booking("approved", "SPM37 Hall", "SPM37-HAL"), booking("pending", "SPM37 Studio", "SPM37-STU")],
      equipment: [line("reserved", "SPM37 Projector", 2, 2), line("requested", "SPM37 Lectern Mic", 1, null)],
      changeRequests: 1,
      safetyChecks: 1,
      registrations: [
        { status: "registered", _count: { _all: 12 } },
        { status: "waitlisted", _count: { _all: 3 } },
        { status: "withdrawn", _count: { _all: 2 } },
      ],
    });

    const res = await preview(token);

    expect(res.status).toBe(200);
    expect((await res.json()).consequences).toEqual([
      "Release SPM37 Hall (SPM37-HAL) on 2 Nov 2027, 09:00–12:00",
      "Withdraw the request for SPM37 Studio (SPM37-STU) on 2 Nov 2027, 09:00–12:00",
      "Release 2 × SPM37 Projector",
      "Cancel the request for 1 × SPM37 Lectern Mic",
      "Close 1 pending change request",
      "Close the pending safety check",
      "Close registration: 12 registered, 3 on the waiting list",
    ]);
  });

  it("[SPM-37][AC1] changes nothing", async () => {
    const token = given(event(), assignedCoordinator(), { bookings: [booking("approved", "SPM37 Hall", "SPM37-HAL")] });

    await preview(token);

    expect(db.event.update).not.toHaveBeenCalled();
    expect(db.venueBooking.updateMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-37] is 500 when the database fails", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    const res = await preview(token);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
