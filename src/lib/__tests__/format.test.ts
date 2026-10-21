import { describe, it, expect } from "vitest";
import {
  EMPTY,
  eventReference,
  formatDate,
  formatDateTime,
  formatDateTimeRange,
  formatTime,
  formatVenue,
  orEmpty,
  parseEventReference,
} from "../format";

// Traces to SPM-7: "the interface is consistent across user roles". A date has
// to read identically on every screen, which is what these lock down.
//
// Fixtures are UTC instants; the formatters render Singapore time (UTC+8), so
// 2026-10-03T06:00:00Z is 14:00 locally.

const START = "2026-10-03T01:00:00.000Z"; // 09:00 SGT
const END = "2026-10-03T09:00:00.000Z"; // 17:00 SGT

describe("formatDate", () => {
  it("[SPM-7] renders the agreed format", () => {
    expect(formatDate(START)).toBe("3 Oct 2026");
  });

  it("[SPM-7] accepts a Date as well as a string", () => {
    expect(formatDate(new Date(START))).toBe("3 Oct 2026");
  });

  it("[SPM-7] renders missing and invalid values as an em dash, never blank", () => {
    expect(formatDate(null)).toBe(EMPTY);
    expect(formatDate(undefined)).toBe(EMPTY);
    expect(formatDate("not a date")).toBe(EMPTY);
  });
});

describe("formatTime", () => {
  it("[SPM-7] renders 24-hour Singapore time", () => {
    expect(formatTime(START)).toBe("09:00");
    expect(formatTime(END)).toBe("17:00");
  });
});

describe("formatDateTime", () => {
  it("[SPM-7] joins the date and time", () => {
    expect(formatDateTime(START)).toBe("3 Oct 2026, 09:00");
  });
});

describe("formatDateTimeRange", () => {
  it("[SPM-7] collapses a same-day range to one date", () => {
    expect(formatDateTimeRange(START, END)).toBe("3 Oct 2026, 09:00–17:00");
  });

  it("[SPM-7] keeps both timestamps for a multi-day event", () => {
    // Multi-day events are common (briefing §4, Multi-Session Events) and
    // collapsing them would hide the end date.
    expect(formatDateTimeRange(START, "2026-10-05T09:00:00.000Z")).toBe(
      "3 Oct 2026, 09:00 – 5 Oct 2026, 17:00"
    );
  });

  it("[SPM-7] renders whichever end it has when one is missing", () => {
    expect(formatDateTimeRange(START, null)).toBe("3 Oct 2026, 09:00");
    expect(formatDateTimeRange(null, END)).toBe("3 Oct 2026, 17:00");
  });

  it("[SPM-7] renders an em dash when it has neither", () => {
    expect(formatDateTimeRange(null, null)).toBe(EMPTY);
  });
});

describe("formatVenue", () => {
  it("[SPM-7] appends the code staff say aloud", () => {
    expect(formatVenue("Marina Grand Hall", "MAR-GH")).toBe("Marina Grand Hall (MAR-GH)");
  });

  it("[SPM-7] omits an absent code", () => {
    expect(formatVenue("Marina Grand Hall")).toBe("Marina Grand Hall");
  });
});

describe("orEmpty", () => {
  it("[SPM-7] passes through real values, including zero", () => {
    expect(orEmpty("Conference")).toBe("Conference");
    expect(orEmpty(0)).toBe("0");
  });

  it("[SPM-7] replaces null, undefined and empty strings", () => {
    expect(orEmpty(null)).toBe(EMPTY);
    expect(orEmpty(undefined)).toBe(EMPTY);
    expect(orEmpty("")).toBe(EMPTY);
  });
});

describe("eventReference / parseEventReference", () => {
  it("[SPM-31] formats and parses back the same number", () => {
    expect(eventReference(123)).toBe("EVT-000123");
    expect(parseEventReference("EVT-000123")).toBe(123);
  });

  it("[SPM-31] is case-insensitive and needs no padding to parse", () => {
    expect(parseEventReference("evt-42")).toBe(42);
  });

  it("[SPM-31] rejects anything that isn't the EVT-<digits> shape, including a raw UUID", () => {
    expect(parseEventReference("not-a-reference")).toBeNull();
    expect(parseEventReference("a1b2c3d4-0000-0000-0000-000000000000")).toBeNull();
    expect(parseEventReference("EVT-")).toBeNull();
    expect(parseEventReference("EVT-12a")).toBeNull();
  });

  // FIXED (found in review of PR #21): a reference above Postgres's int4
  // range crashed every route that resolved it, with a 500 instead of the 404
  // an unmatched reference should give.
  it("[SPM-31] rejects a number too large for the database's sequence column, rather than crashing later", () => {
    expect(parseEventReference("EVT-2147483647")).toBe(2_147_483_647); // int4 max: still valid
    expect(parseEventReference("EVT-2147483648")).toBeNull(); // one past int4 max
    expect(parseEventReference("EVT-99999999999")).toBeNull();
  });
});
