// Track Outstanding Arrangements (SPM-33): the Readiness list of an event, and
// marking an arrangement as not required.
//
// CONTRACT (SPM-33, written before the code) - what these tests expect to exist:
//   src/app/api/events/[id]/arrangements/route.ts   exports GET, PATCH
//
//   GET   -> 200 { event: { sequenceNumber, title, status }, canManage, blocking, arrangements }
//            arrangements is arrangementsFor() (src/lib/eventConfirmation.ts);
//            blocking is how many of them are required and not complete;
//            canManage is true for the assigned coordinator while the event is in Planning.
//            401; 403 for a role without `event:confirm`, before the event is looked up;
//            404 for a malformed reference, an unknown event or a draft.
//   PATCH { kind: "venue" | "equipment", id, notRequired } or { kind: "registration", notRequired }
//         -> 200, the same body as GET, read after the write
//            401; 404 unseen event; 403 not the assigned coordinator; 400 "Validation failed";
//            400 "Arrangements can only be marked as not required while the event is in Planning.";
//            404 "This arrangement is not part of this event.";
//            400 "Only an outstanding arrangement can be marked as not required."
//         writes  venueBooking.update / equipmentRequest.update({ where: { id },
//                   data: { notRequired, notRequiredBy, notRequiredAt } })
//                 event.update({ where: { id }, data: { registrationNotRequired,
//                   registrationNotRequiredBy, registrationNotRequiredAt } })
//                 By is the signed-in coordinator's id and At is now, on marking AND on
//                 reversing - the columns hold the latest decision either way.
//
//   Schema (a migration): VenueBooking.notRequired, EquipmentRequest.notRequired and
//   Event.registrationNotRequired, all Boolean, default false. Beside each, who
//   decided and when (briefing 8f Auditability, customer answer #14): notRequiredBy
//   (a user id, relation `notRequiredByUser`) and notRequiredAt on the two tables;
//   registrationNotRequiredBy (relation `registrationNotRequiredByUser`) and
//   registrationNotRequiredAt on Event. GET returns the person's name and the time
//   on each arrangement that is marked as not required.
//
//   The route reads the event with prisma.event.findUnique, and its sessions,
//   bookings and equipment the way the confirm path of PATCH /api/events/[id]
//   does: eventSession.findMany, venueBooking.findMany (with venue.name) and
//   equipmentRequest.findMany (with equipment.name). The same rows are also
//   stubbed as relations on the event, so loading them with `include` works too.
//
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the address, the body shape and the three column names
//   - any coordinator may read the list; only the assigned one may change it
//   - marking is allowed in Planning only - not on a Confirmed event, where
//     reversing it would leave a confirmed event with something outstanding
//   - only an outstanding arrangement can be marked as not required; marking it
//     as required again is always allowed
//   - the wording of the three refusals
//   - the record is the latest decision on each arrangement, not a full history,
//     and no reason is asked for (decided 2026-10-09)
//
// The Operational Safety Check (AC6, AC9; added 2026-10-12): the route also
// reads the event's latest SafetyCheck (SPM-86) with
// prisma.safetyCheck.findFirst({ where: { eventId }, orderBy: { submittedAt: "desc" } })
// and lists it as the last arrangement. "safety_check" is not a kind PATCH
// accepts, so it can never be marked as not required.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET, PATCH } from "@/app/api/events/[id]/arrangements/route";
import { can } from "@/lib/permissions";
import { ROLES } from "@/lib/roles";
import { callArg, db, holdExpirySweepOrder, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const NOW = new Date("2026-10-08T03:00:00.000Z");
/// Who decided, and when: the signed-in coordinator, now.
const decided = { notRequiredBy: ID.user, notRequiredAt: NOW };
const registrationDecided = { registrationNotRequiredBy: ID.user, registrationNotRequiredAt: NOW };

const assignedCoordinator = () => user("coordinator", { id: ID.user });
const anotherCoordinator = () => user("coordinator", { id: ID.thirdUser });

/// A Planning event assigned to assignedCoordinator(), with no registration.
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Town Hall",
    status: "planning",
    organiserId: ID.otherUser,
    organisationId: ID.org,
    coordinatorId: ID.user,
    startsAt: new Date("2027-03-04T01:00:00.000Z"),
    endsAt: new Date("2027-03-04T09:00:00.000Z"),
    expectedAttendance: 100,
    registrationEnabled: false,
    registrationCapacity: null,
    registrationOpensAt: null,
    registrationClosesAt: null,
    registrationNotRequired: false,
    ...overrides,
  };
}

/// Registration that is switched on but has no capacity yet.
const registrationIncomplete = {
  registrationEnabled: true,
  registrationCapacity: null,
  registrationOpensAt: new Date("2027-02-01T01:00:00.000Z"),
  registrationClosesAt: new Date("2027-02-28T10:00:00.000Z"),
};

type Row = Record<string, unknown> & { id: string };

function booking(overrides: Record<string, unknown> = {}): Row {
  return {
    id: ID.booking,
    eventId: ID.event,
    sessionId: null,
    status: "approved",
    needsReview: false,
    reviewReason: null,
    notRequired: false,
    venue: { name: "Hall A", code: "HALL-A" },
    ...overrides,
  };
}

function line(overrides: Record<string, unknown> = {}): Row {
  return {
    id: ID.request,
    eventId: ID.event,
    sessionId: null,
    status: "reserved",
    quantityRequested: 2,
    quantityReserved: 2,
    needsReview: false,
    reviewReason: null,
    notRequired: false,
    equipment: { name: "Projector" },
    // SPM-77: the alternative waiting for the Coordinator's decision, if any.
    suggestions: [],
    ...overrides,
  };
}

interface Given {
  event?: Record<string, unknown>;
  sessions?: Row[];
  bookings?: Row[];
  equipment?: Row[];
  /// The event's latest SafetyCheck; null = never submitted. CHANGED (SPM-88):
  /// approved by default, since an outstanding check now blocks confirmation
  /// and most tests here are about the other arrangements.
  safetyCheck?: Row | null;
}

const APPROVED_CHECK: Row = {
  id: "approved-check",
  status: "approved",
  submittedAt: new Date("2026-10-09T06:30:00.000Z"),
  submitter: { fullName: "Daniel Tan" },
};

/// The event and what is arranged for it, as the database would answer. Writes
/// change these rows, so a list read after a write shows the change.
function given({ event: overrides = {}, sessions = [], bookings = [], equipment = [], safetyCheck = APPROVED_CHECK }: Given = {}) {
  const row: Record<string, unknown> = event(overrides);
  row.sessions = sessions;
  row.venueBookings = bookings;
  row.equipmentRequests = equipment;
  row.safetyChecks = safetyCheck ? [safetyCheck] : [];
  db.safetyCheck.findFirst.mockResolvedValue(safetyCheck);

  const byId = (rows: Row[]) => async (args: { where: { id?: string } }) =>
    rows.find((r) => r.id === args.where.id) ?? null;
  const change = (rows: Row[]) => async (args: { where: { id: string }; data: object }) =>
    Object.assign(rows.find((r) => r.id === args.where.id) ?? {}, args.data);

  db.event.findUnique.mockResolvedValue(row);
  db.event.update.mockImplementation(async ({ data }: { data: object }) => Object.assign(row, data));
  db.eventSession.findMany.mockResolvedValue(sessions);
  db.venueBooking.findMany.mockResolvedValue(bookings);
  db.venueBooking.findUnique.mockImplementation(byId(bookings));
  db.venueBooking.findFirst.mockImplementation(byId(bookings));
  db.venueBooking.update.mockImplementation(change(bookings));
  db.equipmentRequest.findMany.mockResolvedValue(equipment);
  db.equipmentRequest.findUnique.mockImplementation(byId(equipment));
  db.equipmentRequest.findFirst.mockImplementation(byId(equipment));
  db.equipmentRequest.update.mockImplementation(change(equipment));
}

interface ListedArrangement {
  kind: string;
  id: string | null;
  name: string;
  status: string | null;
  state: string;
  missing: string;
  flagReason: string;
  waivable: boolean;
  waived: boolean;
  blocksConfirmation: boolean;
  note: string;
}

const named = (body: { arrangements: ListedArrangement[] }, name: string) =>
  body.arrangements.find((a) => a.name === name)!;

/// Every arrangement but the two every event has, which have tests of their
/// own: the Operational Safety Check (AC6), and "Registration setup" while
/// registration is off (SPM-64: then it is simply not required).
const listed = (body: { arrangements: ListedArrangement[] }) =>
  body.arrangements.filter(
    (a) => a.kind !== "safety_check" && !(a.kind === "registration" && a.state === "not_required" && !a.waived)
  );

function expectNothingWritten() {
  expect(db.venueBooking.update).not.toHaveBeenCalled();
  expect(db.equipmentRequest.update).not.toHaveBeenCalled();
  expect(db.event.update).not.toHaveBeenCalled();
}

describe("GET /api/events/[id]/arrangements", () => {
  function get(token?: string, reference = REF) {
    return GET(req("GET", `/api/events/${reference}/arrangements`, { token }), params({ id: reference }));
  }

  it("[SPM-82][AC10] SPM-82-TC08 (AC10): names when an expired hold ran out - the expiry reaches the rule, not just the query", async () => {
    given({ bookings: [booking({ status: "expired", holdExpiresAt: new Date("2026-10-01T01:00:00.000Z") })] });

    const body = await (await get(signIn(assignedCoordinator()))).json();

    expect(listed(body).find((a) => a.status === "expired")?.missing).toContain("expired on 1 Oct 2026, 09:00");
  });

  it("[SPM-82][AC10] SPM-82-TC08 (AC10): expires overdue holds before reading the arrangements, with each booking's expiry", async () => {
    given();

    await get(signIn(assignedCoordinator()));

    expect(holdExpirySweepOrder()).toBeLessThan(db.venueBooking.findMany.mock.invocationCallOrder[0]);
    expect(callArg(db.venueBooking.findMany).select.holdExpiresAt).toBe(true);
  });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it("[SPM-77][AC5][AC6] lists a line with a suggested alternative waiting for a decision as outstanding", async () => {
    given({
      bookings: [booking()],
      equipment: [
        line({ status: "partially_fulfilled", equipment: { name: "Ring Light" }, suggestions: [{ equipment: { name: "Podium Light" } }] }),
      ],
    });

    const body = await (await get(signIn(assignedCoordinator()))).json();

    expect(named(body, "Ring Light")).toMatchObject({
      state: "outstanding",
      waivable: false,
      awaitingDecision: true,
      missing: "Ring Light for this event has a suggested alternative (Podium Light) waiting for your decision",
    });
    expect(callArg(db.equipmentRequest.findMany).select.suggestions).toEqual({
      where: { status: "pending" },
      take: 1,
      select: { equipment: { select: { name: true } } },
    });
  });

  // Readiness is the coordinator's planning checklist (UI_DESIGN.md 4.3). The
  // roles come from the permission table, so a change there moves this with it.
  it.each(ROLES.filter((role) => !can(role, "event:confirm")))(
    "[SPM-21][AC4] is 403 for %s, before the event is looked up",
    async (role) => {
      const res = await get(signIn(user(role)));

      expect(res.status).toBe(403);
      expect(db.event.findUnique).not.toHaveBeenCalled();
    }
  );

  it("[SPM-33] is 404 for a malformed reference", async () => {
    expect((await get(signIn(assignedCoordinator()), "nope")).status).toBe(404);
  });

  it("[SPM-33] is 404 for a reference that matches no event", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(null);

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-33] is 404 for a draft", async () => {
    const token = signIn(assignedCoordinator());
    given({ event: { status: "draft" } });

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-33] answers 500 when the database fails", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await get(token)).status).toBe(500);
  });

  it("[SPM-33][AC1][AC3][AC11] gives the assigned coordinator the event, what is arranged for it and what still blocks confirmation", async () => {
    const token = signIn(assignedCoordinator());
    given({
      bookings: [booking()],
      equipment: [line(), line({ id: ID.equipment, status: "requested", equipment: { name: "Lectern" } })],
    });

    const res = await get(token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.event).toEqual({ sequenceNumber: 7, title: "Town Hall", status: "planning" });
    expect(body.canManage).toBe(true);
    // SPM-65: their tab bar offers the Attendees tab.
    expect(body.canViewRegistrationList).toBe(true);
    expect(body.blocking).toBe(1);
    expect(listed(body).map((a: ListedArrangement) => [a.kind, a.name, a.status, a.state])).toEqual([
      ["venue", "Hall A", "approved", "complete"],
      ["equipment", "Projector", "reserved", "complete"],
      ["equipment", "Lectern", "requested", "outstanding"],
    ]);
  });

  // AC2: an event with more than one venue booking (SPM-81).
  it("[SPM-33][AC2] lists each venue booking of the event separately, with its own status", async () => {
    const token = signIn(assignedCoordinator());
    given({
      bookings: [booking(), booking({ id: ID.otherVenue, status: "pending", venue: { name: "Room B", code: "ROOM-B" } })],
    });

    const body = await (await get(token)).json();

    expect(named(body, "Hall A")).toMatchObject({ id: ID.booking, status: "approved", state: "complete" });
    expect(named(body, "Room B")).toMatchObject({ id: ID.otherVenue, status: "pending", state: "outstanding" });
    expect(body.blocking).toBe(1);
  });

  it("[SPM-33][AC1] shows 'No venue booked' for an event with no venue booking at all", async () => {
    const token = signIn(assignedCoordinator());
    given();

    const body = await (await get(token)).json();

    expect(listed(body)).toHaveLength(1);
    expect(listed(body)[0]).toMatchObject({
      kind: "venue",
      id: null,
      name: "No venue booked",
      state: "outstanding",
      waivable: false,
    });
    expect(body.blocking).toBe(1);
  });

  // AC4: flagged by a change to the event (SPM-62) or to the venue (SPM-39).
  it("[SPM-33][AC4] shows a flagged booking and a flagged equipment line as outstanding, with why they were flagged", async () => {
    const token = signIn(assignedCoordinator());
    given({
      bookings: [booking({ needsReview: true, reviewReason: "venue_retired" })],
      equipment: [line({ needsReview: true, reviewReason: "event_schedule_changed" })],
    });

    const body = await (await get(token)).json();

    expect(named(body, "Hall A")).toMatchObject({ state: "outstanding", flagReason: "the venue has been retired" });
    expect(named(body, "Projector")).toMatchObject({ state: "outstanding", flagReason: "the date or time changed" });
    expect(body.blocking).toBe(2);
  });

  // AC5: read from the event's own registration settings (SPM-64).
  it("[SPM-33][AC5] shows registration that is enabled but incomplete as outstanding", async () => {
    const token = signIn(assignedCoordinator());
    given({ event: registrationIncomplete, bookings: [booking()] });

    const body = await (await get(token)).json();

    expect(named(body, "Registration setup")).toMatchObject({
      kind: "registration",
      state: "outstanding",
      missing: "registration setup is incomplete (still needed: registration capacity)",
    });
    expect(body.blocking).toBe(1);
  });

  // SPM-64's rule: registration that is off is not required, and nobody waived it.
  it("[SPM-33][AC5][AC10] shows registration that is not enabled as not required, without counting it", async () => {
    const token = signIn(assignedCoordinator());
    given({ bookings: [booking()] });

    const body = await (await get(token)).json();

    expect(named(body, "Registration setup")).toMatchObject({ state: "not_required", waived: false, waivable: false });
    expect(body.blocking).toBe(0);
  });

  it("[SPM-64][AC4] reads the booking the registration capacity is measured against (SPM-64)", async () => {
    const token = signIn(assignedCoordinator());
    given({
      event: { ...registrationIncomplete, registrationCapacity: 80, registrationVenueBookingId: ID.otherVenue },
      bookings: [booking()],
    });

    const body = await (await get(token)).json();

    expect(named(body, "Registration setup")).toMatchObject({
      state: "outstanding",
      missing: "registration capacity is measured against a venue booking that is no longer active",
    });
  });

  // AC10, AC11.
  it("[SPM-33][AC10][AC11] shows what is marked as not required as such, and does not count it as blocking", async () => {
    const token = signIn(assignedCoordinator());
    given({
      event: { ...registrationIncomplete, registrationNotRequired: true },
      bookings: [booking(), booking({ id: ID.otherVenue, status: "pending", notRequired: true, venue: { name: "Room B", code: "ROOM-B" } })],
      equipment: [line({ status: "unavailable", notRequired: true })],
    });

    const body = await (await get(token)).json();

    expect(listed(body).map((a: ListedArrangement) => [a.name, a.state])).toEqual([
      ["Hall A", "complete"],
      ["Room B", "not_required"],
      ["Projector", "not_required"],
      ["Registration setup", "not_required"],
    ]);
    expect(body.blocking).toBe(0);
  });

  // Briefing 8f and customer answer #14: who did it, and when.
  it("[SPM-33][AC10] says who marked each arrangement as not required, and when", async () => {
    const token = signIn(assignedCoordinator());
    const by = { fullName: "Daniel Tan" };
    given({
      event: {
        ...registrationIncomplete,
        registrationNotRequired: true,
        registrationNotRequiredBy: ID.user,
        registrationNotRequiredAt: NOW,
        registrationNotRequiredByUser: by,
      },
      bookings: [
        booking(),
        booking({
          id: ID.otherVenue,
          status: "pending",
          notRequired: true,
          ...decided,
          notRequiredByUser: by,
          venue: { name: "Room B", code: "ROOM-B" },
        }),
      ],
      equipment: [line({ status: "unavailable", notRequired: true, ...decided, notRequiredByUser: by })],
    });

    const body = await (await get(token)).json();

    for (const name of ["Room B", "Projector", "Registration setup"]) {
      expect(named(body, name)).toMatchObject({ notRequiredBy: "Daniel Tan", notRequiredAt: NOW.toISOString() });
    }
    expect(named(body, "Hall A")).toMatchObject({ notRequiredBy: null, notRequiredAt: null });
  });

  it("[SPM-33][AC8] lets another coordinator read the list, but not manage it", async () => {
    const token = signIn(anotherCoordinator());
    given({ bookings: [booking({ status: "pending" })] });

    const res = await get(token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.canManage).toBe(false);
    expect(listed(body)).toHaveLength(1);
    // SPM-65: nor open its Attendees tab.
    expect(body.canViewRegistrationList).toBe(false);
  });

  // SPM-68: the Readiness tab links a flagged arrangement to the Flagged
  // Arrangements page, which lists it for the assigned coordinator only.
  it.each(["planning", "confirmed", "safety_review"])(
    "[SPM-68][AC1] tells the assigned coordinator of a %s event that its flags are theirs to review",
    async (status) => {
      const token = signIn(assignedCoordinator());
      given({ event: { status }, bookings: [booking()] });

      expect((await (await get(token)).json()).canReviewFlags).toBe(true);
    }
  );

  it.each(["completed", "cancelled"])("[SPM-68][AC1] has no flags left to review on a %s event", async (status) => {
    const token = signIn(assignedCoordinator());
    given({ event: { status }, bookings: [booking()] });

    expect((await (await get(token)).json()).canReviewFlags).toBe(false);
  });

  it("[SPM-68][AC16] tells another coordinator that its flags are not theirs to review", async () => {
    const token = signIn(anotherCoordinator());
    given({ bookings: [booking()] });

    expect((await (await get(token)).json()).canReviewFlags).toBe(false);
  });

  it.each(["approved", "confirmed", "completed", "cancelled"])(
    "[SPM-33][AC8] does not let the assigned coordinator manage the list of a %s event",
    async (status) => {
      const token = signIn(assignedCoordinator());
      given({ event: { status }, bookings: [booking({ status: "pending" })] });

      expect((await (await get(token)).json()).canManage).toBe(false);
    }
  );
});

describe("GET /api/events/[id]/arrangements - the Operational Safety Check (AC6, AC9)", () => {
  function get(token: string) {
    return GET(req("GET", `/api/events/${REF}/arrangements`, { token }), params({ id: REF }));
  }
  const SUBMITTED = new Date("2026-10-09T06:30:00.000Z"); // 14:30 in Singapore
  const check = (status: string): Row => ({
    id: ID.request.replace(/9/g, "5"),
    eventId: ID.event,
    status,
    submittedAt: SUBMITTED,
    submitter: { fullName: "Daniel Tan" },
  });
  const safety = (body: { arrangements: ListedArrangement[] }) => named(body, "Operational Safety Check");

  it("[SPM-33][AC6] reads the event's latest safety check", async () => {
    const token = signIn(assignedCoordinator());
    given({ bookings: [booking()] });

    await get(token);

    expect(callArg(db.safetyCheck.findFirst)).toMatchObject({
      where: { eventId: ID.event },
      orderBy: { submittedAt: "desc" },
    });
  });

  it("[SPM-33][AC6] lists a check that was never submitted, last, as a required item that is not submitted", async () => {
    const token = signIn(assignedCoordinator());
    given({ bookings: [booking()], equipment: [line()], safetyCheck: null });

    const body = await (await get(token)).json();

    expect(body.arrangements.map((a: ListedArrangement) => a.kind)).toEqual([
      "venue",
      "equipment",
      "registration",
      "safety_check",
    ]);
    expect(safety(body)).toMatchObject({
      kind: "safety_check",
      id: null,
      status: "safety_not_submitted",
      state: "outstanding",
      required: true,
      waivable: false,
      blocksConfirmation: true,
      missing: "the Operational Safety Check has not been submitted yet",
    });
  });

  it.each([
    ["pending", "safety_awaiting_review", "outstanding"],
    ["approved", "safety_approved", "complete"],
    ["changes_requested", "safety_changes_requested", "outstanding"],
    ["rejected", "safety_rejected", "outstanding"],
  ])("[SPM-33][AC6] shows a %s check as %s, with who submitted it and when", async (status, shown, state) => {
    const token = signIn(assignedCoordinator());
    given({ event: { status: status === "pending" ? "safety_review" : "planning" }, bookings: [booking()], safetyCheck: check(status) });

    const body = await (await get(token)).json();

    expect(safety(body)).toMatchObject({
      status: shown,
      state,
      waivable: false,
      note: "Submitted by Daniel Tan on 9 Oct 2026, 14:30",
    });
  });

  it("[SPM-33][AC6] leaves out who submitted a check whose submitter's account is gone", async () => {
    const token = signIn(assignedCoordinator());
    given({ event: { status: "safety_review" }, bookings: [booking()], safetyCheck: { ...check("pending"), submitter: null } });

    const body = await (await get(token)).json();

    expect(safety(body).note).toBe("Submitted on 9 Oct 2026, 14:30");
  });

  // CHANGED (SPM-88, AC8/AC9): Confirm waits for an approved safety check.
  it.each([null, "changes_requested", "rejected", "closed"])(
    "[SPM-33][AC6] [SPM-88][AC8] counts an outstanding safety check as blocking confirmation (latest check: %s)",
    async (status) => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking()], safetyCheck: status === null ? null : { ...APPROVED_CHECK, status } });

      expect((await (await get(token)).json()).blocking).toBe(1);
    }
  );

  it("[SPM-33][AC6] [SPM-88][AC8] does not count an approved safety check as blocking", async () => {
    const token = signIn(assignedCoordinator());
    given({ bookings: [booking()] });

    expect((await (await get(token)).json()).blocking).toBe(0);
  });

  // Safety review cannot move to Confirmed until the Safety Officer decides.
  it("[SPM-33][AC6] [SPM-88][AC8] counts a check awaiting the Safety Officer's review as blocking confirmation", async () => {
    const token = signIn(assignedCoordinator());
    given({ event: { status: "safety_review" }, bookings: [booking()], safetyCheck: check("pending") });

    const body = await (await get(token)).json();

    expect(body.blocking).toBe(1);
    expect(safety(body).blocksConfirmation).toBe(true);
  });

  it("[SPM-33][AC8] does not offer marking while the event is with the Safety Officer", async () => {
    const token = signIn(assignedCoordinator());
    given({ event: { status: "safety_review" }, bookings: [booking({ status: "pending" })], safetyCheck: check("pending") });

    expect((await (await get(token)).json()).canManage).toBe(false);
  });
});

describe("PATCH /api/events/[id]/arrangements - the Operational Safety Check (AC9)", () => {
  it.each([
    ["with no id", { kind: "safety_check", notRequired: true }],
    ["by the check's id", { kind: "safety_check", id: ID.request, notRequired: true }],
  ])("[SPM-33][AC9] refuses to mark the safety check as not required, %s, and writes nothing", async (_case, body) => {
    const token = signIn(assignedCoordinator());
    given({ bookings: [booking()] });

    const res = await PATCH(req("PATCH", `/api/events/${REF}/arrangements`, { token, body }), params({ id: REF }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    expectNothingWritten();
    expect(db.safetyCheck.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/[id]/arrangements", () => {
  function patch(token: string | undefined, body: unknown, reference = REF) {
    return PATCH(req("PATCH", `/api/events/${reference}/arrangements`, { token, body }), params({ id: reference }));
  }

  const waiveLine = { kind: "equipment", id: ID.request, notRequired: true };

  // Every decision is stamped with the time it was made.
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("who can reach it", () => {
    it("[SPM-21][AC4] is 401 without a session", async () => {
      expect((await patch(undefined, waiveLine)).status).toBe(401);
    });

    it("[SPM-33] is 404 for a malformed reference", async () => {
      expect((await patch(signIn(assignedCoordinator()), waiveLine, "nope")).status).toBe(404);
    });

    it("[SPM-33] is 404 for a reference that matches no event", async () => {
      const token = signIn(assignedCoordinator());
      db.event.findUnique.mockResolvedValue(null);

      expect((await patch(token, waiveLine)).status).toBe(404);
    });

    it("[SPM-33] is 404, not 403, for an event the user cannot see - and nothing is written", async () => {
      // An attendee sees only confirmed events that are open for registration.
      const token = signIn(user("attendee"));
      given({ equipment: [line({ status: "requested" })] });

      const res = await patch(token, waiveLine);

      expect(res.status).toBe(404);
      expectNothingWritten();
    });

    it("[SPM-33][AC8] is 403 for a coordinator who is not the one assigned, and nothing is written", async () => {
      const token = signIn(anotherCoordinator());
      given({ equipment: [line({ status: "requested" })] });

      const res = await patch(token, waiveLine);

      expect(res.status).toBe(403);
      expectNothingWritten();
    });

    it.each([
      ["the organiser who owns the event", () => user("organiser", { id: ID.otherUser })],
      ["the Ops Manager", () => user("ops_manager")],
      ["Venue Staff", () => user("venue_staff")],
      ["Technical Support", () => user("tech_support")],
    ])("[SPM-33][AC8] is 403 for %s, and nothing is written", async (_who, actor) => {
      const token = signIn(actor());
      given({ equipment: [line({ status: "requested" })] });

      const res = await patch(token, waiveLine);

      expect(res.status).toBe(403);
      expectNothingWritten();
    });

    it("[SPM-33] answers 500 when the database fails", async () => {
      const token = signIn(assignedCoordinator());
      db.event.findUnique.mockRejectedValue(new Error("connection lost"));

      expect((await patch(token, waiveLine)).status).toBe(500);
    });
  });

  describe("what it accepts", () => {
    it.each([
      ["nothing", {}],
      ["no kind", { id: ID.request, notRequired: true }],
      ["a kind that is not an arrangement", { kind: "catering", id: ID.request, notRequired: true }],
      ["a venue booking with no id", { kind: "venue", notRequired: true }],
      ["an equipment line with no id", { kind: "equipment", notRequired: true }],
      ["an id that is not one", { kind: "equipment", id: "r1", notRequired: true }],
      ["no decision", { kind: "equipment", id: ID.request }],
      ["a decision that is not yes or no", { kind: "equipment", id: ID.request, notRequired: "yes" }],
    ])("[SPM-33][AC8] refuses %s", async (_case, body) => {
      const token = signIn(assignedCoordinator());
      given({ equipment: [line({ status: "requested" })] });

      const res = await patch(token, body);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Validation failed");
      expectNothingWritten();
    });

    it.each(["approved", "confirmed", "completed", "cancelled"])(
      "[SPM-33][AC8] refuses on a %s event: arrangements are marked while the event is in Planning",
      async (status) => {
        const token = signIn(assignedCoordinator());
        given({ event: { status }, equipment: [line({ status: "requested" })] });

        const res = await patch(token, waiveLine);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "Arrangements can only be marked as not required while the event is in Planning.",
        });
        expectNothingWritten();
      }
    );

    it.each([
      ["a venue booking", { kind: "venue", id: ID.otherVenue, notRequired: true }],
      ["an equipment line", { kind: "equipment", id: ID.equipment, notRequired: true }],
    ])("[SPM-33][AC8] is 404 for %s that is not part of this event", async (_case, body) => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking({ status: "pending" })], equipment: [line({ status: "requested" })] });

      const res = await patch(token, body);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "This arrangement is not part of this event." });
      expectNothingWritten();
    });

    it.each([
      ["an approved venue booking", { bookings: [booking()] }, { kind: "venue", id: ID.booking, notRequired: true }],
      ["a reserved equipment line", { bookings: [booking()], equipment: [line()] }, waiveLine],
      // Held, as for Confirm and Submit for safety check (SPM-86).
      [
        "a partly reserved equipment line",
        { bookings: [booking()], equipment: [line({ status: "partially_fulfilled", quantityReserved: 1 })] },
        waiveLine,
      ],
      [
        "registration that is fully set up",
        { bookings: [booking()], event: { ...registrationIncomplete, registrationCapacity: 80 } },
        { kind: "registration", notRequired: true },
      ],
      ["registration that is not enabled", { bookings: [booking()] }, { kind: "registration", notRequired: true }],
    ])("[SPM-33][AC8] refuses %s: only an outstanding arrangement can be marked", async (_case, state, body) => {
      const token = signIn(assignedCoordinator());
      given(state);

      const res = await patch(token, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Only an outstanding arrangement can be marked as not required." });
      expectNothingWritten();
    });
  });

  describe("marking as not required (AC8)", () => {
    it.each([
      ["a booking still awaiting Venue Staff", booking({ status: "pending" })],
      ["an approved booking that is flagged for review", booking({ needsReview: true, reviewReason: "venue_retired" })],
    ])("[SPM-33][AC8] marks %s as not required, and changes nothing else about it", async (_case, row) => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking({ id: ID.otherVenue, venue: { name: "Room B", code: "ROOM-B" } }), row] });

      const res = await patch(token, { kind: "venue", id: ID.booking, notRequired: true });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(callArg(db.venueBooking.update)).toEqual({ where: { id: ID.booking }, data: { notRequired: true, ...decided } });
      expect(named(body, "Hall A")).toMatchObject({ state: "not_required", status: row.status });
      expect(body.blocking).toBe(0);
      expect(db.equipmentRequest.update).not.toHaveBeenCalled();
      expect(db.event.update).not.toHaveBeenCalled();
    });

    // "an unfulfilled equipment item agreed with Technical Support Staff to be
    // non-essential" - the story's own example.
    it.each(["requested", "under_review", "unavailable"])(
      "[SPM-33][AC8] marks a %s equipment line as not required, and leaves its status as it was",
      async (status) => {
        const token = signIn(assignedCoordinator());
        given({ bookings: [booking()], equipment: [line({ status })] });

        const res = await patch(token, waiveLine);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(callArg(db.equipmentRequest.update)).toEqual({ where: { id: ID.request }, data: { notRequired: true, ...decided } });
        expect(named(body, "Projector")).toMatchObject({ state: "not_required", status });
        expect(body.blocking).toBe(0);
        expect(db.venueBooking.update).not.toHaveBeenCalled();
        expect(db.event.update).not.toHaveBeenCalled();
      }
    );

    it("[SPM-33][AC8] marks incomplete registration setup as not required, without changing the event's status or settings", async () => {
      const token = signIn(assignedCoordinator());
      given({ event: registrationIncomplete, bookings: [booking()] });

      const res = await patch(token, { kind: "registration", notRequired: true });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(callArg(db.event.update)).toEqual({ where: { id: ID.event }, data: { registrationNotRequired: true, ...registrationDecided } });
      expect(named(body, "Registration setup").state).toBe("not_required");
      expect(body.event.status).toBe("planning");
      expect(body.blocking).toBe(0);
    });

    it("[SPM-33][AC8][AC11] asks for a venue again when the event's only booking is marked as not required", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking({ status: "pending" })] });

      const body = await (await patch(token, { kind: "venue", id: ID.booking, notRequired: true })).json();

      expect(listed(body).map((a: ListedArrangement) => [a.name, a.state])).toEqual([
        ["Hall A", "not_required"],
        ["No venue booked", "outstanding"],
      ]);
      expect(body.blocking).toBe(1);
    });
  });

  describe("reversing the decision (AC8)", () => {
    it("[SPM-33][AC8] marks a venue booking as required again, so it is outstanding once more", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking(), booking({ id: ID.otherVenue, status: "pending", notRequired: true, venue: { name: "Room B", code: "ROOM-B" } })] });

      const res = await patch(token, { kind: "venue", id: ID.otherVenue, notRequired: false });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(callArg(db.venueBooking.update)).toEqual({ where: { id: ID.otherVenue }, data: { notRequired: false, ...decided } });
      expect(named(body, "Room B").state).toBe("outstanding");
      expect(body.blocking).toBe(1);
    });

    it("[SPM-33][AC8] marks an equipment line as required again", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking()], equipment: [line({ status: "unavailable", notRequired: true })] });

      const res = await patch(token, { ...waiveLine, notRequired: false });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(callArg(db.equipmentRequest.update)).toEqual({ where: { id: ID.request }, data: { notRequired: false, ...decided } });
      expect(named(body, "Projector").state).toBe("outstanding");
      expect(body.blocking).toBe(1);
    });

    it("[SPM-33][AC8] writes nothing when asked to mark registration that is switched off as required", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking()] });

      const res = await patch(token, { kind: "registration", notRequired: false });

      expect(res.status).toBe(200);
      expectNothingWritten();
    });

    it("[SPM-33][AC8] marks registration setup as required again", async () => {
      const token = signIn(assignedCoordinator());
      given({ event: { ...registrationIncomplete, registrationNotRequired: true }, bookings: [booking()] });

      const res = await patch(token, { kind: "registration", notRequired: false });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(callArg(db.event.update)).toEqual({ where: { id: ID.event }, data: { registrationNotRequired: false, ...registrationDecided } });
      expect(named(body, "Registration setup").state).toBe("outstanding");
    });

    it("[SPM-33][AC8] writes nothing when asked to reverse a decision that was never made", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking()], equipment: [line({ status: "requested" })] });

      const res = await patch(token, { ...waiveLine, notRequired: false });

      expect(res.status).toBe(200);
      expect(named(await res.json(), "Projector").state).toBe("outstanding");
      expectNothingWritten();
    });

    it("[SPM-33][AC8] is 404 if the event is gone by the time the change has been saved", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking()], equipment: [line({ status: "requested" })] });
      const found = await db.event.findUnique();
      db.event.findUnique.mockResolvedValueOnce(found).mockResolvedValueOnce(null);

      expect((await patch(token, waiveLine)).status).toBe(404);
    });

    // The line was reserved after it was waived: it is complete either way,
    // and the decision can still be taken back.
    it("[SPM-33][AC8] lets a decision be reversed even when the arrangement has since been completed", async () => {
      const token = signIn(assignedCoordinator());
      given({ bookings: [booking()], equipment: [line({ status: "reserved", notRequired: true })] });

      const res = await patch(token, { ...waiveLine, notRequired: false });

      expect(res.status).toBe(200);
      expect(named(await res.json(), "Projector").state).toBe("complete");
    });
  });
});
