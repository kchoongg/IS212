// SPM-48 (check availability) and SPM-49 (reserve). Both routes read through
// src/lib/equipmentAvailabilityService.ts, so these tests feed that service
// database rows and assert on what the real availability rules make of them.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET as availability } from "@/app/api/events/[id]/equipment/availability/route";
import { POST as reserve } from "@/app/api/events/[id]/equipment/[requestId]/reserve/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const NOW = new Date("2026-10-02T04:00:00Z");
const STARTS = new Date("2027-03-04T01:00:00.000Z");
const ENDS = new Date("2027-03-04T09:00:00.000Z");

const techSupport = () => user("tech_support", { id: ID.user });

function projector(overrides = {}) {
  return {
    id: ID.equipment,
    name: "Projector",
    totalQuantity: 10,
    quantityInMaintenance: 0,
    isActive: true,
    locationVenueId: null,
    ...overrides,
  };
}

/// Another event's hold on the same item, on the same day unless overridden.
function otherHold(overrides: Record<string, unknown> = {}) {
  return {
    id: "other-request",
    equipmentId: ID.equipment,
    status: "reserved",
    quantityReserved: 7,
    sessionId: null,
    session: null,
    event: { title: "Gala Dinner", status: "confirmed", startsAt: STARTS, endsAt: ENDS, venueBookings: [] },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/events/[id]/equipment/availability", () => {
  function eventRow(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.event,
      sequenceNumber: 7,
      status: "planning",
      organiserId: "organiser-id",
      organisationId: ID.org,
      coordinatorId: ID.otherUser,
      startsAt: STARTS,
      endsAt: ENDS,
      venueBookings: [],
      equipmentRequests: [line()],
      ...overrides,
    };
  }

  /// One requested equipment line of that event.
  function line(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.request,
      quantityRequested: 4,
      quantityReserved: null,
      status: "requested",
      sessionId: null,
      session: null,
      equipment: projector(),
      ...overrides,
    };
  }

  function check(token?: string, reference = REF) {
    return availability(
      req("GET", `/api/events/${reference}/equipment/availability`, { token }),
      params({ id: reference })
    );
  }

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await check()).status).toBe(401);
  });

  it("[SPM-48] is 404 for a malformed reference", async () => {
    expect((await check(signIn(techSupport()), "nope")).status).toBe(404);
  });

  it("[SPM-48] is 404 for a draft, which Technical Support cannot see", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow({ status: "draft" }));

    expect((await check(token)).status).toBe(404);
  });

  it.each([
    ["the assigned coordinator", () => user("coordinator", { id: ID.otherUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
    ["the Ops Manager", () => user("ops_manager")],
    ["Venue Staff", () => user("venue_staff")],
  ])("[SPM-21][AC4] is 403 for %s - a result names other clients' events", async (_who, actor) => {
    const token = signIn(actor());
    db.event.findUnique.mockResolvedValue(eventRow());

    const res = await check(token);

    expect(res.status).toBe(403);
    expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
  });

  it.each(["submitted", "under_review", "approved", "postponed", "cancelled", "completed"])(
    "[SPM-48] is 404 for an event that is %s - Technical Support's part starts with planning",
    async (status) => {
      const token = signIn(techSupport());
      db.event.findUnique.mockResolvedValue(eventRow({ status }));

      const res = await check(token);

      expect(res.status).toBe(404);
      expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
    }
  );

  it("[SPM-48] is still shown for a confirmed event", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow({ status: "confirmed" }));
    db.equipmentRequest.findMany.mockResolvedValue([]);

    expect((await check(token)).status).toBe(200);
  });

  it("[SPM-50][AC1][AC4] gives each line the coordinator's requirements and Technical Support's own review", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(
      eventRow({
        equipmentRequests: [
          line({
            technicalRequirements: "HDMI on stage left",
            staffNotes: "Spare unit checked",
            reviewedAt: new Date("2027-02-01T02:00:00.000Z"),
            reviewer: { fullName: "Tessa Lim" },
          }),
        ],
      })
    );
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const body = await (await check(token)).json();

    expect(body.lines[0]).toMatchObject({
      technicalRequirements: "HDMI on stage left",
      staffNotes: "Spare unit checked",
      reviewedByName: "Tessa Lim",
      reviewedAt: "2027-02-01T02:00:00.000Z",
    });
  });

  it("[SPM-50][AC1][AC4] gives no reviewer for a line nobody has reviewed yet", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const body = await (await check(token)).json();

    expect(body.lines[0].reviewedByName).toBeNull();
  });

  it("[SPM-48][AC8] reports a line as available when nothing else holds the item", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const res = await check(token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allAvailable).toBe(true);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      requestId: ID.request,
      equipmentName: "Projector",
      quantityRequested: 4,
      venueChosen: false,
      result: { status: "available", total: 10, available: 10, requested: 4, shortfall: 0, heldBy: [] },
    });
  });

  it("[SPM-48][AC4] counts another event's reservation on the same day, and names who holds it", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([otherHold()]);

    const body = await (await check(token)).json();

    expect(body.allAvailable).toBe(false);
    expect(body.lines[0].result).toMatchObject({
      status: "partial",
      reservedElsewhere: 7,
      available: 3,
      shortfall: 1,
      heldBy: [{ eventTitle: "Gala Dinner", quantity: 7 }],
    });
  });

  it("[SPM-48][AC4] only asks for requests that actually hold stock", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([]);

    await check(token);

    expect(callArg(db.equipmentRequest.findMany).where).toEqual({
      equipmentId: { in: [ID.equipment] },
      status: { in: ["reserved", "partially_fulfilled"] },
    });
  });

  it("[SPM-48][AC4] ignores a hold belonging to a cancelled event", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([
      otherHold({ event: { ...otherHold().event, status: "cancelled" } }),
    ]);

    const body = await (await check(token)).json();

    expect(body.lines[0].result).toMatchObject({ status: "available", reservedElsewhere: 0 });
  });

  it("[SPM-49][AC4] does not count the line's own reservation against itself", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(
      eventRow({ equipmentRequests: [line({ status: "reserved", quantityReserved: 4 })] })
    );
    db.equipmentRequest.findMany.mockResolvedValue([otherHold({ id: ID.request, quantityReserved: 4 })]);

    const body = await (await check(token)).json();

    expect(body.lines[0].result).toMatchObject({ status: "available", reservedElsewhere: 0, available: 10 });
  });

  it("[SPM-48][AC4] labels a hold by another session of a multi-session event with that session", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([
      otherHold({ sessionId: ID.session, session: { label: "Day 1", startsAt: STARTS, endsAt: ENDS } }),
    ]);

    const body = await (await check(token)).json();

    expect(body.lines[0].result.heldBy[0].eventTitle).toBe("Gala Dinner · Day 1");
  });

  it("[SPM-48][AC4] labels a session's hold by an untitled event as 'Untitled event'", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow());
    db.equipmentRequest.findMany.mockResolvedValue([
      otherHold({
        event: { ...otherHold().event, title: null },
        sessionId: ID.session,
        session: { label: "Day 1", startsAt: STARTS, endsAt: ENDS },
      }),
    ]);

    const body = await (await check(token)).json();

    expect(body.lines[0].result.heldBy[0].eventTitle).toBe("Untitled event · Day 1");
  });

  it("[SPM-48][AC3] [SPM-47][AC4] checks a session's line against the session's own times and venue", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(
      eventRow({
        venueBookings: [
          { venueId: ID.venue, sessionId: null, status: "pending" },
          { venueId: ID.otherVenue, sessionId: ID.session, status: "approved" },
          { venueId: "rejected-venue", sessionId: ID.session, status: "rejected" },
        ],
        equipmentRequests: [
          line({ sessionId: ID.session, session: { label: "Day 2", startsAt: STARTS, endsAt: ENDS } }),
        ],
      })
    );
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const body = await (await check(token)).json();

    // Stored at ConnectSphere, booked at a venue: two hours' transfer applies.
    expect(body.lines[0]).toMatchObject({
      sessionId: ID.session,
      sessionLabel: "Day 2",
      venueChosen: true,
      transferMinutes: 120,
    });
  });

  it("[SPM-48][AC6] counts a venue that is only requested, not yet approved, as the session's venue", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(
      eventRow({
        venueBookings: [{ venueId: ID.venue, sessionId: ID.session, status: "pending" }],
        equipmentRequests: [
          line({ sessionId: ID.session, session: { label: "Day 1", startsAt: STARTS, endsAt: ENDS } }),
        ],
      })
    );
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const body = await (await check(token)).json();

    expect(body.lines[0]).toMatchObject({ venueChosen: true, transferMinutes: 120 });
  });

  it("[SPM-48][AC3] cannot check a line while the event has no dates", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow({ startsAt: null, endsAt: null }));
    db.equipmentRequest.findMany.mockResolvedValue([]);

    const body = await (await check(token)).json();

    expect(body.lines[0].result).toBeNull();
    expect(body.allAvailable).toBe(false);
  });

  it("[SPM-48] returns no lines, and makes no further query, for an event with no equipment requested", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValue(eventRow({ equipmentRequests: [] }));

    const res = await check(token);

    expect(await res.json()).toEqual({ lines: [], allAvailable: true });
    expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-48] is 404 if the event is deleted between the access check and the availability read", async () => {
    const token = signIn(techSupport());
    db.event.findUnique.mockResolvedValueOnce(eventRow()).mockResolvedValueOnce(null);

    expect((await check(token)).status).toBe(404);
  });
});

describe("POST /api/events/[id]/equipment/[requestId]/reserve", () => {
  /// The request row. The route reads it once for the access check and the
  /// availability service reads it again inside the lock; one row serves both.
  function requestRow(overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
    return {
      id: ID.request,
      eventId: ID.event,
      equipmentId: ID.equipment,
      quantityRequested: 4,
      quantityReserved: null,
      status: "requested",
      sessionId: null,
      session: null,
      equipment: projector(),
      event: {
        id: ID.event,
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

  function given(row: object | null, holds: object[] = [], actor = techSupport()) {
    const token = signIn(actor);
    db.event.findUnique.mockResolvedValue({ id: ID.event });
    db.equipmentRequest.findUnique.mockResolvedValue(row);
    db.equipmentRequest.findMany.mockResolvedValue(holds);
    db.equipmentRequest.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.request, ...data }));
    return token;
  }

  function post(token?: string, reference = REF) {
    return reserve(
      req("POST", `/api/events/${reference}/equipment/${ID.request}/reserve`, { token }),
      params({ id: reference, requestId: ID.request })
    );
  }

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("[SPM-49] is 404 for a malformed event reference", async () => {
    expect((await post(signIn(techSupport()), "nope")).status).toBe(404);
  });

  it("[SPM-49] is 404 when the request does not exist", async () => {
    expect((await post(given(null))).status).toBe(404);
  });

  it("[SPM-49] is 404 when the request belongs to a different event than the URL names", async () => {
    const res = await post(given(requestRow({ eventId: "another-event" })));

    expect(res.status).toBe(404);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-49] is 404 for a draft, which Technical Support cannot see", async () => {
    expect((await post(given(requestRow({}, { status: "draft" })))).status).toBe(404);
  });

  it.each([
    ["the assigned coordinator", () => user("coordinator", { id: ID.otherUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
    ["the Ops Manager", () => user("ops_manager")],
  ])("[SPM-21][AC4] is 403 for %s", async (_who, actor) => {
    const res = await post(given(requestRow(), [], actor()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Technical Support Staff can reserve equipment" });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it.each(["submitted", "under_review", "approved", "postponed", "cancelled", "rejected", "completed"])(
    "[SPM-49] is 404 for an event that is %s - Technical Support does not see its equipment",
    async (status) => {
      const res = await post(given(requestRow({}, { status })));

      expect(res.status).toBe(404);
      expect(db.$transaction).not.toHaveBeenCalled();
    }
  );

  it("[SPM-49] refuses to reserve into a confirmed event, whose equipment is final", async () => {
    const res = await post(given(requestRow({}, { status: "confirmed" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This event is confirmed — its equipment is final. A change now goes through a change request.",
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("[SPM-49][AC1][AC2] reserves everything requested when it is all available", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given(requestRow());

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update)).toMatchObject({
      where: { id: ID.request },
      data: { quantityReserved: 4, status: "reserved", reviewedBy: ID.user, reviewedAt: NOW },
    });
  });

  it("[SPM-49][AC4][AC5] reserves only what is left when another event holds some, and marks it partially fulfilled", async () => {
    const token = given(requestRow(), [otherHold({ quantityReserved: 7 })]);

    const res = await post(token);

    expect(res.status).toBe(200);
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({
      quantityReserved: 3,
      status: "partially_fulfilled",
    });
  });

  it("[SPM-55][AC3] does not count units that are out of service", async () => {
    const token = given(requestRow({ equipment: projector({ quantityInMaintenance: 9 }) }));

    await post(token);

    expect(callArg(db.equipmentRequest.update).data).toMatchObject({
      quantityReserved: 1,
      status: "partially_fulfilled",
    });
  });

  it("[SPM-49][AC5] refuses when nothing is left for the dates", async () => {
    const token = given(requestRow(), [otherHold({ quantityReserved: 10 })]);

    const res = await post(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing is available for these dates any more." });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-48][AC7] refuses a retired item, whatever quantity is still on record", async () => {
    const res = await post(given(requestRow({ equipment: projector({ isActive: false }) })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing is available for these dates any more." });
  });

  it("[SPM-48][AC3] refuses while the event has no dates", async () => {
    const res = await post(given(requestRow({}, { startsAt: null, endsAt: null })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Set the event date and time before reserving equipment" });
  });

  it("[SPM-49] refuses when the request disappears between the access check and the lock", async () => {
    const token = given(requestRow());
    db.equipmentRequest.findUnique.mockResolvedValueOnce(requestRow()).mockResolvedValueOnce(null);

    const res = await post(token);

    expect(res.status).toBe(400);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("[SPM-50][AC4] clears the 'cannot be provided' reason when such a line is reserved after all", async () => {
    const token = given(requestRow({ status: "unavailable", staffNotes: "Both units out for repair" }));

    await post(token);

    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ status: "reserved", staffNotes: null });
  });

  it("[SPM-50][AC4] keeps Technical Support's notes on any other line it reserves", async () => {
    const token = given(requestRow({ status: "under_review", staffNotes: "Deliver to the loading bay" }));

    await post(token);

    expect(callArg(db.equipmentRequest.update).data).not.toHaveProperty("staffNotes");
  });

  it("[SPM-49] refuses a request that has been withdrawn", async () => {
    const res = await post(given(requestRow({ status: "cancelled" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This request has been withdrawn and can no longer be reserved." });
  });

  it("[SPM-49][AC4] re-reserving a line does not count its own reservation against it", async () => {
    const token = given(requestRow({ status: "reserved", quantityReserved: 4 }));

    await post(token);

    expect(callArg(db.equipmentRequest.findMany).where).toEqual({
      equipmentId: ID.equipment,
      id: { not: ID.request },
      status: { in: ["reserved", "partially_fulfilled"] },
    });
    expect(callArg(db.equipmentRequest.update).data).toMatchObject({ quantityReserved: 4, status: "reserved" });
  });

  it("[SPM-49][AC5] locks the equipment row before reading availability, so two reservations cannot both take the last unit", async () => {
    const token = given(requestRow());

    await post(token);

    const [sql, lockedId] = db.$queryRaw.mock.calls[0];
    expect(sql.join("?")).toBe("SELECT id FROM equipment WHERE id = ? FOR UPDATE");
    expect(lockedId).toBe(ID.equipment);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      db.equipmentRequest.findMany.mock.invocationCallOrder[0]
    );
  });

  it("[SPM-49] answers 500 when the database fails inside the transaction", async () => {
    const token = given(requestRow());
    db.$queryRaw.mockRejectedValue(new Error("lock timeout"));

    const res = await post(token);

    expect(res.status).toBe(500);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });
});
