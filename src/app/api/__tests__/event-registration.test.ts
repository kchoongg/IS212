// SPM-64 Configure Event Registration - the route these tests pin down (written test-first):
//   src/app/api/events/[id]/registration/route.ts   exports PATCH
//   PATCH /api/events/EVT-000007/registration, body = any of the registration settings
//     (strict schema: any other key -> 400 "Validation failed").
//   -> 401 no session; 404 malformed / unknown / not visible (canViewEvent);
//      403 "Only the coordinator assigned to this event can change its registration settings";
//      400 "Registration settings can only be changed while the event is Approved, Planning or Confirmed.";
//      200 { event, flagged }; 500 on a database failure.
//   Writes: prisma.event.update({ where: { id }, data: <changed settings> }).
// Manual cases: docs/test-cases/SPM-64_test_cases.json (wording decided there).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { PATCH } from "@/app/api/events/[id]/registration/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const ORGANISER_ID = "organiser-id";

const assignedCoordinator = () => user("coordinator", { id: ID.user });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "SPM64 Orchard Data Forum",
    status: "planning",
    organiserId: ORGANISER_ID,
    organisationId: ID.org,
    coordinatorId: ID.user,
    startsAt: new Date("2027-03-17T01:00:00.000Z"),
    endsAt: new Date("2027-03-17T09:00:00.000Z"),
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    registrationReviewReason: null,
    ...overrides,
  };
}

/// Signs `actor` in and loads the event.
function given(eventOverrides: Record<string, unknown> = {}, actor = assignedCoordinator()) {
  const token = signIn(actor);
  const row = event(eventOverrides);
  db.event.findUnique.mockResolvedValue(row);
  db.event.update.mockImplementation(async ({ data }: { data: object }) => ({ ...row, ...data }));
  return token;
}

function save(token: string | undefined, body: unknown, reference = REF) {
  return PATCH(
    req("PATCH", `/api/events/${reference}/registration`, { token, body }),
    params({ id: reference })
  );
}

const nothingWritten = () => expect(db.event.update).not.toHaveBeenCalled();

describe("AC1 the assigned coordinator turns registration on or off", () => {
  it("turns registration on (TC01)", async () => {
    const token = given({ registrationEnabled: false });

    const res = await save(token, { registrationEnabled: true });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update)).toMatchObject({ where: { id: ID.event }, data: { registrationEnabled: true } });
    const body = await res.json();
    expect(body.event.registrationEnabled).toBe(true);
    expect(body.flagged).toEqual([]);
  });

  it("turns registration off without clearing the saved capacity and period (TC02)", async () => {
    const token = given({
      status: "confirmed",
      registrationEnabled: true,
      registrationCapacity: 50,
      registrationOpensAt: new Date("2026-08-01T01:00:00.000Z"),
      registrationClosesAt: new Date("2026-09-30T09:00:00.000Z"),
    });

    const res = await save(token, { registrationEnabled: false });

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).data).toEqual({ registrationEnabled: false });
  });

  it.each(["submitted", "under_review", "postponed", "completed", "cancelled", "rejected", "withdrawn"])(
    "refuses an event that is %s (TC03)",
    async (status) => {
      const token = given({ status });

      const res = await save(token, { registrationEnabled: true });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Registration settings can only be changed while the event is Approved, Planning or Confirmed.",
      });
      nothingWritten();
    }
  );

  it.each([
    ["a field that is not a registration setting", { registrationEnabled: true, title: "New name" }],
    ["a switch that is not true or false", { registrationEnabled: "yes" }],
  ])("refuses a body with %s", async (_what, body) => {
    const token = given();

    const res = await save(token, body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    nothingWritten();
  });

  it("is 500 when the database fails", async () => {
    const token = given();
    db.event.update.mockRejectedValue(new Error("connection lost"));

    const res = await save(token, { registrationEnabled: true });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

/// The event's one approved booking: Orchard Seminar Room, 70 as a classroom.
const classroomBooking = {
  id: ID.booking,
  status: "approved",
  layoutName: "classroom",
  venue: {
    name: "Orchard Seminar Room",
    code: "ORC-SEM",
    layouts: [
      { layoutName: "theatre", capacity: 120 },
      { layoutName: "classroom", capacity: 70 },
    ],
  },
};

describe("AC2 the coordinator sets a registration capacity", () => {
  it("saves the capacity, checked against the event's own bookings (TC04)", async () => {
    const token = given({ registrationEnabled: true });
    db.venueBooking.findMany.mockResolvedValue([classroomBooking]);

    const res = await save(token, { registrationCapacity: 60 });

    expect(res.status).toBe(200);
    expect(callArg(db.venueBooking.findMany).where).toEqual({ eventId: ID.event });
    expect(callArg(db.event.update).data).toEqual({ registrationCapacity: 60 });
  });

  it.each([0, -5, 12.5])("refuses a capacity of %s under its field, and writes nothing (TC05)", async (capacity) => {
    const token = given({ registrationEnabled: true });

    const res = await save(token, { registrationCapacity: capacity });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.registrationCapacity).toEqual(["Enter a whole number, at least 1."]);
    nothingWritten();
  });

  it("doesn't read the bookings when the capacity isn't being changed", async () => {
    const token = given();

    await save(token, { registrationEnabled: true });

    expect(db.venueBooking.findMany).not.toHaveBeenCalled();
  });
});

describe("AC3 the capacity cannot exceed the booked room's layout capacity", () => {
  it("refuses a capacity over the limit as a field error, and writes nothing (TC06)", async () => {
    const token = given({ registrationEnabled: true });
    db.venueBooking.findMany.mockResolvedValue([classroomBooking]);

    const res = await save(token, { registrationCapacity: 71 });

    const message =
      "Registration capacity can't be more than 70, the capacity of Orchard Seminar Room (ORC-SEM) in its Classroom layout.";
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message, details: { fieldErrors: { registrationCapacity: [message] } } });
    nothingWritten();
  });
});

describe("AC11 only the assigned coordinator changes registration settings", () => {
  it("is 401 without a session", async () => {
    expect((await save(undefined, { registrationEnabled: true })).status).toBe(401);
    nothingWritten();
  });

  it.each(["nope", ID.event])("is 404 for the malformed reference %s, without querying", async (reference) => {
    const token = signIn(assignedCoordinator());

    expect((await save(token, { registrationEnabled: true }, reference)).status).toBe(404);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("is 404 for a reference that matches no event", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(null);

    expect((await save(token, { registrationEnabled: true })).status).toBe(404);
  });

  it("is 404, not 403, for an attendee and an event they may not see", async () => {
    const token = given({}, user("attendee", { id: ID.thirdUser }));

    expect((await save(token, { registrationEnabled: true })).status).toBe(404);
    nothingWritten();
  });

  it.each([
    ["the organiser who raised it (TC23)", () => user("organiser", { id: ORGANISER_ID })],
    ["a coordinator who is not assigned (TC24)", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager (TC24)", () => user("ops_manager", { id: ID.thirdUser })],
    ["Venue Staff (TC24)", () => user("venue_staff", { id: ID.thirdUser })],
    ["Technical Support (TC24)", () => user("tech_support", { id: ID.thirdUser })],
  ])("is 403 for %s, and writes nothing", async (_who, actor) => {
    const token = given({}, actor());

    const res = await save(token, { registrationEnabled: true });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only the coordinator assigned to this event can change its registration settings",
    });
    nothingWritten();
  });

  it("is 403 for an attendee who can see a confirmed event open for registration (TC25)", async () => {
    const token = given({ status: "confirmed", registrationEnabled: true }, user("attendee", { id: ID.thirdUser }));

    expect((await save(token, { registrationEnabled: false })).status).toBe(403);
    nothingWritten();
  });
});
