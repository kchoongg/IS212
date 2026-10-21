import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/registrations/route";
import { callArg, db, ID, req, signIn, user } from "@/test/kit";

const NOW = new Date("2026-10-02T04:00:00Z");

/// An event an attendee can register for right now. Each test changes the one
/// field its rule depends on.
/// CHANGED (SPM-51 AC3): it has a registration period, because an event with
/// none is no longer eligible.
function openEvent(overrides = {}) {
  return {
    id: ID.event,
    organiserId: ID.otherUser,
    organisationId: ID.org,
    coordinatorId: ID.thirdUser,
    status: "confirmed",
    registrationEnabled: true,
    registrationCapacity: null,
    registrationOpensAt: new Date("2026-10-01T00:00:00Z"),
    registrationClosesAt: new Date("2026-10-03T00:00:00Z"),
    ...overrides,
  };
}

function register(token: string | undefined, body: object = { eventId: ID.event }) {
  return POST(req("POST", "/api/registrations", { token, body }));
}

describe("POST /api/registrations", () => {
  // Fixed so whether the period is open never depends on the day the tests run.
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await register(undefined)).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "venue_staff", "tech_support"])(
    "[SPM-21][AC4] is 403 for %s - only an Attendee registers",
    async (role) => {
      const res = await register(signIn(user(role)));

      expect(res.status).toBe(403);
      expect(db.registration.create).not.toHaveBeenCalled();
    }
  );

  it("[SPM-51][AC2][AC5] registers an attendee for a confirmed event that is open", async () => {
    const attendee = user("attendee");
    const token = signIn(attendee);
    db.event.findUnique.mockResolvedValue(openEvent());
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "r1", ...data }));

    const res = await register(token, {
      eventId: ID.event,
      dietaryRequirements: "Vegetarian",
      accessibilityRequirements: "Step-free access",
    });

    expect(res.status).toBe(201);
    expect(callArg(db.registration.create).data).toEqual({
      eventId: ID.event,
      attendeeId: attendee.id,
      dietaryRequirements: "Vegetarian",
      accessibilityRequirements: "Step-free access",
      status: "registered",
    });
  });

  it("[SPM-51] rejects an eventId that is not a UUID", async () => {
    const res = await register(signIn(user("attendee")), { eventId: "EVT-000001" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
  });

  it("[SPM-51] is 404 for an event that does not exist", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(null);

    expect((await register(token)).status).toBe(404);
  });

  it.each([
    ["not confirmed yet", { status: "planning" }],
    ["confirmed but with registration switched off", { registrationEnabled: false }],
  ])("[SPM-51][AC3] is 404, not 400, for an event the attendee cannot see: %s", async (_case, overrides) => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent(overrides));

    const res = await register(token);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Event not found" });
    expect(db.registration.create).not.toHaveBeenCalled();
  });

  it("[SPM-51][AC3][AC4] refuses before the registration window opens", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent({ registrationOpensAt: new Date("2026-10-03T00:00:00Z") }));

    const res = await register(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Registration has not opened yet" });
  });

  it("[SPM-51][AC3][AC4] refuses after the registration window closes", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent({ registrationClosesAt: new Date("2026-10-01T00:00:00Z") }));

    const res = await register(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Registration has closed" });
  });

  // SPM-51 AC3 (TC08): no period, no registration.
  it.each([
    ["no opening date", { registrationOpensAt: null }],
    ["no closing date", { registrationClosesAt: null }],
  ])("[SPM-51][AC3][AC8] refuses an event with %s, and writes nothing", async (_what, overrides) => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent(overrides));

    const res = await register(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Registration dates haven't been set for this event" });
    expect(db.registration.create).not.toHaveBeenCalled();
  });

  it.each(["registered", "attended"])("[SPM-51][AC7] refuses a second registration while the first is %s", async (status) => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent());
    db.registration.findUnique.mockResolvedValue({ id: "r1", status });

    const res = await register(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Already registered for this event" });
    expect(db.registration.create).not.toHaveBeenCalled();
    expect(db.registration.update).not.toHaveBeenCalled();
  });

  it("[SPM-51][AC7] [SPM-52][AC3] reactivates a withdrawn registration instead of inserting a second row", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent());
    db.registration.findUnique.mockResolvedValue({ id: "r1", status: "withdrawn" });
    db.registration.update.mockResolvedValue({ id: "r1", status: "registered" });

    const res = await register(token, { eventId: ID.event, dietaryRequirements: "Halal" });

    expect(res.status).toBe(201);
    expect(db.registration.create).not.toHaveBeenCalled();
    expect(callArg(db.registration.update)).toEqual({
      where: { id: "r1" },
      data: {
        status: "registered",
        registeredAt: NOW,
        withdrawnAt: null,
        dietaryRequirements: "Halal",
        accessibilityRequirements: undefined,
      },
    });
  });

  it("[SPM-51][AC9] refuses when every seat is taken", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent({ registrationCapacity: 50 }));
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.count.mockResolvedValue(50);

    const res = await register(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This event is full" });
    expect(db.registration.create).not.toHaveBeenCalled();
    // SPM-51 AC10: offer only - joining the waiting list is its own story,
    // so a full event never quietly waitlists the attendee.
    expect(db.registration.update).not.toHaveBeenCalled();
    expect(db.registration.upsert).not.toHaveBeenCalled();
  });

  it("[SPM-51][AC9] takes the last seat, counting only registered and attended as taken", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent({ registrationCapacity: 50 }));
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.count.mockResolvedValue(49);
    db.registration.create.mockResolvedValue({ id: "r1" });

    const res = await register(token);

    expect(res.status).toBe(201);
    expect(callArg(db.registration.count).where).toEqual({
      eventId: ID.event,
      status: { in: ["registered", "attended"] },
    });
  });

  // SPM-111: the race itself is shown on a real database
  // (integration/registration.test.ts); here, that the lock comes first.
  it("[SPM-51][AC9][BUG-111] locks the event's row before counting the seats taken", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent({ registrationCapacity: 50 }));
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.count.mockResolvedValue(49);
    db.registration.create.mockResolvedValue({ id: "r1" });

    await register(token);

    const [sql, eventId] = db.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join("?")).toBe("SELECT id FROM events WHERE id = ? FOR UPDATE");
    expect(eventId).toBe(ID.event);
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.registration.count.mock.invocationCallOrder[0]);
  });

  it("[SPM-51][AC9] does not count seats for an event with no capacity limit", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent({ registrationCapacity: null }));
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.create.mockResolvedValue({ id: "r1" });

    await register(token);

    expect(db.registration.count).not.toHaveBeenCalled();
  });

  it("[SPM-51][AC7] reports a duplicate caught only by the database's unique constraint", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockResolvedValue(openEvent());
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.create.mockRejectedValue(new Error("Unique constraint failed on the fields: (`event_id`)"));

    const res = await register(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Already registered for this event" });
  });

  it("[SPM-51] answers 500 when the database fails", async () => {
    const token = signIn(user("attendee"));
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await register(token)).status).toBe(500);
  });
});

// SPM-51 AC6 (TC11): an attendee's own registrations, for My Registrations.
describe("GET /api/registrations", () => {
  const list = (token: string | undefined) => GET(req("GET", "/api/registrations", { token }));

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await list(undefined)).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "venue_staff", "tech_support"])(
    "[SPM-21][AC4] is 403 for %s, without reading any registrations",
    async (role) => {
      const res = await list(signIn(user(role)));

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Registrations belong to an Attendee account." });
      expect(db.registration.findMany).not.toHaveBeenCalled();
    }
  );

  it("[SPM-51][AC6] gives an attendee their own registrations, newest first, with each event's title and time", async () => {
    const attendee = user("attendee");
    const token = signIn(attendee);
    db.registration.findMany.mockResolvedValue([
      {
        id: "r2",
        status: "waitlisted",
        registeredAt: new Date("2026-10-08T02:00:00Z"),
        event: {
          sequenceNumber: 44,
          title: "SPM51 Sold Out Summit",
          startsAt: new Date("2028-01-29T01:00:00Z"),
          endsAt: new Date("2028-01-29T09:00:00Z"),
        },
      },
    ]);

    const res = await list(token);

    expect(res.status).toBe(200);
    expect(callArg(db.registration.findMany)).toEqual({
      where: { attendeeId: attendee.id },
      orderBy: { registeredAt: "desc" },
      select: {
        id: true,
        status: true,
        registeredAt: true,
        event: {
          select: {
            sequenceNumber: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            registrationEnabled: true,
            registrationClosesAt: true,
          },
        },
      },
    });
    expect(await res.json()).toEqual([
      {
        id: "r2",
        status: "waitlisted",
        registeredAt: "2026-10-08T02:00:00.000Z",
        event: {
          sequenceNumber: 44,
          title: "SPM51 Sold Out Summit",
          startsAt: "2028-01-29T01:00:00.000Z",
          endsAt: "2028-01-29T09:00:00.000Z",
        },
      },
    ]);
  });

  it("[SPM-51] answers 500 when the database fails", async () => {
    const token = signIn(user("attendee"));
    db.registration.findMany.mockRejectedValue(new Error("connection lost"));

    expect((await list(token)).status).toBe(500);
  });
});
