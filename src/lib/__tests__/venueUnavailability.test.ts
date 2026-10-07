// SPM-45 (Record Venue Unavailability). Written before the code; the rules
// below were decided here, not in the story (change the test if the team wants
// otherwise):
//   - a period runs from the START of its first unavailable slot to the START
//     of its first available slot, Singapore time
//   - a booking's setup and turnaround slots count, as they do for the calendar
//     and the conflict check
import { describe, it, expect } from "vitest";
import {
  EMPTY_PERIOD_FORM,
  UNAVAILABILITY_REASONS,
  bookingInPeriod,
  describePeriod,
  periodBounds,
  periodInterval,
  periodPayload,
  periodPhase,
  unavailabilityReasonLabel,
  validatePeriodForm,
  type PeriodFormValues,
} from "../venueUnavailability";

/// A Singapore wall-clock time as an instant (UTC+8, no daylight saving).
const sgt = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);

/// Unavailable from 10 Jun 2027 PM, available again from 15 Jun 2027 PM.
const BOUNDS = { fromDay: "2027-06-10", fromSlot: "PM", untilDay: "2027-06-15", untilSlot: "PM" } as const;
const PERIOD = { startsAt: sgt("2027-06-10", "13:00"), endsAt: sgt("2027-06-15", "13:00") };

const NO_TURNAROUND = { setupMinutes: 0, teardownMinutes: 0 };

const AM = (day: string) => ({ startsAt: sgt(day, "07:00"), endsAt: sgt(day, "12:00") });
const PM = (day: string) => ({ startsAt: sgt(day, "13:00"), endsAt: sgt(day, "18:00") });

describe("the reasons a venue can be unavailable for", () => {
  it("offers Week 7's list plus internal activity, in this order", () => {
    expect(UNAVAILABILITY_REASONS).toEqual([
      "maintenance",
      "equipment_failure",
      "renovation",
      "safety",
      "internal_activity",
      "other",
    ]);
  });

  it.each([
    ["maintenance", "Maintenance"],
    ["equipment_failure", "Equipment failure"],
    ["internal_activity", "Internal activity"],
  ])("labels %s as %s", (code, label) => {
    expect(unavailabilityReasonLabel(code)).toBe(label);
  });
});

describe("periodInterval - a period stated in days and slots, as stored", () => {
  it("runs from the start of the first unavailable slot to the start of the first available one", () => {
    expect(periodInterval(BOUNDS)).toEqual(PERIOD);
  });

  it.each([
    ["AM", "07:00"],
    ["PM", "13:00"],
    ["Night", "19:00"],
  ] as const)("starts a period at the %s slot's own start, %s Singapore time", (slot, time) => {
    expect(periodInterval({ ...BOUNDS, fromSlot: slot }).startsAt).toEqual(sgt("2027-06-10", time));
  });

  it("covers one slot when the venue is back in the next slot of the same day", () => {
    const oneSlot = periodInterval({ fromDay: "2027-06-10", fromSlot: "PM", untilDay: "2027-06-10", untilSlot: "Night" });

    expect(oneSlot).toEqual({ startsAt: sgt("2027-06-10", "13:00"), endsAt: sgt("2027-06-10", "19:00") });
  });

  it("covers the whole Night slot when the venue is back the next morning", () => {
    const overnight = periodInterval({ fromDay: "2027-06-10", fromSlot: "Night", untilDay: "2027-06-11", untilSlot: "AM" });

    expect(overnight).toEqual({ startsAt: sgt("2027-06-10", "19:00"), endsAt: sgt("2027-06-11", "07:00") });
  });
});

describe("periodBounds - a stored period, back as days and slots", () => {
  it("is the reverse of periodInterval", () => {
    expect(periodBounds(PERIOD)).toEqual(BOUNDS);
  });

  it("reads Singapore days, not UTC ones", () => {
    // 07:00 on 11 Jun in Singapore is still 10 Jun in UTC.
    const bounds = periodBounds({ startsAt: sgt("2027-06-10", "19:00"), endsAt: sgt("2027-06-11", "07:00") });

    expect(bounds).toEqual({ fromDay: "2027-06-10", fromSlot: "Night", untilDay: "2027-06-11", untilSlot: "AM" });
  });
});

describe("periodBounds - a stored period that does not sit on slot starts", () => {
  it("reads a period seeded as whole days as AM of its first day to AM of the day after its last", () => {
    // How the base seed and SPM-43's fixture write a period: 00:00 to 24:00.
    const wholeDay = { startsAt: sgt("2027-05-14", "00:00"), endsAt: sgt("2027-05-15", "00:00") };

    expect(periodBounds(wholeDay)).toEqual({ fromDay: "2027-05-14", fromSlot: "AM", untilDay: "2027-05-15", untilSlot: "AM" });
  });

  it("reads a period ended part-way through a slot as back from the next slot", () => {
    const endedEarly = { startsAt: sgt("2027-06-10", "13:00"), endsAt: sgt("2027-06-12", "10:00") };

    expect(periodBounds(endedEarly)).toMatchObject({ untilDay: "2027-06-12", untilSlot: "PM" });
  });

  it("reads a period ended after Night has started as back the next morning", () => {
    const endedLate = { startsAt: sgt("2027-06-10", "13:00"), endsAt: sgt("2027-06-12", "21:30") };

    expect(periodBounds(endedLate)).toMatchObject({ untilDay: "2027-06-13", untilSlot: "AM" });
  });

  it("reads a period starting between two slots as starting with the later one", () => {
    const fromLunch = { startsAt: sgt("2027-06-10", "12:30"), endsAt: sgt("2027-06-11", "07:00") };

    expect(periodBounds(fromLunch)).toMatchObject({ fromDay: "2027-06-10", fromSlot: "PM" });
  });
});

describe("describePeriod", () => {
  it("names both dates and both slots", () => {
    expect(describePeriod(BOUNDS)).toBe("Unavailable from 10 Jun 2027 PM. Available again from 15 Jun 2027 PM.");
  });
});

describe("bookingInPeriod - which bookings a period affects", () => {
  it.each([
    ["the slot before the period starts", false, AM("2027-06-10")],
    ["the first slot of the period", true, PM("2027-06-10")],
    ["a slot in the middle of the period", true, AM("2027-06-12")],
    ["the last slot of the period", true, AM("2027-06-15")],
    ["the slot the venue is available again", false, PM("2027-06-15")],
  ])("a booking in %s: %s", (_case, expected, booking) => {
    expect(bookingInPeriod(booking, NO_TURNAROUND, PERIOD)).toBe(expected);
  });

  it("counts a booking that only partly overlaps the period's slots", () => {
    const allDay = { startsAt: sgt("2027-06-10", "09:00"), endsAt: sgt("2027-06-10", "17:00") };

    expect(bookingInPeriod(allDay, NO_TURNAROUND, PERIOD)).toBe(true);
  });

  it("counts a booking whose turnaround slot falls in the period", () => {
    // The morning booking itself ends before the period; its turnaround takes 10 Jun PM.
    expect(bookingInPeriod(AM("2027-06-10"), { setupMinutes: 0, teardownMinutes: 30 }, PERIOD)).toBe(true);
  });

  it("counts a booking whose setup slot falls in the period", () => {
    // The afternoon booking starts as the venue returns; its setup takes 15 Jun AM.
    expect(bookingInPeriod(PM("2027-06-15"), { setupMinutes: 60, teardownMinutes: 0 }, PERIOD)).toBe(true);
  });

  it("does not count a turnaround slot the venue does not need", () => {
    expect(bookingInPeriod(AM("2027-06-10"), { setupMinutes: 60, teardownMinutes: 0 }, PERIOD)).toBe(false);
  });

  it.each([
    ["inside the period", "2027-06-12", true],
    ["before the period", "2027-06-10", false],
  ])("judges a booking that touches no slot by its own minutes: %s", (_case, day, expected) => {
    const overLunch = { startsAt: sgt(day, "12:15"), endsAt: sgt(day, "12:45") };

    expect(bookingInPeriod(overLunch, NO_TURNAROUND, PERIOD)).toBe(expected);
  });
});

describe("periodPhase - whether a period is still to come, under way or over", () => {
  it.each([
    ["the slot before it starts", "upcoming", sgt("2027-06-10", "12:59")],
    ["the moment it starts", "current", sgt("2027-06-10", "13:00")],
    ["the last minute before the venue returns", "current", sgt("2027-06-15", "12:59")],
    ["the moment the venue returns", "past", sgt("2027-06-15", "13:00")],
  ])("at %s it is %s", (_case, phase, now) => {
    expect(periodPhase(PERIOD, now)).toBe(phase);
  });
});

describe("validatePeriodForm - what the dialog refuses before sending", () => {
  const filled: PeriodFormValues = { ...BOUNDS, reason: "maintenance", otherReason: "" };

  it("accepts a complete period", () => {
    expect(validatePeriodForm(filled)).toEqual({});
  });

  it("names every missing answer on an untouched form", () => {
    expect(validatePeriodForm(EMPTY_PERIOD_FORM)).toEqual({
      fromDay: "Enter the date the venue becomes unavailable.",
      untilDay: "Enter the date the venue becomes available again.",
      reason: "Choose a reason.",
    });
  });

  it.each([
    ["the same slot", "PM"],
    ["an earlier slot of the same day", "AM"],
  ] as const)("refuses a return in %s", (_case, untilSlot) => {
    expect(validatePeriodForm({ ...filled, untilDay: "2027-06-10", untilSlot })).toEqual({
      untilDay: "The venue must become available again after it becomes unavailable.",
    });
  });

  it("accepts a return in the next slot of the same day", () => {
    expect(validatePeriodForm({ ...filled, untilDay: "2027-06-10", untilSlot: "Night" })).toEqual({});
  });

  it("does not compare the dates while the start date is missing", () => {
    expect(validatePeriodForm({ ...filled, fromDay: "" })).toEqual({
      fromDay: "Enter the date the venue becomes unavailable.",
    });
  });

  it.each(["", "   "])("asks for a description when the reason is Other and %j was typed", (otherReason) => {
    expect(validatePeriodForm({ ...filled, reason: "other", otherReason })).toEqual({
      otherReason: "Describe the reason.",
    });
  });

  it("accepts Other with a description", () => {
    expect(validatePeriodForm({ ...filled, reason: "other", otherReason: "Film crew on site" })).toEqual({});
  });
});

describe("periodPayload - what the dialog sends", () => {
  it("sends the description, trimmed, when the reason is Other", () => {
    expect(periodPayload({ ...BOUNDS, reason: "other", otherReason: "  Film crew on site " })).toEqual({
      ...BOUNDS,
      reason: "other",
      otherReason: "Film crew on site",
    });
  });

  it("leaves out a description typed before the reason was changed to one on the list", () => {
    expect(periodPayload({ ...BOUNDS, reason: "safety", otherReason: "Film crew on site" })).toEqual({
      ...BOUNDS,
      reason: "safety",
    });
  });
});
