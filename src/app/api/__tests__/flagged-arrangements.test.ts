// SPM-68, Review Flagged Arrangements. Written before the code; what these tests hold it to:
//   src/app/api/flagged-arrangements/route.ts   exports GET and POST
//
//   GET  -> 200 { venueBookings, equipmentRequests, registrations } - the flagged arrangements of the
//           events assigned to the signed-in coordinator, most recently flagged first; 401;
//           403 "Flagged arrangements are for Event Coordinators" for a role without event:confirm,
//           before anything is read.
//           Reads prisma.venueBooking.findMany, prisma.equipmentRequest.findMany and
//           prisma.event.findMany, each where the event's coordinatorId is the actor's. The rows
//           carry what the live check reads (see bookingRow(), equipmentRow(), eventRow() below).
//           Equipment availability is loadSingleLineAvailability() (SPM-49) - the result Technical
//           Support see - so it reads prisma.equipmentRequest.findUnique and, for the other
//           holders of the item, prisma.equipmentRequest.findMany.
//   POST { kind: "venue_booking" | "equipment_request" | "registrations", id } - keep it, or mark
//           the registrations as reviewed. `id` is the booking's, the request's, or the event's.
//        -> 200 { cleared: true }, having written ONLY the flag;
//           401; 403 for a role without event:confirm; 400 "Validation failed";
//           404 "This arrangement could not be found.";
//           403 "Only the assigned Coordinator can review this event's flagged arrangements.";
//           400 "This arrangement is not flagged for review.";
//           400 { error: "<name> no longer meets this event's requirements: …", unmet: [...] }.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - one route for the three kinds, and the response field names
//   - keeping writes { needsReview: false, reviewReason: null } and leaves flaggedAt as history;
//     reviewing registrations writes { registrationReviewReason: null }
//   - the wording of every message
// AC12's release needs nothing here: it is done on the event's Venue tab (SPM-67). A
// withdrawn or released booking leaves this list because only pending and approved
// bookings are read.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/flagged-arrangements/route";
import { can } from "@/lib/permissions";
import { ROLES } from "@/lib/roles";
import { callArg, db, ID, req, signIn, user } from "@/test/kit";

const PATH = "/api/flagged-arrangements";
const list = (token?: string) => GET(req("GET", PATH, { token }));
const keep = (body: unknown, token?: string) => POST(req("POST", PATH, { token, body }));

const coordinator = () => signIn(user("coordinator"));
const OTHER_ROLES = ROLES.filter((role) => !can(role, "event:confirm"));

/// 8 Oct 2027 at a Singapore wall-clock hour.
const at = (hour: number, day = 8) => new Date(Date.UTC(2027, 9, day, hour - 8));
const FLAGGED_AT = new Date("2026-10-12T02:00:00.000Z");

const NOT_ASSIGNED = "Only the assigned Coordinator can review this event's flagged arrangements.";
const NOT_FLAGGED = "This arrangement is not flagged for review.";
const NOT_FOUND = "This arrangement could not be found.";
const EVENT_CLOSED = "This event is completed, cancelled, rejected or withdrawn, so its flags are no longer reviewed.";
const NOTHING_HELD = "This arrangement no longer holds anything, so there is nothing to review.";
const CLOSED_STATUSES = ["completed", "cancelled", "rejected", "withdrawn"];

function eventOf(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 41,
    title: "Harbour Summit",
    status: "planning",
    coordinatorId: ID.user,
    startsAt: at(9),
    endsAt: at(17),
    expectedAttendance: 80,
    preferredLayout: "theatre",
    facilityRequirements: [] as object[],
    ...overrides,
  };
}

function venueOf(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.venue,
    code: "HALL",
    name: "Hall",
    isActive: true,
    setupMinutes: 0,
    teardownMinutes: 0,
    layouts: [{ layoutName: "theatre", capacity: 100 }],
    facilities: [] as { facilityId: string }[],
    bookings: [] as object[],
    unavailability: [] as object[],
    ...overrides,
  };
}

/// A flagged venue booking as the route reads it: with its event's present
/// requirements and everything of the venue the live check needs.
function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.booking,
    status: "approved",
    needsReview: true,
    reviewReason: "event_attendance_changed",
    flaggedAt: FLAGGED_AT,
    startsAt: at(9),
    endsAt: at(17),
    layoutName: "theatre",
    sessionId: null,
    session: null,
    event: eventOf(),
    venue: venueOf(),
    ...overrides,
  };
}

/// A flagged equipment request. One row serves both reads: the route's own,
/// and loadSingleLineAvailability()'s (which needs the item's stock and the
/// event's dates and venue bookings).
function equipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.request,
    status: "reserved",
    needsReview: true,
    reviewReason: "event_schedule_changed",
    flaggedAt: FLAGGED_AT,
    quantityRequested: 2,
    quantityReserved: 2,
    sessionId: null,
    session: null,
    equipment: {
      id: ID.equipment,
      name: "Projector",
      totalQuantity: 4,
      quantityInMaintenance: 0,
      isActive: true,
      locationVenueId: null,
    },
    event: { ...eventOf(), venueBookings: [] },
    ...overrides,
  };
}

/// An event whose registrations are flagged, with the registrations that hold a place.
function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    ...eventOf(),
    registrationReviewReason: "registration_capacity_lowered",
    registrations: [{ status: "registered" }, { status: "registered" }, { status: "waitlisted" }],
    ...overrides,
  };
}

/// What the three list queries find. An equipment request is also what
/// loadSingleLineAvailability() finds by id; nobody else holds the item.
function given({
  bookings = [],
  equipment = [],
  events = [],
}: { bookings?: object[]; equipment?: object[]; events?: object[] } = {}) {
  db.venueBooking.findMany.mockResolvedValue(bookings);
  db.equipmentRequest.findMany.mockImplementation(async (args: { where?: { needsReview?: boolean } }) =>
    args?.where?.needsReview ? equipment : []
  );
  db.equipmentRequest.findUnique.mockImplementation(
    async (args: { where: { id: string } }) => (equipment as { id: string }[]).find((r) => r.id === args.where.id) ?? null
  );
  db.event.findMany.mockResolvedValue(events);
}

describe("GET /api/flagged-arrangements", () => {
  it("is 401 without a session", async () => {
    expect((await list()).status).toBe(401);
  });

  it.each(OTHER_ROLES)("is 403 for %s, before anything is read", async (role) => {
    const res = await list(signIn(user(role)));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Flagged arrangements are for Event Coordinators");
    expect(db.venueBooking.findMany).not.toHaveBeenCalled();
    expect(db.equipmentRequest.findMany).not.toHaveBeenCalled();
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  // AC1, AC3, AC16: only what is flagged, and only on this coordinator's events.
  it("asks only for flagged arrangements of the events assigned to this coordinator", async () => {
    given();

    await list(coordinator());

    expect(callArg(db.venueBooking.findMany).where).toMatchObject({
      needsReview: true,
      event: { coordinatorId: ID.user },
    });
    const flaggedEquipment = db.equipmentRequest.findMany.mock.calls.map(([args]) => args).find((args) => args.where.needsReview);
    expect(flaggedEquipment.where).toMatchObject({ needsReview: true, event: { coordinatorId: ID.user } });
    expect(callArg(db.event.findMany).where).toMatchObject({
      coordinatorId: ID.user,
      registrationReviewReason: { not: null },
    });
  });

  // AC12: so a booking the coordinator withdrew or released (SPM-67) is gone from the list.
  it("leaves out a booking or equipment line that no longer holds anything", async () => {
    given();

    await list(coordinator());

    expect(callArg(db.venueBooking.findMany).where.status).toEqual({ in: ["pending", "approved"] });
    const flaggedEquipment = db.equipmentRequest.findMany.mock.calls.map(([args]) => args).find((args) => args.where.needsReview);
    expect(flaggedEquipment.where.status).toEqual({
      in: ["requested", "under_review", "reserved", "partially_fulfilled"],
    });
  });

  it("leaves out events that are over or called off", async () => {
    given();

    await list(coordinator());

    const closed = { notIn: ["completed", "cancelled", "rejected", "withdrawn"] };
    expect(callArg(db.venueBooking.findMany).where.event.status).toEqual(closed);
    const flaggedEquipment = db.equipmentRequest.findMany.mock.calls.map(([args]) => args).find((args) => args.where.needsReview);
    expect(flaggedEquipment.where.event.status).toEqual(closed);
    expect(callArg(db.event.findMany).where.status).toEqual(closed);
  });

  // Marking as not required (SPM-33) waives it for confirmation; it does not clear the flag.
  it("still lists a flagged arrangement that was marked as not required, and says so", async () => {
    given({ bookings: [bookingRow({ notRequired: true })], equipment: [equipmentRow({ notRequired: true })] });

    const body = await (await list(coordinator())).json();

    expect(body.venueBookings[0].notRequired).toBe(true);
    expect(body.equipmentRequests[0].notRequired).toBe(true);
  });

  it("reads the most recently flagged first", async () => {
    given();

    await list(coordinator());

    expect(callArg(db.venueBooking.findMany).orderBy).toEqual({ flaggedAt: "desc" });
    const flaggedEquipment = db.equipmentRequest.findMany.mock.calls.map(([args]) => args).find((args) => args.where.needsReview);
    expect(flaggedEquipment.orderBy).toEqual({ flaggedAt: "desc" });
  });

  it("answers three empty lists when nothing is flagged", async () => {
    given();

    const res = await list(coordinator());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ venueBookings: [], equipmentRequests: [], registrations: [] });
  });

  // AC2, AC4.
  it("lists a flagged booking with its event, venue, why it was flagged and its current result", async () => {
    given({ bookings: [bookingRow({ reviewReason: "event_schedule_changed,event_attendance_changed" })] });

    const body = await (await list(coordinator())).json();

    expect(body.venueBookings).toEqual([
      {
        id: ID.booking,
        status: "approved",
        notRequired: false,
        startsAt: "2027-10-08T01:00:00.000Z",
        endsAt: "2027-10-08T09:00:00.000Z",
        layoutName: "theatre",
        flaggedAt: "2026-10-12T02:00:00.000Z",
        reasons: ["the date or time changed", "the expected attendance changed"],
        event: { reference: "EVT-000041", title: "Harbour Summit", status: "planning" },
        session: null,
        venue: { id: ID.venue, code: "HALL", name: "Hall" },
        suitability: { ok: true, unmet: [] },
        availability: { ok: true, unmet: [] },
      },
    ]);
  });

  it("says which requirement a booking no longer meets, judged on the event as it is now", async () => {
    given({ bookings: [bookingRow({ event: eventOf({ expectedAttendance: 150 }) })] });

    const [booking] = (await (await list(coordinator())).json()).venueBookings;

    expect(booking.suitability).toEqual({ ok: false, unmet: ["Theatre capacity is 100 - your event expects 150."] });
    expect(booking.availability).toEqual({ ok: true, unmet: [] });
  });

  it("checks the event's mandatory facilities against what the venue has now", async () => {
    const requires = (isMandatory: boolean) => [
      { facilityId: ID.facility, isMandatory, facility: { name: "Raised stage", category: "facility" } },
    ];
    given({
      bookings: [
        bookingRow({ id: "mandatory", event: eventOf({ facilityRequirements: requires(true) }) }),
        bookingRow({ id: "optional", event: eventOf({ facilityRequirements: requires(false) }) }),
        bookingRow({
          id: "has-it",
          event: eventOf({ facilityRequirements: requires(true) }),
          venue: venueOf({ facilities: [{ facilityId: ID.facility }] }),
        }),
      ],
    });

    const bookings = (await (await list(coordinator())).json()).venueBookings;

    expect(bookings.map((b: { suitability: object }) => b.suitability)).toEqual([
      { ok: false, unmet: ["Missing facility: Raised stage."] },
      { ok: true, unmet: [] },
      { ok: true, unmet: [] },
    ]);
  });

  it("shows a booking at a venue that is blocked or retired as not available, with why", async () => {
    given({
      bookings: [
        bookingRow({
          id: "blocked",
          reviewReason: "venue_unavailable",
          venue: venueOf({ unavailability: [{ startsAt: at(8), endsAt: at(18), reason: "maintenance" }] }),
        }),
        bookingRow({ id: "retired", reviewReason: "venue_retired", venue: venueOf({ isActive: false }) }),
      ],
    });

    const bookings = (await (await list(coordinator())).json()).venueBookings;

    expect(bookings[0]).toMatchObject({
      reasons: ["the venue is unavailable during this booking"],
      availability: { ok: false, unmet: ["Hall is unavailable at this time (maintenance, 8 Oct 2027, 08:00–18:00)."] },
    });
    expect(bookings[1]).toMatchObject({
      reasons: ["the venue has been retired"],
      availability: { ok: false, unmet: ["Hall has been retired."] },
    });
  });

  it("shows a booking that no longer covers the event's new date as not available", async () => {
    given({ bookings: [bookingRow({ event: eventOf({ startsAt: at(9, 9), endsAt: at(17, 9) }) })] });

    const [booking] = (await (await list(coordinator())).json()).venueBookings;

    expect(booking.availability).toEqual({
      ok: false,
      unmet: ["The booking (8 Oct 2027, 09:00–17:00) does not cover the event's time (9 Oct 2027, 09:00–17:00)."],
    });
  });

  it("names the other event when its approved booking now holds the room at the same time", async () => {
    const other = {
      id: "other-booking",
      eventId: ID.otherUser,
      status: "approved",
      startsAt: at(12),
      endsAt: at(14),
      sessionId: null,
      event: { sequenceNumber: 50, title: "Other Event" },
    };
    // The booking's own row is among the venue's bookings too, and never counts against itself.
    const own = { ...other, id: ID.booking, eventId: ID.event, startsAt: at(9), endsAt: at(17) };
    given({ bookings: [bookingRow({ venue: venueOf({ bookings: [own, other] }) })] });

    const [booking] = (await (await list(coordinator())).json()).venueBookings;

    expect(booking.availability).toEqual({
      ok: false,
      unmet: ["Hall is already booked for EVT-000050 Other Event on 8 Oct 2027, 12:00–14:00."],
    });
  });

  it("has no time to hold a booking to while the event has no dates", async () => {
    given({ bookings: [bookingRow({ event: eventOf({ startsAt: null, endsAt: null }) })] });

    const [booking] = (await (await list(coordinator())).json()).venueBookings;

    expect(booking.availability).toEqual({ ok: true, unmet: [] });
  });

  it("judges a session's booking by that session's own time, attendance and layout", async () => {
    const session = {
      id: ID.session,
      label: "Day 1",
      startsAt: at(9),
      endsAt: at(17),
      expectedAttendance: 120,
      preferredLayout: "theatre",
    };
    given({ bookings: [bookingRow({ sessionId: ID.session, session })] });

    const [booking] = (await (await list(coordinator())).json()).venueBookings;

    expect(booking.session).toEqual({ id: ID.session, label: "Day 1" });
    // The event expects 80, which fits; the session's 120 does not.
    expect(booking.suitability).toEqual({ ok: false, unmet: ["Theatre capacity is 100 - your event expects 120."] });
  });

  // AC2, AC5.
  it("lists a flagged equipment reservation with its current availability", async () => {
    given({ equipment: [equipmentRow()] });

    const body = await (await list(coordinator())).json();

    expect(body.equipmentRequests).toEqual([
      {
        id: ID.request,
        status: "reserved",
        notRequired: false,
        quantityRequested: 2,
        quantityReserved: 2,
        flaggedAt: "2026-10-12T02:00:00.000Z",
        reasons: ["the date or time changed"],
        event: { reference: "EVT-000041", title: "Harbour Summit", status: "planning" },
        session: null,
        equipment: { id: ID.equipment, name: "Projector" },
        availability: { ok: true, needed: 2, available: 4, summary: "2 reserved, 4 available for these dates." },
      },
    ]);
  });

  it("says which session a session's equipment line is for", async () => {
    given({ equipment: [equipmentRow({ sessionId: ID.session, session: { id: ID.session, label: "Day 1" } })] });

    const [request] = (await (await list(coordinator())).json()).equipmentRequests;

    expect(request.session).toEqual({ id: ID.session, label: "Day 1" });
  });

  it("cannot check a line whose event has no dates, and says so", async () => {
    given({ equipment: [equipmentRow({ event: { ...eventOf({ startsAt: null, endsAt: null }), venueBookings: [] } })] });

    const [request] = (await (await list(coordinator())).json()).equipmentRequests;

    expect(request.availability).toEqual({
      ok: false,
      needed: 2,
      available: null,
      summary: "Availability could not be checked: this event has no dates yet.",
    });
  });

  it("shows a reservation the units left can no longer cover", async () => {
    const equipment = { ...equipmentRow().equipment, totalQuantity: 2, quantityInMaintenance: 1 };
    given({ equipment: [equipmentRow({ reviewReason: "equipment_unavailable", equipment })] });

    const [request] = (await (await list(coordinator())).json()).equipmentRequests;

    expect(request.reasons).toEqual(["units of the equipment were marked out of service"]);
    expect(request.availability).toEqual({
      ok: false,
      needed: 2,
      available: 1,
      summary: "2 reserved, 1 available for these dates.",
    });
  });

  // AC8.
  it("lists flagged registrations with how many are registered and waitlisted, and why", async () => {
    given({
      events: [eventRow({ registrationReviewReason: "event_schedule_changed,registration_capacity_lowered" })],
    });

    const body = await (await list(coordinator())).json();

    expect(body.registrations).toEqual([
      {
        event: { id: ID.event, reference: "EVT-000041", title: "Harbour Summit", status: "planning" },
        registered: 2,
        waitlisted: 1,
        reasons: [
          "the date or time changed",
          "the registration capacity was lowered below the number registered or waitlisted",
        ],
      },
    ]);
  });

  it("answers 500 when the database fails", async () => {
    given();
    db.venueBooking.findMany.mockRejectedValue(new Error("connection lost"));

    expect((await list(coordinator())).status).toBe(500);
  });
});

describe("POST /api/flagged-arrangements", () => {
  const BOOKING = { kind: "venue_booking", id: ID.booking };
  const EQUIPMENT = { kind: "equipment_request", id: ID.request };
  const REGISTRATIONS = { kind: "registrations", id: ID.event };

  /// What the route finds when it looks the arrangement up by id.
  function found({
    booking = null,
    equipment = null,
    event = null,
  }: { booking?: object | null; equipment?: object | null; event?: object | null }) {
    db.venueBooking.findUnique.mockResolvedValue(booking);
    db.equipmentRequest.findUnique.mockResolvedValue(equipment);
    // The other holders of the item, for the availability check: nobody.
    db.equipmentRequest.findMany.mockResolvedValue([]);
    db.event.findUnique.mockResolvedValue(event);
  }

  const nothingWritten = () => {
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.equipmentRequest.update).not.toHaveBeenCalled();
    expect(db.event.update).not.toHaveBeenCalled();
  };

  it("is 401 without a session", async () => {
    expect((await keep(BOOKING)).status).toBe(401);
  });

  it.each(OTHER_ROLES)("is 403 for %s, and nothing is read or written", async (role) => {
    found({ booking: bookingRow() });

    const res = await keep(BOOKING, signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueBooking.findUnique).not.toHaveBeenCalled();
    nothingWritten();
  });

  it.each([
    ["an unknown kind", { kind: "safety_check", id: ID.booking }],
    ["no id", { kind: "venue_booking" }],
    ["no kind", { id: ID.booking }],
  ])("refuses a request with %s", async (_what, body) => {
    found({ booking: bookingRow() });

    const res = await keep(body, coordinator());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Validation failed");
    nothingWritten();
  });

  // The same limits GET lists by: nothing the page would never show can be
  // kept or reviewed, even by a request made without the page.
  describe("what the list would never show", () => {
    it.each(CLOSED_STATUSES)("refuses a booking on a %s event, and clears nothing", async (status) => {
      found({ booking: bookingRow({ event: eventOf({ status }) }) });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(EVENT_CLOSED);
      nothingWritten();
    });

    it.each(CLOSED_STATUSES)("refuses equipment on a %s event, and clears nothing", async (status) => {
      found({ equipment: equipmentRow({ event: { ...eventOf({ status }), venueBookings: [] } }) });

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(EVENT_CLOSED);
      nothingWritten();
    });

    it.each(CLOSED_STATUSES)("refuses registrations on a %s event, and clears nothing", async (status) => {
      found({ event: eventRow({ status }) });

      const res = await keep(REGISTRATIONS, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(EVENT_CLOSED);
      nothingWritten();
    });

    it.each(["rejected", "withdrawn", "released"])("refuses a %s booking, and clears nothing", async (status) => {
      found({ booking: bookingRow({ status }) });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NOTHING_HELD);
      nothingWritten();
    });

    it.each(["unavailable", "cancelled"])("refuses an equipment request that is %s, and clears nothing", async (status) => {
      found({ equipment: equipmentRow({ status }) });

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NOTHING_HELD);
      nothingWritten();
    });

    it.each(["approved", "planning", "safety_review", "confirmed", "postponed"])(
      "still keeps a booking on an event that is %s",
      async (status) => {
        found({ booking: bookingRow({ event: eventOf({ status }) }) });

        expect((await keep(BOOKING, coordinator())).status).toBe(200);
      }
    );

    it.each(["requested", "under_review", "partially_fulfilled"])("still keeps an equipment request that is %s", async (status) => {
      found({ equipment: equipmentRow({ status, quantityReserved: status === "partially_fulfilled" ? 2 : null }) });

      expect((await keep(EQUIPMENT, coordinator())).status).toBe(200);
    });
  });

  describe("keeping a venue booking", () => {
    // AC6.
    it("clears the flag of a booking that still meets the event's requirements, and changes nothing else", async () => {
      found({ booking: bookingRow() });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cleared: true });
      expect(db.venueBooking.update).toHaveBeenCalledTimes(1);
      expect(callArg(db.venueBooking.update).where).toEqual({ id: ID.booking });
      // Only the flag: not the venue, the times, the layout or the status.
      expect(callArg(db.venueBooking.update).data).toEqual({ needsReview: false, reviewReason: null });
      expect(db.event.update).not.toHaveBeenCalled();
    });

    it("keeps a pending request too", async () => {
      found({ booking: bookingRow({ status: "pending", reviewReason: "event_schedule_changed" }) });

      expect((await keep(BOOKING, coordinator())).status).toBe(200);
    });

    // AC7.
    it("refuses a booking whose room is now too small, names the requirement and leaves the flag", async () => {
      found({ booking: bookingRow({ event: eventOf({ expectedAttendance: 150 }) }) });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Hall no longer meets this event's requirements: Theatre capacity is 100 - your event expects 150.",
        unmet: ["Theatre capacity is 100 - your event expects 150."],
      });
      nothingWritten();
    });

    it("refuses a booking at a venue that is blocked for its time", async () => {
      found({
        booking: bookingRow({
          venue: venueOf({ unavailability: [{ startsAt: at(8), endsAt: at(18), reason: "maintenance" }] }),
        }),
      });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "Hall no longer meets this event's requirements: Hall is unavailable at this time (maintenance, 8 Oct 2027, 08:00–18:00)."
      );
      nothingWritten();
    });

    it("refuses a booking at a retired venue", async () => {
      found({ booking: bookingRow({ venue: venueOf({ isActive: false }) }) });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).unmet).toEqual(["Hall has been retired."]);
      nothingWritten();
    });

    it("names every unmet requirement, suitability first", async () => {
      found({
        booking: bookingRow({ event: eventOf({ expectedAttendance: 150 }), venue: venueOf({ isActive: false }) }),
      });

      const body = await (await keep(BOOKING, coordinator())).json();

      expect(body.unmet).toEqual(["Theatre capacity is 100 - your event expects 150.", "Hall has been retired."]);
      expect(body.error).toBe(
        "Hall no longer meets this event's requirements: Theatre capacity is 100 - your event expects 150. Hall has been retired."
      );
    });

    it("is 404 for a booking that does not exist", async () => {
      found({});

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe(NOT_FOUND);
      nothingWritten();
    });

    // AC16.
    it("refuses a booking of an event assigned to another coordinator", async () => {
      found({ booking: bookingRow({ event: eventOf({ coordinatorId: ID.otherUser }) }) });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(NOT_ASSIGNED);
      nothingWritten();
    });

    it("refuses a booking that is not flagged", async () => {
      found({ booking: bookingRow({ needsReview: false, reviewReason: null }) });

      const res = await keep(BOOKING, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NOT_FLAGGED);
      nothingWritten();
    });
  });

  describe("keeping an equipment reservation", () => {
    // AC6.
    it("clears the flag of a reservation that is still available, and changes nothing else", async () => {
      found({ equipment: equipmentRow() });

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cleared: true });
      expect(callArg(db.equipmentRequest.update).where).toEqual({ id: ID.request });
      // Only the flag: not the quantity, the status or the dates.
      expect(callArg(db.equipmentRequest.update).data).toEqual({ needsReview: false, reviewReason: null });
    });

    // AC7.
    it("refuses a reservation the units left can no longer cover, names the shortfall and leaves the flag", async () => {
      const equipment = { ...equipmentRow().equipment, totalQuantity: 2, quantityInMaintenance: 1 };
      found({ equipment: equipmentRow({ equipment }) });

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Projector no longer meets this event's requirements: 2 reserved, 1 available for these dates.",
        unmet: ["2 reserved, 1 available for these dates."],
      });
      nothingWritten();
    });

    it("is 404 for a request that does not exist", async () => {
      found({});

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe(NOT_FOUND);
    });

    it("refuses a request of an event assigned to another coordinator", async () => {
      found({ equipment: equipmentRow({ event: { ...eventOf({ coordinatorId: ID.otherUser }), venueBookings: [] } }) });

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(NOT_ASSIGNED);
      nothingWritten();
    });

    it("refuses a request that is not flagged", async () => {
      found({ equipment: equipmentRow({ needsReview: false, reviewReason: null }) });

      const res = await keep(EQUIPMENT, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NOT_FLAGGED);
      nothingWritten();
    });
  });

  describe("marking registrations as reviewed", () => {
    // AC9.
    it("clears the event's registration flag and changes no registration", async () => {
      found({ event: eventRow() });

      const res = await keep(REGISTRATIONS, coordinator());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ cleared: true });
      expect(callArg(db.event.update).where).toEqual({ id: ID.event });
      // Only the flag: not the capacity, whether registration is on, or the status.
      expect(callArg(db.event.update).data).toEqual({ registrationReviewReason: null });
      for (const write of ["create", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
        expect(db.registration[write]).not.toHaveBeenCalled();
      }
    });

    it("needs nothing of the registrations to be true first - there is nothing to keep or refuse", async () => {
      found({ event: eventRow({ registrationReviewReason: "registration_disabled", registrations: [] }) });

      expect((await keep(REGISTRATIONS, coordinator())).status).toBe(200);
    });

    it("is 404 for an event that does not exist", async () => {
      found({});

      const res = await keep(REGISTRATIONS, coordinator());

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe(NOT_FOUND);
    });

    it("refuses an event assigned to another coordinator", async () => {
      found({ event: eventRow({ coordinatorId: ID.otherUser }) });

      const res = await keep(REGISTRATIONS, coordinator());

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(NOT_ASSIGNED);
      nothingWritten();
    });

    it("refuses an event whose registrations are not flagged", async () => {
      found({ event: eventRow({ registrationReviewReason: null }) });

      const res = await keep(REGISTRATIONS, coordinator());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(NOT_FLAGGED);
      nothingWritten();
    });
  });

  it("answers 500 when the database fails", async () => {
    found({});
    db.venueBooking.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await keep(BOOKING, coordinator())).status).toBe(500);
  });
});
