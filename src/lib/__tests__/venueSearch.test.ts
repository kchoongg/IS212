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
  withinOpeningHours,
  type SearchableVenue,
} from "../venueSearch";

// Traces to SPM-40 and docs/test-cases/SPM-40_test_cases.json. The venues are
// shaped like the seed's (prisma/seed.ts), so a tester's screen and these tests
// describe the same rooms.
//
// Times are Singapore wall-clock with an explicit +08:00 offset, the same
// convention as venueSlots.test.ts - so the tests pass on a machine in any zone.

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

const DAY = at("2026-12-09T09:00:00", "2026-12-09T11:00:00"); // AM only

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

describe("AC1 - date and time: opening hours (#46)", () => {
  it("drops a venue that opens after the event starts", () => {
    // One-North Rooftop opens at 16:00.
    expect(withinOpeningHours(ONE_ROOF, DAY)).toBe(false);
    expect(withinOpeningHours(ONE_ROOF, at("2026-12-09T17:00:00", "2026-12-09T22:00:00"))).toBe(true);
  });

  it("drops a venue that closes before the event ends", () => {
    expect(withinOpeningHours(ORC_SEM, at("2026-12-09T19:00:00", "2026-12-09T22:30:00"))).toBe(false);
  });

  it("allows starting at opening and ending at closing exactly", () => {
    expect(withinOpeningHours(ORC_SEM, at("2026-12-09T08:00:00", "2026-12-09T22:00:00"))).toBe(true);
  });

  it("reads an end at midnight as 24:00, the end of the day", () => {
    const allNight = venue({ opensAt: "07:00", closesAt: "23:59" });
    expect(withinOpeningHours(allNight, at("2026-12-09T19:00:00", "2026-12-10T00:00:00"))).toBe(false);
  });

  it("checks the first day's start and the last day's end of a multi-day event", () => {
    expect(withinOpeningHours(ORC_SEM, at("2026-12-09T09:00:00", "2026-12-10T18:00:00"))).toBe(true);
  });

  it("does not hide a venue whose stored hours cannot be read", () => {
    expect(withinOpeningHours(venue({ opensAt: "late", closesAt: "?" }), DAY)).toBe(true);
  });
});

describe("AC1 - date and time: occupancy, via SPM-46's slot rules", () => {
  const approved = (from: string, to: string, eventId = "other") => ({
    ...at(from, to),
    eventId,
    status: "approved",
  });

  it("drops a venue with an approved booking in the same slot (#107)", () => {
    // Different minutes, same AM slot - consumed in full.
    const booked = venue({ bookings: [approved("2026-12-09T11:00:00", "2026-12-09T11:45:00")] });
    expect(occupancyConflict(booked, at("2026-12-09T08:00:00", "2026-12-09T09:00:00"))).toBe("booked");
  });

  it("drops a venue whose turnaround slot is taken by the other booking (#123)", () => {
    // An AM booking with turnaround holds PM. A PM search must not get it.
    const booked = venue({ bookings: [approved("2026-12-09T09:00:00", "2026-12-09T11:00:00")] });
    expect(occupancyConflict(booked, at("2026-12-09T14:00:00", "2026-12-09T16:00:00"))).toBe("booked");
  });

  it("counts the REQUESTED event's own setup slot too", () => {
    // A Night booking the day before, with its turnaround, holds this morning's
    // AM. Even without that, THIS AM event needs the previous Night for setup.
    const booked = venue({
      setupMinutes: 60,
      teardownMinutes: 0,
      bookings: [approved("2026-12-08T19:00:00", "2026-12-08T22:00:00")],
    });
    expect(occupancyConflict(booked, DAY)).toBe("booked");
  });

  it("offers the venue when setup and turnaround leave a free slot between", () => {
    // Night booking, no turnaround recorded; this search is next day's PM, whose
    // setup slot is AM - free.
    const quiet = venue({
      setupMinutes: 60,
      teardownMinutes: 0,
      bookings: [approved("2026-12-08T19:00:00", "2026-12-08T22:00:00")],
    });
    expect(occupancyConflict(quiet, at("2026-12-09T14:00:00", "2026-12-09T17:00:00"))).toBeNull();
  });

  it("drops a venue on tentative hold for the time (#41), on the hold's own slots only", () => {
    const held = venue({
      setupMinutes: 0,
      teardownMinutes: 0,
      bookings: [{ ...at("2026-12-09T09:00:00", "2026-12-09T11:00:00"), eventId: "x", status: "pending" }],
    });
    expect(occupancyConflict(held, DAY)).toBe("on_hold");
    // The hold claims no turnaround, so the PM slot is still offered.
    expect(occupancyConflict(held, at("2026-12-09T14:00:00", "2026-12-09T16:00:00"))).toBeNull();
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

  it("drops a venue blocked for maintenance, setup time included", () => {
    const blocked = venue({
      unavailability: [{ ...at("2026-12-08T00:00:00", "2026-12-08T23:59:00"), reason: "renovation" }],
    });
    // The block ends the day before, but this AM event's setup is that Night.
    expect(occupancyConflict(blocked, DAY)).toBe("unavailable");
    expect(occupancyConflict(venue({ setupMinutes: 0, unavailability: blocked.unavailability }), DAY)).toBeNull();
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
