import { describe, it, expect } from "vitest";
import {
  failedCriteria,
  fitsAttendance,
  hasFacilities,
  occupancyConflict,
  offersLayout,
  parseWallClock,
  searchVenues,
  toWallClock,
  type SearchableVenue,
} from "../venueSearch";

// Traces to SPM-40 and docs/test-cases/SPM-40_test_cases.json. The venues are
// shaped like the seed's (prisma/seed.ts), so a tester's screen and these tests
// describe the same rooms.
//
// Times are Singapore wall-clock with an explicit +08:00 offset, the same
// convention as venueTime.test.ts - so the tests pass on a machine in any zone.

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const at = (from: string, to: string) => ({ startsAt: sgt(from), endsAt: sgt(to) });

const WIFI = "fac-wifi";
const LOADING_BAY = "fac-loading-bay";
const STEP_FREE = "fac-step-free";
const LOOP = "fac-hearing-loop";

const venue = (overrides: Partial<SearchableVenue> = {}): SearchableVenue => ({
  name: "Marina Grand Hall",
  building: "Marina Centre",
  opensAt: "07:00",
  closesAt: "23:00",
  setupMinutes: 180,
  teardownMinutes: 120,
  layouts: [
    { layoutName: "theatre", capacity: 500 },
    { layoutName: "classroom", capacity: 250 },
  ],
  facilityIds: [WIFI, LOADING_BAY, STEP_FREE, LOOP],
  bookings: [],
  unavailability: [],
  ...overrides,
});

const MAR_GH = venue();
const ORC_SEM = venue({
  name: "Orchard Seminar Room",
  building: "Orchard Hub",
  opensAt: "08:00",
  closesAt: "22:00",
  setupMinutes: 60,
  teardownMinutes: 30,
  layouts: [
    { layoutName: "classroom", capacity: 60 },
    { layoutName: "theatre", capacity: 120 },
  ],
  facilityIds: [WIFI, STEP_FREE],
});
const ONE_ROOF = venue({
  name: "One-North Rooftop Terrace",
  building: "One-North",
  opensAt: "16:00",
  closesAt: "23:00",
  layouts: [{ layoutName: "cabaret", capacity: 100 }],
  facilityIds: [WIFI],
});
const NO_LAYOUTS = venue({ name: "Empty Shell", layouts: [] });

const DAY = at("2026-12-09T09:00:00", "2026-12-09T11:00:00");

describe("AC5 - room layout", () => {
  it("matches a venue that offers the layout and drops one that does not", () => {
    expect(offersLayout(MAR_GH, "theatre")).toBe(true);
    expect(offersLayout(ONE_ROOF, "theatre")).toBe(false);
    expect(failedCriteria(ONE_ROOF, { layout: "theatre" })).toEqual(["layout"]);
  });
});

describe("AC2 - expected attendance is compared with LAYOUT capacity (#112)", () => {
  it("uses the chosen layout's capacity, never maxCapacity", () => {
    // Marina seats 500 theatre-style but only 250 in classroom.
    expect(fitsAttendance(MAR_GH, 300, "theatre")).toBe(true);
    expect(fitsAttendance(MAR_GH, 300, "classroom")).toBe(false);
  });

  it("with no layout chosen, any layout that seats everyone will do", () => {
    expect(fitsAttendance(ORC_SEM, 100)).toBe(true); // theatre 120
    expect(fitsAttendance(ORC_SEM, 121)).toBe(false);
  });

  it("is inclusive at exactly the capacity", () => {
    expect(fitsAttendance(ORC_SEM, 60, "classroom")).toBe(true);
    expect(fitsAttendance(ORC_SEM, 61, "classroom")).toBe(false);
  });

  it("never matches a venue with no layouts", () => {
    expect(fitsAttendance(NO_LAYOUTS, 1)).toBe(false);
  });

  it("reports a missing layout once, not also as capacity", () => {
    expect(failedCriteria(ONE_ROOF, { layout: "theatre", attendance: 50 })).toEqual(["layout"]);
  });
});

describe("AC3 - location", () => {
  it("keeps venues in the chosen building only", () => {
    expect(failedCriteria(MAR_GH, { building: "Marina Centre" })).toEqual([]);
    expect(failedCriteria(ORC_SEM, { building: "Marina Centre" })).toEqual(["location"]);
  });
});

describe("AC4 and AC6 - accessibility and facilities", () => {
  it("needs EVERY requested facility, not any of them", () => {
    expect(hasFacilities(ORC_SEM, [WIFI, STEP_FREE])).toBe(true);
    expect(hasFacilities(ORC_SEM, [WIFI, LOOP])).toBe(false);
  });

  it("treats an accessibility feature exactly like a facility", () => {
    expect(failedCriteria(ORC_SEM, { facilityIds: [LOOP] })).toEqual(["facilities"]);
    expect(failedCriteria(MAR_GH, { facilityIds: [LOOP] })).toEqual([]);
  });

  it("an empty list is no filter at all", () => {
    expect(failedCriteria(ONE_ROOF, { facilityIds: [] })).toEqual([]);
  });
});

// SPM-93: the window a search asks about is widened by the venue's setup and
// turnaround minutes before anything is compared with it (Week 7 Customer
// Changes, Change #1) - the same occupied period a booking request is checked on.
describe("AC1 - date and time: opening hours (#46), setup and turnaround included", () => {
  it("drops a venue that opens after the event starts", () => {
    // One-North Rooftop opens at 16:00.
    expect(failedCriteria(ONE_ROOF, { window: DAY })).toContain("opening_hours");
  });

  it("allows setup to start at opening and turnaround to end at closing exactly", () => {
    // Orchard: open 08:00-22:00, 60 min setup, 30 min turnaround.
    expect(failedCriteria(ORC_SEM, { window: at("2026-12-09T09:00:00", "2026-12-09T21:30:00") })).toEqual([]);
  });

  it("drops a venue whose setup would start before it opens", () => {
    expect(failedCriteria(ORC_SEM, { window: at("2026-12-09T08:45:00", "2026-12-09T11:00:00") })).toEqual(["opening_hours"]);
  });

  it("drops a venue whose turnaround would end after it closes", () => {
    expect(failedCriteria(ORC_SEM, { window: at("2026-12-09T19:00:00", "2026-12-09T21:45:00") })).toEqual(["opening_hours"]);
  });
});

describe("AC1 - date and time: occupancy, setup and turnaround included (SPM-93)", () => {
  const approved = (from: string, to: string, eventId = "other") => ({
    ...at(from, to),
    eventId,
    status: "approved",
  });
  // SPM93 Studio: 30 min setup, 45 min turnaround; SPM93 Morning Masterclass
  // approved 8 Jun 2027 10:00-12:00, so the room is in use 09:30-12:45.
  const studio = venue({
    name: "SPM93 Studio",
    setupMinutes: 30,
    teardownMinutes: 45,
    bookings: [approved("2027-06-08T10:00:00", "2027-06-08T12:00:00")],
  });

  it("SPM-93-TC17: drops a venue whose turnaround would run into an approved booking's setup", () => {
    expect(occupancyConflict(studio, at("2027-06-08T08:15:00", "2027-06-08T09:00:00"))).toBe("booked");
  });

  it("SPM-93-TC17: offers it when the turnaround ends as that setup starts", () => {
    expect(occupancyConflict(studio, at("2027-06-08T08:15:00", "2027-06-08T08:45:00"))).toBeNull();
  });

  it("drops a venue whose setup would run into an approved booking's turnaround", () => {
    expect(occupancyConflict(studio, at("2027-06-08T13:00:00", "2027-06-08T14:00:00"))).toBe("booked");
    expect(occupancyConflict(studio, at("2027-06-08T13:15:00", "2027-06-08T14:00:00"))).toBeNull();
  });

  it("no longer takes a whole slot: a booking minutes away does not clash (#126, #128)", () => {
    const quick = venue({ setupMinutes: 0, teardownMinutes: 0, bookings: [approved("2026-12-09T11:00:00", "2026-12-09T11:45:00")] });
    expect(occupancyConflict(quick, at("2026-12-09T08:00:00", "2026-12-09T09:00:00"))).toBeNull();
    expect(occupancyConflict(quick, at("2026-12-09T11:45:00", "2026-12-09T12:00:00"))).toBeNull();
    expect(occupancyConflict(quick, at("2026-12-09T11:30:00", "2026-12-09T12:00:00"))).toBe("booked");
  });

  it("drops a venue on tentative hold for the time (#41), the hold's setup and turnaround included", () => {
    // SPM93 Partner Lunch, pending 10 Jun 12:00-13:00: held 11:30-13:45.
    const held = venue({
      setupMinutes: 30,
      teardownMinutes: 45,
      bookings: [{ ...at("2027-06-10T12:00:00", "2027-06-10T13:00:00"), eventId: "x", status: "pending" }],
    });
    expect(occupancyConflict(held, at("2027-06-10T14:00:00", "2027-06-10T15:00:00"))).toBe("on_hold");
    expect(occupancyConflict(held, at("2027-06-10T14:15:00", "2027-06-10T15:00:00"))).toBeNull();
  });

  it("ignores rejected and cancelled requests", () => {
    const released = venue({
      bookings: [
        { ...DAY, eventId: "x", status: "rejected" },
        { ...DAY, eventId: "y", status: "cancelled" },
      ],
    });
    expect(occupancyConflict(released, DAY)).toBeNull();
  });

  it("never counts the searched-for event's own booking against a venue", () => {
    const own = venue({ bookings: [approved("2026-12-09T09:00:00", "2026-12-09T11:00:00", "evt-1")] });
    expect(occupancyConflict(own, DAY, "evt-1")).toBeNull();
    expect(occupancyConflict(own, DAY, "evt-2")).toBe("booked");
  });

  it("SPM-93-TC12: drops a venue whose setup would run into an unavailable period", () => {
    const blocked = venue({
      setupMinutes: 30,
      teardownMinutes: 45,
      unavailability: [{ ...at("2027-06-16T14:00:00", "2027-06-16T18:00:00"), reason: "maintenance" }],
    });
    expect(occupancyConflict(blocked, at("2027-06-16T18:15:00", "2027-06-16T20:00:00"))).toBe("unavailable");
    expect(occupancyConflict(blocked, at("2027-06-16T18:30:00", "2027-06-16T20:00:00"))).toBeNull();
  });

  it("reports the most serious reason when several apply", () => {
    const both = venue({
      bookings: [approved("2026-12-09T09:00:00", "2026-12-09T11:00:00")],
      unavailability: [{ ...DAY, reason: "maintenance" }],
    });
    expect(occupancyConflict(both, DAY)).toBe("unavailable");
  });
});

describe("AC7 - results only display venues matching every selected criterion", () => {
  const catalogue = [MAR_GH, ORC_SEM, ONE_ROOF, NO_LAYOUTS];

  it("returns every venue when no filter is set", () => {
    expect(searchVenues(catalogue, {})).toHaveLength(4);
  });

  it("drops a venue failing any single filter, however well it matches the rest", () => {
    // Orchard seats 100 theatre-style and has WiFi, but no hearing loop.
    const names = searchVenues(catalogue, {
      attendance: 100,
      layout: "theatre",
      facilityIds: [WIFI, LOOP],
    }).map((v) => v.name);
    expect(names).toEqual(["Marina Grand Hall"]);
  });

  it("combines all six filters", () => {
    const filters = {
      window: DAY,
      attendance: 50,
      building: "Orchard Hub",
      layout: "classroom",
      facilityIds: [STEP_FREE],
    };
    expect(searchVenues(catalogue, filters).map((v) => v.name)).toEqual(["Orchard Seminar Room"]);
    expect(searchVenues(catalogue, { ...filters, attendance: 61 })).toEqual([]);
  });

  it("lists the tightest fit first when attendance is given", () => {
    const names = searchVenues(catalogue, { attendance: 50 }).map((v) => v.name);
    // Orchard classroom 60, Rooftop cabaret 100, Marina classroom 250.
    expect(names).toEqual(["Orchard Seminar Room", "One-North Rooftop Terrace", "Marina Grand Hall"]);
  });

  it("ranks by the chosen layout's fit, and by name when two fit as tightly", () => {
    const a = venue({ name: "Beta Room", layouts: [{ layoutName: "theatre", capacity: 80 }, { layoutName: "classroom", capacity: 40 }] });
    const b = venue({ name: "Alpha Room", layouts: [{ layoutName: "theatre", capacity: 80 }] });
    const c = venue({ name: "Cosy Room", layouts: [{ layoutName: "theatre", capacity: 60 }] });
    expect(searchVenues([a, b, c], { attendance: 40, layout: "theatre" }).map((v) => v.name)).toEqual([
      "Cosy Room",
      "Alpha Room",
      "Beta Room",
    ]);
  });

  it("lists by name otherwise", () => {
    expect(searchVenues([ORC_SEM, MAR_GH], {}).map((v) => v.name)).toEqual([
      "Marina Grand Hall",
      "Orchard Seminar Room",
    ]);
  });
});

describe("Singapore wall-clock conversion (#36)", () => {
  it("reads the typed time as Singapore time, whatever the machine's zone", () => {
    expect(parseWallClock("2026-12-09T09:00")).toEqual(sgt("2026-12-09T09:00:00"));
  });

  it("rejects impossible dates and times", () => {
    expect(parseWallClock("2026-02-31T09:00")).toBeNull();
    expect(parseWallClock("2026-12-09T25:00")).toBeNull();
    expect(parseWallClock("9 Dec 2026")).toBeNull();
  });

  it("round-trips", () => {
    expect(toWallClock(sgt("2026-12-09T18:30:00"))).toBe("2026-12-09T18:30");
    expect(toWallClock(parseWallClock("2026-01-01T00:05")!)).toBe("2026-01-01T00:05");
  });
});
