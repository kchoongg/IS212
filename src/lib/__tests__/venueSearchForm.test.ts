import { describe, it, expect } from "vitest";
import {
  EMPTY_SEARCH,
  searchFormErrors,
  searchFromBooking,
  searchFromEvent,
  searchQuery,
  shouldStartPlanning,
  type SearchableEvent,
} from "../venueSearchForm";

// SPM-40: what opening S-14 for an event fills in, and what the form sends.

const event = (overrides: Partial<SearchableEvent> = {}): SearchableEvent => ({
  startsAt: "2026-12-09T01:00:00.000Z", // 09:00 Singapore
  endsAt: "2026-12-09T10:00:00.000Z", // 18:00 Singapore
  expectedAttendance: 200,
  preferredLayout: "theatre",
  facilityRequirements: [
    { facilityId: "loop", isMandatory: true },
    { facilityId: "livestream", isMandatory: true },
    { facilityId: "green-room", isMandatory: false },
  ],
  ...overrides,
});

describe("searchFromEvent - 'using event requirements'", () => {
  it("[SPM-40][AC1][AC2][AC5] fills time (in Singapore time), attendance and layout from the event", () => {
    const values = searchFromEvent(event());
    expect(values.from).toBe("2026-12-09T09:00");
    expect(values.to).toBe("2026-12-09T18:00");
    expect(values.attendance).toBe("200");
    expect(values.layout).toBe("theatre");
  });

  it("[SPM-40][AC6] takes mandatory facilities only - a nice-to-have must not hide venues", () => {
    expect(searchFromEvent(event()).facilityIds).toEqual(["loop", "livestream"]);
  });

  it("[SPM-40][AC3] leaves location as any building", () => {
    expect(searchFromEvent(event()).building).toBe("");
  });

  it("[SPM-40] leaves a missing value blank rather than inventing one", () => {
    const values = searchFromEvent(
      event({ startsAt: null, endsAt: null, expectedAttendance: null, preferredLayout: null })
    );
    expect(values).toEqual({ ...EMPTY_SEARCH, facilityIds: ["loop", "livestream"] });
  });

  it("[SPM-40][AC1][AC2][AC5] [SPM-42][AC4] uses a chosen session's own time, attendance and layout (#74)", () => {
    const values = searchFromEvent(
      event({
        sessions: [
          {
            id: "s2",
            startsAt: "2026-12-10T11:00:00.000Z", // 19:00 Singapore
            endsAt: "2026-12-10T14:00:00.000Z",
            expectedAttendance: 80,
            preferredLayout: "banquet",
          },
        ],
      }),
      "s2"
    );
    expect(values.from).toBe("2026-12-10T19:00");
    expect(values.to).toBe("2026-12-10T22:00");
    expect(values.attendance).toBe("80");
    expect(values.layout).toBe("banquet");
  });

  it("[SPM-40][AC1][AC2][AC5] [SPM-42][AC4] falls back to the event's headcount and layout for a session without its own", () => {
    const values = searchFromEvent(
      event({
        sessions: [
          {
            id: "s1",
            startsAt: "2026-12-09T01:00:00.000Z",
            endsAt: "2026-12-09T04:00:00.000Z",
            expectedAttendance: null,
            preferredLayout: null,
          },
        ],
      }),
      "s1"
    );
    expect(values.attendance).toBe("200");
    expect(values.layout).toBe("theatre");
  });
});

describe("searchQuery", () => {
  it("[SPM-40][AC7] leaves unset filters out", () => {
    expect(searchQuery(EMPTY_SEARCH)).toBe("");
  });

  it("[SPM-40][AC7] sends every set filter, and the event reference", () => {
    const query = new URLSearchParams(searchQuery(searchFromEvent(event()), "EVT-000004"));
    expect(Object.fromEntries(query)).toEqual({
      from: "2026-12-09T09:00",
      to: "2026-12-09T18:00",
      attendance: "200",
      layout: "theatre",
      facilityIds: "loop,livestream",
      event: "EVT-000004",
    });
  });

  it("[SPM-40][AC7] sends no time at all when only one end is filled in", () => {
    expect(searchQuery({ ...EMPTY_SEARCH, from: "2026-12-09T09:00" })).toBe("");
  });
});

describe("searchFormErrors", () => {
  it("[SPM-40][AC1] accepts an empty form", () => {
    expect(searchFormErrors(EMPTY_SEARCH)).toEqual({});
  });

  it("[SPM-40][AC1] needs both ends of the time, or neither", () => {
    expect(searchFormErrors({ ...EMPTY_SEARCH, from: "2026-12-09T09:00" })).toEqual({
      to: "Give both a start and an end, or clear both.",
    });
  });

  it("[SPM-40][AC1] needs the end after the start", () => {
    const same = { ...EMPTY_SEARCH, from: "2026-12-09T09:00", to: "2026-12-09T09:00" };
    expect(searchFormErrors(same).to).toBe("The end must be after the start.");
  });

  it("[SPM-40][AC2] needs a whole, positive attendance", () => {
    const notWhole = { attendance: "Enter a whole number of people, 1 or more." };
    expect(searchFormErrors({ ...EMPTY_SEARCH, attendance: "0" })).toEqual(notWhole);
    expect(searchFormErrors({ ...EMPTY_SEARCH, attendance: "12.5" })).toEqual(notWhole);
    expect(searchFormErrors({ ...EMPTY_SEARCH, attendance: "12" })).toEqual({});
  });
});

// SPM-68 (written before the code): searchFromBooking(event, booking)
// in src/lib/venueSearchForm.ts - what S-14 fills in when it is opened to
// replace a flagged venue booking (AC11). `booking` is a row of
// GET /api/events/[id]/venue-bookings. Decided here, not in the story: the
// layout is the booking's own, falling back to the session's, then the
// event's; the attendance is the session's for a session's booking.
describe("searchFromBooking - replacing a flagged venue booking (SPM-68)", () => {
  const flagged = (overrides: Partial<Parameters<typeof searchFromBooking>[1]> = {}) => ({
    startsAt: "2026-12-10T00:30:00.000Z", // 08:30 Singapore, the day after the event's own start
    endsAt: "2026-12-10T11:00:00.000Z", // 19:00 Singapore
    layoutName: "classroom",
    session: null,
    ...overrides,
  });

  it("[SPM-68][AC11] fills the date and the start and end times from the booking, not the event", () => {
    const values = searchFromBooking(event(), flagged());

    expect(values.from).toBe("2026-12-10T08:30");
    expect(values.to).toBe("2026-12-10T19:00");
  });

  // SPM-90: the main programme follows the event; any other space keeps its own.
  it("[SPM-68][AC11] fills the event's present attendance and layout for the main programme, whatever was booked", () => {
    const values = searchFromBooking(
      event({ expectedAttendance: 260 }),
      flagged({ purpose: "Main programme", expectedAttendance: 80 })
    );

    expect(values.attendance).toBe("260");
    expect(values.layout).toBe("theatre");
  });

  it("[SPM-68][AC11] treats a booking made before SPM-90, with no space, as the main programme", () => {
    const values = searchFromBooking(event({ expectedAttendance: 260 }), flagged());

    expect(values.attendance).toBe("260");
    expect(values.layout).toBe("theatre");
  });

  it("[SPM-68][AC11] fills a breakout room's own attendance and layout, as booked", () => {
    const values = searchFromBooking(event(), flagged({ purpose: "Breakout room", expectedAttendance: 30 }));

    expect(values.attendance).toBe("30");
    expect(values.layout).toBe("classroom");
  });

  it("[SPM-68][AC11] leaves the layout open for a breakout room booked without one, and falls back to the event's attendance", () => {
    const values = searchFromBooking(event(), flagged({ purpose: "Breakout room", expectedAttendance: null, layoutName: null }));

    expect(values.layout).toBe("");
    expect(values.attendance).toBe("200");
  });

  it("[SPM-68][AC11] fills the event's mandatory facilities and accessibility requirements, not its nice-to-haves", () => {
    expect(searchFromBooking(event(), flagged()).facilityIds).toEqual(["loop", "livestream"]);
  });

  it("[SPM-68][AC11] leaves location as any building", () => {
    expect(searchFromBooking(event(), flagged()).building).toBe("");
  });

  it("[SPM-68][AC11] uses the session's own attendance and layout for a session's main programme", () => {
    const sessions = [
      { id: "s1", startsAt: "2026-12-09T01:00:00.000Z", endsAt: "2026-12-09T04:00:00.000Z", expectedAttendance: 40, preferredLayout: "boardroom" },
    ];
    const values = searchFromBooking(event({ sessions }), flagged({ layoutName: null, session: { id: "s1" } }));

    expect(values.attendance).toBe("40");
    expect(values.layout).toBe("boardroom");
    // Still the booking's own times, not the session's.
    expect(values.from).toBe("2026-12-10T08:30");
  });

  it("[SPM-68][AC11] falls back to the event's attendance for a session that gives none", () => {
    const sessions = [
      { id: "s1", startsAt: "2026-12-09T01:00:00.000Z", endsAt: "2026-12-09T04:00:00.000Z", expectedAttendance: null, preferredLayout: null },
    ];
    const values = searchFromBooking(event({ sessions }), flagged({ layoutName: null, session: { id: "s1" } }));

    expect(values.attendance).toBe("200");
    expect(values.layout).toBe("theatre");
  });
});

describe("shouldStartPlanning - Approved -> Planning when the search starts", () => {
  const daniel = { id: "u-daniel", role: "coordinator" };
  const approved = { status: "approved", coordinatorId: "u-daniel" };

  it("[SPM-54][AC1] moves an Approved event when its assigned coordinator opens the search", () => {
    expect(shouldStartPlanning(approved, daniel)).toBe(true);
  });

  it("[SPM-54][AC1] never moves an event that is not Approved", () => {
    for (const status of ["under_review", "planning", "confirmed", "postponed", "cancelled"]) {
      expect(shouldStartPlanning({ ...approved, status }, daniel)).toBe(false);
    }
  });

  it("[SPM-54][AC1] leaves it alone for another coordinator, or another role", () => {
    expect(shouldStartPlanning(approved, { id: "u-priya", role: "coordinator" })).toBe(false);
    expect(shouldStartPlanning(approved, { id: "u-daniel", role: "venue_staff" })).toBe(false);
    expect(shouldStartPlanning(approved, { id: "u-grace", role: "ops_manager" })).toBe(false);
  });
});
