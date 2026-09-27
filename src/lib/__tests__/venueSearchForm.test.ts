import { describe, it, expect } from "vitest";
import {
  EMPTY_SEARCH,
  searchFormErrors,
  searchFromEvent,
  searchQuery,
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
  it("fills time (in Singapore time), attendance and layout from the event", () => {
    const values = searchFromEvent(event());
    expect(values.from).toBe("2026-12-09T09:00");
    expect(values.to).toBe("2026-12-09T18:00");
    expect(values.attendance).toBe("200");
    expect(values.layout).toBe("theatre");
  });

  it("takes mandatory facilities only - a nice-to-have must not hide venues", () => {
    expect(searchFromEvent(event()).facilityIds).toEqual(["loop", "livestream"]);
  });

  it("leaves location as any building", () => {
    expect(searchFromEvent(event()).building).toBe("");
  });

  it("leaves a missing value blank rather than inventing one", () => {
    const values = searchFromEvent(
      event({ startsAt: null, endsAt: null, expectedAttendance: null, preferredLayout: null })
    );
    expect(values).toEqual({ ...EMPTY_SEARCH, facilityIds: ["loop", "livestream"] });
  });

  it("uses a chosen session's own time, attendance and layout (#74)", () => {
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

  it("falls back to the event's headcount and layout for a session without its own", () => {
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
  it("leaves unset filters out", () => {
    expect(searchQuery(EMPTY_SEARCH)).toBe("");
  });

  it("sends every set filter, and the event reference", () => {
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

  it("sends no time at all when only one end is filled in", () => {
    expect(searchQuery({ ...EMPTY_SEARCH, from: "2026-12-09T09:00" })).toBe("");
  });
});

describe("searchFormErrors", () => {
  it("accepts an empty form", () => {
    expect(searchFormErrors(EMPTY_SEARCH)).toEqual({});
  });

  it("needs both ends of the time, or neither", () => {
    expect(searchFormErrors({ ...EMPTY_SEARCH, from: "2026-12-09T09:00" }).to).toBeTruthy();
  });

  it("needs the end after the start", () => {
    const same = { ...EMPTY_SEARCH, from: "2026-12-09T09:00", to: "2026-12-09T09:00" };
    expect(searchFormErrors(same).to).toBe("The end must be after the start.");
  });

  it("needs a whole, positive attendance", () => {
    expect(searchFormErrors({ ...EMPTY_SEARCH, attendance: "0" }).attendance).toBeTruthy();
    expect(searchFormErrors({ ...EMPTY_SEARCH, attendance: "12.5" }).attendance).toBeTruthy();
    expect(searchFormErrors({ ...EMPTY_SEARCH, attendance: "12" })).toEqual({});
  });
});
