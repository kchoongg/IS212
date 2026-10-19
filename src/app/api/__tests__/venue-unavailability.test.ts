// SPM-45 (Record Venue Unavailability). Rewritten on 2026-10-09 for times on the
// 15-minute grid (Week 7 Change #1, SPM-93), before the code was reworked. The contract:
//   src/app/api/venues/[id]/unavailability/route.ts              exports GET, POST
//   src/app/api/venues/[id]/unavailability/[periodId]/route.ts   exports PATCH, DELETE
//
//   Every handler: 401; 403 "Only Venue Staff can mark a venue unavailable" without
//   venue:manage; 404 "Venue not found"; 500.
//   GET    -> 200 [{ id, fromDay, fromTime, untilDay, untilTime, reason, otherReason }] - the venue's
//             periods that are not over yet, earliest first.
//   POST   { fromDay, fromTime, untilDay, untilTime, reason, otherReason? } - days "YYYY-MM-DD",
//          times "HH:MM" on the 15-minute grid, Singapore time. A period that is already
//          over (its return is not after now) is a 400 in the same shape as a validation
//          failure, fieldErrors.untilTime ["This period is already over."]; so is PATCH.
//          -> 201 { period, flaggedBookings }; 400 with Zod details.
//   PATCH  the same body -> 200 { period, flaggedBookings };
//          404 "Unavailable period not found" (missing, or another venue's).
//   DELETE -> 200 { ended: true }; 404 as PATCH; 400 "This unavailable period is already over."
//
//   The period is a VenueUnavailability row: startsAt is the time the venue becomes
//   unavailable, endsAt the time it is available again.
//   otherReason is required when reason is "other" and is stored, trimmed, in the
//   notes column; for any other reason notes is null and otherReason is ignored.
//   The venue is read with venue.findUnique, a period with venueUnavailability.findUnique,
//   and the bookings to judge with venueBooking.findMany - the same candidates
//   SPM-39 uses (approved, not finished), each with its session and event.
//   A booking is flagged when its room-in-use period (its times plus the venue's
//   setup and turnaround) overlaps the period: needsReview, reviewReason
//   "venue_unavailable" (merged into any reasons already there), flaggedAt; and its
//   coordinator notified that alternative arrangements are needed (Week 7 Change #2).
//   A booking is never changed in any other way.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the refusal and validation wording, and the notification's type and title
//   - a change flags only the bookings the period did not cover before
//   - ending a period under way sets its end to now, rounded down to the 15-minute
//     grid (deleting it if that leaves nothing); one not started is deleted
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/venues/[id]/unavailability/route";
import { PATCH, DELETE } from "@/app/api/venues/[id]/unavailability/[periodId]/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const PERIOD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COORDINATOR_ID = "coordinator-id";
const REQUESTER_ID = "requester-id";
const OTHERS = ["organiser", "coordinator", "ops_manager", "tech_support", "attendee"];

/// A Singapore wall-clock time as an instant (UTC+8, no daylight saving).
const sgt = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);

/// Before every fixture date below, so each booking is still to come.
const NOW = sgt("2026-10-06", "10:00");

/// Unavailable from 10 Jun 2027, 13:00; available again from 15 Jun 2027, 13:00.
const body = {
  fromDay: "2027-06-10",
  fromTime: "13:00",
  untilDay: "2027-06-15",
  untilTime: "13:00",
  reason: "equipment_failure",
};
/// The same period, for a reason that is not on the list.
const other = { ...body, reason: "other", otherReason: "Film crew on site" };
const STARTS = sgt("2027-06-10", "13:00");
const ENDS = sgt("2027-06-15", "13:00");

function venue(overrides: Record<string, unknown> = {}) {
  return { id: ID.venue, code: "HALL-A", name: "Hall A", isActive: true, setupMinutes: 0, teardownMinutes: 0, ...overrides };
}

function period(overrides: Record<string, unknown> = {}) {
  return {
    id: PERIOD_ID,
    venueId: ID.venue,
    startsAt: STARTS,
    endsAt: ENDS,
    reason: "equipment_failure",
    notes: null,
    ...overrides,
  };
}

/// An approved booking of the venue, by its own times on one day.
function booking(id: string, title: string, day: string, from: string, to: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    eventId: `event-${id}`,
    sessionId: null,
    session: null,
    layoutName: "theatre",
    status: "approved",
    needsReview: false,
    reviewReason: null,
    requestedBy: REQUESTER_ID,
    startsAt: sgt(day, from),
    endsAt: sgt(day, to),
    event: { id: `event-${id}`, title, coordinatorId: COORDINATOR_ID },
    ...overrides,
  };
}

/// The four bookings of the manual test cases (SPM-45-TC09): each meets an edge
/// of the period, two from outside it and two from inside.
const before = () => booking("b-before", "Morning Briefing", "2027-06-10", "11:00", "13:00");
const first = () => booking("b-first", "Afternoon Workshop", "2027-06-10", "13:00", "15:00");
const last = () => booking("b-last", "Closing Seminar", "2027-06-15", "10:00", "13:00");
const after = () => booking("b-after", "Return Forum", "2027-06-15", "13:00", "15:00");

function given({ stored = venue(), bookings = [], existing = period() }: {
  stored?: object | null;
  bookings?: object[];
  existing?: object | null;
} = {}) {
  const token = signIn(user("venue_staff"));
  db.venue.findUnique.mockResolvedValue(stored);
  db.venueBooking.findMany.mockResolvedValue(bookings);
  db.venueUnavailability.findUnique.mockResolvedValue(existing);
  db.venueUnavailability.findMany.mockResolvedValue(existing ? [existing] : []);
  db.venueUnavailability.create.mockImplementation(async ({ data }: { data: object }) => ({ id: PERIOD_ID, ...data }));
  db.venueUnavailability.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existing, ...data }));
  return token;
}

const LIST = `/api/venues/${ID.venue}/unavailability`;
const ONE = `${LIST}/${PERIOD_ID}`;
const venueParams = () => params({ id: ID.venue });
const periodParams = () => params({ id: ID.venue, periodId: PERIOD_ID });

const list = (token?: string) => GET(req("GET", LIST, { token }), venueParams());
const create = (token: string | undefined, sent: unknown = body) => POST(req("POST", LIST, { token, body: sent }), venueParams());
const change = (token: string | undefined, sent: unknown = body) => PATCH(req("PATCH", ONE, { token, body: sent }), periodParams());
const end = (token?: string) => DELETE(req("DELETE", ONE, { token }), periodParams());

const flaggedIds = () => db.venueBooking.update.mock.calls.map(([arg]) => arg.where.id);

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/venues/[id]/unavailability", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await list()).status).toBe(401);
  });

  it.each(OTHERS)("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await list(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Venue Staff can mark a venue unavailable" });
    expect(db.venueUnavailability.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-45] is 404 for a venue that does not exist", async () => {
    const res = await list(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
  });

  it("[SPM-45][AC1] lists the periods that are not over yet, earliest first, as dates and times", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given();

    const res = await list(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: PERIOD_ID,
        fromDay: "2027-06-10",
        fromTime: "13:00",
        untilDay: "2027-06-15",
        untilTime: "13:00",
        reason: "equipment_failure",
        otherReason: null,
      },
    ]);
    expect(callArg(db.venueUnavailability.findMany)).toMatchObject({
      where: { venueId: ID.venue, endsAt: { gt: NOW } },
      orderBy: { startsAt: "asc" },
    });
  });

  it("[SPM-45] answers 500 when the database fails", async () => {
    const token = given();
    db.venue.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await list(token)).status).toBe(500);
  });
});

describe("POST /api/venues/[id]/unavailability", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await create(undefined)).status).toBe(401);
  });

  it.each(OTHERS)("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await create(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueUnavailability.create).not.toHaveBeenCalled();
  });

  it("[SPM-45] is 404 for a venue that does not exist", async () => {
    const res = await create(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venueUnavailability.create).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC1] records the period from the time it becomes unavailable to the time it is available again", async () => {
    const token = given();

    const res = await create(token);

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data).toEqual({
      venueId: ID.venue,
      startsAt: STARTS,
      endsAt: ENDS,
      reason: "equipment_failure",
      notes: null,
      createdBy: ID.user,
    });
  });

  it("[SPM-45][AC1] answers with the period as dates and times, and nothing flagged when no booking is affected", async () => {
    const json = await (await create(given())).json();

    expect(json.period).toEqual({ id: PERIOD_ID, ...body, otherReason: null });
    expect(json.flaggedBookings).toEqual([]);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC6] saves the description of an Other reason, trimmed", async () => {
    const res = await create(given(), { ...other, otherReason: "  Film crew on site " });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data).toMatchObject({ reason: "other", notes: "Film crew on site" });
    expect((await res.json()).period).toMatchObject({ reason: "other", otherReason: "Film crew on site" });
  });

  it("[SPM-45][AC6] ignores a description sent with a reason that is on the list", async () => {
    const res = await create(given(), { ...body, otherReason: "Film crew on site" });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data.notes).toBeNull();
  });

  it("[SPM-45][AC1] accepts a period of a single 15-minute step", async () => {
    const res = await create(given(), { ...body, untilDay: "2027-06-10", untilTime: "13:15" });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data).toMatchObject({
      startsAt: sgt("2027-06-10", "13:00"),
      endsAt: sgt("2027-06-10", "13:15"),
    });
  });

  it("[SPM-45][AC1] accepts a period that starts at midnight, outside any opening hours", async () => {
    const res = await create(given(), { ...body, fromTime: "00:00" });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data.startsAt).toEqual(sgt("2027-06-10", "00:00"));
  });

  it("[SPM-45][AC1] leaves the venue itself active - the room is not retired", async () => {
    const res = await create(given());

    expect(res.status).toBe(201);
    expect(db.venue.update).not.toHaveBeenCalled();
  });

  describe("what it refuses", () => {
    it.each([
      ["at the same time", { untilDay: "2027-06-10", untilTime: "13:00" }],
      ["earlier the same day", { untilDay: "2027-06-10", untilTime: "09:00" }],
      ["on an earlier day, later in the day", { untilDay: "2027-06-09", untilTime: "23:45" }],
    ])("[SPM-45][AC2] a return %s", async (_case, until) => {
      const res = await create(given(), { ...body, ...until });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.fieldErrors.untilTime).toEqual([
        "The venue must become available again after it becomes unavailable.",
      ]);
      expect(db.venueUnavailability.create).not.toHaveBeenCalled();
    });

    it.each([
      ["no reason", { reason: undefined }, "reason"],
      ["a reason that is not on the list", { reason: "holiday" }, "reason"],
      ["no start date", { fromDay: undefined }, "fromDay"],
      ["a start date that is not a real date", { fromDay: "2027-02-31" }, "fromDay"],
      ["no return date", { untilDay: undefined }, "untilDay"],
      ["no start time", { fromTime: undefined }, "fromTime"],
      ["no return time", { untilTime: undefined }, "untilTime"],
      ["a start time off the 15-minute grid", { fromTime: "13:10" }, "fromTime"],
      ["a return time off the 15-minute grid", { untilTime: "13:40" }, "untilTime"],
      ["a time that does not exist", { fromTime: "24:00" }, "fromTime"],
      ["a slot name instead of a time", { fromTime: "PM" }, "fromTime"],
      ["Other with no description", { reason: "other" }, "otherReason"],
      ["Other with a description of spaces only", { reason: "other", otherReason: "   " }, "otherReason"],
      ["Other with a description longer than 500 characters", { reason: "other", otherReason: "x".repeat(501) }, "otherReason"],
    ])("[SPM-45][AC1] %s", async (_case, change, field) => {
      const res = await create(given(), { ...body, ...change });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.fieldErrors).toHaveProperty(field);
      expect(db.venueUnavailability.create).not.toHaveBeenCalled();
    });

    describe("a period that is already over", () => {
      const past = { ...body, fromDay: "2026-09-01", fromTime: "09:00" };

      it.each([
        ["ended last month", { untilDay: "2026-09-05", untilTime: "17:00" }],
        ["ends at this very moment", { untilDay: "2026-10-06", untilTime: "10:00" }],
      ])("[SPM-45][AC1] when it %s", async (_case, until) => {
        vi.useFakeTimers({ now: NOW });

        const res = await create(given({ bookings: [first()] }), { ...past, ...until });

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "Validation failed",
          details: { formErrors: [], fieldErrors: { untilTime: ["This period is already over."] } },
        });
        expect(db.venueUnavailability.create).not.toHaveBeenCalled();
        expect(db.venueBooking.update).not.toHaveBeenCalled();
      });

      it("[SPM-45][AC1] but not one that began in the past and ends 15 minutes from now", async () => {
        vi.useFakeTimers({ now: NOW });

        const res = await create(given(), { ...past, untilDay: "2026-10-06", untilTime: "10:15" });

        expect(res.status).toBe(201);
      });
    });

    it("[SPM-45][AC1] names the 15-minute grid when a time is off it", async () => {
      const json = await (await create(given(), { ...body, fromTime: "13:10" })).json();

      expect(json.details.fieldErrors.fromTime).toEqual(["Choose a time on a 15-minute step (:00, :15, :30 or :45)."]);
    });

    it("[SPM-45][AC6] says what is missing when Other has no description", async () => {
      const json = await (await create(given(), { ...body, reason: "other" })).json();

      expect(json.details.fieldErrors.otherReason).toEqual(["Describe the reason."]);
    });
  });

  describe("bookings inside the period", () => {
    it("[SPM-45][AC3] only considers approved bookings that have not finished yet", async () => {
      vi.useFakeTimers({ now: NOW });

      await create(given());

      expect(callArg(db.venueBooking.findMany).where).toEqual({
        venueId: ID.venue,
        status: "approved",
        endsAt: { gt: NOW },
      });
    });

    it("[SPM-45][AC3] flags the bookings that overlap it, and not one that ends as it starts or starts as it ends", async () => {
      const token = given({ bookings: [before(), first(), last(), after()] });

      const json = await (await create(token)).json();

      expect(flaggedIds()).toEqual(["b-first", "b-last"]);
      expect(json.flaggedBookings.map((b: { eventTitle: string }) => b.eventTitle)).toEqual([
        "Afternoon Workshop",
        "Closing Seminar",
      ]);
    });

    it("[SPM-45][AC3] flags a booking for review without changing anything else about it", async () => {
      vi.useFakeTimers({ now: NOW });
      const token = given({ bookings: [first()] });

      await create(token);

      expect(callArg(db.venueBooking.update)).toEqual({
        where: { id: "b-first" },
        data: { needsReview: true, reviewReason: "venue_unavailable", flaggedAt: NOW },
      });
    });

    it("[SPM-45][AC3] reports what was flagged and who was told", async () => {
      const json = await (await create(given({ bookings: [first()] }))).json();

      expect(json.flaggedBookings).toEqual([
        {
          bookingId: "b-first",
          eventId: "event-b-first",
          eventTitle: "Afternoon Workshop",
          sessionId: null,
          sessionLabel: null,
          reasons: ["venue_unavailable"],
          notifiedUserId: COORDINATOR_ID,
        },
      ]);
    });

    it("[SPM-45][AC3] notifies the event's assigned coordinator, naming the venue, the event and the reason", async () => {
      await create(given({ bookings: [first()] }));
      const notification = callArg(db.notification.create).data;

      expect(notification).toMatchObject({
        recipientId: COORDINATOR_ID,
        type: "booking_venue_unavailable",
        title: "Venue unavailable - booking needs review",
        eventId: "event-b-first",
      });
      expect(notification.body).toContain("Hall A");
      expect(notification.body).toContain("the venue is unavailable during this booking");
      expect(notification.body).toContain("The approved booking for Afternoon Workshop on ");
      expect(notification.body).toContain("nothing has been changed automatically.");
      expect(notification.body).toContain("Alternative arrangements are needed");
      expect(notification.body).toContain("Unavailable from 10 Jun 2027, 13:00. Available again from 15 Jun 2027, 13:00.");
      expect(notification.body).toContain("Equipment failure");
    });

    it("[SPM-45][AC3] calls an untitled event 'an event' in the notification", async () => {
      const untitled = { ...first(), event: { ...first().event, title: null } };

      await create(given({ bookings: [untitled] }));

      expect(callArg(db.notification.create).data.body).toContain("The approved booking for an event on ");
    });

    it("[SPM-45][AC3] gives the coordinator the description when the reason is Other", async () => {
      await create(given({ bookings: [first()] }), other);

      expect(callArg(db.notification.create).data.body).toContain("Film crew on site");
    });

    it("[SPM-45][AC3] notifies the person who requested the booking when the event has no coordinator", async () => {
      const unassigned = { ...first(), event: { ...first().event, coordinatorId: null } };

      await create(given({ bookings: [unassigned] }));

      expect(callArg(db.notification.create).data.recipientId).toBe(REQUESTER_ID);
    });

    it("[SPM-45][AC3] names the session when the booking belongs to one", async () => {
      const sessionBooking = { ...first(), sessionId: ID.session, session: { label: "Day 2" } };

      const json = await (await create(given({ bookings: [sessionBooking] }))).json();

      expect(json.flaggedBookings[0]).toMatchObject({ sessionId: ID.session, sessionLabel: "Day 2" });
      expect(callArg(db.notification.create).data.body).toContain("(Day 2)");
    });

    it("[SPM-45][AC3] keeps the reasons an earlier venue change already flagged", async () => {
      const alreadyFlagged = { ...first(), needsReview: true, reviewReason: "layout_removed" };

      await create(given({ bookings: [alreadyFlagged] }));

      expect(callArg(db.venueBooking.update).data.reviewReason).toBe("layout_removed,venue_unavailable");
    });

    it("[SPM-45][AC3] counts a booking whose turnaround runs into the period", async () => {
      // Morning Briefing ends at 13:00, as the period starts; its turnaround runs to 13:45.
      const token = given({ stored: venue({ teardownMinutes: 45 }), bookings: [before()] });

      await create(token);

      expect(flaggedIds()).toEqual(["b-before"]);
    });

    it("[SPM-45][AC3] counts a booking whose setup starts inside the period", async () => {
      // Return Forum starts at 13:00, as the venue returns; its setup starts at 12:30.
      const token = given({ stored: venue({ setupMinutes: 30 }), bookings: [after()] });

      await create(token);

      expect(flaggedIds()).toEqual(["b-after"]);
    });

    it("[SPM-45][AC3] does not count setup and turnaround that only meet the period", async () => {
      // Room in use 10:30-13:00 and 13:00-15:45: each meets an edge, neither overlaps.
      const early = booking("b-early", "Early Talk", "2027-06-10", "11:00", "12:15");
      const later = booking("b-later", "Later Talk", "2027-06-15", "13:30", "15:00");
      const token = given({ stored: venue({ setupMinutes: 30, teardownMinutes: 45 }), bookings: [early, later] });

      const json = await (await create(token)).json();

      expect(json.flaggedBookings).toEqual([]);
      expect(db.venueBooking.update).not.toHaveBeenCalled();
    });
  });

  it("[SPM-45] answers 500 when the database fails", async () => {
    const token = given();
    db.venueUnavailability.create.mockRejectedValue(new Error("connection lost"));

    expect((await create(token)).status).toBe(500);
  });
});

describe("PATCH /api/venues/[id]/unavailability/[periodId]", () => {
  /// 12:45 to 13:15: one 15-minute step wider at each end than the stored period.
  const wider = { ...body, fromTime: "12:45", untilTime: "13:15" };

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await change(undefined)).status).toBe(401);
  });

  it.each(OTHERS)("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await change(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it.each([
    ["does not exist", null],
    ["belongs to another venue", period({ venueId: ID.otherVenue })],
  ])("[SPM-45] is 404 for a period that %s", async (_case, existing) => {
    const res = await change(given({ existing }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unavailable period not found" });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45] is 404 for a venue that does not exist", async () => {
    const res = await change(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] saves the new dates, times and reason", async () => {
    const token = given();

    const res = await change(token, { ...wider, reason: "other", otherReason: " Film crew on site " });

    expect(res.status).toBe(200);
    expect(callArg(db.venueUnavailability.update)).toEqual({
      where: { id: PERIOD_ID },
      data: {
        startsAt: sgt("2027-06-10", "12:45"),
        endsAt: sgt("2027-06-15", "13:15"),
        reason: "other",
        notes: "Film crew on site",
      },
    });
    expect((await res.json()).period).toEqual({ id: PERIOD_ID, ...wider, reason: "other", otherReason: "Film crew on site" });
  });

  it("[SPM-45][AC5][AC3] flags only the bookings the wider period newly covers", async () => {
    const token = given({ bookings: [before(), first(), last(), after()] });

    const json = await (await change(token, wider)).json();

    expect(flaggedIds()).toEqual(["b-before", "b-after"]);
    expect(json.flaggedBookings).toHaveLength(2);
    expect(db.notification.create).toHaveBeenCalledTimes(2);
  });

  it("[SPM-45][AC5][AC3] flags nothing, and clears nothing, when the period is made shorter", async () => {
    const shorter = { ...body, fromDay: "2027-06-11", fromTime: "09:00" };
    const token = given({ bookings: [{ ...first(), needsReview: true, reviewReason: "venue_unavailable" }] });

    const json = await (await change(token, shorter)).json();

    expect(json.flaggedBookings).toEqual([]);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC2] refuses a return that is not later than the start", async () => {
    const res = await change(given(), { ...body, untilDay: "2027-06-10", untilTime: "13:00" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.untilTime).toEqual([
      "The venue must become available again after it becomes unavailable.",
    ]);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] refuses a change that would leave the period already over", async () => {
    vi.useFakeTimers({ now: sgt("2027-06-12", "10:00") });

    const res = await change(given(), { ...body, untilDay: "2027-06-12", untilTime: "09:00" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.untilTime).toEqual(["This period is already over."]);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] refuses a time that is off the 15-minute grid", async () => {
    const res = await change(given(), { ...body, untilTime: "13:20" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors).toHaveProperty("untilTime");
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC6] refuses a change with no reason", async () => {
    const res = await change(given(), { ...body, reason: undefined });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors).toHaveProperty("reason");
  });

  it("[SPM-45][AC6] clears the description when the reason is changed from Other to one on the list", async () => {
    const token = given({ existing: period({ reason: "other", notes: "Film crew on site" }) });

    await change(token, { ...body, reason: "safety" });

    expect(callArg(db.venueUnavailability.update).data).toMatchObject({ reason: "safety", notes: null });
  });

  it("[SPM-45][AC6] refuses a change to Other with no description", async () => {
    const res = await change(given(), { ...body, reason: "other" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.otherReason).toEqual(["Describe the reason."]);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45] answers 500 when the database fails", async () => {
    const token = given();
    db.venueUnavailability.update.mockRejectedValue(new Error("connection lost"));

    expect((await change(token)).status).toBe(500);
  });
});

describe("DELETE /api/venues/[id]/unavailability/[periodId] - ending a period early", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await end()).status).toBe(401);
  });

  it.each(OTHERS)("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await end(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["does not exist", null],
    ["belongs to another venue", period({ venueId: ID.otherVenue })],
  ])("[SPM-45] is 404 for a period that %s", async (_case, existing) => {
    const res = await end(given({ existing }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unavailable period not found" });
  });

  it("[SPM-45] is 404 for a venue that does not exist", async () => {
    const res = await end(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5][AC4] ends a period that is under way from the 15-minute step that has begun, keeping the record of it", async () => {
    vi.useFakeTimers({ now: sgt("2027-06-12", "10:07") });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: true });
    expect(callArg(db.venueUnavailability.update)).toEqual({
      where: { id: PERIOD_ID },
      data: { endsAt: sgt("2027-06-12", "10:00") },
    });
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] removes a period ended within 15 minutes of starting, since nothing of it is left", async () => {
    vi.useFakeTimers({ now: sgt("2027-06-10", "13:10") });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(200);
    expect(callArg(db.venueUnavailability.delete)).toEqual({ where: { id: PERIOD_ID } });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] removes a period that has not started yet", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(200);
    expect(callArg(db.venueUnavailability.delete)).toEqual({ where: { id: PERIOD_ID } });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] refuses a period that is already over", async () => {
    vi.useFakeTimers({ now: sgt("2027-06-15", "13:00") });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This unavailable period is already over." });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it("[SPM-45][AC5] leaves bookings and their flags alone", async () => {
    vi.useFakeTimers({ now: NOW });

    const res = await end(given({ bookings: [{ ...first(), needsReview: true, reviewReason: "venue_unavailable" }] }));

    expect(res.status).toBe(200);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-45] answers 500 when the database fails", async () => {
    const token = given();
    db.venueUnavailability.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await end(token)).status).toBe(500);
  });
});
