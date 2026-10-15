import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/equipment/route";
import { PATCH as recordOutOfService } from "@/app/api/equipment/[id]/out-of-service/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

describe("GET /api/equipment", () => {
  it("is 401 without a session", async () => {
    expect((await GET(req("GET", "/api/equipment"))).status).toBe(401);
  });

  it.each(["attendee", "venue_staff"])("is 403 for %s", async (role) => {
    const res = await GET(req("GET", "/api/equipment", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.equipment.findMany).not.toHaveBeenCalled();
  });

  it.each(["organiser", "coordinator", "ops_manager", "tech_support"])(
    "lists only active equipment for %s",
    async (role) => {
      const token = signIn(user(role));
      const items = [{ id: ID.equipment, name: "Projector", isActive: true }];
      db.equipment.findMany.mockResolvedValue(items);

      const res = await GET(req("GET", "/api/equipment", { token }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(items);
      expect(callArg(db.equipment.findMany).where).toEqual({ isActive: true });
    }
  );

  it("includes retired equipment for Technical Support when asked", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findMany.mockResolvedValue([]);

    await GET(req("GET", "/api/equipment?includeInactive=true", { token }));

    expect(callArg(db.equipment.findMany).where).toBeUndefined();
  });

  it("ignores includeInactive from a role that cannot manage the catalogue", async () => {
    const token = signIn(user("organiser"));
    db.equipment.findMany.mockResolvedValue([]);

    await GET(req("GET", "/api/equipment?includeInactive=true", { token }));

    expect(callArg(db.equipment.findMany).where).toEqual({ isActive: true });
  });
});

describe("POST /api/equipment", () => {
  const valid = { name: "Wireless microphone", category: "audio", totalQuantity: 10, quantityInMaintenance: 2 };

  it("is 401 without a session", async () => {
    expect((await POST(req("POST", "/api/equipment", { body: valid }))).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "venue_staff", "attendee"])(
    "is 403 for %s",
    async (role) => {
      const res = await POST(req("POST", "/api/equipment", { token: signIn(user(role)), body: valid }));

      expect(res.status).toBe(403);
      expect(db.equipment.create).not.toHaveBeenCalled();
    }
  );

  it("lets Technical Support add an item", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.create.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.equipment, ...data }));

    const res = await POST(req("POST", "/api/equipment", { token, body: valid }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID.equipment, ...valid });
    expect(callArg(db.equipment.create).data).toEqual(valid);
  });

  it("accepts an item with no maintenance figure", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.create.mockResolvedValue({ id: ID.equipment });

    const res = await POST(req("POST", "/api/equipment", { token, body: { name: "Lectern", totalQuantity: 0 } }));

    expect(res.status).toBe(201);
    expect(callArg(db.equipment.create).data).toEqual({ name: "Lectern", totalQuantity: 0 });
  });

  it("refuses more units in maintenance than the item has", async () => {
    const token = signIn(user("tech_support"));

    const res = await POST(
      req("POST", "/api/equipment", { token, body: { ...valid, totalQuantity: 1, quantityInMaintenance: 2 } })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "quantityInMaintenance cannot exceed totalQuantity" });
    expect(db.equipment.create).not.toHaveBeenCalled();
  });

  it("rejects a body that fails validation", async () => {
    const token = signIn(user("tech_support"));

    const res = await POST(req("POST", "/api/equipment", { token, body: { name: "", totalQuantity: -1 } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(Object.keys(body.details.fieldErrors).sort()).toEqual(["name", "totalQuantity"]);
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.create.mockRejectedValue(new Error("connection lost"));

    const res = await POST(req("POST", "/api/equipment", { token, body: valid }));

    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/equipment/[id]/out-of-service", () => {
  const path = `/api/equipment/${ID.equipment}/out-of-service`;
  const context = () => params({ id: ID.equipment });

  it("is 401 without a session", async () => {
    const res = await recordOutOfService(req("PATCH", path, { body: { quantityOutOfService: 1 } }), context());
    expect(res.status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "venue_staff", "attendee"])(
    "is 403 for %s",
    async (role) => {
      const token = signIn(user(role));

      const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 1 } }), context());

      expect(res.status).toBe(403);
      expect(db.equipment.update).not.toHaveBeenCalled();
    }
  );

  // CHANGED (SPM-55): the type of unavailability is recorded with the count.
  it("records the units out of service, their type and the reason", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue({ totalQuantity: 10 });
    db.equipment.update.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.equipment, ...data }));

    const res = await recordOutOfService(
      req("PATCH", path, { token, body: { quantityOutOfService: 3, type: "damaged", reason: "  Cracked lenses " } }),
      context()
    );

    expect(res.status).toBe(200);
    expect(callArg(db.equipment.update)).toEqual({
      where: { id: ID.equipment },
      data: { quantityInMaintenance: 3, outOfServiceType: "damaged", outOfServiceReason: "Cracked lenses" },
    });
  });

  it("clears the reason when no units are out of service", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue({ totalQuantity: 10 });
    db.equipment.update.mockResolvedValue({});

    await recordOutOfService(
      req("PATCH", path, { token, body: { quantityOutOfService: 0, reason: "Stale reason" } }),
      context()
    );

    expect(callArg(db.equipment.update).data).toEqual({
      quantityInMaintenance: 0,
      outOfServiceType: null,
      outOfServiceReason: null,
    });
  });

  it("is 404 for equipment that does not exist", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue(null);

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 1, type: "damaged" } }), context());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Equipment not found" });
  });

  it("refuses more units out of service than the item has", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue({ totalQuantity: 2 });

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 5, type: "damaged" } }), context());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Only 2 units in total - cannot mark 5 as out of service" });
    expect(db.equipment.update).not.toHaveBeenCalled();
  });

  it("rejects a negative quantity", async () => {
    const token = signIn(user("tech_support"));

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: -1 } }), context());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockRejectedValue(new Error("connection lost"));

    const res = await recordOutOfService(req("PATCH", path, { token, body: { quantityOutOfService: 1, type: "damaged" } }), context());

    expect(res.status).toBe(500);
  });
});

// SPM-55 - Record Equipment Unavailability.
//
// CONTRACT (SPM-55, written before the code):
//   PATCH /api/equipment/[id]/out-of-service takes { quantityOutOfService, type?, reason? }.
//     type is "unavailable" | "damaged" | "under_maintenance", required when any unit is out
//     (400 fieldErrors.type "Choose a type."), cleared with the reason at 0.
//     After saving, in one transaction: every Reserved / Partially fulfilled request for this item
//     whose event has not ended (event.endsAt > now, event not released) that the units LEFT can
//     no longer cover - but could before - is flagged (needsReview, reviewReason gains
//     "equipment_unavailable", flaggedAt) and its event's coordinator (or, with none, whoever
//     requested it) is notified. The request's status and quantities are never changed.
//     Answers the saved item plus flaggedReservations: [{ requestId, eventId, eventTitle,
//     sessionLabel, reserved, available }].
//   GET /api/equipment leaves out quantityInMaintenance, outOfServiceType and outOfServiceReason
//     for the Event Organiser - operational status is internal (AC6, decided 2026-10-11).
describe("SPM-55 - recording equipment unavailability", () => {
  const path = `/api/equipment/${ID.equipment}/out-of-service`;
  const context = () => params({ id: ID.equipment });
  const NOW = new Date("2026-10-11T02:00:00Z");
  const COORDINATOR = "coordinator-1";

  const presenter = (overrides: Record<string, unknown> = {}) => ({
    id: ID.equipment,
    name: "SPM55 Wireless Presenter",
    totalQuantity: 6,
    quantityInMaintenance: 0,
    isActive: true,
    locationVenueId: null,
    ...overrides,
  });

  /// A Reserved request of this item for an upcoming event, as the route reads it.
  function heldFor(id: string, title: string, day: string, quantityReserved: number | null, overrides: Record<string, unknown> = {}) {
    return {
      id,
      eventId: `event-${id}`,
      status: "reserved",
      quantityReserved,
      requestedBy: "requester-1",
      needsReview: false,
      reviewReason: null,
      sessionId: null,
      session: null,
      event: {
        title,
        status: "planning",
        coordinatorId: COORDINATOR,
        startsAt: new Date(`${day}T01:00:00Z`),
        endsAt: new Date(`${day}T05:00:00Z`),
        venueBookings: [],
      },
      ...overrides,
    };
  }

  function given(item = presenter(), held: object[] = []) {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const token = signIn(user("tech_support"));
    db.equipment.findUnique.mockResolvedValue(item);
    db.equipment.update.mockImplementation(async ({ data }: { data: object }) => ({ ...item, ...data }));
    db.equipmentRequest.findMany.mockResolvedValue(held);
    return token;
  }

  const record = (token: string, body: object) => recordOutOfService(req("PATCH", path, { token, body }), context());

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for a type when units are marked out of service", async () => {
    const token = given();

    const res = await record(token, { quantityOutOfService: 2 });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.type).toEqual(["Choose a type."]);
    expect(db.equipment.update).not.toHaveBeenCalled();
  });

  it("refuses a type that is not one of the three", async () => {
    const token = given();

    expect((await record(token, { quantityOutOfService: 2, type: "lost" })).status).toBe(400);
    expect(db.equipment.update).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "damaged", "under_maintenance"])("SPM-55-TC01: accepts the type %s", async (type) => {
    const token = given();

    expect((await record(token, { quantityOutOfService: 2, type })).status).toBe(200);
    expect(callArg(db.equipment.update).data.outOfServiceType).toBe(type);
  });

  it("SPM-55-TC04: keeps no reason when none is given", async () => {
    const token = given();

    await record(token, { quantityOutOfService: 6, type: "damaged" });

    expect(callArg(db.equipment.update).data).toEqual({
      quantityInMaintenance: 6,
      outOfServiceType: "damaged",
      outOfServiceReason: null,
    });
  });

  it("looks only at reservations of this item for events that have not ended", async () => {
    const token = given();

    await record(token, { quantityOutOfService: 1, type: "damaged" });

    expect(callArg(db.equipmentRequest.findMany).where).toEqual({
      equipmentId: ID.equipment,
      status: { in: ["reserved", "partially_fulfilled"] },
      event: { status: { notIn: ["cancelled", "postponed", "rejected", "draft"] }, endsAt: { gt: NOW } },
    });
  });

  it("SPM-55-TC06: flags a reservation the units left no longer cover, without changing it, and notifies its coordinator", async () => {
    const token = given(presenter(), [
      heldFor("launch", "SPM55 Harbour Product Launch", "2027-08-10", 4),
      heldFor("board", "SPM55 Quiet Board Meeting", "2027-08-24", 2),
    ]);

    const res = await record(token, { quantityOutOfService: 3, type: "damaged", reason: "Dropped in transit" });

    expect(res.status).toBe(200);
    expect((await res.json()).flaggedReservations).toEqual([
      {
        requestId: "launch",
        eventId: "event-launch",
        eventTitle: "SPM55 Harbour Product Launch",
        sessionLabel: null,
        reserved: 4,
        available: 3,
      },
    ]);
    expect(db.equipmentRequest.update).toHaveBeenCalledTimes(1);
    expect(callArg(db.equipmentRequest.update)).toEqual({
      where: { id: "launch" },
      data: { needsReview: true, reviewReason: "equipment_unavailable", flaggedAt: NOW },
    });
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    const notice = callArg(db.notification.create).data;
    expect(notice).toMatchObject({
      recipientId: COORDINATOR,
      type: "equipment_unavailable",
      title: "Equipment out of service - reservation needs review",
      eventId: "event-launch",
    });
    expect(notice.body).toContain("SPM55 Harbour Product Launch");
    expect(notice.body).toContain("Dropped in transit");
    expect(notice.body).toContain("flagged for review");
  });

  it("keeps the reasons an earlier change flagged the request for", async () => {
    const token = given(presenter(), [
      heldFor("launch", "SPM55 Harbour Product Launch", "2027-08-10", 4, {
        needsReview: true,
        reviewReason: "event_schedule_changed",
      }),
    ]);

    await record(token, { quantityOutOfService: 3, type: "damaged" });

    expect(callArg(db.equipmentRequest.update).data.reviewReason).toBe("event_schedule_changed,equipment_unavailable");
  });

  it("names the session, and an untitled event, in the notification and the result", async () => {
    const launch = heldFor("launch", "x", "2027-08-10", 4);
    const token = given(presenter(), [
      {
        ...launch,
        sessionId: "s1",
        session: { label: "Day 1", startsAt: launch.event.startsAt, endsAt: launch.event.endsAt },
        event: { ...launch.event, title: null },
      },
    ]);

    const res = await record(token, { quantityOutOfService: 3, type: "damaged" });

    expect((await res.json()).flaggedReservations[0]).toMatchObject({ eventTitle: null, sessionLabel: "Day 1" });
    expect(callArg(db.notification.create).data.body).toContain("for an event (Day 1) on");
  });

  it("notifies whoever requested the equipment when the event has no coordinator", async () => {
    const launch = heldFor("launch", "SPM55 Harbour Product Launch", "2027-08-10", 4);
    const token = given(presenter(), [{ ...launch, event: { ...launch.event, coordinatorId: null } }]);

    await record(token, { quantityOutOfService: 3, type: "damaged" });

    expect(callArg(db.notification.create).data.recipientId).toBe("requester-1");
  });

  it("SPM-55-TC07: flags nothing when the units left still cover every reservation", async () => {
    const token = given(presenter(), [heldFor("launch", "SPM55 Harbour Product Launch", "2027-08-10", 4)]);

    const res = await record(token, { quantityOutOfService: 2, type: "under_maintenance" });

    expect((await res.json()).flaggedReservations).toEqual([]);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("counts a reservation with no quantity recorded as holding none, so never flags it", async () => {
    const token = given(presenter(), [heldFor("blank", "SPM55 Unsized Booking", "2027-08-10", null)]);

    const res = await record(token, { quantityOutOfService: 6, type: "damaged" });

    expect((await res.json()).flaggedReservations).toEqual([]);
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("SPM-55-TC08: flags both events sharing the days when the units left cannot cover them both", async () => {
    const token = given(presenter(), [
      heldFor("morning", "SPM55 Morning Showcase", "2027-08-17", 3),
      heldFor("evening", "SPM55 Evening Showcase", "2027-08-17", 3),
    ]);

    const res = await record(token, { quantityOutOfService: 1, type: "unavailable" });

    expect((await res.json()).flaggedReservations.map((r: { eventTitle: string }) => r.eventTitle)).toEqual([
      "SPM55 Morning Showcase",
      "SPM55 Evening Showcase",
    ]);
    expect(db.notification.create).toHaveBeenCalledTimes(2);
  });

  it("does not flag again a reservation that was already short before this change", async () => {
    const token = given(presenter({ quantityInMaintenance: 3 }), [
      heldFor("launch", "SPM55 Harbour Product Launch", "2027-08-10", 4),
    ]);

    await record(token, { quantityOutOfService: 4, type: "damaged" });

    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("SPM-55-TC03: flags nothing when units are returned (AC5)", async () => {
    const token = given(presenter({ quantityInMaintenance: 3, outOfServiceType: "damaged" }), [
      heldFor("launch", "SPM55 Harbour Product Launch", "2027-08-10", 4),
    ]);

    const res = await record(token, { quantityOutOfService: 0 });

    expect(res.status).toBe(200);
    expect(callArg(db.equipment.update).data).toEqual({
      quantityInMaintenance: 0,
      outOfServiceType: null,
      outOfServiceReason: null,
    });
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  });

  it("writes in one transaction", async () => {
    const token = given();

    await record(token, { quantityOutOfService: 1, type: "damaged" });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/equipment - operational status is internal (SPM-55 AC6)", () => {
  const item = {
    id: ID.equipment,
    name: "SPM55 Spare Microphone Kit",
    category: "AV",
    totalQuantity: 5,
    quantityInMaintenance: 3,
    outOfServiceType: "under_maintenance",
    outOfServiceReason: "Cable fault",
    isActive: true,
  };

  it("SPM-55-TC11: leaves the status out for the Event Organiser", async () => {
    const token = signIn(user("organiser"));
    db.equipment.findMany.mockResolvedValue([item]);

    const [listed] = await (await GET(req("GET", "/api/equipment", { token }))).json();

    expect(listed).toEqual({ id: ID.equipment, name: "SPM55 Spare Microphone Kit", category: "AV", totalQuantity: 5, isActive: true });
  });

  it.each(["coordinator", "ops_manager", "tech_support"])("SPM-55-TC10: gives %s the status", async (role) => {
    const token = signIn(user(role));
    db.equipment.findMany.mockResolvedValue([item]);

    const [listed] = await (await GET(req("GET", "/api/equipment", { token }))).json();

    expect(listed).toEqual(item);
  });
});
