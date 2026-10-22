// SPM-69 — Release or Adjust Equipment Reservation. Like the reserve route
// (SPM-49), this reads availability through equipmentAvailabilityService.ts,
// so the tests feed it database rows and assert on what the real rules make
// of them.
//
// CONTRACT (SPM-69, written before the code) - what these tests expect to exist:
//   src/app/api/events/[id]/equipment/[requestId]/reservation/route.ts   exports PATCH, DELETE
//   PATCH { quantity }  -> 200 the updated line; reduces or increases what is reserved
//   DELETE              -> 200 the updated line; releases the reservation (status "released",
//                          quantityReserved kept as the record of what was held)
//   both: 401; 404 unseen event / request of another event / event Technical Support
//         cannot see; 403 "Only Technical Support Staff can change equipment reservations";
//         400 reservingClosedMessage() outside Planning; 400 for each rule in
//         src/lib/equipmentReservation.ts; 500.
//   both lock the equipment row first, as reserving does, and notify the assigned
//   Coordinator in the same transaction.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - Planning only, the same window as reserving and updating (SPM-49 / SPM-50)
//   - DELETE for release: the reservation goes, the requirement stays

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { DELETE, PATCH } from "@/app/api/events/[id]/equipment/[requestId]/reservation/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const NOW = new Date("2026-10-22T04:00:00Z");
const STARTS = new Date("2027-03-04T01:00:00.000Z");
const ENDS = new Date("2027-03-04T09:00:00.000Z");
const PATH = `/api/events/${REF}/equipment/${ID.request}/reservation`;

const techSupport = () => user("tech_support", { id: ID.user });

afterEach(() => {
  vi.useRealTimers();
});

/// The request row. The route reads it for the access check and the
/// availability service reads it again inside the lock; one row serves both.
function requestRow(overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  return {
    id: ID.request,
    eventId: ID.event,
    equipmentId: ID.equipment,
    quantityRequested: 4,
    quantityReserved: 4,
    status: "reserved",
    sessionId: null,
    session: null,
    equipment: {
      id: ID.equipment,
      name: "Projector",
      totalQuantity: 10,
      quantityInMaintenance: 0,
      isActive: true,
      locationVenueId: null,
    },
    event: {
      id: ID.event,
      title: "Gala Dinner",
      organiserId: "organiser-id",
      organisationId: ID.org,
      coordinatorId: ID.otherUser,
      status: "planning",
      startsAt: STARTS,
      endsAt: ENDS,
      venueBookings: [],
      ...eventOverrides,
    },
    ...overrides,
  };
}

/// Another event's reservation of the same item on the same day.
function otherHold(quantityReserved: number) {
  return {
    id: "other-request",
    equipmentId: ID.equipment,
    status: "reserved",
    quantityReserved,
    sessionId: null,
    session: null,
    event: { title: "Tech Summit", status: "planning", startsAt: STARTS, endsAt: ENDS, venueBookings: [] },
  };
}

function given(row: object | null, holds: object[] = [], actor = techSupport()) {
  const token = signIn(actor);
  db.event.findUnique.mockResolvedValue({ id: ID.event });
  db.equipmentRequest.findUnique.mockResolvedValue(row);
  db.equipmentRequest.findMany.mockResolvedValue(holds);
  db.equipmentRequest.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.request, ...data }));
  return token;
}

function adjust(token: string | undefined, body: unknown, reference = REF) {
  return PATCH(
    req("PATCH", PATH.replace(REF, reference), { token, body }),
    params({ id: reference, requestId: ID.request })
  );
}

function release(token?: string, reference = REF) {
  return DELETE(req("DELETE", PATH.replace(REF, reference), { token }), params({ id: reference, requestId: ID.request }));
}

describe.each([
  ["PATCH (adjust)", (token?: string, reference?: string) => adjust(token, { quantity: 2 }, reference)],
  ["DELETE (release)", (token?: string, reference?: string) => release(token, reference)],
])("%s: who may, and when", (_method, call) => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await call()).status).toBe(401);
  });

  it("[SPM-69] is 404 for a malformed event reference", async () => {
    expect((await call(signIn(techSupport()), "nope")).status).toBe(404);
  });

  it("[SPM-69] is 404 when the request does not exist", async () => {
    expect((await call(given(null))).status).toBe(404);
  });

  it("[SPM-69] is 404 when the request belongs to a different event than the URL names", async () => {
    const res = await call(given(requestRow({ eventId: "another-event" })));

    expect(res.status).toBe(404);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-69] is 404 for a draft, which Technical Support cannot see", async () => {
    expect((await call(given(requestRow({}, { status: "draft" })))).status).toBe(404);
  });

  it.each([
    ["the assigned coordinator", () => user("coordinator", { id: ID.otherUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
    ["the Ops Manager", () => user("ops_manager")],
  ])("[SPM-69][AC1][AC2][AC3] is 403 for %s - only Technical Support changes reservations", async (_who, actor) => {
    const res = await call(given(requestRow(), [], actor()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Technical Support Staff can change equipment reservations" });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it.each(["submitted", "under_review", "approved", "postponed", "cancelled", "rejected", "completed"])(
    "[SPM-69] is 404 for an event that is %s - Technical Support does not see its equipment",
    async (status) => {
      const res = await call(given(requestRow({}, { status })));

      expect(res.status).toBe(404);
      expect(db.$transaction).not.toHaveBeenCalled();
    }
  );

  it("[SPM-69] refuses on a confirmed event, whose equipment is final", async () => {
    const res = await call(given(requestRow({}, { status: "confirmed" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This event is confirmed — its equipment is final. A change now goes through a change request.",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("[SPM-69] locks the equipment row before reading the line, so it cannot race a reservation", async () => {
    await call(given(requestRow()));

    const [sql, lockedId] = db.$queryRaw.mock.calls[0];
    expect(sql.join("?")).toBe("SELECT id FROM equipment WHERE id = ? FOR UPDATE");
    expect(lockedId).toBe(ID.equipment);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.equipmentRequest.update.mock.invocationCallOrder[0]
    );
  });

  it("[SPM-69] refuses when the request disappears between the access check and the lock", async () => {
    const token = given(requestRow());
    db.equipmentRequest.findUnique.mockResolvedValueOnce(requestRow()).mockResolvedValueOnce(null);

    const res = await call(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This request no longer exists." });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-69] answers 500 when the database fails inside the transaction", async () => {
    const token = given(requestRow());
    db.$queryRaw.mockRejectedValue(new Error("lock timeout"));

    expect((await call(token)).status).toBe(500);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id]/equipment/[requestId]/reservation", () => {
  it("[SPM-69][AC2][AC5] reduces a reservation and marks the line partially fulfilled", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given(requestRow());

    const res = await adjust(token, { quantity: 2 });

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update)).toMatchObject({
      where: { id: ID.request },
      data: { quantityReserved: 2, status: "partially_fulfilled", reviewedBy: ID.user, reviewedAt: NOW },
    });
    expect(await res.json()).toMatchObject({ quantityReserved: 2, status: "partially_fulfilled" });
  });

  it("[SPM-69][AC3][AC5] increases a reservation within what is free, and marks it reserved once it is all there", async () => {
    const token = given(requestRow({ status: "partially_fulfilled", quantityReserved: 2 }), [otherHold(6)]);

    const res = await adjust(token, { quantity: 4 });

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ quantityReserved: 4, status: "reserved" });
  });

  it("[SPM-69][AC3] refuses an increase beyond what is available for the event's dates", async () => {
    const token = given(requestRow({ status: "partially_fulfilled", quantityReserved: 2 }), [otherHold(7)]);

    const res = await adjust(token, { quantity: 4 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only 3 available for this event's dates." });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-69][AC3] does not count the line's own reservation as taken when checking an increase", async () => {
    const token = given(requestRow({ status: "partially_fulfilled", quantityReserved: 3 }), [otherHold(6)]);

    await adjust(token, { quantity: 4 });

    expect(callArg(db.equipmentRequest.findMany).where).toMatchObject({
      equipmentId: ID.equipment,
      id: { not: ID.request },
    });
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ quantityReserved: 4 });
  });

  it("[SPM-69][AC3] refuses an increase while the event has no dates to check against", async () => {
    const token = given(requestRow({ status: "partially_fulfilled", quantityReserved: 2 }, { startsAt: null, endsAt: null }));

    const res = await adjust(token, { quantity: 3 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set the event date and time before reserving equipment" });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-69][AC3] refuses more than the event requested", async () => {
    const res = await adjust(given(requestRow()), { quantity: 5 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The event requested 4 — a reservation cannot be more than that." });
  });

  it("[SPM-69] refuses the quantity already reserved", async () => {
    const res = await adjust(given(requestRow()), { quantity: 4 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That is already the reserved quantity." });
  });

  it.each([
    ["requested, never reserved", { status: "requested", quantityReserved: null }],
    ["released", { status: "released", quantityReserved: 4 }],
    ["withdrawn", { status: "cancelled", quantityReserved: null }],
  ])("[SPM-69][AC2][AC3] refuses a line that is %s", async (_case, overrides) => {
    const res = await adjust(given(requestRow(overrides)), { quantity: 2 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only reserved equipment can be adjusted." });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it.each([
    ["zero - releasing is its own action", { quantity: 0 }],
    ["a fraction", { quantity: 1.5 }],
    ["text", { quantity: "2" }],
    ["nothing", {}],
  ])("[SPM-69][AC2] rejects a quantity of %s", async (_case, body) => {
    const res = await adjust(given(requestRow()), body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("[SPM-69][AC6] tells the assigned Coordinator how the reservation changed", async () => {
    const res = await adjust(given(requestRow()), { quantity: 2 });

    expect(res.status).toBe(200);
    expect(callArg(db.notification.create).data).toEqual({
      recipientId: ID.otherUser,
      type: "equipment_reservation_adjusted",
      title: "Equipment reservation changed",
      body: "Technical Support changed the Projector reserved for Gala Dinner from 4 to 2.",
      eventId: ID.event,
    });
  });

  it("[SPM-69][AC6] still saves the change when no Coordinator is assigned, and tells no one", async () => {
    const res = await adjust(given(requestRow({}, { coordinatorId: null })), { quantity: 2 });

    expect(res.status).toBe(200);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-69][AC7] confirms the same quantity on a line the Coordinator sent back, marking it reserved again", async () => {
    const token = given(requestRow({ status: "requested", quantityRequested: 4, quantityReserved: 4 }));

    const res = await adjust(token, { quantity: 4 });

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ quantityReserved: 4, status: "reserved" });
  });

  it("[SPM-69][AC7] fits a sent-back reservation to a smaller requirement", async () => {
    const token = given(requestRow({ status: "requested", quantityRequested: 2, quantityReserved: 4 }));

    await adjust(token, { quantity: 2 });

    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ quantityReserved: 2, status: "reserved" });
  });
});

describe("DELETE /api/events/[id]/equipment/[requestId]/reservation", () => {
  it("[SPM-69][AC1][AC5][AC8] releases the reservation, keeping what was reserved on the record", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given(requestRow());

    const res = await release(token);

    expect(res.status).toBe(200);
    const write = callArg(db.equipmentRequest.update);
    expect(write).toMatchObject({
      where: { id: ID.request },
      data: { status: "released", reviewedBy: ID.user, reviewedAt: NOW },
    });
    expect(write.data).not.toHaveProperty("quantityReserved");
    expect(db.equipmentRequest.delete).not.toHaveBeenCalled();
  });

  it("[SPM-69][AC1] releases a partly fulfilled reservation too", async () => {
    const res = await release(given(requestRow({ status: "partially_fulfilled", quantityReserved: 2 })));

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ status: "released" });
  });

  it("[SPM-69][AC7] releases a reservation the Coordinator sent back for review", async () => {
    const res = await release(given(requestRow({ status: "requested", quantityReserved: 4 })));

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ status: "released" });
  });

  it.each([
    ["requested, never reserved", { status: "requested", quantityReserved: null }],
    ["already released", { status: "released", quantityReserved: 4 }],
    ["marked as cannot be provided", { status: "unavailable", quantityReserved: null }],
  ])("[SPM-69][AC1] refuses a line that is %s", async (_case, overrides) => {
    const res = await release(given(requestRow(overrides)));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only reserved equipment can be released." });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-69][AC6] tells the assigned Coordinator what was released", async () => {
    await release(given(requestRow()));

    expect(callArg(db.notification.create).data).toEqual({
      recipientId: ID.otherUser,
      type: "equipment_reservation_released",
      title: "Equipment reservation released",
      body: "Technical Support released the 4 Projector reserved for Gala Dinner.",
      eventId: ID.event,
    });
  });

  it("[SPM-69][AC6] still releases when no Coordinator is assigned, and tells no one", async () => {
    const res = await release(given(requestRow({}, { coordinatorId: null })));

    expect(res.status).toBe(200);
    expect(db.notification.create).not.toHaveBeenCalled();
  });
});
