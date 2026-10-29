// SPM-62 Update Event Information - the route these tests pin down (written test-first):
//   src/app/api/events/[id]/information/route.ts   exports PATCH
//   PATCH /api/events/EVT-000007/information, body = any of the permitted fields:
//     title, category, purpose, description, startsAt, endsAt, expectedAttendance, preferredLayout,
//     accessibilityNotes, specialRequirements, facilityIds. Any other key (status, organiserId, equipment,
//     sessions, the registration settings - those are Configure Event Registration, SPM-64) -> 400
//     "Validation failed" (strict schema).
//   -> 401 no session; 404 malformed / unknown / not visible (canViewEvent);
//      403 "Only the coordinator assigned to this event can change its information" for anyone else;
//      400 "Event information can only be changed while the event is Approved, Planning, Safety review, Safety approved or Confirmed.";
//      400 { error, details.fieldErrors } for the same field rules as the draft edit, plus a start
//          before registration closes: startsAt "Registration closes after this start time. Change the
//          registration period first.";
//      400 "Session times and attendance can't be changed here yet." for schedule/attendance/layout on a
//          multi-session event;
//      200 { event, importantChanges, statusReverted, flagged, safetyCheckClosed }; 500 on a database failure.
//      SPM-88 (AC5, AC6): also allowed in Safety review and Safety approved. An important change there
//        closes the safety check and returns the event to Planning (safetyCheckClosed: true); one that
//        moves a Confirmed event back closes its approval too.
//      `flagged` words what THIS save flagged, one line per arrangement, for the page to show:
//        "Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed"
//        "Equipment: 4K Portable Projector × 2 – the date or time changed"
//        "Registrations: 12 attendees – the date or time changed"
//      Showing flags afterwards is Track Outstanding Arrangements (SPM-33) / Review Flagged Arrangements (SPM-68).
//   Reads: prisma.event.findUnique (with facilityRequirements and sessions), prisma.venueBooking.findMany,
//          prisma.equipmentRequest.findMany (each with the venue's / item's name), prisma.registration.count.
//   Writes, in one prisma.$transaction:
//     event.update({ where: { id }, data: <changed fields> [+ registrationReviewReason]
//                    [+ status: "planning", confirmedAt: null] })
//     venueBooking.update / equipmentRequest.update({ where: { id }, data: { needsReview: true, reviewReason, flaggedAt } })
//       - reviewReason merged with what is already stored, SPM-39's venue codes included
//     eventStatusHistory.create (confirmed -> planning, reason "Event information changed: <labels>")
//   SPM-53: the organiser is told of an important change (AC14) and of a move back to Planning
//   (AC15); Registered attendees of a new date and time (AC17).
// Decided here, not in the story: see docs/test-cases/SPM-62_test_cases.json open_questions.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { PATCH } from "@/app/api/events/[id]/information/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const ORGANISER_ID = "organiser-id";
const START = new Date("2027-03-17T01:00:00.000Z");
const END = new Date("2027-03-17T09:00:00.000Z");
const NEW_START = "2027-03-24T01:00:00.000Z";
const NEW_END = "2027-03-24T09:00:00.000Z";

const assignedCoordinator = () => user("coordinator", { id: ID.user });

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Harbour Leadership Summit",
    category: "conference",
    purpose: "Leadership offsite",
    description: "Keynotes and panels",
    status: "planning",
    organiserId: ORGANISER_ID,
    organisationId: ID.org,
    coordinatorId: ID.user,
    startsAt: START,
    endsAt: END,
    expectedAttendance: 80,
    preferredLayout: "theatre",
    accessibilityNotes: null,
    specialRequirements: null,
    registrationEnabled: true,
    registrationCapacity: 100,
    registrationOpensAt: null,
    registrationClosesAt: null,
    confirmedAt: new Date("2027-01-10T00:00:00.000Z"),
    registrationReviewReason: null,
    facilityRequirements: [{ facilityId: ID.facility, isMandatory: true }],
    sessions: [],
    ...overrides,
  };
}

const approvedBooking = (overrides = {}) => ({
  id: ID.booking,
  status: "approved",
  endsAt: END,
  reviewReason: null,
  needsReview: false,
  session: null,
  venue: { name: "Orchard Seminar Room", code: "ORC-SEM" },
  ...overrides,
});

const reservedEquipment = (overrides = {}) => ({
  id: ID.request,
  status: "reserved",
  endsAt: END,
  quantityRequested: 2,
  reviewReason: null,
  needsReview: false,
  equipment: { name: "4K Portable Projector" },
  ...overrides,
});

interface Arrangements {
  bookings?: object[];
  equipment?: object[];
  registrations?: number;
}

/// Signs `actor` in and loads the event and its arrangements. By default the
/// event has an approved booking, reserved equipment and 12 registrations.
function given(
  eventOverrides: Record<string, unknown> = {},
  { bookings = [approvedBooking()], equipment = [reservedEquipment()], registrations = 12 }: Arrangements = {},
  actor = assignedCoordinator()
) {
  const token = signIn(actor);
  const row = event(eventOverrides);
  db.event.findUnique.mockResolvedValue(row);
  db.venueBooking.findMany.mockResolvedValue(bookings);
  db.equipmentRequest.findMany.mockResolvedValue(equipment);
  db.registration.count.mockResolvedValue(registrations);
  db.event.update.mockImplementation(async ({ data }: { data: object }) => ({ ...row, ...data }));
  db.event.updateMany.mockResolvedValue({ count: 1 });
  db.safetyCheck.updateMany.mockResolvedValue({ count: 1 });
  // SPM-53 (AC17): who is Registered, told of a new date and time.
  db.registration.findMany.mockResolvedValue([]);
  return token;
}

function save(token: string | undefined, body: unknown, reference = REF) {
  return PATCH(
    req("PATCH", `/api/events/${reference}/information`, { token, body }),
    params({ id: reference })
  );
}

const eventData = () => callArg(db.event.update).data;

function nothingWritten() {
  expect(db.event.update).not.toHaveBeenCalled();
  expect(db.venueBooking.update).not.toHaveBeenCalled();
  expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
}

const reasonsOf = (value: string) => value.split(",").sort();

describe("PATCH /api/events/[id]/information - who may change it", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await save(undefined, { description: "x" })).status).toBe(401);
  });

  it.each(["nope", ID.event])("[SPM-62] is 404 for the malformed reference %s, without querying", async (reference) => {
    const token = signIn(assignedCoordinator());

    expect((await save(token, { description: "x" }, reference)).status).toBe(404);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("[SPM-62] is 404 for a reference that matches no event", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(null);

    expect((await save(token, { description: "x" })).status).toBe(404);
  });

  it("[SPM-62][AC3] is 404, not 403, for an event the user may not see - an attendee and a planning event", async () => {
    const token = given({}, {}, user("attendee", { id: ID.thirdUser }));

    expect((await save(token, { description: "x" })).status).toBe(404);
    nothingWritten();
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["the organiser who raised it", () => user("organiser", { id: ORGANISER_ID })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.thirdUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.thirdUser })],
    ["Technical Support", () => user("tech_support", { id: ID.thirdUser })],
  ])("[SPM-62][AC3] is 403 for %s, and writes nothing", async (_who, actor) => {
    const token = given({}, {}, actor());

    const res = await save(token, { description: "x" });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only the coordinator assigned to this event can change its information",
    });
    nothingWritten();
  });

  it("[SPM-62][AC3] is 403 for an attendee who can see a confirmed event open for registration", async () => {
    const token = given({ status: "confirmed", registrationEnabled: true }, {}, user("attendee", { id: ID.thirdUser }));

    expect((await save(token, { description: "x" })).status).toBe(403);
    nothingWritten();
  });

  it("[SPM-62] is 404 for a coordinator's own event while it is still a draft", async () => {
    const token = given({ status: "draft" });

    expect((await save(token, { description: "x" })).status).toBe(404);
  });

  it.each(["submitted", "under_review", "postponed", "completed", "cancelled", "rejected", "withdrawn"])(
    "[SPM-62][AC1] refuses an event that is %s",
    async (status) => {
      const token = given({ status });

      const res = await save(token, { description: "x" });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Event information can only be changed while the event is Approved, Planning, Safety review, Safety approved or Confirmed.",
      });
      nothingWritten();
    }
  );

  it.each(["approved", "planning", "safety_review", "safety_cleared", "confirmed"])("[SPM-62][AC1][AC7] accepts an ordinary edit while the event is %s", async (status) => {
    const token = given({ status });

    expect((await save(token, { description: "New programme" })).status).toBe(200);
  });
});

describe("PATCH /api/events/[id]/information - validation", () => {
  it.each([
    ["the status", { status: "confirmed" }],
    ["the organiser", { organiserId: ID.otherUser }],
    ["the coordinator", { coordinatorId: ID.otherUser }],
    ["equipment", { equipment: [] }],
    ["sessions", { sessions: [] }],
    ["whether registration is on", { registrationEnabled: false }],
    ["the registration capacity", { registrationCapacity: 50 }],
    ["when registration opens", { registrationOpensAt: "2027-02-01T01:00:00.000Z" }],
    ["when registration closes", { registrationClosesAt: "2027-03-01T01:00:00.000Z" }],
  ])("[SPM-62][AC3] refuses a body that tries to change %s", async (_what, body) => {
    const token = given();

    const res = await save(token, { description: "x", ...body });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    nothingWritten();
  });

  it.each([
    ["a blank event name", { title: "  " }, "title"],
    ["no type of event", { category: "" }, "category"],
    ["a cleared start", { startsAt: null }, "startsAt"],
    ["a cleared end", { endsAt: null }, "endsAt"],
    ["an attendance of zero", { expectedAttendance: 0 }, "expectedAttendance"],
    ["a cleared attendance", { expectedAttendance: null }, "expectedAttendance"],
    ["a fractional attendance", { expectedAttendance: 1.5 }, "expectedAttendance"],
  ])("[SPM-62][AC1] refuses %s", async (_what, body, field) => {
    const token = given();

    const res = await save(token, body);

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors).toHaveProperty(field);
    nothingWritten();
  });

  it("[SPM-62][AC1] accepts an attendance of 1", async () => {
    const token = given({}, { bookings: [], equipment: [], registrations: 0 });

    expect((await save(token, { expectedAttendance: 1 })).status).toBe(200);
  });

  it("[SPM-62][AC1] checks a new end against the start already saved", async () => {
    const token = given();

    const res = await save(token, { endsAt: "2027-03-17T00:00:00.000Z" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.endsAt).toEqual(["Ends at must be after starts at."]);
    nothingWritten();
  });

  it("[SPM-62][AC1] refuses an end equal to the start", async () => {
    const token = given();

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_START });

    expect((await res.json()).details.fieldErrors.endsAt).toEqual(["Ends at must be after starts at."]);
  });

  it("[SPM-62][AC1] refuses a start before registration closes", async () => {
    const token = given({ registrationClosesAt: new Date("2027-03-10T10:00:00.000Z") });

    const res = await save(token, { startsAt: "2027-03-10T01:00:00.000Z", endsAt: "2027-03-10T09:00:00.000Z" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.startsAt).toEqual([
      "Registration closes after this start time. Change the registration period first.",
    ]);
    nothingWritten();
  });

  it("[SPM-62][AC1] refuses a start at or before registration opens, when no closing date is set", async () => {
    const token = given({ registrationOpensAt: new Date("2027-03-10T01:00:00.000Z"), registrationClosesAt: null });

    const res = await save(token, { startsAt: "2027-03-10T01:00:00.000Z", endsAt: "2027-03-10T09:00:00.000Z" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.startsAt).toEqual([
      "Registration closes after this start time. Change the registration period first.",
    ]);
    nothingWritten();
  });

  it("[SPM-62][AC1] accepts a start after registration opens, when no closing date is set", async () => {
    const token = given({ registrationOpensAt: new Date("2027-03-01T01:00:00.000Z"), registrationClosesAt: null });

    expect((await save(token, { startsAt: NEW_START, endsAt: NEW_END })).status).toBe(200);
  });

  it("[SPM-62][AC1] accepts a start after registration closes", async () => {
    const token = given({ registrationClosesAt: new Date("2027-03-10T10:00:00.000Z") });

    expect((await save(token, { startsAt: NEW_START, endsAt: NEW_END })).status).toBe(200);
  });

  it.each([
    ["the start", { startsAt: NEW_START }],
    ["the attendance", { expectedAttendance: 90 }],
    ["the layout", { preferredLayout: "classroom" }],
  ])("[SPM-62][AC1] refuses to change %s of a multi-session event here", async (_what, body) => {
    const token = given({ sessions: [{ id: ID.session }, { id: ID.otherSession }] });

    const res = await save(token, body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Session times and attendance can't be changed here yet." });
    nothingWritten();
  });

  it("[SPM-62][AC1] still lets the description of a multi-session event change", async () => {
    const token = given({ sessions: [{ id: ID.session }, { id: ID.otherSession }] });

    expect((await save(token, { description: "Two-day programme" })).status).toBe(200);
  });
});

describe("PATCH /api/events/[id]/information - an ordinary edit", () => {
  const ordinary = {
    purpose: "Brief clients on the 2027 outlook",
    description: "Keynote, market briefing and Q&A",
    specialRequirements: "Reserve the front row",
    accessibilityNotes: "Two wheelchair users",
  };

  it("[SPM-62][AC1][AC2] saves exactly the fields sent", async () => {
    const token = given();

    const res = await save(token, ordinary);

    expect(res.status).toBe(200);
    expect(callArg(db.event.update).where).toEqual({ id: ID.event });
    expect(eventData()).toEqual(ordinary);
  });

  it("[SPM-62][AC1][AC2] saves a new name and type of event", async () => {
    const token = given();

    await save(token, { title: "  Harbour Leaders Forum ", category: "seminar" });

    expect(eventData()).toEqual({ title: "Harbour Leaders Forum", category: "seminar" });
  });

  it.each(["approved", "planning", "confirmed"])(
    "[SPM-62][AC7] on a %s event, flags nothing and leaves the status alone",
    async (status) => {
      const token = given({ status });

      const res = await save(token, ordinary);
      const body = await res.json();

      expect(body.importantChanges).toEqual([]);
      expect(body.statusReverted).toBe(false);
      expect(body.flagged).toEqual([]);
      expect(eventData()).not.toHaveProperty("status");
      expect(eventData()).not.toHaveProperty("registrationReviewReason");
      expect(db.venueBooking.update).not.toHaveBeenCalled();
      expect(db.equipmentRequest.update).not.toHaveBeenCalled();
      expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    }
  );

  it("[SPM-62][AC4][AC7] treats important fields sent back unchanged as no change at all", async () => {
    const token = given({ status: "confirmed" });

    const res = await save(token, {
      ...ordinary,
      startsAt: START.toISOString(),
      endsAt: END.toISOString(),
      expectedAttendance: 80,
      preferredLayout: "theatre",
      facilityIds: [ID.facility],
    });
    const body = await res.json();

    expect(body.importantChanges).toEqual([]);
    expect(body.statusReverted).toBe(false);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("[SPM-62][AC7] does not begin planning on an Approved event", async () => {
    const token = given({ status: "approved" }, { bookings: [], equipment: [], registrations: 0 });

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(eventData()).not.toHaveProperty("status");
    expect(db.event.updateMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id]/information - an important change", () => {
  it("[SPM-62][AC4] saves the new schedule and reports it as a date and time change", async () => {
    const token = given();

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(res.status).toBe(200);
    expect((await res.json()).importantChanges).toEqual(["schedule"]);
    expect(eventData()).toMatchObject({ startsAt: new Date(NEW_START), endsAt: new Date(NEW_END) });
  });

  it("[SPM-62][AC5] flags the venue booking for review without moving or cancelling it", async () => {
    const token = given();

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    const update = callArg(db.venueBooking.update);
    expect(update.where).toEqual({ id: ID.booking });
    expect(update.data).toEqual({
      needsReview: true,
      reviewReason: "event_schedule_changed",
      flaggedAt: expect.any(Date),
    });
  });

  it("[SPM-62][AC5] flags the equipment for review without changing it", async () => {
    const token = given();

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    const update = callArg(db.equipmentRequest.update);
    expect(update.where).toEqual({ id: ID.request });
    expect(update.data).toEqual({
      needsReview: true,
      reviewReason: "event_schedule_changed",
      flaggedAt: expect.any(Date),
    });
  });

  it("[SPM-62][AC5] flags the registrations on the event itself", async () => {
    const token = given();

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(eventData().registrationReviewReason).toBe("event_schedule_changed");
  });

  it("[SPM-62][AC5] does not flag registrations when nobody has registered", async () => {
    const token = given({}, { registrations: 0 });

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(eventData()).not.toHaveProperty("registrationReviewReason");
  });

  it("[SPM-62][AC5] flags only the venue booking when the attendance changes", async () => {
    const token = given();

    const res = await save(token, { expectedAttendance: 90 });

    expect((await res.json()).importantChanges).toEqual(["attendance"]);
    expect(callArg(db.venueBooking.update).data.reviewReason).toBe("event_attendance_changed");
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(eventData()).not.toHaveProperty("registrationReviewReason");
  });

  it("[SPM-62][AC5] flags the venue booking when the venue requirements change, and replaces them", async () => {
    const token = given();

    const res = await save(token, { facilityIds: [ID.facility, ID.venue] });

    expect((await res.json()).importantChanges).toEqual(["venue_requirements"]);
    expect(callArg(db.venueBooking.update).data.reviewReason).toBe("event_requirements_changed");
    expect(callArg(db.eventFacilityRequirement.deleteMany)).toEqual({ where: { eventId: ID.event } });
  });

  it("[SPM-62][AC5] keeps the reasons a booking was already flagged for, SPM-39's included", async () => {
    const token = given({}, { bookings: [approvedBooking({ needsReview: true, reviewReason: "venue_retired" })] });

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(reasonsOf(callArg(db.venueBooking.update).data.reviewReason)).toEqual([
      "event_schedule_changed",
      "venue_retired",
    ]);
  });

  it("[SPM-62][AC5] flags every booking the event has", async () => {
    const token = given({}, { bookings: [approvedBooking(), approvedBooking({ id: ID.otherVenue, status: "pending" })] });

    await save(token, { expectedAttendance: 90 });

    expect(db.venueBooking.update).toHaveBeenCalledTimes(2);
  });

  it("[SPM-62][AC5] words what this save flagged, one line per arrangement", async () => {
    const token = given();

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect((await res.json()).flagged).toEqual([
      "Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed",
      "Equipment: 4K Portable Projector × 2 – the date or time changed",
      "Registrations: 12 attendees – the date or time changed",
    ]);
  });

  it("[SPM-62][AC5] names a session's booking by its session, and joins several reasons", async () => {
    const token = given({}, { bookings: [approvedBooking({ session: { label: "Day 2" } })], equipment: [] });

    const res = await save(token, { expectedAttendance: 90, preferredLayout: "classroom" });

    expect((await res.json()).flagged).toEqual([
      "Venue booking: Day 2: Orchard Seminar Room (ORC-SEM) – the expected attendance changed; the venue requirements changed",
    ]);
  });

  it("[SPM-62][AC5] says '1 attendee' for a single registration", async () => {
    const token = given({}, { bookings: [], equipment: [], registrations: 1 });

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect((await res.json()).flagged).toEqual(["Registrations: 1 attendee – the date or time changed"]);
  });

  it("[SPM-62][AC5] words only this save's reasons, not what a booking was already flagged for", async () => {
    const token = given({}, { bookings: [approvedBooking({ needsReview: true, reviewReason: "venue_retired" })], equipment: [], registrations: 0 });

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect((await res.json()).flagged).toEqual([
      "Venue booking: Orchard Seminar Room (ORC-SEM) – the date or time changed",
    ]);
  });

  it("[SPM-62] does all of it in one transaction", async () => {
    const token = given();

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(db.$transaction).toHaveBeenCalledOnce();
  });

  it("[SPM-62][AC6] leaves a Planning event in Planning", async () => {
    const token = given({ status: "planning" });

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect((await res.json()).statusReverted).toBe(false);
    expect(eventData()).not.toHaveProperty("status");
  });
});

describe("PATCH /api/events/[id]/information - a Confirmed event", () => {
  it("[SPM-62][AC6] moves back to Planning, clearing when it was confirmed", async () => {
    const token = given({ status: "confirmed" });

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect((await res.json()).statusReverted).toBe(true);
    expect(eventData()).toMatchObject({ status: "planning", confirmedAt: null });
  });

  it("[SPM-62][AC6] records the move in the status history, naming what changed", async () => {
    const token = given({ status: "confirmed" });

    await save(token, { startsAt: NEW_START, endsAt: NEW_END, expectedAttendance: 90 });

    expect(callArg(db.eventStatusHistory.create).data).toEqual({
      eventId: ID.event,
      fromStatus: "confirmed",
      toStatus: "planning",
      changedBy: ID.user,
      reason: "Event information changed: Date and time, Expected attendance",
    });
  });

  it("[SPM-62][AC6] stays Confirmed when the change flags only registrations", async () => {
    const token = given({ status: "confirmed" }, { bookings: [], equipment: [], registrations: 12 });

    const res = await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect((await res.json()).statusReverted).toBe(false);
    expect(eventData()).not.toHaveProperty("status");
    expect(eventData().registrationReviewReason).toBe("event_schedule_changed");
  });
});

describe("PATCH /api/events/[id]/information - while a safety check is open (SPM-88)", () => {
  it.each(["safety_review", "safety_cleared"])(
    "[SPM-88][AC7] SPM-88-TC09/TC11: an ordinary edit leaves a %s event and its check alone",
    async (status) => {
      const token = given({ status });

      const body = await (await save(token, { description: "New programme" })).json();

      expect(body.safetyCheckClosed).toBe(false);
      expect(db.event.updateMany).not.toHaveBeenCalled();
      expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
      expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    }
  );

  it.each(["safety_review", "safety_cleared"])(
    "[SPM-88][AC6] SPM-88-TC07: an important change moves a %s event back to Planning and closes its check",
    async (status) => {
      const token = given({ status });

      const body = await (await save(token, { expectedAttendance: 90 })).json();

      expect(body.safetyCheckClosed).toBe(true);
      expect(callArg(db.event.updateMany)).toEqual({ where: { id: ID.event, status }, data: { status: "planning" } });
      expect(callArg(db.eventStatusHistory.create).data).toEqual({
        eventId: ID.event,
        fromStatus: status,
        toStatus: "planning",
        changedBy: ID.user,
        reason: "Safety check closed: the expected attendance changed",
      });
      expect(callArg(db.safetyCheck.updateMany)).toEqual({
        where: { eventId: ID.event, status: { in: ["pending", "approved"] } },
        data: { status: "closed", decidedBy: ID.user, decidedAt: expect.any(Date), decisionNote: "the expected attendance changed" },
      });
    }
  );

  it("[SPM-88][AC6] [SPM-62][AC5] still flags what the change affects", async () => {
    const token = given({ status: "safety_cleared" });

    await save(token, { expectedAttendance: 90 });

    expect(callArg(db.venueBooking.update).data.needsReview).toBe(true);
  });

  it("[SPM-88][AC5] SPM-88-TC12: closes the approval of a Confirmed event the change moves back to Planning", async () => {
    const token = given({ status: "confirmed" });

    const body = await (await save(token, { startsAt: NEW_START, endsAt: NEW_END })).json();

    expect(body).toMatchObject({ statusReverted: true, safetyCheckClosed: true });
    expect(callArg(db.safetyCheck.updateMany).data).toMatchObject({ status: "closed", decisionNote: "the date or time changed" });
    // SPM-62's history row is the only one.
    expect(db.eventStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it("[SPM-88][AC7] leaves the check of a Confirmed event that stays Confirmed", async () => {
    const token = given({ status: "confirmed" }, { bookings: [], equipment: [], registrations: 12 });

    const body = await (await save(token, { startsAt: NEW_START, endsAt: NEW_END })).json();

    expect(body.safetyCheckClosed).toBe(false);
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-88][AC7] does not touch a check on a Planning event", async () => {
    const token = given({ status: "planning" });

    const body = await (await save(token, { startsAt: NEW_START, endsAt: NEW_END })).json();

    expect(body.safetyCheckClosed).toBe(false);
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id]/information - failures", () => {
  it("[SPM-62] answers 500 when the database fails", async () => {
    const token = given();
    db.event.update.mockRejectedValue(new Error("connection lost"));

    const res = await save(token, { description: "x" });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});

describe("PATCH /api/events/[id]/information - telling people (SPM-53)", () => {
  const told = () => db.notification.create.mock.calls.map((c: unknown[]) => (c[0] as { data: unknown }).data);
  const changed = (what: string) => ({
    recipientId: ORGANISER_ID,
    type: "event_information_changed",
    title: "Event information changed",
    body: `"Harbour Leadership Summit" has changed: ${what}.`,
    eventId: ID.event,
  });

  it("[SPM-53][AC14] tells the organiser which important information changed", async () => {
    const token = given({}, { bookings: [], equipment: [], registrations: 0 });

    await save(token, { expectedAttendance: 120, preferredLayout: "classroom" });

    expect(told()).toEqual([changed("Expected attendance, Venue requirements")]);
  });

  it("[SPM-53][AC14] tells no one of an ordinary edit", async () => {
    const token = given();

    await save(token, { description: "Keynotes, panels and lunch" });

    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-53][AC14][AC17] tells only the Registered attendees the new date and time", async () => {
    const token = given({}, { bookings: [], equipment: [], registrations: 2 });
    db.registration.findMany.mockResolvedValue([{ attendeeId: "attendee-1" }, { attendeeId: "attendee-2" }]);

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(callArg(db.registration.findMany).where).toEqual({ eventId: ID.event, status: "registered" });
    expect(told()).toEqual([
      changed("Date and time"),
      ...["attendee-1", "attendee-2"].map((recipientId) => ({
        recipientId,
        type: "event_rescheduled",
        title: "Event rescheduled",
        body: '"Harbour Leadership Summit" has a new date and time: 24 Mar 2027, 09:00–17:00.',
        eventId: ID.event,
      })),
    ]);
  });

  it("[SPM-53][AC17] tells attendees nothing when the date and time stay the same", async () => {
    const token = given();

    await save(token, { expectedAttendance: 120 });

    expect(db.registration.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-53][AC15] tells the organiser that a Confirmed event moved back to Planning", async () => {
    const token = given({ status: "confirmed" }, { equipment: [], registrations: 0 });

    await save(token, { startsAt: NEW_START, endsAt: NEW_END });

    expect(told()).toEqual([
      changed("Date and time"),
      {
        recipientId: ORGANISER_ID,
        type: "event_unconfirmed",
        title: "Event no longer confirmed",
        body: '"Harbour Leadership Summit" has moved back to Planning after a change and is no longer confirmed.',
        eventId: ID.event,
      },
    ]);
  });

  it("[SPM-53][AC15] does not say a Confirmed event moved back when the change flagged nothing it rests on", async () => {
    const token = given({ status: "confirmed" }, { bookings: [], equipment: [], registrations: 0 });

    await save(token, { expectedAttendance: 120 });

    expect(told()).toEqual([changed("Expected attendance")]);
  });
});
