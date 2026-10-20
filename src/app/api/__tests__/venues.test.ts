import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET as list, POST as create } from "@/app/api/venues/route";
import { GET as getOne, PATCH } from "@/app/api/venues/[id]/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const NOW = new Date("2026-10-02T04:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/venues", () => {
  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await list(req("GET", "/api/venues"))).status).toBe(401);
  });

  it.each(["organiser", "attendee", "tech_support"])("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await list(req("GET", "/api/venues", { token: signIn(user(role)) }));

    expect(res.status).toBe(403);
    expect(db.venue.findMany).not.toHaveBeenCalled();
  });

  it.each(["coordinator", "ops_manager", "venue_staff"])("[SPM-39][AC6] lists only active venues for %s", async (role) => {
    const token = signIn(user(role));
    const venues = [{ id: ID.venue, name: "Hall A", layouts: [], facilities: [] }];
    db.venue.findMany.mockResolvedValue(venues);

    const res = await list(req("GET", "/api/venues", { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(venues);
    expect(callArg(db.venue.findMany).where).toEqual({ isActive: true });
  });

  it("[SPM-39][AC6] includes retired venues when asked", async () => {
    const token = signIn(user("venue_staff"));
    db.venue.findMany.mockResolvedValue([]);

    await list(req("GET", "/api/venues?includeRetired=true", { token }));

    expect(callArg(db.venue.findMany).where).toBeUndefined();
  });
});

describe("POST /api/venues", () => {
  const valid = { code: "HALL-A", name: "Hall A", building: "Tower 1", maxCapacity: 300 };

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await create(req("POST", "/api/venues", { body: valid }))).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "tech_support", "attendee"])("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await create(req("POST", "/api/venues", { token: signIn(user(role)), body: valid }));

    expect(res.status).toBe(403);
    expect(db.venue.create).not.toHaveBeenCalled();
  });

  it("[SPM-39][AC1] lets Venue Staff add a venue with its layouts and facilities", async () => {
    const token = signIn(user("venue_staff"));
    db.venue.findUnique.mockResolvedValue(null);
    db.venue.create.mockResolvedValue({ id: ID.venue, ...valid });
    const layouts = [{ layoutName: "theatre", capacity: 300 }];

    const res = await create(
      req("POST", "/api/venues", { token, body: { ...valid, layouts, facilityIds: [ID.facility] } })
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID.venue, ...valid });
    expect(callArg(db.venue.create).data).toEqual({
      ...valid,
      layouts: { create: layouts },
      facilities: { create: [{ facilityId: ID.facility }] },
    });
  });

  it("[SPM-39][AC1] creates no relation rows when none are given", async () => {
    const token = signIn(user("venue_staff"));
    db.venue.findUnique.mockResolvedValue(null);
    db.venue.create.mockResolvedValue({ id: ID.venue });

    await create(req("POST", "/api/venues", { token, body: valid }));

    expect(callArg(db.venue.create).data).toEqual({ ...valid, layouts: undefined, facilities: undefined });
  });

  it("[SPM-39][AC1] refuses a code that is already in use", async () => {
    const token = signIn(user("venue_staff"));
    db.venue.findUnique.mockResolvedValue({ id: "existing" });

    const res = await create(req("POST", "/api/venues", { token, body: valid }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A venue with this code already exists" });
    expect(callArg(db.venue.findUnique).where).toEqual({ code: "HALL-A" });
    expect(db.venue.create).not.toHaveBeenCalled();
  });

  it.each([
    ["no building", { ...valid, building: "" }, "building"],
    ["a capacity of zero", { ...valid, maxCapacity: 0 }, "maxCapacity"],
    ["an opening time that is not HH:MM", { ...valid, opensAt: "9am" }, "opensAt"],
    ["a code longer than 20 characters", { ...valid, code: "X".repeat(21) }, "code"],
  ])("[SPM-39][AC1] rejects %s", async (_case, body, field) => {
    const token = signIn(user("venue_staff"));

    const res = await create(req("POST", "/api/venues", { token, body }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.details.fieldErrors).toHaveProperty(field);
  });

  it("[SPM-39] answers 500 when the database fails", async () => {
    const token = signIn(user("venue_staff"));
    db.venue.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await create(req("POST", "/api/venues", { token, body: valid }))).status).toBe(500);
  });
});

describe("GET /api/venues/[id]", () => {
  const get = (token?: string) => getOne(req("GET", `/api/venues/${ID.venue}`, { token }), params({ id: ID.venue }));

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it.each(["organiser", "attendee", "tech_support"])("[SPM-21][AC4] is 403 for %s", async (role) => {
    expect((await get(signIn(user(role)))).status).toBe(403);
  });

  it("[SPM-39][AC2][AC3] returns the venue with its layouts and facilities", async () => {
    const token = signIn(user("coordinator"));
    const venue = { id: ID.venue, name: "Hall A", layouts: [{ layoutName: "theatre", capacity: 300 }], facilities: [] };
    db.venue.findUnique.mockResolvedValue(venue);

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(venue);
    expect(callArg(db.venue.findUnique).where).toEqual({ id: ID.venue });
  });

  it("[SPM-39] is 404 for a venue that does not exist", async () => {
    const token = signIn(user("coordinator"));
    db.venue.findUnique.mockResolvedValue(null);

    const res = await get(token);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
  });
});

describe("PATCH /api/venues/[id]", () => {
  const COORDINATOR_ID = "coordinator-id";
  const REQUESTER_ID = "requester-id";

  /// The venue as stored: active, seats 300, one theatre layout, one facility.
  function venue(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.venue,
      code: "HALL-A",
      name: "Hall A",
      isActive: true,
      maxCapacity: 300,
      layouts: [{ layoutName: "theatre", capacity: 300 }],
      facilities: [{ facilityId: ID.facility }],
      ...overrides,
    };
  }

  /// An approved, upcoming booking of that venue: 200 people, theatre layout.
  function booking(overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
    return {
      id: ID.booking,
      eventId: ID.event,
      sessionId: null,
      session: null,
      layoutName: "theatre",
      needsReview: false,
      reviewReason: null,
      requestedBy: REQUESTER_ID,
      startsAt: new Date("2027-03-04T01:00:00.000Z"),
      endsAt: new Date("2027-03-04T09:00:00.000Z"),
      event: {
        id: ID.event,
        title: "Gala Dinner",
        coordinatorId: COORDINATOR_ID,
        expectedAttendance: 200,
        facilityRequirements: [],
        ...eventOverrides,
      },
      ...overrides,
    };
  }

  function given(stored: object | null, bookings: object[] = []) {
    const token = signIn(user("venue_staff"));
    db.venue.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id ? stored : null
    );
    db.venueBooking.findMany.mockResolvedValue(bookings);
    db.venue.update.mockImplementation(async ({ data }: { data: object }) => ({ ...stored, ...data }));
    return token;
  }

  function patch(token: string | undefined, body: unknown) {
    return PATCH(req("PATCH", `/api/venues/${ID.venue}`, { token, body }), params({ id: ID.venue }));
  }

  it("[SPM-21][AC4] is 401 without a session", async () => {
    expect((await patch(undefined, { name: "Hall B" })).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager", "tech_support", "attendee"])("[SPM-21][AC4] is 403 for %s", async (role) => {
    const res = await patch(signIn(user(role)), { name: "Hall B" });

    expect(res.status).toBe(403);
    expect(db.venue.update).not.toHaveBeenCalled();
  });

  it("[SPM-39] is 404 for a venue that does not exist", async () => {
    const res = await patch(given(null), { name: "Hall B" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venue.update).not.toHaveBeenCalled();
  });

  it("[SPM-39][AC5] rejects an empty body", async () => {
    const res = await patch(given(venue()), {});

    expect(res.status).toBe(400);
    expect((await res.json()).details.formErrors).toEqual(["Provide at least one field to change"]);
  });

  it("[SPM-39][AC5] rejects the same layout listed twice", async () => {
    const layout = { layoutName: "theatre", capacity: 100 };

    const res = await patch(given(venue()), { layouts: [layout, layout] });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.layouts).toEqual(["Each layout may appear only once"]);
  });

  it("[SPM-39][AC5] changes only the fields that were sent and reports nothing flagged", async () => {
    const token = given(venue());

    const res = await patch(token, { name: "Grand Hall" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.venue.name).toBe("Grand Hall");
    expect(body.flaggedBookings).toEqual([]);
    expect(callArg(db.venue.update)).toMatchObject({
      where: { id: ID.venue },
      data: { name: "Grand Hall", layouts: undefined, facilities: undefined },
    });
    expect(db.venueLayout.deleteMany).not.toHaveBeenCalled();
    expect(db.venueFacility.deleteMany).not.toHaveBeenCalled();
  });

  it("[SPM-39][AC5] refuses a new code that another venue already uses", async () => {
    const token = given(venue());
    db.venue.findUnique.mockImplementation(async ({ where }: { where: { id?: string; code?: string } }) =>
      where.code === "HALL-B" ? { id: "another-venue" } : venue()
    );

    const res = await patch(token, { code: "HALL-B" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A venue with this code already exists" });
    expect(db.venue.update).not.toHaveBeenCalled();
  });

  it("[SPM-39][AC5] accepts a new code that no other venue uses", async () => {
    const token = given(venue());

    const res = await patch(token, { code: "HALL-Z" });

    expect(res.status).toBe(200);
    expect(callArg(db.venue.findUnique, 1).where).toEqual({ code: "HALL-Z" });
    expect(callArg(db.venue.update).data.code).toBe("HALL-Z");
  });

  it("[SPM-39][AC5] does not look for a clash when the code is unchanged", async () => {
    const token = given(venue());

    const res = await patch(token, { code: "HALL-A", name: "Grand Hall" });

    expect(res.status).toBe(200);
    // The one lookup is the venue itself, by id.
    expect(db.venue.findUnique).toHaveBeenCalledOnce();
  });

  it("[SPM-39][AC7] only considers approved bookings that have not finished yet", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given(venue());

    await patch(token, { isActive: false });

    expect(callArg(db.venueBooking.findMany).where).toEqual({
      venueId: ID.venue,
      status: "approved",
      endsAt: { gt: NOW },
    });
  });

  describe("retiring a venue", () => {
    it("[SPM-39][AC7] flags each affected booking for review without changing it", async () => {
      vi.useFakeTimers({ now: NOW });
      const token = given(venue(), [booking()]);

      const res = await patch(token, { isActive: false });

      expect(res.status).toBe(200);
      expect(db.venueBooking.update).toHaveBeenCalledOnce();
      expect(callArg(db.venueBooking.update)).toEqual({
        where: { id: ID.booking },
        data: { needsReview: true, reviewReason: "venue_retired", flaggedAt: NOW },
      });
    });

    it("[SPM-39][AC7] notifies the event's assigned coordinator, naming the venue and the event", async () => {
      const token = given(venue(), [booking()]);

      await patch(token, { isActive: false });
      const notification = callArg(db.notification.create).data;

      expect(notification).toMatchObject({
        recipientId: COORDINATOR_ID,
        type: "booking_venue_retired",
        title: "Venue retired - booking needs review",
        eventId: ID.event,
      });
      expect(notification.body).toContain("Hall A");
      expect(notification.body).toContain("the venue has been retired");
      expect(notification.body).toContain("The approved booking for Gala Dinner on ");
      expect(notification.body).toContain("nothing has been changed automatically.");
      expect(notification.body).not.toContain("Reason given");
    });

    it("[SPM-39][AC7] passes the reason on in the notification, but does not store it on the venue", async () => {
      const token = given(venue(), [booking()]);

      await patch(token, { isActive: false, reason: "Closed for refurbishment" });

      expect(callArg(db.notification.create).data.body).toMatch(/Reason given: Closed for refurbishment$/);
      expect(callArg(db.venue.update).data).not.toHaveProperty("reason");
    });

    it("[SPM-39][AC7] reports what was flagged and who was told", async () => {
      const token = given(venue(), [booking()]);

      const body = await (await patch(token, { isActive: false })).json();

      expect(body.flaggedBookings).toEqual([
        {
          bookingId: ID.booking,
          eventId: ID.event,
          eventTitle: "Gala Dinner",
          sessionId: null,
          sessionLabel: null,
          reasons: ["venue_retired"],
          notifiedUserId: COORDINATOR_ID,
        },
      ]);
    });

    it("[SPM-39][AC7] notifies the person who requested the booking when the event has no coordinator", async () => {
      const token = given(venue(), [booking({}, { coordinatorId: null })]);

      await patch(token, { isActive: false });

      expect(callArg(db.notification.create).data.recipientId).toBe(REQUESTER_ID);
    });

    it("[SPM-39][AC7] names the session when the booking belongs to one", async () => {
      const token = given(venue(), [
        booking({ sessionId: ID.session, session: { label: "Day 1", expectedAttendance: 50 } }),
      ]);

      const body = await (await patch(token, { isActive: false })).json();

      expect(callArg(db.notification.create).data.body).toContain("Gala Dinner (Day 1) on ");
      expect(body.flaggedBookings[0]).toMatchObject({ sessionId: ID.session, sessionLabel: "Day 1" });
    });

    it("[SPM-39][AC7] falls back to 'an event' for a booking whose event has no title", async () => {
      const token = given(venue(), [booking({}, { title: null })]);

      await patch(token, { isActive: false });

      expect(callArg(db.notification.create).data.body).toContain("The approved booking for an event on ");
    });

    it("[SPM-39][AC7] adds to the reasons an earlier edit already flagged, rather than replacing them", async () => {
      const token = given(venue(), [booking({ needsReview: true, reviewReason: "layout_removed" })]);

      await patch(token, { isActive: false });

      expect(callArg(db.venueBooking.update).data.reviewReason).toBe("venue_retired,layout_removed");
    });

    // The column is shared: Update Event Information (SPM-62) writes its own
    // reasons here too. A venue edit must not drop a code it does not know.
    it("[SPM-39][AC7] keeps a reason another story flagged, such as the event's date changing", async () => {
      const token = given(venue(), [
        booking({ needsReview: true, reviewReason: "event_schedule_changed,layout_removed" }),
      ]);

      await patch(token, { isActive: false });

      expect(callArg(db.venueBooking.update).data.reviewReason).toBe(
        "venue_retired,layout_removed,event_schedule_changed"
      );
    });

    it("[SPM-39][AC7] flags and notifies once per affected booking", async () => {
      const token = given(venue(), [booking(), booking({ id: "second-booking" })]);

      const body = await (await patch(token, { isActive: false })).json();

      expect(db.venueBooking.update).toHaveBeenCalledTimes(2);
      expect(db.notification.create).toHaveBeenCalledTimes(2);
      expect(body.flaggedBookings).toHaveLength(2);
    });
  });

  describe("changing attributes", () => {
    it("[SPM-39][AC7] flags a booking when the maximum capacity drops below its attendance", async () => {
      const token = given(venue(), [booking()]);

      const body = await (await patch(token, { maxCapacity: 150 })).json();

      expect(body.flaggedBookings[0].reasons).toEqual(["max_capacity_below_attendance"]);
      expect(callArg(db.notification.create).data).toMatchObject({
        type: "booking_needs_review",
        title: "Booking needs review",
      });
    });

    it("[SPM-39][AC7] leaves a booking alone when the venue still fits it", async () => {
      const token = given(venue(), [booking()]);

      const body = await (await patch(token, { maxCapacity: 250 })).json();

      expect(body.flaggedBookings).toEqual([]);
      expect(db.venueBooking.update).not.toHaveBeenCalled();
      expect(db.notification.create).not.toHaveBeenCalled();
    });

    it("[SPM-39][AC7] judges a session's booking by the session's attendance, not the whole event's", async () => {
      // The event's 250 fits the venue today and would not after this edit, so
      // judging by the event would flag it. The 20-person session still fits.
      const token = given(venue(), [
        booking(
          { sessionId: ID.session, session: { label: "Breakout", expectedAttendance: 20 } },
          { expectedAttendance: 250 }
        ),
      ]);

      const body = await (await patch(token, { maxCapacity: 100 })).json();

      expect(body.flaggedBookings).toEqual([]);
    });

    // SPM-90: an event may book several rooms, each for its own space.
    it("[SPM-39][AC7] [SPM-90][AC3] SPM-90: judges a booking by its own space's attendance, ahead of the session's and the event's", async () => {
      // 250 for the event and 180 for the session would both be flagged by a
      // room cut to 100; the 20-person breakout space still fits.
      const token = given(venue(), [
        booking(
          { expectedAttendance: 20, sessionId: ID.session, session: { label: "Day 1", expectedAttendance: 180 } },
          { expectedAttendance: 250 }
        ),
      ]);

      const body = await (await patch(token, { maxCapacity: 100 })).json();

      expect(body.flaggedBookings).toEqual([]);
    });

    it("[SPM-39][AC7] [SPM-90][AC3] SPM-90: flags a booking whose own space no longer fits, though the event's attendance would", async () => {
      const token = given(venue(), [booking({ expectedAttendance: 150 }, { expectedAttendance: 50 })]);

      const body = await (await patch(token, { maxCapacity: 100 })).json();

      expect(body.flaggedBookings).toHaveLength(1);
    });

    it("[SPM-39][AC7] flags a booking whose layout is removed, and replaces the layouts wholesale", async () => {
      const token = given(venue(), [booking()]);
      const layouts = [{ layoutName: "banquet", capacity: 200 }];

      const body = await (await patch(token, { layouts })).json();

      expect(body.flaggedBookings[0].reasons).toEqual(["layout_removed"]);
      expect(callArg(db.venueLayout.deleteMany)).toEqual({ where: { venueId: ID.venue } });
      expect(callArg(db.venue.update).data.layouts).toEqual({ create: layouts });
    });

    it("[SPM-39][AC7] flags a booking when its layout now seats fewer than its attendance", async () => {
      const token = given(venue(), [booking()]);

      const body = await (await patch(token, { layouts: [{ layoutName: "theatre", capacity: 120 }] })).json();

      expect(body.flaggedBookings[0].reasons).toEqual(["layout_capacity_below_attendance"]);
    });

    it("[SPM-39][AC7] removes every layout when sent an empty list", async () => {
      const token = given(venue());

      await patch(token, { layouts: [] });

      expect(db.venueLayout.deleteMany).toHaveBeenCalledOnce();
      expect(callArg(db.venue.update).data.layouts).toBeUndefined();
    });

    it("[SPM-39][AC7] flags a booking when a facility its event requires is removed", async () => {
      const token = given(venue(), [booking({}, { facilityRequirements: [{ facilityId: ID.facility }] })]);
      const replacement = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

      const body = await (await patch(token, { facilityIds: [replacement] })).json();

      expect(body.flaggedBookings[0].reasons).toEqual(["mandatory_facility_removed"]);
      expect(callArg(db.venueFacility.deleteMany)).toEqual({ where: { venueId: ID.venue } });
      expect(callArg(db.venue.update).data.facilities).toEqual({ create: [{ facilityId: replacement }] });
    });

    it("[SPM-39][AC7] does not flag a booking for a problem it already had before this edit", async () => {
      // Already retired; renaming it introduces nothing new.
      const token = given(venue({ isActive: false }), [booking()]);

      const body = await (await patch(token, { name: "Old Hall" })).json();

      expect(body.flaggedBookings).toEqual([]);
      expect(db.venueBooking.update).not.toHaveBeenCalled();
    });

    it("[SPM-39][AC7] never writes to a booking's venue, layout, times or status", async () => {
      const token = given(venue(), [booking()]);

      await patch(token, { isActive: false, maxCapacity: 10, layouts: [] });

      expect(Object.keys(callArg(db.venueBooking.update).data).sort()).toEqual([
        "flaggedAt",
        "needsReview",
        "reviewReason",
      ]);
      expect(db.event.update).not.toHaveBeenCalled();
    });
  });

  it("[SPM-39] answers 500 when the database fails", async () => {
    const token = given(venue());
    db.venueBooking.findMany.mockRejectedValue(new Error("connection lost"));

    expect((await patch(token, { name: "Hall B" })).status).toBe(500);
  });
});
