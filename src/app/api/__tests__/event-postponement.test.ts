// SPM-38 - Postpone Event: what the Postpone event dialog says postponing will
// do. GET /api/events/[id]/postponement, read-only, as GET .../cancellation is
// for Cancel event (event-cancellation.test.ts). Postponing itself is PATCH
// /api/events/[id] { status: "postponed", reason? } (event-detail.test.ts,
// "postponing (SPM-38)").

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET } from "@/app/api/events/[id]/postponement/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";

const assignedCoordinator = () => user("coordinator", { id: ID.user, fullName: "Daniel Tan" });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM38 Lantern Gala",
    status: "planning",
    organiserId: ID.otherUser,
    organisationId: ID.org,
    coordinatorId: ID.user,
    registrationEnabled: false,
    ...overrides,
  };
}

// 12 Jan 2028, 09:00-12:00 Singapore time.
const booking = (status: string, name: string, code: string) => ({
  status,
  startsAt: new Date("2028-01-12T01:00:00.000Z"),
  endsAt: new Date("2028-01-12T04:00:00.000Z"),
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
  GET(req("GET", `/api/events/${reference}/postponement`, { token }), params({ id: reference }));

function given(
  row: object | null = event(),
  actor = assignedCoordinator(),
  held: {
    bookings?: object[];
    equipment?: object[];
    postponementRequests?: number;
    safetyCheck?: { status: string } | null;
    registrations?: { status: string; _count: { _all: number } }[];
  } = {}
) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue(row);
  db.venueBooking.findMany.mockResolvedValue(held.bookings ?? []);
  db.equipmentRequest.findMany.mockResolvedValue(held.equipment ?? []);
  db.eventChangeRequest.count.mockResolvedValue(held.postponementRequests ?? 0);
  db.safetyCheck.findFirst.mockResolvedValue(held.safetyCheck ?? null);
  db.registration.groupBy.mockResolvedValue(held.registrations ?? []);
  return token;
}

describe("GET /api/events/[id]/postponement", () => {
  it("[SPM-38][AC2] is 401 without a session", async () => {
    expect((await preview()).status).toBe(401);
  });

  it.each(["not-a-reference", "EVT-99999999999"])("[SPM-38][AC2] is 404 for the malformed reference %s", async (reference) => {
    const token = given();

    expect((await preview(token, reference)).status).toBe(404);
  });

  it("[SPM-38][AC2] is 404 for an event that does not exist", async () => {
    const token = given(null);

    expect((await preview(token)).status).toBe(404);
  });

  it("[SPM-38][AC2] is 404, not 403, for an organiser of another client", async () => {
    const token = given(event(), user("organiser", { id: ID.thirdUser, organisationId: ID.otherOrg }));

    expect((await preview(token)).status).toBe(404);
  });

  it.each([
    ["a coordinator it is not assigned to", () => user("coordinator", { id: ID.thirdUser })],
    ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
    ["the organiser who owns it", () => user("organiser", { id: ID.otherUser, organisationId: ID.org })],
    ["Venue Staff", () => user("venue_staff", { id: ID.thirdUser })],
  ])("[SPM-38][AC2] refuses %s", async (_who, actor) => {
    const token = given(event(), actor());

    const res = await preview(token);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Only the assigned Coordinator can postpone this event.");
  });

  it.each([
    ["under_review", "This event is Under review and can't be moved to Postponed."],
    ["postponed", "This event is Postponed and can't be moved to Postponed."],
    ["completed", "This event is Completed and can't be moved to Postponed."],
  ])("[SPM-38][AC1] refuses an event that is %s", async (status, message) => {
    const token = given(event({ status }));

    const res = await preview(token);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
  });

  it("[SPM-38][AC1] lists nothing for an event that holds nothing", async () => {
    const token = given(event({ status: "approved" }));

    const res = await preview(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ consequences: [] });
  });

  it("[SPM-38][AC2][AC3][AC4][AC8] lists everything the event holds, as the dialog shows it", async () => {
    const token = given(event({ status: "safety_review", registrationEnabled: true }), assignedCoordinator(), {
      bookings: [booking("approved", "SPM38 Hall", "SPM38-HAL"), booking("pending", "SPM38 Studio", "SPM38-STU")],
      equipment: [line("reserved", "SPM38 Projector", 2, 2), line("requested", "SPM38 Lectern Mic", 1, null)],
      postponementRequests: 1,
      safetyCheck: { status: "pending" },
      registrations: [
        { status: "registered", _count: { _all: 12 } },
        { status: "waitlisted", _count: { _all: 3 } },
      ],
    });

    const res = await preview(token);

    expect(res.status).toBe(200);
    expect((await res.json()).consequences).toEqual([
      "Release SPM38 Hall (SPM38-HAL) on 12 Jan 2028, 09:00–12:00",
      "Withdraw the request for SPM38 Studio (SPM38-STU) on 12 Jan 2028, 09:00–12:00",
      "Release 2 × SPM38 Projector",
      "Cancel the request for 1 × SPM38 Lectern Mic",
      "Approve 1 postponement request",
      "Close the pending safety check",
      "Pause registration until the event is confirmed again: 12 registered, 3 on the waiting list",
    ]);
  });

  it("[SPM-38][AC2] counts only the pending postponement requests", async () => {
    const token = given();

    await preview(token);

    expect(callArg(db.eventChangeRequest.count)).toEqual({
      where: { eventId: ID.event, status: "pending", kind: "postpone" },
    });
  });

  it("[SPM-38][AC4] lists closing the approval of a Safety approved event", async () => {
    const token = given(event({ status: "safety_cleared" }), assignedCoordinator(), { safetyCheck: { status: "approved" } });

    expect((await (await preview(token)).json()).consequences).toEqual(["Close the safety approval"]);
  });

  it("[SPM-38][AC1] changes nothing", async () => {
    const token = given(event(), assignedCoordinator(), { bookings: [booking("approved", "SPM38 Hall", "SPM38-HAL")] });

    await preview(token);

    expect(db.event.update).not.toHaveBeenCalled();
    expect(db.venueBooking.updateMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-38] is 500 when the database fails", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    const res = await preview(token);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
