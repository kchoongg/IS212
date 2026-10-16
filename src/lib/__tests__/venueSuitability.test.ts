import { describe, it, expect } from "vitest";
import {
  assessVenues,
  checkVenueSuitability,
  describeUnmet,
  layoutLabel,
  missingEventInputs,
  parseSpaceAttendance,
  type EventNeeds,
  type VenueCapabilities,
} from "../venueSuitability";

// Traces to SPM-41 and docs/test-cases/SPM-41_test_cases.json. The venues are
// the seed's, so a tester's screen and these tests describe the same rooms.

const WIFI = "fac-wifi";
const VIDEO = "fac-video";
const LIVESTREAM = "fac-livestream";
const GREEN_ROOM = "fac-green-room";
const LOOP = "fac-hearing-loop";
const BRAILLE = "fac-braille";

const req = (facilityId: string, name: string, category = "facility", isMandatory = true) => ({
  facilityId,
  name,
  category,
  isMandatory,
});

const HEARING_LOOP = req(LOOP, "Hearing induction loop", "accessibility");

const event = (overrides: Partial<EventNeeds> = {}): EventNeeds => ({
  expectedAttendance: 60,
  preferredLayout: "classroom",
  requirements: [],
  ...overrides,
});

const ORC_SEM: VenueCapabilities & { name: string } = {
  name: "Orchard Seminar Room",
  layouts: [
    { layoutName: "theatre", capacity: 120 },
    { layoutName: "classroom", capacity: 70 },
    { layoutName: "u_shape", capacity: 45 },
    { layoutName: "cabaret", capacity: 80 },
  ],
  facilityIds: [WIFI],
};

// max capacity 60, but classroom seats 40 (TC02).
const JUR_TRN: VenueCapabilities & { name: string } = {
  name: "Jurong Training Room",
  layouts: [
    { layoutName: "classroom", capacity: 40 },
    { layoutName: "u_shape", capacity: 36 },
  ],
  facilityIds: [WIFI],
};

const MAR_AUD: VenueCapabilities & { name: string } = {
  name: "Marina Auditorium",
  layouts: [{ layoutName: "theatre", capacity: 220 }],
  facilityIds: [WIFI, VIDEO, LIVESTREAM, GREEN_ROOM, LOOP, BRAILLE],
};

describe("capacity is checked against the selected layout (AC1)", () => {
  it("passes when attendance fits the layout", () => {
    expect(checkVenueSuitability(event({ expectedAttendance: 60 }), ORC_SEM).suitable).toBe(true);
  });

  it("fails when attendance is under the venue maximum but over the layout capacity", () => {
    // 55 people, classroom of 40 in a room whose overall maximum is 60.
    const result = checkVenueSuitability(event({ expectedAttendance: 55 }), JUR_TRN);
    expect(result.suitable).toBe(false);
    expect(result.unmet).toEqual([
      { kind: "capacity", layoutName: "classroom", layoutCapacity: 40, expectedAttendance: 55 },
    ]);
  });

  it("accepts attendance equal to the layout capacity", () => {
    expect(checkVenueSuitability(event({ expectedAttendance: 70 }), ORC_SEM).suitable).toBe(true);
  });

  it("rejects attendance one above the layout capacity", () => {
    const result = checkVenueSuitability(event({ expectedAttendance: 71 }), ORC_SEM);
    expect(result.unmet).toEqual([
      { kind: "capacity", layoutName: "classroom", layoutCapacity: 70, expectedAttendance: 71 },
    ]);
  });

  it("gives a different answer for the same attendance under a different layout (TC05)", () => {
    expect(
      checkVenueSuitability(event({ expectedAttendance: 100, preferredLayout: "theatre" }), ORC_SEM)
        .suitable
    ).toBe(true);
    expect(
      checkVenueSuitability(event({ expectedAttendance: 100, preferredLayout: "classroom" }), ORC_SEM)
        .suitable
    ).toBe(false);
  });
});

describe("facilities and accessibility are matched (AC2, AC3)", () => {
  const video = req(VIDEO, "Video conferencing suite");

  it("passes when the venue has every required facility", () => {
    const result = checkVenueSuitability(
      event({ preferredLayout: "theatre", requirements: [video, HEARING_LOOP] }),
      MAR_AUD
    );
    expect(result.suitable).toBe(true);
  });

  it("names a missing facility", () => {
    const result = checkVenueSuitability(
      event({ preferredLayout: "theatre", expectedAttendance: 100, requirements: [video] }),
      ORC_SEM
    );
    expect(result.unmet).toEqual([
      { kind: "facility", facilityId: VIDEO, name: "Video conferencing suite", category: "facility" },
    ]);
  });

  it("names a missing accessibility feature", () => {
    const result = checkVenueSuitability(
      event({ preferredLayout: "theatre", expectedAttendance: 100, requirements: [HEARING_LOOP] }),
      ORC_SEM
    );
    expect(result.unmet).toEqual([
      { kind: "facility", facilityId: LOOP, name: "Hearing induction loop", category: "accessibility" },
    ]);
  });

  it("lists every missing requirement, not just the first", () => {
    const result = checkVenueSuitability(
      event({
        preferredLayout: "theatre",
        expectedAttendance: 40,
        requirements: [video, req(LIVESTREAM, "Livestream capability"), req(GREEN_ROOM, "Green room")],
      }),
      ORC_SEM
    );
    expect(result.unmet.map((u) => u.kind === "facility" && u.name)).toEqual([
      "Video conferencing suite",
      "Livestream capability",
      "Green room",
    ]);
  });

  it("does not fail an event that requires nothing", () => {
    expect(checkVenueSuitability(event(), ORC_SEM).unmet).toEqual([]);
  });

  it("reports a missing nice-to-have without disqualifying the venue", () => {
    const result = checkVenueSuitability(
      event({ requirements: [req(VIDEO, "Video conferencing suite", "facility", false)] }),
      ORC_SEM
    );
    expect(result.suitable).toBe(true);
    expect(result.unmet).toEqual([]);
    expect(result.optionalMissing).toHaveLength(1);
  });
});

describe("the required layout is checked (AC4)", () => {
  it("fails a venue that does not offer the layout, with no capacity fallback", () => {
    const result = checkVenueSuitability(
      event({ preferredLayout: "cabaret", expectedAttendance: 20 }),
      MAR_AUD
    );
    // 20 people in a 220-seat auditorium: the only failure is the layout.
    expect(result.unmet).toEqual([{ kind: "layout", layoutName: "cabaret" }]);
  });

  it("passes a venue that offers the layout", () => {
    expect(
      checkVenueSuitability(event({ preferredLayout: "cabaret", expectedAttendance: 80 }), ORC_SEM).suitable
    ).toBe(true);
  });
});

describe("unsuitable venues say why (AC5, AC6)", () => {
  it("reports capacity and accessibility failures together (TC13)", () => {
    const result = checkVenueSuitability(
      event({ expectedAttendance: 55, requirements: [HEARING_LOOP] }),
      JUR_TRN
    );
    expect(result.suitable).toBe(false);
    expect(result.unmet.map((u) => u.kind)).toEqual(["capacity", "facility"]);
  });

  it("words each requirement so the reason names the requirement and its figures", () => {
    expect(
      describeUnmet({ kind: "capacity", layoutName: "classroom", layoutCapacity: 40, expectedAttendance: 55 })
    ).toBe("Classroom capacity is 40 - this space expects 55.");
    expect(describeUnmet({ kind: "layout", layoutName: "u_shape" })).toBe("U shape layout is not offered.");
    expect(
      describeUnmet({ kind: "facility", facilityId: LOOP, name: "Hearing induction loop", category: "accessibility" })
    ).toBe("Missing accessibility feature: Hearing induction loop.");
    expect(
      describeUnmet({ kind: "facility", facilityId: VIDEO, name: "Video conferencing suite", category: "facility" })
    ).toBe("Missing facility: Video conferencing suite.");
  });

  it("puts suitable venues first, then the closest to suitable", () => {
    const ranked = assessVenues(
      event({ expectedAttendance: 55, requirements: [HEARING_LOOP] }),
      [JUR_TRN, ORC_SEM, MAR_AUD]
    );
    // MAR_AUD has no classroom (1 unmet); JUR_TRN fails 2; ORC_SEM fails only
    // the loop (1). Nothing is suitable.
    expect(ranked.map((r) => r.venue.name)).toEqual([
      "Marina Auditorium",
      "Orchard Seminar Room",
      "Jurong Training Room",
    ]);
  });

  it("keeps unsuitable venues in the list", () => {
    expect(assessVenues(event({ expectedAttendance: 55 }), [JUR_TRN])).toHaveLength(1);
  });
});

describe("incomplete events", () => {
  it("skips the checks it has no input for instead of guessing", () => {
    const noLayout = event({ preferredLayout: null, expectedAttendance: 500 });
    expect(checkVenueSuitability(noLayout, ORC_SEM).unmet).toEqual([]);
    const noAttendance = event({ expectedAttendance: null });
    expect(checkVenueSuitability(noAttendance, JUR_TRN).unmet).toEqual([]);
  });

  it("says what is missing", () => {
    expect(missingEventInputs({ expectedAttendance: null, preferredLayout: null })).toEqual([
      "expectedAttendance",
      "preferredLayout",
    ]);
    expect(missingEventInputs({ expectedAttendance: 10, preferredLayout: "theatre" })).toEqual([]);
  });
});

describe("layoutLabel", () => {
  it("reads like the form does", () => {
    expect(layoutLabel("theatre")).toBe("Theatre");
    expect(layoutLabel("u_shape")).toBe("U shape");
  });
});

// SPM-90: the attendance typed for a space, on the Venue tab and in ?attendance=.
describe("parseSpaceAttendance", () => {
  it.each([
    ["1", 1],
    ["20", 20],
    [" 150 ", 150],
  ])("reads %j as %i", (typed, expected) => {
    expect(parseSpaceAttendance(typed)).toBe(expected);
  });

  it.each(["", " ", "0", "-3", "2.5", "abc", "1e3", "99999999999999999999"])("refuses %j", (typed) => {
    expect(parseSpaceAttendance(typed)).toBeNull();
  });
});
