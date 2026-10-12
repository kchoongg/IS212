import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/events/route";
import { callArg, db, ID, req, signIn, user } from "@/test/kit";

const HOUR = 60 * 60 * 1000;

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("GET /api/events", () => {
  it("is 401 without a session", async () => {
    expect((await GET(req("GET", "/api/events"))).status).toBe(401);
  });

  it("scopes an organiser to their own events and their organisation's submitted ones", async () => {
    const organiser = user("organiser");
    const token = signIn(organiser);
    db.event.findMany.mockResolvedValue([]);

    await GET(req("GET", "/api/events", { token }));

    expect(callArg(db.event.findMany).where).toEqual({
      OR: [{ organiserId: organiser.id }, { organisationId: organiser.organisationId, status: { not: "draft" } }],
    });
  });

  it.each(["coordinator", "ops_manager", "venue_staff", "tech_support"])(
    "shows %s every event except drafts",
    async (role) => {
      const token = signIn(user(role));
      db.event.findMany.mockResolvedValue([]);

      await GET(req("GET", "/api/events", { token }));

      expect(callArg(db.event.findMany).where).toEqual({ status: { not: "draft" } });
    }
  );

  it("returns the whole record to staff", async () => {
    const token = signIn(user("coordinator"));
    const events = [{ id: ID.event, title: "Gala", specialRequirements: "VIP entrance", coordinatorId: ID.user }];
    db.event.findMany.mockResolvedValue(events);

    const res = await GET(req("GET", "/api/events", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(events);
  });

  // CHANGED (SPM-64, #10): plus the confirmed events they hold a place in.
  it("shows an attendee confirmed events open for registration or that they hold a place in, and only their public fields", async () => {
    const token = signIn(user("attendee"));
    db.event.findMany.mockResolvedValue([
      {
        id: ID.event,
        sequenceNumber: 9,
        title: "Client Forum",
        status: "confirmed",
        registrationEnabled: true,
        organisation: { name: "Meridian" },
        // Internal planning information - must not reach an attendee.
        coordinatorId: ID.otherUser,
        organiserId: ID.thirdUser,
        specialRequirements: "VIP entrance",
        rejectionReason: null,
        facilityRequirements: [],
      },
    ]);

    const res = await GET(req("GET", "/api/events", { token }));

    expect(callArg(db.event.findMany).where).toEqual({
      status: "confirmed",
      OR: [
        { registrationEnabled: true },
        { registrations: { some: { attendeeId: ID.user, status: { in: ["registered", "waitlisted"] } } } },
      ],
    });
    expect(await res.json()).toEqual([
      {
        id: ID.event,
        sequenceNumber: 9,
        title: "Client Forum",
        status: "confirmed",
        registrationEnabled: true,
        organisation: { name: "Meridian" },
      },
    ]);
  });
});

describe("POST /api/events", () => {
  function create(token: string | undefined, body: object) {
    return POST(req("POST", "/api/events", { token, body }));
  }

  /// The create inside the transaction, then the re-read the route returns.
  function givenCreateSucceeds() {
    db.event.create.mockResolvedValue({ id: ID.event });
    db.event.findUniqueOrThrow.mockResolvedValue({ id: ID.event, status: "draft" });
  }

  it("is 401 without a session", async () => {
    expect((await create(undefined, { title: "Gala" })).status).toBe(401);
  });

  it.each(["coordinator", "ops_manager", "venue_staff", "tech_support", "attendee"])(
    "is 403 for %s - only an organiser raises a request",
    async (role) => {
      const res = await create(signIn(user(role)), { title: "Gala" });

      expect(res.status).toBe(403);
      expect(db.event.create).not.toHaveBeenCalled();
    }
  );

  it("saves a title-only request as a draft owned by the organiser", async () => {
    const organiser = user("organiser");
    const token = signIn(organiser);
    givenCreateSucceeds();

    const res = await create(token, { title: "  Gala Dinner  " });
    const written = callArg(db.event.create).data;

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID.event, status: "draft" });
    expect(written).toMatchObject({
      title: "Gala Dinner",
      status: "draft",
      organiserId: organiser.id,
      organisationId: organiser.organisationId,
      registrationEnabled: false,
    });
    expect(written.startsAt).toBeUndefined();
    expect(written.facilityRequirements).toBeUndefined();
    expect(written.equipmentRequests).toBeUndefined();
  });

  it("takes the organisation from the signed-in user, never from the body", async () => {
    const organiser = user("organiser");
    const token = signIn(organiser);
    givenCreateSucceeds();

    await create(token, { title: "Gala", organisationId: ID.otherOrg, organiserId: ID.otherUser, status: "confirmed" });
    const written = callArg(db.event.create).data;

    expect(written.organisationId).toBe(organiser.organisationId);
    expect(written.organiserId).toBe(organiser.id);
    expect(written.status).toBe("draft");
  });

  it("stores ticked facilities as mandatory requirement rows", async () => {
    const token = signIn(user("organiser"));
    givenCreateSucceeds();

    await create(token, { title: "Gala", facilityIds: [ID.facility] });

    expect(callArg(db.event.create).data.facilityRequirements).toEqual({
      create: [{ facilityId: ID.facility, isMandatory: true }],
    });
  });

  it("stores the registration settings and window", async () => {
    const token = signIn(user("organiser"));
    givenCreateSucceeds();

    const res = await create(token, {
      title: "Gala",
      startsAt: "2027-03-04T01:00:00.000Z",
      endsAt: "2027-03-04T09:00:00.000Z",
      registrationEnabled: true,
      registrationCapacity: 150,
      registrationOpensAt: "2027-02-01T00:00:00.000Z",
      registrationClosesAt: "2027-03-01T00:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(callArg(db.event.create).data).toMatchObject({
      registrationEnabled: true,
      registrationCapacity: 150,
      registrationOpensAt: new Date("2027-02-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2027-03-01T00:00:00.000Z"),
    });
  });

  it("requests equipment for two hours either side of the event", async () => {
    const organiser = user("organiser");
    const token = signIn(organiser);
    givenCreateSucceeds();
    db.equipment.findFirst.mockResolvedValue(null);
    const startsAt = "2027-03-04T01:00:00.000Z";
    const endsAt = "2027-03-04T09:00:00.000Z";

    const res = await create(token, {
      title: "Gala",
      startsAt,
      endsAt,
      equipment: [{ equipmentId: ID.equipment, quantityRequested: 4, technicalRequirements: "HDMI" }],
    });

    expect(res.status).toBe(201);
    expect(callArg(db.event.create).data.equipmentRequests).toEqual({
      create: [
        {
          equipmentId: ID.equipment,
          quantityRequested: 4,
          technicalRequirements: "HDMI",
          startsAt: new Date(new Date(startsAt).getTime() - 2 * HOUR),
          endsAt: new Date(new Date(endsAt).getTime() + 2 * HOUR),
          requestedBy: organiser.id,
          status: "requested",
        },
      ],
    });
  });

  it("refuses equipment that has been retired", async () => {
    const token = signIn(user("organiser"));
    db.equipment.findFirst.mockResolvedValue({ name: "Overhead projector" });

    const res = await create(token, {
      title: "Gala",
      startsAt: "2027-03-04T01:00:00.000Z",
      endsAt: "2027-03-04T09:00:00.000Z",
      equipment: [{ equipmentId: ID.equipment, quantityRequested: 1 }],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Overhead projector has been retired and can no longer be requested" });
    expect(callArg(db.equipment.findFirst).where).toEqual({ id: { in: [ID.equipment] }, isActive: false });
    expect(db.event.create).not.toHaveBeenCalled();
  });

  describe("with sessions", () => {
    const sessions = [
      {
        label: "Day 2",
        startsAt: "2027-03-05T01:00:00.000Z",
        endsAt: "2027-03-05T09:00:00.000Z",
        expectedAttendance: 120,
      },
      {
        label: "Day 1",
        startsAt: "2027-03-04T02:00:00.000Z",
        endsAt: "2027-03-04T06:00:00.000Z",
        expectedAttendance: 80,
        preferredLayout: "theatre",
        equipment: [{ equipmentId: ID.equipment, quantityRequested: 2 }],
      },
    ];

    it("derives the event's start, end and attendance from its sessions", async () => {
      const token = signIn(user("organiser"));
      givenCreateSucceeds();

      // The body's own dates and attendance are ignored once sessions are sent.
      const res = await create(token, {
        title: "Summit",
        startsAt: "2027-01-01T00:00:00.000Z",
        endsAt: "2027-01-01T01:00:00.000Z",
        expectedAttendance: 5,
        sessions,
      });

      expect(res.status).toBe(201);
      expect(callArg(db.event.create).data).toMatchObject({
        startsAt: new Date("2027-03-04T02:00:00.000Z"),
        endsAt: new Date("2027-03-05T09:00:00.000Z"),
        expectedAttendance: 120,
      });
    });

    it("writes each session, and its equipment against that session's own window", async () => {
      const organiser = user("organiser");
      const token = signIn(organiser);
      givenCreateSucceeds();

      await create(token, { title: "Summit", sessions });
      const sessionRows = callArg(db.eventSession.createMany).data;
      const equipmentRows = callArg(db.equipmentRequest.createMany).data;

      expect(sessionRows).toHaveLength(2);
      expect(sessionRows[1]).toMatchObject({
        eventId: ID.event,
        label: "Day 1",
        startsAt: new Date("2027-03-04T02:00:00.000Z"),
        endsAt: new Date("2027-03-04T06:00:00.000Z"),
        expectedAttendance: 80,
        preferredLayout: "theatre",
      });
      expect(sessionRows[0].preferredLayout).toBeNull();
      expect(equipmentRows).toEqual([
        {
          eventId: ID.event,
          sessionId: sessionRows[1].id,
          equipmentId: ID.equipment,
          quantityRequested: 2,
          technicalRequirements: undefined,
          startsAt: new Date("2027-03-04T00:00:00.000Z"),
          endsAt: new Date("2027-03-04T08:00:00.000Z"),
          requestedBy: organiser.id,
          status: "requested",
        },
      ]);
    });

    it("writes no equipment rows when no session asks for any", async () => {
      const token = signIn(user("organiser"));
      givenCreateSucceeds();

      await create(token, { title: "Summit", sessions: sessions.map((s) => ({ ...s, equipment: undefined })) });

      expect(db.eventSession.createMany).toHaveBeenCalledOnce();
      expect(db.equipmentRequest.createMany).not.toHaveBeenCalled();
    });

    it("rejects a single session - one session is just an event", async () => {
      const token = signIn(user("organiser"));

      const res = await create(token, { title: "Summit", sessions: [sessions[0]] });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.details.fieldErrors.sessions).toContain("A multi-session event needs at least two sessions");
    });

    it("rejects the same item requested by two sessions", async () => {
      const token = signIn(user("organiser"));
      const equipment = [{ equipmentId: ID.equipment, quantityRequested: 1 }];

      const res = await create(token, { title: "Summit", sessions: sessions.map((s) => ({ ...s, equipment })) });

      expect(res.status).toBe(400);
      expect(db.event.create).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["a blank title", { title: "   " }, "title"],
    [
      "an end before the start",
      { title: "Gala", startsAt: "2027-03-04T09:00:00.000Z", endsAt: "2027-03-04T01:00:00.000Z" },
      "endsAt",
    ],
    ["registration switched on without a capacity", { title: "Gala", registrationEnabled: true }, "registrationCapacity"],
    [
      "registration closing after the event starts",
      {
        title: "Gala",
        startsAt: "2027-03-04T01:00:00.000Z",
        endsAt: "2027-03-04T09:00:00.000Z",
        registrationClosesAt: "2027-03-04T02:00:00.000Z",
      },
      "registrationClosesAt",
    ],
    [
      "equipment on an event with no dates",
      { title: "Gala", equipment: [{ equipmentId: ID.equipment, quantityRequested: 1 }] },
      "equipment",
    ],
    [
      "the same equipment item twice",
      {
        title: "Gala",
        startsAt: "2027-03-04T01:00:00.000Z",
        endsAt: "2027-03-04T09:00:00.000Z",
        equipment: [
          { equipmentId: ID.equipment, quantityRequested: 1 },
          { equipmentId: ID.equipment, quantityRequested: 2 },
        ],
      },
      "equipment",
    ],
  ])("rejects %s", async (_case, body, field) => {
    const token = signIn(user("organiser"));

    const res = await create(token, body);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.fieldErrors).toHaveProperty(field);
    expect(db.event.create).not.toHaveBeenCalled();
  });

  it("gives the transaction longer than Prisma's 5 second default", async () => {
    const token = signIn(user("organiser"));
    givenCreateSucceeds();

    await create(token, { title: "Gala" });

    expect(db.$transaction.mock.calls[0][1]).toEqual({ timeout: 15000 });
  });

  it("reports a duplicate item caught only by the database's unique index", async () => {
    const token = signIn(user("organiser"));
    db.event.create.mockRejectedValue(uniqueConstraintError());

    const res = await create(token, { title: "Gala" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Each item can only be requested once per event, across all sessions." });
  });

  it("answers 500 when the database fails", async () => {
    const token = signIn(user("organiser"));
    db.event.create.mockRejectedValue(new Error("connection lost"));

    expect((await create(token, { title: "Gala" })).status).toBe(500);
  });
});
