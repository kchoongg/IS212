// SPM-46 (venue availability calendar) and SPM-40 (venue search). Times are
// written in UTC; Singapore is UTC+8, so local midnight is 16:00Z the day
// before and the PM slot (13:00-18:00) is 05:00Z-10:00Z.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET as availability } from "@/app/api/venues/[id]/availability/route";
import { GET as search } from "@/app/api/venues/search/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const DAY = "2027-03-04";
const DAY_STARTS = new Date("2027-03-03T16:00:00.000Z");
const DAY_ENDS = new Date("2027-03-04T16:00:00.000Z");
const PM_STARTS = new Date("2027-03-04T05:00:00.000Z");
const PM_ENDS = new Date("2027-03-04T10:00:00.000Z");
const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/venues/[id]/availability", () => {
  function venue(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.venue,
      code: "HALL-A",
      name: "Hall A",
      opensAt: "07:00",
      closesAt: "23:59",
      setupMinutes: 0,
      teardownMinutes: 0,
      isActive: true,
      ...overrides,
    };
  }

  function booking(overrides: Record<string, unknown> = {}) {
    return {
      id: ID.booking,
      eventId: ID.event,
      status: "approved",
      layoutName: "theatre",
      startsAt: PM_STARTS,
      endsAt: PM_ENDS,
      event: { title: "Town Hall", status: "planning" },
      session: null,
      ...overrides,
    };
  }

  function given(venueRow: object | null = venue(), bookings: object[] = [], blocks: object[] = []) {
    const token = signIn(user("coordinator"));
    db.venue.findUnique.mockResolvedValue(venueRow);
    db.venueBooking.findMany.mockResolvedValue(bookings);
    db.venueUnavailability.findMany.mockResolvedValue(blocks);
    return token;
  }

  function get(token?: string, query = `?from=${DAY}&to=${DAY}`) {
    return availability(req("GET", `/api/venues/${ID.venue}/availability${query}`, { token }), params({ id: ID.venue }));
  }

  it("is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it.each(["organiser", "attendee", "tech_support"])("is 403 for %s", async (role) => {
    const res = await get(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venue.findUnique).not.toHaveBeenCalled();
  });

  it.each(["coordinator", "ops_manager", "venue_staff"])("is available to %s", async (role) => {
    given();

    expect((await get(signIn(user(role)))).status).toBe(200);
  });

  it("is 404 for a venue that does not exist", async () => {
    const res = await get(given(null));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
  });

  describe("the date range", () => {
    it("defaults to a week starting today, in Singapore time", async () => {
      // 17:00 UTC on the 1st is already 01:00 on the 2nd in Singapore.
      vi.useFakeTimers({ now: new Date("2026-10-01T17:00:00Z") });

      const body = await (await get(given(), "")).json();

      expect(body.range).toEqual({ from: "2026-10-02", to: "2026-10-08", timeZone: "Asia/Singapore" });
      expect(body.days.map((d: { date: string }) => d.date)).toEqual([
        "2026-10-02",
        "2026-10-03",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
      ]);
    });

    it("runs a week from `from` when only that is given", async () => {
      const body = await (await get(given(), `?from=${DAY}`)).json();

      expect(body.range).toMatchObject({ from: DAY, to: "2027-03-10" });
    });

    it.each(["2027-02-30", "04/03/2027", "tomorrow"])("rejects %s as a date", async (from) => {
      const res = await get(given(), `?from=${from}`);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Validation failed");
      expect(body.details.fieldErrors.from[0]).toMatch(/Use a real date written as YYYY-MM-DD/);
    });

    it("refuses an end before the start", async () => {
      const res = await get(given(), `?from=${DAY}&to=2027-03-03`);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "The end date must be on or after the start date." });
    });

    it("refuses a range longer than 62 days", async () => {
      const res = await get(given(), "?from=2027-01-01&to=2027-03-04");

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Choose a range of 62 days or fewer - this one is 63." });
      expect(db.venue.findUnique).not.toHaveBeenCalled();
    });

    it("accepts a range of exactly 62 days", async () => {
      expect((await get(given(), "?from=2027-01-01&to=2027-03-03")).status).toBe(200);
    });
  });

  describe("what it loads", () => {
    it("asks for approved and pending bookings overlapping the range, widened by the venue's turnaround", async () => {
      await get(given(venue({ setupMinutes: 60, teardownMinutes: 30 })));

      expect(callArg(db.venueBooking.findMany).where).toEqual({
        venueId: ID.venue,
        status: { in: ["approved", "pending"] },
        startsAt: { lt: new Date(DAY_ENDS.getTime() + 60 * MINUTE) },
        endsAt: { gt: new Date(DAY_STARTS.getTime() - 30 * MINUTE) },
      });
    });

    it("asks for unavailability overlapping the range itself", async () => {
      await get(given());

      expect(callArg(db.venueUnavailability.findMany).where).toEqual({
        venueId: ID.venue,
        startsAt: { lt: DAY_ENDS },
        endsAt: { gt: DAY_STARTS },
      });
    });
  });

  describe("what it shows", () => {
    it("shows an empty day as three free slots", async () => {
      const body = await (await get(given())).json();

      expect(body.slots.map((s: { slot: string }) => s.slot)).toEqual(["AM", "PM", "Night"]);
      expect(body.days).toHaveLength(1);
      expect(body.days[0].slots.AM.status).toBe("free");
      expect(body.days[0].slots.PM.status).toBe("free");
      expect(body).toMatchObject({ bookings: [], unavailability: [], holds: [], hasOverlaps: false });
    });

    it("marks the slot of an approved booking as booked, and names the event", async () => {
      const token = given(venue(), [booking({ session: { label: "Day 1" } })]);

      const body = await (await get(token)).json();

      expect(body.days[0].slots.PM).toMatchObject({ status: "booked", bookingIds: [ID.booking] });
      expect(body.days[0].slots.AM.status).toBe("free");
      expect(body.bookings).toHaveLength(1);
      expect(body.bookings[0]).toMatchObject({
        id: ID.booking,
        eventId: ID.event,
        eventTitle: "Town Hall",
        eventStatus: "planning",
        sessionLabel: "Day 1",
        layoutName: "theatre",
        cells: [{ day: DAY, slot: "PM", via: "booking" }],
      });
    });

    it("takes the slot before for setup and the slot after for turnaround", async () => {
      const token = given(venue({ setupMinutes: 60, teardownMinutes: 30 }), [booking()]);

      const { slots } = (await (await get(token)).json()).days[0];

      expect(slots.AM).toMatchObject({ status: "turnaround", turnaroundBookingIds: [ID.booking] });
      expect(slots.PM.status).toBe("booked");
      expect(slots.Night).toMatchObject({ status: "turnaround", turnaroundBookingIds: [ID.booking] });
    });

    it("shows a pending request as a hold without taking the slot", async () => {
      const token = given(venue(), [booking({ status: "pending" })]);

      const body = await (await get(token)).json();

      expect(body.bookings).toEqual([]);
      expect(body.holds).toHaveLength(1);
      expect(body.holds[0]).toMatchObject({
        id: ID.booking,
        eventId: ID.event,
        eventTitle: "Town Hall",
        cells: [{ day: DAY, slot: "PM" }],
      });
      expect(body.days[0].slots.PM).toMatchObject({ status: "free", holdIds: [ID.booking] });
    });

    it("marks the slot of an unavailable period, with its reason", async () => {
      const block = { id: "block-1", startsAt: PM_STARTS, endsAt: PM_ENDS, reason: "maintenance", notes: "Floor resurfacing" };

      const body = await (await get(given(venue(), [], [block]))).json();

      expect(body.days[0].slots.PM).toMatchObject({ status: "unavailable", unavailabilityIds: ["block-1"] });
      expect(body.unavailability[0]).toMatchObject({
        id: "block-1",
        reason: "maintenance",
        notes: "Floor resurfacing",
        cells: [{ day: DAY, slot: "PM" }],
      });
    });

    it("flags a booking that overlaps an unavailable period", async () => {
      const block = { id: "block-1", startsAt: PM_STARTS, endsAt: PM_ENDS, reason: "maintenance", notes: null };

      const body = await (await get(given(venue(), [booking()], [block]))).json();

      expect(body.hasOverlaps).toBe(true);
      expect(body.bookings[0].overlaps.unavailabilityIds).toEqual(["block-1"]);
      expect(body.unavailability[0].overlaps.bookingIds).toEqual([ID.booking]);
    });

    it("flags two approved bookings that overlap each other", async () => {
      const token = given(venue(), [booking(), booking({ id: "second-booking" })]);

      const body = await (await get(token)).json();

      expect(body.hasOverlaps).toBe(true);
      expect(body.bookings[0].overlaps.bookingIds).toEqual(["second-booking"]);
      expect(body.days[0].slots.PM.bookingIds).toEqual([ID.booking, "second-booking"]);
    });
  });
});

describe("GET /api/venues/search", () => {
  const WINDOW = "from=2027-03-04T13:00&to=2027-03-04T18:00";
  const loop = { facilityId: ID.facility, facility: { id: ID.facility, name: "Hearing loop", category: "accessibility" } };
  const STAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const stage = { facilityId: STAGE_ID, facility: { id: STAGE_ID, name: "Stage", category: "facility" } };

  function venue(name: string, overrides: Record<string, unknown> = {}) {
    return {
      id: `id-${name}`,
      code: name.toUpperCase(),
      name,
      building: "Marina Centre",
      floor: "1",
      maxCapacity: 300,
      opensAt: "07:00",
      closesAt: "23:00",
      setupMinutes: 0,
      teardownMinutes: 0,
      layouts: [{ layoutName: "theatre", capacity: 300 }],
      facilities: [],
      ...overrides,
    };
  }

  function given(venues: object[], actor = user("coordinator")) {
    const token = signIn(actor);
    db.venue.findMany.mockResolvedValue(venues);
    return token;
  }

  function get(token?: string, query = "") {
    return search(req("GET", `/api/venues/search${query ? `?${query}` : ""}`, { token }));
  }

  async function names(token: string, query: string) {
    const res = await get(token, query);
    expect(res.status).toBe(200);
    return (await res.json()).results.map((v: { name: string }) => v.name);
  }

  it("is 401 without a session", async () => {
    expect((await get()).status).toBe(401);
  });

  it.each(["organiser", "attendee", "tech_support"])("is 403 for %s", async (role) => {
    const res = await get(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venue.findMany).not.toHaveBeenCalled();
  });

  it("returns the whole active catalogue, by name, when no filter is given", async () => {
    const token = given([
      venue("Orchid", { building: "Riverside" }),
      venue("Atrium", {
        layouts: [
          { layoutName: "boardroom", capacity: 40 },
          { layoutName: "theatre", capacity: 300 },
        ],
        facilities: [stage, loop],
      }),
    ]);

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      checked: 2,
      buildings: ["Marina Centre", "Riverside"],
      results: [
        {
          id: "id-Atrium",
          code: "ATRIUM",
          name: "Atrium",
          building: "Marina Centre",
          floor: "1",
          maxCapacity: 300,
          opensAt: "07:00",
          closesAt: "23:00",
          // Largest layout first; facilities by name.
          layouts: [
            { layoutName: "theatre", capacity: 300 },
            { layoutName: "boardroom", capacity: 40 },
          ],
          facilities: [
            { id: ID.facility, name: "Hearing loop", category: "accessibility" },
            { id: STAGE_ID, name: "Stage", category: "facility" },
          ],
        },
        expect.objectContaining({ name: "Orchid", building: "Riverside" }),
      ],
    });
  });

  it("searches only active venues, and loads no bookings when no date is given", async () => {
    await get(given([]));
    const query = callArg(db.venue.findMany);

    expect(query.where).toEqual({ isActive: true });
    expect(query.include.bookings).toBe(false);
    expect(query.include.unavailability).toBe(false);
  });

  it("treats blank parameters as filters that are not set", async () => {
    const token = given([venue("Atrium")]);

    expect(await names(token, "from=&to=&attendance=&building=&layout=&event=")).toEqual(["Atrium"]);
    expect(db.event.findUnique).not.toHaveBeenCalled();
  });

  describe("filters", () => {
    it("keeps only venues that seat the attendance, smallest fitting room first", async () => {
      const token = given([
        venue("Expo", { layouts: [{ layoutName: "theatre", capacity: 800 }] }),
        venue("Studio", { layouts: [{ layoutName: "theatre", capacity: 30 }] }),
        venue("Atrium", { layouts: [{ layoutName: "theatre", capacity: 60 }] }),
      ]);

      expect(await names(token, "attendance=40")).toEqual(["Atrium", "Expo"]);
    });

    it("filters by building", async () => {
      const token = given([venue("Atrium"), venue("Orchid", { building: "Riverside" })]);

      expect(await names(token, "building=Riverside")).toEqual(["Orchid"]);
    });

    it("filters by layout", async () => {
      const token = given([venue("Atrium"), venue("Orchid", { layouts: [{ layoutName: "banquet", capacity: 100 }] })]);

      expect(await names(token, "layout=banquet")).toEqual(["Orchid"]);
    });

    it("requires every facility asked for", async () => {
      const token = given([venue("Atrium", { facilities: [loop] }), venue("Orchid", { facilities: [loop, stage] })]);

      expect(await names(token, `facilityIds=${ID.facility},${STAGE_ID}`)).toEqual(["Orchid"]);
    });

    it("applies all filters together, but still lists every building as a filter option", async () => {
      const token = given([
        venue("Atrium"),
        venue("Orchid", { building: "Riverside", layouts: [{ layoutName: "theatre", capacity: 20 }] }),
      ]);

      const body = await (await get(token, "building=Riverside&attendance=100")).json();

      expect(body.results).toEqual([]);
      expect(body.checked).toBe(2);
      expect(body.buildings).toEqual(["Marina Centre", "Riverside"]);
    });
  });

  describe("the date filter", () => {
    const taken = (status: string, eventId = "another-event") => ({
      bookings: [{ eventId, status, startsAt: PM_STARTS, endsAt: PM_ENDS }],
      unavailability: [],
    });
    const free = { bookings: [], unavailability: [] };

    it("loads only approved and pending bookings within two days of the window", async () => {
      await get(given([]), WINDOW);
      const { bookings, unavailability } = callArg(db.venue.findMany).include;
      const near = {
        startsAt: { lt: new Date(PM_ENDS.getTime() + 2 * DAY_MS) },
        endsAt: { gt: new Date(PM_STARTS.getTime() - 2 * DAY_MS) },
      };

      expect(bookings.where).toEqual({ status: { in: ["approved", "pending"] }, ...near });
      expect(unavailability.where).toEqual(near);
    });

    it.each(["approved", "pending"])("excludes a venue with another event's %s booking in the window", async (status) => {
      const token = given([venue("Atrium", taken(status)), venue("Orchid", free)]);

      expect(await names(token, WINDOW)).toEqual(["Orchid"]);
    });

    it("excludes a venue that is unavailable in the window", async () => {
      const token = given([
        venue("Atrium", { bookings: [], unavailability: [{ startsAt: PM_STARTS, endsAt: PM_ENDS, reason: "maintenance" }] }),
        venue("Orchid", free),
      ]);

      expect(await names(token, WINDOW)).toEqual(["Orchid"]);
    });

    it("excludes a venue that is closed during the window", async () => {
      const token = given([venue("Atrium", { ...free, closesAt: "15:00" }), venue("Orchid", free)]);

      expect(await names(token, WINDOW)).toEqual(["Orchid"]);
    });

    it("still offers a venue to the event that already holds it", async () => {
      const token = given([venue("Atrium", taken("approved", ID.event))]);
      db.event.findUnique.mockResolvedValue({
        id: ID.event,
        status: "planning",
        organiserId: "organiser-id",
        organisationId: ID.org,
        coordinatorId: ID.user,
      });

      expect(await names(token, `${WINDOW}&event=EVT-000007`)).toEqual(["Atrium"]);
      expect(callArg(db.event.findUnique).where).toEqual({ sequenceNumber: 7 });
    });

    it.each([
      ["a start with no end", "from=2027-03-04T13:00", "Give both a start and an end, or neither"],
      ["an end before the start", "from=2027-03-04T18:00&to=2027-03-04T13:00", "The end must be after the start"],
    ])("rejects %s", async (_case, query, message) => {
      const res = await get(given([]), query);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.details.fieldErrors.to).toEqual([message]);
      expect(db.venue.findMany).not.toHaveBeenCalled();
    });

    it("rejects a date that does not exist", async () => {
      const res = await get(given([]), "from=2027-02-31T09:00&to=2027-02-31T18:00");

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "That is not a real date and time" });
    });
  });

  it.each([
    ["attendance that is not a number", "attendance=lots", "attendance"],
    ["attendance of zero", "attendance=0", "attendance"],
    ["a facility id that is not a UUID", "facilityIds=stage", "facilityIds"],
  ])("rejects %s", async (_case, query, field) => {
    const res = await get(given([]), query);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(body.details.fieldErrors).toHaveProperty(field);
  });

  describe("searching for an event", () => {
    it.each([
      ["a malformed reference", "event=nope", undefined],
      ["a reference that matches no event", "event=EVT-000999", null],
      ["a draft the user cannot see", "event=EVT-000007", { id: ID.event, status: "draft", organiserId: "organiser-id", organisationId: ID.org, coordinatorId: null }],
    ])("is 404 for %s", async (_case, query, eventRow) => {
      const token = given([venue("Atrium")]);
      if (eventRow !== undefined) db.event.findUnique.mockResolvedValue(eventRow);

      const res = await get(token, query);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Event not found" });
      expect(db.venue.findMany).not.toHaveBeenCalled();
    });
  });
});
