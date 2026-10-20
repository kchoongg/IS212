// SPM-41 (venue suitability) and SPM-42 (request a venue booking), with
// SPM-93's times on a 15-minute grid. Times are written in UTC; Singapore is
// UTC+8, so 05:30Z is 13:30 local.

import { afterEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { GET as listBookings, POST as requestBooking } from "@/app/api/events/[id]/venue-bookings/route";
import { GET as suitability } from "@/app/api/events/[id]/venue-suitability/route";
import { callArg, db, holdExpirySweepOrder, ID, params, req, signIn, user } from "@/test/kit";

const REF = "EVT-000007";
const DAY = "2027-03-04";
/// The event's own times, 13:30-17:00 local.
const STARTS = new Date("2027-03-04T05:30:00.000Z");
const ENDS = new Date("2027-03-04T09:00:00.000Z");

const hearingLoop = { facilityId: ID.facility, isMandatory: true, facility: { name: "Hearing loop", category: "accessibility" } };

const assignedCoordinator = () => user("coordinator", { id: ID.user });

/// A single-session event on the afternoon of DAY: 100 people, theatre layout.
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 7,
    title: "Town Hall",
    status: "planning",
    organiserId: "organiser-id",
    organisationId: ID.org,
    coordinatorId: ID.user,
    startsAt: new Date("2027-03-04T05:30:00.000Z"),
    endsAt: new Date("2027-03-04T09:00:00.000Z"),
    expectedAttendance: 100,
    preferredLayout: "theatre",
    facilityRequirements: [],
    sessions: [],
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.session,
    label: "Day 1",
    startsAt: new Date("2027-03-04T05:30:00.000Z"),
    endsAt: new Date("2027-03-04T09:00:00.000Z"),
    expectedAttendance: 40,
    preferredLayout: "boardroom",
    ...overrides,
  };
}

/// An active venue that suits event(): theatre for 300, free all day.
function venue(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.venue,
    code: "HALL-A",
    name: "Hall A",
    building: "Tower 1",
    floor: "3",
    isActive: true,
    maxCapacity: 300,
    opensAt: "07:00",
    closesAt: "23:59",
    setupMinutes: 0,
    teardownMinutes: 0,
    layouts: [{ layoutName: "theatre", capacity: 300 }],
    facilities: [],
    bookings: [],
    unavailability: [],
    ...overrides,
  };
}

describe("GET /api/events/[id]/venue-bookings", () => {
  function get(token?: string, reference = REF) {
    return listBookings(req("GET", `/api/events/${reference}/venue-bookings`, { token }), params({ id: reference }));
  }

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it.each(["organiser", "attendee", "tech_support"])("[SPM-21][AC4] is 403 for %s, before the event is looked up", async (role) => {
    const res = await get(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  it("[SPM-42] is 404 for a malformed reference", async () => {
    expect((await get(signIn(assignedCoordinator()), "nope")).status).toBe(404);
  });

  it("[SPM-82][AC1][AC4] SPM-82 (AC1, AC8): expires overdue holds before listing the event's requests, each with its expiry", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event());
    db.venueBooking.findMany.mockResolvedValue([]);

    await get(token);

    expect(holdExpirySweepOrder()).toBeLessThan(db.venueBooking.findMany.mock.invocationCallOrder[0]);
    expect(callArg(db.venueBooking.findMany).select.holdExpiresAt).toBe(true);
  });

  it("[SPM-42] is 404 for a draft", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-42][AC1][AC4] gives the assigned coordinator the schedule, sessions and existing requests, and lets them request", async () => {
    const token = signIn(assignedCoordinator());
    const bookings = [{ id: ID.booking, status: "pending", venue: { id: ID.venue, name: "Hall A" } }];
    db.event.findUnique.mockResolvedValue(event({ sessions: [{ ...session(), eventId: ID.event, createdAt: "x" }] }));
    db.venueBooking.findMany.mockResolvedValue(bookings);

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      event: { title: "Town Hall", preferredLayout: "theatre", expectedAttendance: 100 },
      schedule: { startsAt: "2027-03-04T05:30:00.000Z", endsAt: "2027-03-04T09:00:00.000Z" },
      sessions: [
        {
          id: ID.session,
          label: "Day 1",
          startsAt: "2027-03-04T05:30:00.000Z",
          endsAt: "2027-03-04T09:00:00.000Z",
          expectedAttendance: 40,
          preferredLayout: "boardroom",
        },
      ],
      cannotRequest: null,
      // Already in planning, so requesting begins nothing.
      willBeginPlanning: false,
      // SPM-67: the assigned coordinator may withdraw or release.
      canChangeBookings: true,
      // SPM-65: and the tab bar offers them the Attendees tab.
      canViewRegistrationList: true,
      bookings,
    });
    expect(callArg(db.venueBooking.findMany).where).toEqual({ eventId: ID.event });
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.otherUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.otherUser })],
  ])("[SPM-42] shows the bookings to %s but says why they cannot request", async (_who, actor) => {
    const token = signIn(actor());
    db.event.findUnique.mockResolvedValue(event());
    db.venueBooking.findMany.mockResolvedValue([]);

    const res = await get(token);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cannotRequest).toBe("Only the assigned Coordinator can request a venue booking.");
    // SPM-67 AC9: nor withdraw or release one.
    expect(body.canChangeBookings).toBe(false);
    // SPM-65: nor open the Attendees tab - only the assigned coordinator may.
    expect(body.canViewRegistrationList).toBe(false);
  });

  it("[SPM-54][AC1] says a request on an approved event will begin planning", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "approved" }));
    db.venueBooking.findMany.mockResolvedValue([]);

    const body = await (await get(token)).json();

    expect(body).toMatchObject({ cannotRequest: null, willBeginPlanning: true });
  });

  it.each(["submitted", "under_review"])(
    "[SPM-54][AC3] tells the assigned coordinator a %s event must be approved first",
    async (status) => {
      const token = signIn(assignedCoordinator());
      db.event.findUnique.mockResolvedValue(event({ status }));
      db.venueBooking.findMany.mockResolvedValue([]);

      const body = await (await get(token)).json();

      expect(body.cannotRequest).toBe("A venue can be requested once this request has been approved.");
      expect(body.willBeginPlanning).toBe(false);
    }
  );

  it("[SPM-43][AC6] returns Venue Staff's decision on each request, for the coordinator to act on", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event());
    db.venueBooking.findMany.mockResolvedValue([]);

    await get(token);
    const select = callArg(db.venueBooking.findMany).select;

    expect(select).toMatchObject({ decisionReason: true, suggestedAlternative: true });
    expect(select.suggestedVenue).toEqual({ select: { id: true, code: true, name: true, isActive: true } });
  });

  it.each(["completed", "cancelled", "rejected"])(
    "[SPM-42] tells the assigned coordinator a %s event takes no new requests",
    async (status) => {
      const token = signIn(assignedCoordinator());
      db.event.findUnique.mockResolvedValue(event({ status }));
      db.venueBooking.findMany.mockResolvedValue([]);

      const body = await (await get(token)).json();

      expect(body.cannotRequest).toBe("A venue cannot be requested for a completed, cancelled or rejected event.");
      // SPM-67: nor can its bookings be withdrawn or released.
      expect(body.canChangeBookings).toBe(false);
    }
  );

  it("[SPM-67][AC1][AC3] SPM-67: lets the assigned coordinator withdraw or release on an event that is not approved yet", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "under_review" }));
    db.venueBooking.findMany.mockResolvedValue([]);

    expect((await (await get(token)).json()).canChangeBookings).toBe(true);
  });

  it("[SPM-67][AC5][AC6] SPM-67-TC07: returns the reason a booking was withdrawn or released", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event());
    db.venueBooking.findMany.mockResolvedValue([]);

    await get(token);

    expect(callArg(db.venueBooking.findMany).select).toMatchObject({ cancellationReason: true });
  });
});

describe("POST /api/events/[id]/venue-bookings", () => {
  const valid = { venueId: ID.venue, day: DAY, startTime: "13:30", endTime: "17:00", purpose: "Main programme" };

  function post(token: string | undefined, body: unknown, reference = REF) {
    return requestBooking(
      req("POST", `/api/events/${reference}/venue-bookings`, { token, body }),
      params({ id: reference })
    );
  }

  function given(eventRow: object | null = event(), venueRow: object | null = venue()) {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(eventRow);
    db.venue.findUnique.mockResolvedValue(venueRow);
    db.venueBooking.create.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.booking, ...data }));
    return token;
  }

  /// A booking by another event at the event's own times. SPM-44 (AC9) loads the
  /// event with each booking so a refusal can say whose booking is in the way.
  function anotherEventsBooking(status: string) {
    return {
      eventId: "another-event",
      status,
      startsAt: STARTS,
      endsAt: ENDS,
      event: { sequenceNumber: 9, title: "Board Meeting" },
    };
  }

  async function refusal(token: string, body: unknown = valid) {
    const res = await post(token, body);
    expect(res.status).toBe(400);
    expect(db.venueBooking.create).not.toHaveBeenCalled();
    return (await res.json()).error as string;
  }

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await post(undefined, valid)).status).toBe(401);
  });

  // SPM-82 (AC2): a new request is a tentative hold, held for 7 days or until
  // the event starts, whichever is sooner. The clock is fixed so the 7 days
  // can be checked exactly.
  describe("the hold's expiry (SPM-82)", () => {
    afterEach(() => vi.useRealTimers());

    it("[SPM-82][AC2] SPM-82-TC01: holds a new request for 7 days", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-15T06:30:00.000Z"));
      const token = given();

      expect((await post(token, valid)).status).toBe(201);
      expect(callArg(db.venueBooking.create).data.holdExpiresAt).toEqual(new Date("2026-10-22T06:30:00.000Z"));
    });

    it("[SPM-82][AC2] SPM-82-TC02: stops at the start of an event less than 7 days away", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2027-03-01T02:00:00.000Z"));
      const token = given(); // the event starts 4 Mar 2027, 05:30 UTC

      await post(token, valid);

      expect(callArg(db.venueBooking.create).data.holdExpiresAt).toEqual(new Date("2027-03-04T05:30:00.000Z"));
    });

    it("[SPM-82][AC6] SPM-82 (AC6): expires overdue holds after locking the venue and before reading its bookings", async () => {
      await post(given(), valid);

      const sweep = holdExpirySweepOrder();
      expect(sweep).toBeTypeOf("number");
      // After the venue lock (the first raw query)...
      expect(sweep!).toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[0]);
      // ...and before the venue and its bookings are read.
      expect(sweep!).toBeLessThan(db.venue.findUnique.mock.invocationCallOrder[0]);
    });
  });

  it("[SPM-42] is 404 for an event the user cannot see", async () => {
    expect((await post(given(event({ status: "draft" })), valid)).status).toBe(404);
  });

  it.each([
    ["a coordinator who is not assigned", () => user("coordinator", { id: ID.otherUser })],
    ["the Ops Manager", () => user("ops_manager", { id: ID.otherUser })],
    ["Venue Staff", () => user("venue_staff", { id: ID.otherUser })],
    ["the organiser who owns the event", () => user("organiser", { id: "organiser-id" })],
  ])("[SPM-21][AC4] is 403 for %s", async (_who, actor) => {
    const token = signIn(actor());
    db.event.findUnique.mockResolvedValue(event());

    const res = await post(token, valid);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the assigned Coordinator can request a venue booking." });
    expect(db.venueBooking.create).not.toHaveBeenCalled();
  });

  it("[SPM-93][AC1] [SPM-42][AC8] SPM-93-TC01: creates a pending request for exactly the requested times", async () => {
    const token = given();

    const res = await post(token, { ...valid, requirementsNote: "  Stage at the north end " });

    expect(res.status).toBe(201);
    expect(callArg(db.venueBooking.create).data).toEqual({
      eventId: ID.event,
      sessionId: undefined,
      venueId: ID.venue,
      // SPM-90: the space - here the event's own attendance and layout (AC2).
      purpose: "Main programme",
      expectedAttendance: 100,
      layoutName: "theatre",
      startsAt: STARTS,
      endsAt: ENDS,
      status: "pending",
      // SPM-82: every new request is a tentative hold with an expiry - the
      // exact time is checked by "the hold's expiry (SPM-82)" tests.
      holdExpiresAt: expect.any(Date),
      requestedBy: ID.user,
      requirementsNote: "Stage at the north end",
    });
  });

  it("[SPM-42][AC6] stores a blank requirements note as none", async () => {
    const token = given();

    await post(token, { ...valid, requirementsNote: "   " });

    expect(callArg(db.venueBooking.create).data.requirementsNote).toBeUndefined();
  });

  it("[SPM-44][AC4][AC7] only counts pending and approved bookings as holding the venue", async () => {
    const token = given();

    await post(token, valid);

    expect(callArg(db.venue.findUnique).include.bookings).toEqual({
      where: { status: { in: ["pending", "approved"] } },
      // SPM-44 (AC9): the event behind each booking, so a refusal can name it.
      include: { event: { select: { sequenceNumber: true, title: true } } },
    });
  });

  it.each([
    ["a venue id that is not a UUID", { ...valid, venueId: "hall-a" }, "venueId"],
    ["a day that is not a real date", { ...valid, day: "2027-02-30" }, "day"],
    ["no start time", { venueId: ID.venue, day: DAY, endTime: "17:00" }, "startTime"],
    ["no end time", { venueId: ID.venue, day: DAY, startTime: "13:30" }, "endTime"],
  ])("[SPM-42] rejects %s", async (_case, body, field) => {
    const res = await post(given(), body);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.fieldErrors).toHaveProperty(field);
  });

  describe("what is refused", () => {
    it("[SPM-42] an event with no dates", async () => {
      expect(await refusal(given(event({ startsAt: null, endsAt: null })))).toBe(
        "Set the event date and time before requesting a venue."
      );
    });

    it.each([
      ["does not exist", null],
      ["has been retired", venue({ isActive: false })],
    ])("[SPM-39][AC6] a venue that %s", async (_case, venueRow) => {
      expect(await refusal(given(event(), venueRow))).toBe("Venue not found");
    });

    it.each(["submitted", "under_review"])("[SPM-42] an event that is still %s", async (status) => {
      expect(await refusal(given(event({ status })))).toBe(
        "A venue can be requested once this request has been approved."
      );
    });

    it.each(["completed", "cancelled", "rejected"])("[SPM-42] an event that is %s", async (status) => {
      expect(await refusal(given(event({ status })))).toBe(
        "A venue cannot be requested for a completed, cancelled or rejected event."
      );
    });

    // SPM-93 AC3: the refused time is named, with the field it belongs to.
    it.each([
      ["SPM-93-TC03: a start time off the 15-minute grid", { ...valid, startTime: "13:40" }, "startTime", "Choose a start time on a 15-minute step (:00, :15, :30 or :45)."],
      ["SPM-93-TC03: an end time off the 15-minute grid", { ...valid, endTime: "17:20" }, "endTime", "Choose an end time on a 15-minute step (:00, :15, :30 or :45)."],
      ["SPM-93-TC03: an end that is not after the start", { ...valid, endTime: "13:30" }, "endTime", "The end time must be after the start time."],
    ])("[SPM-93][AC3] %s", async (_case, body, field, message) => {
      const res = await post(given(), body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: message, field });
      expect(db.venueBooking.create).not.toHaveBeenCalled();
    });

    it("[SPM-93][AC3] SPM-93-TC04: times that do not cover the event's own time", async () => {
      expect(await refusal(given(), { ...valid, startTime: "14:00" })).toBe(
        "The requested times do not cover the event's time (4 Mar 2027, 13:30–17:00)."
      );
    });

    it("[SPM-93][AC6][AC7] SPM-93-TC09: a venue whose setup runs into another event's approved booking", async () => {
      // Booked 17:30-18:00; with 30 min setup the room is in use from 17:00, as this request ends.
      const later = {
        ...anotherEventsBooking("approved"),
        startsAt: new Date("2027-03-04T09:30:00.000Z"),
        endsAt: new Date("2027-03-04T10:00:00.000Z"),
      };
      expect(await refusal(given(event(), venue({ setupMinutes: 30, teardownMinutes: 15, bookings: [later] })))).toBe(
        "Hall A is already booked for EVT-000009 Board Meeting on 4 Mar 2027, 17:00–17:15."
      );
      vi.clearAllMocks();
      expect((await post(given(event(), venue({ setupMinutes: 30, bookings: [later] })), valid)).status).toBe(201);
    });

    it("[SPM-93][AC4][AC6] SPM-93-TC06: times whose setup or turnaround falls outside opening hours", async () => {
      const token = given(event(), venue({ closesAt: "17:30", setupMinutes: 30, teardownMinutes: 45 }));

      expect(await refusal(token)).toBe(
        "Hall A is open 07:00–17:30. With its 30 min setup and 45 min turnaround, choose times between 07:30 and 16:45."
      );
    });

    it("[SPM-41][AC4] a venue that does not offer the event's layout", async () => {
      const token = given(event(), venue({ layouts: [{ layoutName: "banquet", capacity: 300 }] }));

      expect(await refusal(token)).toBe("Hall A is not suitable for this space: Theatre layout is not offered.");
    });

    it("[SPM-41][AC1] a venue whose layout seats fewer than the attendance", async () => {
      const token = given(event(), venue({ layouts: [{ layoutName: "theatre", capacity: 60 }] }));

      expect(await refusal(token)).toBe(
        "Hall A is not suitable for this space: Theatre capacity is 60 - this space expects 100."
      );
    });

    it("[SPM-41][AC2] a venue missing a facility the event requires", async () => {
      const token = given(event({ facilityRequirements: [hearingLoop] }));

      expect(await refusal(token)).toBe(
        "Hall A is not suitable for this space: Missing accessibility feature: Hearing loop."
      );
    });

    it("[SPM-44][AC3][AC5] a venue with an approved booking for another event at that time", async () => {
      const token = given(
        event(),
        venue({ bookings: [anotherEventsBooking("approved")] })
      );

      expect(await refusal(token)).toBe("Hall A is already booked for EVT-000009 Board Meeting on 4 Mar 2027, 13:30–17:00.");
    });

    it("[SPM-44][AC4][AC5] a venue with another event's pending request at that time", async () => {
      const token = given(
        event(),
        venue({ bookings: [anotherEventsBooking("pending")] })
      );

      expect(await refusal(token)).toBe("Hall A is on hold for EVT-000009 Board Meeting on 4 Mar 2027, 13:30–17:00.");
    });

    it("[SPM-44][AC8] a venue recorded as unavailable at that time", async () => {
      const token = given(event(), venue({ unavailability: [{ startsAt: STARTS, endsAt: ENDS }] }));

      expect(await refusal(token)).toBe("Hall A is unavailable at this time (4 Mar 2027, 13:30–17:00).");
    });
  });

  it("[SPM-54][AC1] begins planning when it is the first arrangement on an approved event", async () => {
    const token = given(event({ status: "approved" }));
    db.event.updateMany.mockResolvedValue({ count: 1 });

    const res = await post(token, valid);

    expect(res.status).toBe(201);
    expect((await res.json()).planningStarted).toBe(true);
    expect(callArg(db.event.updateMany)).toEqual({
      where: { id: ID.event, status: "approved" },
      data: { status: "planning" },
    });
    expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
      toStatus: "planning",
      reason: "Venue booking requested",
    });
  });

  it("[SPM-54][AC1] leaves the status alone on an event already in planning", async () => {
    const res = await post(given(), valid);

    expect((await res.json()).planningStarted).toBe(false);
    expect(db.event.updateMany).not.toHaveBeenCalled();
  });

  // SPM-88 (AC5, AC6): a booking request is a significant change - it closes
  // the safety check the event rests on and returns it to Planning.
  it.each(["safety_review", "safety_cleared"])(
    "[SPM-88][AC6] SPM-88: moves a %s event back to Planning and closes its safety check",
    async (status) => {
      const token = given(event({ status }));
      db.event.updateMany.mockResolvedValue({ count: 1 });
      db.safetyCheck.updateMany.mockResolvedValue({ count: 1 });

      const res = await post(token, valid);

      expect(res.status).toBe(201);
      expect((await res.json()).safetyCheckClosed).toBe(true);
      expect(callArg(db.event.updateMany)).toEqual({ where: { id: ID.event, status }, data: { status: "planning" } });
      expect(callArg(db.eventStatusHistory.create).data).toMatchObject({
        reason: "Safety check closed: a venue booking was requested",
      });
      expect(callArg(db.safetyCheck.updateMany).data).toMatchObject({ status: "closed" });
    }
  );

  it("[SPM-88][AC7] SPM-88: leaves the safety check of a Planning event alone", async () => {
    const res = await post(given(), valid);

    expect((await res.json()).safetyCheckClosed).toBe(false);
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
  });

  /// One of this event's own bookings at its own times: for the whole event
  /// (sessionId null) or for one of its sessions.
  function ownBooking(status: string, sessionId: string | null = null) {
    return {
      eventId: ID.event,
      sessionId,
      status,
      startsAt: STARTS,
      endsAt: ENDS,
      event: { sequenceNumber: 7, title: "Town Hall" },
    };
  }

  // SPM-81 AC4 (decided 2026-10-10): a repeat is per event, not per session.
  // Before SPM-81, Day 2 could share the room Day 1 already held at that time.
  it("[SPM-81][AC4] SPM-81-TC09: refuses another session of the event asking for a room one of its sessions already holds then", async () => {
    const token = given(
      event({ sessions: [session(), session({ id: ID.otherSession, label: "Day 2" })] }),
      venue({ layouts: [{ layoutName: "boardroom", capacity: 50 }], bookings: [ownBooking("pending", ID.session)] })
    );

    expect(await refusal(token, { ...valid, sessionId: ID.otherSession })).toBe(
      "This event already has a pending request for Hall A on 4 Mar 2027, 13:30–17:00."
    );
  });

  // SPM-44 AC4, raised in review on PR #37: only one active request or booking
  // per venue and time, including from the same event.
  it("[SPM-81][AC4] refuses the same event asking again for a time its pending request already holds", async () => {
    const token = given(event(), venue({ bookings: [ownBooking("pending")] }));

    expect(await refusal(token)).toBe(
      "This event already has a pending request for Hall A on 4 Mar 2027, 13:30–17:00."
    );
  });

  it("[SPM-81][AC4] refuses the same session asking twice, and names the session", async () => {
    const token = given(
      event({ sessions: [session(), session({ id: ID.otherSession, label: "Day 2" })] }),
      venue({ layouts: [{ layoutName: "boardroom", capacity: 50 }], bookings: [ownBooking("approved", ID.session)] })
    );

    expect(await refusal(token, { ...valid, sessionId: ID.session })).toBe(
      "Day 1 already has Hall A booked on 4 Mar 2027, 13:30–17:00."
    );
  });

  // SPM-81 (AC2, AC3): each venue is checked on its own bookings alone, so
  // what the event holds at another venue is never read and cannot block it.
  it("[SPM-81][AC2] SPM-81-TC01: checks only the requested venue, whatever the event holds elsewhere", async () => {
    const res = await post(given(), valid);

    expect(res.status).toBe(201);
    expect(callArg(db.venue.findUnique).where).toEqual({ id: ID.venue });
    expect(db.venueBooking.findMany).not.toHaveBeenCalled();
  });

  it("[SPM-81][AC4] SPM-81-TC04: refuses the same venue again at wider, overlapping times, naming the earlier request's own", async () => {
    const token = given(event(), venue({ bookings: [ownBooking("pending")] }));

    expect(await refusal(token, { ...valid, startTime: "13:00", endTime: "18:00" })).toBe(
      "This event already has a pending request for Hall A on 4 Mar 2027, 13:30–17:00."
    );
  });

  it("[SPM-41][AC2] accepts a venue that has the facility the event requires", async () => {
    const token = given(
      event({ facilityRequirements: [hearingLoop] }),
      venue({ facilities: [{ facilityId: ID.facility }] })
    );

    expect((await post(token, valid)).status).toBe(201);
  });

  describe("multi-session events", () => {
    const multiSession = () => event({ sessions: [session(), session({ id: ID.otherSession, label: "Day 2" })] });
    const boardroomVenue = () => venue({ layouts: [{ layoutName: "boardroom", capacity: 50 }] });

    it("[SPM-42][AC4] books the session, judged by the session's own attendance and layout", async () => {
      // Suits the 40-person boardroom session; would not suit the 100-person
      // theatre event.
      const token = given(multiSession(), boardroomVenue());

      const res = await post(token, { ...valid, sessionId: ID.session });

      expect(res.status).toBe(201);
      expect(callArg(db.venueBooking.create).data).toMatchObject({
        sessionId: ID.session,
        layoutName: "boardroom",
      });
    });

    it.each([
      ["no session is chosen", valid],
      ["the session belongs to another event", { ...valid, sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
    ])("[SPM-42][AC4] refuses when %s", async (_case, body) => {
      expect(await refusal(given(multiSession(), boardroomVenue()), body)).toBe("Choose a session.");
    });

    it("[SPM-42][AC4] names the session, not the event, when the times miss its time", async () => {
      const token = given(multiSession(), boardroomVenue());

      expect(await refusal(token, { ...valid, sessionId: ID.session, endTime: "16:00" })).toBe(
        "The requested times do not cover the session's time (4 Mar 2027, 13:30–17:00)."
      );
    });
  });

  it("[SPM-42] accepts a request for an event with no title", async () => {
    expect((await post(given(event({ title: null })), valid)).status).toBe(201);
  });

  it("[SPM-42] accepts a request for a session with no label", async () => {
    const token = given(
      event({ sessions: [session({ label: null }), session({ id: ID.otherSession })] }),
      venue({ layouts: [{ layoutName: "boardroom", capacity: 50 }] })
    );

    expect((await post(token, { ...valid, sessionId: ID.session })).status).toBe(201);
  });

  it("[SPM-42][AC4] refuses a session id on an event that has no sessions", async () => {
    expect(await refusal(given(), { ...valid, sessionId: ID.session })).toBe("Session not found for this event");
  });

  it("[SPM-42] answers 500 when the database fails", async () => {
    const token = given();
    db.venue.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await post(token, valid)).status).toBe(500);
  });
});

describe("GET /api/events/[id]/venue-suitability", () => {
  function get(token?: string, query = "", reference = REF) {
    return suitability(
      req("GET", `/api/events/${reference}/venue-suitability${query}`, { token }),
      params({ id: reference })
    );
  }

  const small = () => venue({ id: ID.otherVenue, code: "ROOM-B", name: "Room B", layouts: [{ layoutName: "theatre", capacity: 40 }] });

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it.each(["organiser", "attendee", "tech_support"])("[SPM-21][AC4] is 403 for %s", async (role) => {
    expect((await get(signIn(user(role)))).status).toBe(403);
  });

  it("[SPM-42] is 404 for a malformed reference", async () => {
    expect((await get(signIn(assignedCoordinator()), "", "nope")).status).toBe(404);
  });

  it("[SPM-42] is 404 for a draft", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ status: "draft" }));

    expect((await get(token)).status).toBe(404);
  });

  it("[SPM-41][AC5] judges every active venue against the event, suitable ones first", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event());
    db.venue.findMany.mockResolvedValue([small(), venue()]);

    const res = await get(token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(callArg(db.venue.findMany).where).toEqual({ isActive: true });
    expect(body.event).toEqual({ expectedAttendance: 100, preferredLayout: "theatre", requirements: [], missing: [] });
    expect(body.results).toEqual([
      {
        venue: {
          id: ID.venue,
          code: "HALL-A",
          name: "Hall A",
          building: "Tower 1",
          floor: "3",
          maxCapacity: 300,
          layouts: [{ layoutName: "theatre", capacity: 300 }],
        },
        suitable: true,
        unmet: [],
        optionalMissing: [],
      },
      {
        venue: expect.objectContaining({ id: ID.otherVenue, name: "Room B" }),
        suitable: false,
        unmet: [{ kind: "capacity", layoutName: "theatre", layoutCapacity: 40, expectedAttendance: 100 }],
        optionalMissing: [],
      },
    ]);
  });

  it("[SPM-41][AC2][AC5] marks a venue unsuitable for a missing mandatory facility, but only notes an optional one", async () => {
    const token = signIn(assignedCoordinator());
    const optional = { facilityId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", isMandatory: false, facility: { name: "Stage", category: "facility" } };
    db.event.findUnique.mockResolvedValue(event({ facilityRequirements: [optional] }));
    db.venue.findMany.mockResolvedValue([venue()]);

    const optionalOnly = (await (await get(token)).json()).results[0];
    db.event.findUnique.mockResolvedValue(event({ facilityRequirements: [hearingLoop] }));
    const mandatory = (await (await get(token)).json()).results[0];

    expect(optionalOnly.suitable).toBe(true);
    expect(optionalOnly.optionalMissing).toEqual([
      { kind: "facility", facilityId: optional.facilityId, name: "Stage", category: "facility" },
    ]);
    expect(mandatory.suitable).toBe(false);
    expect(mandatory.unmet).toEqual([
      { kind: "facility", facilityId: ID.facility, name: "Hearing loop", category: "accessibility" },
    ]);
  });

  it("[SPM-41][AC2] counts a venue as suitable when it has the mandatory facility", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ facilityRequirements: [hearingLoop] }));
    db.venue.findMany.mockResolvedValue([venue({ facilities: [{ facilityId: ID.facility }] })]);

    const body = await (await get(token)).json();

    expect(body.results[0]).toMatchObject({ suitable: true, unmet: [] });
    expect(body.event.requirements).toEqual([
      { facilityId: ID.facility, name: "Hearing loop", category: "accessibility", isMandatory: true },
    ]);
  });

  it("[SPM-41] says what the event has not specified yet", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ expectedAttendance: null, preferredLayout: null }));
    db.venue.findMany.mockResolvedValue([venue()]);

    const body = await (await get(token)).json();

    expect(body.event.missing).toEqual(["expectedAttendance", "preferredLayout"]);
    expect(body.results[0].suitable).toBe(true);
  });

  it("[SPM-41] [SPM-42][AC4] judges by a session's own attendance and layout when ?session= is given", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ sessions: [session()] }));
    db.venue.findMany.mockResolvedValue([venue({ layouts: [{ layoutName: "boardroom", capacity: 50 }] })]);

    const body = await (await get(token, `?session=${ID.session}`)).json();

    expect(body.event).toMatchObject({ expectedAttendance: 40, preferredLayout: "boardroom" });
    expect(body.results[0].suitable).toBe(true);
  });

  it("[SPM-41] refuses a session that is not one of the event's", async () => {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(event({ sessions: [session()] }));

    const res = await get(token, `?session=${ID.otherSession}`);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Session not found for this event" });
    expect(db.venue.findMany).not.toHaveBeenCalled();
  });
});

// CONTRACT (SPM-90, written before the code) - what these tests expect:
//   POST /api/events/[id]/venue-bookings   body gains
//     purpose             required, trimmed, 1-100 characters
//     expectedAttendance  optional whole number >= 1; omitted = the session's, else the event's
//     layoutName          optional; omitted = the session's, else the event's; null = not set
//     -> stored on the booking as purpose, expectedAttendance and layoutName, and the
//        venue is judged against them (the event's facility requirements still apply);
//        400 "<venue> is not suitable for this space: ..." naming the space's figure
//   GET  /api/events/[id]/venue-bookings   event gains expectedAttendance; each booking
//        is selected with purpose and expectedAttendance
//   GET  /api/events/[id]/venue-suitability?attendance=<n>&layout=<name>
//        judges by those instead of the event's (or the session's);
//        400 { error: "Enter a whole number of at least 1." } for a bad attendance
// Decided here, not in the story (docs/test-cases/SPM-90_test_cases.json, open_questions):
//   the field and parameter names, the limits, and the wording.
describe("SPM-90: each venue is checked against its own space", () => {
  const space = { venueId: ID.venue, day: DAY, startTime: "13:30", endTime: "17:00", purpose: "Breakout room" };
  /// Too small for event()'s 100 in any layout; a classroom for exactly 20.
  const breakoutRoom = (overrides: Record<string, unknown> = {}) =>
    venue({
      layouts: [
        { layoutName: "theatre", capacity: 30 },
        { layoutName: "classroom", capacity: 20 },
      ],
      ...overrides,
    });

  function post(token: string | undefined, body: unknown) {
    return requestBooking(req("POST", `/api/events/${REF}/venue-bookings`, { token, body }), params({ id: REF }));
  }

  function given(eventRow: object = event(), venueRow: object = breakoutRoom()) {
    const token = signIn(assignedCoordinator());
    db.event.findUnique.mockResolvedValue(eventRow);
    db.venue.findUnique.mockResolvedValue(venueRow);
    db.venueBooking.create.mockImplementation(async ({ data }: { data: object }) => ({ id: ID.booking, ...data }));
    return token;
  }

  async function refusal(token: string, body: unknown) {
    const res = await post(token, body);
    expect(res.status).toBe(400);
    expect(db.venueBooking.create).not.toHaveBeenCalled();
    return (await res.json()).error as string;
  }

  describe("POST /api/events/[id]/venue-bookings", () => {
    it("[SPM-90][AC1] SPM-90-TC02: stores what the space is for, with its own attendance and layout", async () => {
      const token = given();

      const res = await post(token, { ...space, purpose: "  Breakout room ", expectedAttendance: 20, layoutName: "classroom" });

      expect(res.status).toBe(201);
      expect(callArg(db.venueBooking.create).data).toMatchObject({
        purpose: "Breakout room",
        expectedAttendance: 20,
        layoutName: "classroom",
        status: "pending",
      });
    });

    it("[SPM-90][AC3] SPM-90-TC02: accepts a room too small for the whole event when it seats its own space", async () => {
      const token = given(event({ expectedAttendance: 150 }));

      const res = await post(token, { ...space, expectedAttendance: 30, layoutName: "theatre" });

      expect(res.status).toBe(201);
    });

    it("[SPM-90][AC3][AC4] SPM-90-TC03: refuses a room that cannot seat its own space, naming the space's figure", async () => {
      const token = given();

      expect(await refusal(token, { ...space, expectedAttendance: 25, layoutName: "classroom" })).toBe(
        "Hall A is not suitable for this space: Classroom capacity is 20 - this space expects 25."
      );
    });

    it("[SPM-90][AC3] SPM-90-TC04: refuses a layout the room does not offer, whatever the attendance", async () => {
      const token = given();

      expect(await refusal(token, { ...space, expectedAttendance: 5, layoutName: "boardroom" })).toBe(
        "Hall A is not suitable for this space: Boardroom layout is not offered."
      );
    });

    it("[SPM-90][AC3] still asks every space for the facilities the event requires", async () => {
      const token = given(event({ facilityRequirements: [hearingLoop] }));

      expect(await refusal(token, { ...space, expectedAttendance: 20, layoutName: "classroom" })).toBe(
        "Hall A is not suitable for this space: Missing accessibility feature: Hearing loop."
      );
    });

    it("[SPM-90][AC2] SPM-90-TC01: a space given no attendance or layout takes the event's own", async () => {
      const token = given(event(), venue());

      const res = await post(token, { ...space, purpose: "Main programme" });

      expect(res.status).toBe(201);
      expect(callArg(db.venueBooking.create).data).toMatchObject({
        purpose: "Main programme",
        expectedAttendance: 100,
        layoutName: "theatre",
      });
    });

    it("[SPM-90][AC1] SPM-90-TC11: for a session, it takes the session's own", async () => {
      const token = given(
        event({ sessions: [session()] }),
        venue({ layouts: [{ layoutName: "boardroom", capacity: 50 }] })
      );

      const res = await post(token, { ...space, sessionId: ID.session });

      expect(res.status).toBe(201);
      expect(callArg(db.venueBooking.create).data).toMatchObject({ expectedAttendance: 40, layoutName: "boardroom" });
    });

    it("[SPM-90][AC1] stores no layout when the space is given none", async () => {
      const token = given();

      const res = await post(token, { ...space, expectedAttendance: 20, layoutName: null });

      expect(res.status).toBe(201);
      expect(callArg(db.venueBooking.create).data).toMatchObject({ expectedAttendance: 20, layoutName: null });
    });

    it.each([
      ["no purpose", { purpose: undefined }],
      ["a blank purpose", { purpose: "   " }],
      ["a purpose over 100 characters", { purpose: "x".repeat(101) }],
      ["an attendance of 0", { expectedAttendance: 0 }],
      ["a negative attendance", { expectedAttendance: -5 }],
      ["an attendance that is not a whole number", { expectedAttendance: 20.5 }],
    ])("[SPM-90][AC1] SPM-90-TC05: refuses %s, and saves nothing", async (_what, patch) => {
      const token = given(event(), venue());

      const res = await post(token, { ...space, ...patch });

      expect(res.status).toBe(400);
      expect(db.venueBooking.create).not.toHaveBeenCalled();
    });

    it("[SPM-90][AC1] accepts a purpose of exactly 100 characters", async () => {
      const token = given(event(), venue());

      const res = await post(token, { ...space, purpose: "x".repeat(100) });

      expect(res.status).toBe(201);
      expect(callArg(db.venueBooking.create).data.purpose).toHaveLength(100);
    });
  });

  describe("GET /api/events/[id]/venue-bookings", () => {
    it("[SPM-90][AC5] SPM-90-TC07: returns each booking's space, and the event's own attendance for the form to start on", async () => {
      const token = signIn(assignedCoordinator());
      const bookings = [{ id: ID.booking, status: "pending", purpose: "Breakout room", expectedAttendance: 20, layoutName: "classroom" }];
      db.event.findUnique.mockResolvedValue(event());
      db.venueBooking.findMany.mockResolvedValue(bookings);

      const res = await listBookings(req("GET", `/api/events/${REF}/venue-bookings`, { token }), params({ id: REF }));
      const body = await res.json();

      expect(callArg(db.venueBooking.findMany).select).toMatchObject({ purpose: true, expectedAttendance: true, layoutName: true });
      expect(body.event).toEqual({ title: "Town Hall", preferredLayout: "theatre", expectedAttendance: 100 });
      expect(body.bookings).toEqual(bookings);
    });
  });

  describe("GET /api/events/[id]/venue-suitability", () => {
    function get(token: string, query: string) {
      return suitability(req("GET", `/api/events/${REF}/venue-suitability${query}`, { token }), params({ id: REF }));
    }

    function givenVenues(eventRow: object = event()) {
      const token = signIn(assignedCoordinator());
      db.event.findUnique.mockResolvedValue(eventRow);
      db.venue.findMany.mockResolvedValue([breakoutRoom()]);
      return token;
    }

    it("[SPM-90][AC2] judges by the event's own attendance and layout when no space is given", async () => {
      const body = await (await get(givenVenues(), "")).json();

      expect(body.results[0]).toMatchObject({
        suitable: false,
        unmet: [{ kind: "capacity", layoutName: "theatre", layoutCapacity: 30, expectedAttendance: 100 }],
      });
    });

    it("[SPM-90][AC3] SPM-90-TC02: judges by the space's attendance and layout when they are given", async () => {
      const body = await (await get(givenVenues(), "?attendance=20&layout=classroom")).json();

      expect(body.event).toMatchObject({ expectedAttendance: 20, preferredLayout: "classroom", missing: [] });
      expect(body.results[0]).toMatchObject({ suitable: true, unmet: [] });
    });

    it("[SPM-90][AC3][AC4] SPM-90-TC04: one more than the layout seats is not suitable, and says so with the space's figure", async () => {
      const body = await (await get(givenVenues(), "?attendance=21&layout=classroom")).json();

      expect(body.results[0]).toMatchObject({
        suitable: false,
        unmet: [{ kind: "capacity", layoutName: "classroom", layoutCapacity: 20, expectedAttendance: 21 }],
      });
    });

    it("[SPM-90][AC3] keeps the event's facility requirements for the space", async () => {
      const token = givenVenues(event({ facilityRequirements: [hearingLoop] }));

      const body = await (await get(token, "?attendance=20&layout=classroom")).json();

      expect(body.results[0]).toMatchObject({
        suitable: false,
        unmet: [{ kind: "facility", name: "Hearing loop", category: "accessibility" }],
      });
    });

    it("[SPM-90][AC3] keeps the event's layout when only an attendance is given, and its attendance when only a layout is", async () => {
      const token = givenVenues();

      const onlyAttendance = await (await get(token, "?attendance=20")).json();
      const onlyLayout = await (await get(token, "?layout=classroom")).json();

      expect(onlyAttendance.event).toMatchObject({ expectedAttendance: 20, preferredLayout: "theatre" });
      expect(onlyLayout.event).toMatchObject({ expectedAttendance: 100, preferredLayout: "classroom" });
    });

    it("[SPM-90][AC3] checks no layout, and says so, when the space is given none", async () => {
      const body = await (await get(givenVenues(), "?attendance=500&layout=")).json();

      expect(body.event).toMatchObject({ expectedAttendance: 500, preferredLayout: null, missing: ["preferredLayout"] });
      // No layout, so no capacity to compare the 500 with.
      expect(body.results[0].suitable).toBe(true);
    });

    it("[SPM-90][AC3] puts the space's values ahead of the session's", async () => {
      const token = givenVenues(event({ sessions: [session()] }));

      const body = await (await get(token, `?session=${ID.session}&attendance=20&layout=classroom`)).json();

      expect(body.event).toMatchObject({ expectedAttendance: 20, preferredLayout: "classroom" });
      expect(body.results[0].suitable).toBe(true);
    });

    it.each(["0", "-3", "abc", "2.5"])("[SPM-90][AC1] refuses an attendance of %s", async (attendance) => {
      const token = givenVenues();

      const res = await get(token, `?attendance=${attendance}&layout=classroom`);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Enter a whole number of at least 1." });
      expect(db.venue.findMany).not.toHaveBeenCalled();
    });
  });
});
