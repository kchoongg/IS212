// SPM-45 (Record Venue Unavailability). Rewritten on 2026-10-09 for times on
// the 15-minute grid (Week 7 Change #1, SPM-93), before the code was reworked.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - a period is stored exactly as stated, Singapore time
//   - a booking counts when its room-in-use period (setup and turnaround
//     included) overlaps the period; periods that only meet do not overlap
//   - ending a period under way brings its end to now, rounded down to the grid
//   - a period that is already over when it is saved is refused (Kayal, 2026-10-09)
import { describe, it, expect } from "vitest";
import {
  EMPTY_PERIOD_FORM,
  UNAVAILABILITY_REASONS,
  bookingInPeriod,
  describePeriod,
  endEarlyAt,
  periodBounds,
  periodInterval,
  periodPayload,
  periodPhase,
  unavailabilityReasonLabel,
  unavailabilityReasonText,
  validatePeriodForm,
  type PeriodFormValues,
} from "../venueUnavailability";

/// A Singapore wall-clock time as an instant (UTC+8, no daylight saving).
const sgt = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);

/// Unavailable from 10 Jun 2027, 13:00; available again from 15 Jun 2027, 13:00.
const BOUNDS = { fromDay: "2027-06-10", fromTime: "13:00", untilDay: "2027-06-15", untilTime: "13:00" };
const PERIOD = { startsAt: sgt("2027-06-10", "13:00"), endsAt: sgt("2027-06-15", "13:00") };

const NO_TURNAROUND = { setupMinutes: 0, teardownMinutes: 0 };
/// The Week 7 example: 30 minutes of setup, 45 of turnaround.
const WEEK_7 = { setupMinutes: 30, teardownMinutes: 45 };

const on = (day: string, from: string, to: string) => ({ startsAt: sgt(day, from), endsAt: sgt(day, to) });

describe("the reasons a venue can be unavailable for", () => {
  it("[SPM-45][AC6] offers Week 7's list plus internal activity, in this order", () => {
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
  ])("[SPM-45][AC6] labels %s as %s", (code, label) => {
    expect(unavailabilityReasonLabel(code)).toBe(label);
  });

  // One wording for a period's reason in every notification - SPM-45's and
  // SPM-80's (review of PR #74).
  it("[SPM-45][AC6] gives the reason alone when there is no description", () => {
    expect(unavailabilityReasonText({ reason: "maintenance", notes: null })).toBe("Maintenance");
  });

  it("[SPM-45][AC6] adds the description of an 'other' reason", () => {
    expect(unavailabilityReasonText({ reason: "other", notes: "Filming" })).toBe("Other - Filming");
  });
});

describe("periodInterval - a period stated as dates and times, as stored", () => {
  it("[SPM-45][AC1] runs from the time the venue becomes unavailable to the time it is available again", () => {
    expect(periodInterval(BOUNDS)).toEqual(PERIOD);
  });

  it("[SPM-45][AC1] can be a single 15-minute step", () => {
    const shortest = periodInterval({ fromDay: "2027-07-20", fromTime: "14:00", untilDay: "2027-07-20", untilTime: "14:15" });

    expect(shortest).toEqual(on("2027-07-20", "14:00", "14:15"));
  });

  it("[SPM-45][AC1] reads midnight as the start of the day stated", () => {
    const fromMidnight = periodInterval({ fromDay: "2026-09-01", fromTime: "00:00", untilDay: "2027-07-07", untilTime: "00:00" });

    expect(fromMidnight).toEqual({ startsAt: sgt("2026-09-01", "00:00"), endsAt: sgt("2027-07-07", "00:00") });
  });
});

describe("periodBounds - a stored period, back as dates and times", () => {
  it("[SPM-45][AC1] is the reverse of periodInterval", () => {
    expect(periodBounds(PERIOD)).toEqual(BOUNDS);
  });

  it("[SPM-45][AC1] reads Singapore days, not UTC ones", () => {
    // 07:00 on 11 Jun in Singapore is still 10 Jun in UTC.
    const bounds = periodBounds({ startsAt: sgt("2027-06-10", "19:00"), endsAt: sgt("2027-06-11", "07:00") });

    expect(bounds).toEqual({ fromDay: "2027-06-10", fromTime: "19:00", untilDay: "2027-06-11", untilTime: "07:00" });
  });

  it("[SPM-45][AC1] reads a period seeded as whole days as midnight to midnight", () => {
    // How the base seed and SPM-43's fixture write a period: 00:00 to 24:00.
    const wholeDay = { startsAt: sgt("2027-05-14", "00:00"), endsAt: sgt("2027-05-15", "00:00") };

    expect(periodBounds(wholeDay)).toEqual({ fromDay: "2027-05-14", fromTime: "00:00", untilDay: "2027-05-15", untilTime: "00:00" });
  });
});

describe("describePeriod", () => {
  it("[SPM-45][AC1] names both dates and both times", () => {
    expect(describePeriod(BOUNDS)).toBe("Unavailable from 10 Jun 2027, 13:00. Available again from 15 Jun 2027, 13:00.");
  });
});

describe("bookingInPeriod - which bookings a period affects", () => {
  it.each([
    ["ending as the period starts", false, on("2027-06-10", "11:00", "13:00")],
    ["running 15 minutes into the period", true, on("2027-06-10", "11:15", "13:15")],
    ["starting as the period starts", true, on("2027-06-10", "13:00", "15:00")],
    ["in the middle of the period", true, on("2027-06-12", "09:00", "10:00")],
    ["ending as the period ends", true, on("2027-06-15", "10:00", "13:00")],
    ["starting 15 minutes before the venue is available again", true, on("2027-06-15", "12:45", "14:00")],
    ["starting as the venue is available again", false, on("2027-06-15", "13:00", "15:00")],
  ])("[SPM-45][AC3] a booking %s: %s", (_case, expected, booking) => {
    expect(bookingInPeriod(booking, NO_TURNAROUND, PERIOD)).toBe(expected);
  });

  it("[SPM-45][AC3] counts a booking that the period falls wholly inside", () => {
    const longBooking = { startsAt: sgt("2027-06-09", "09:00"), endsAt: sgt("2027-06-16", "17:00") };

    expect(bookingInPeriod(longBooking, NO_TURNAROUND, PERIOD)).toBe(true);
  });

  describe("at a venue with 30 minutes of setup and 45 of turnaround", () => {
    it("[SPM-45][AC3] counts a booking whose turnaround runs into the period", () => {
      // Ends 12:30; the room is in use until 13:15.
      expect(bookingInPeriod(on("2027-06-10", "11:00", "12:30"), WEEK_7, PERIOD)).toBe(true);
    });

    it("[SPM-45][AC3] does not count a booking whose turnaround ends as the period starts", () => {
      // Ends 12:15; the room is in use until 13:00.
      expect(bookingInPeriod(on("2027-06-10", "11:00", "12:15"), WEEK_7, PERIOD)).toBe(false);
    });

    it("[SPM-45][AC3] counts a booking whose setup starts inside the period", () => {
      // Starts 13:15; the room is in use from 12:45.
      expect(bookingInPeriod(on("2027-06-15", "13:15", "14:15"), WEEK_7, PERIOD)).toBe(true);
    });

    it("[SPM-45][AC3] does not count a booking whose setup starts as the venue is available again", () => {
      // Starts 13:30; the room is in use from 13:00.
      expect(bookingInPeriod(on("2027-06-15", "13:30", "14:30"), WEEK_7, PERIOD)).toBe(false);
    });
  });
});

describe("periodPhase - whether a period is still to come, under way or over", () => {
  it.each([
    ["the minute before it starts", "upcoming", sgt("2027-06-10", "12:59")],
    ["the moment it starts", "current", sgt("2027-06-10", "13:00")],
    ["the last minute before the venue returns", "current", sgt("2027-06-15", "12:59")],
    ["the moment the venue returns", "past", sgt("2027-06-15", "13:00")],
  ])("[SPM-45][AC4] at %s it is %s", (_case, phase, now) => {
    expect(periodPhase(PERIOD, now)).toBe(phase);
  });
});

describe("endEarlyAt - when a period under way ends if it is ended now", () => {
  it.each([
    ["part-way through a 15-minute step", "10:07", "10:00"],
    ["in the last minute of a step", "10:14", "10:00"],
    ["exactly on a step", "10:15", "10:15"],
  ])("[SPM-45][AC5] ended %s, the venue is back from the step that has begun", (_case, now, end) => {
    expect(endEarlyAt(PERIOD, sgt("2027-06-12", now))).toEqual(sgt("2027-06-12", end));
  });

  it("[SPM-45][AC5] drops seconds as well as minutes", () => {
    const now = new Date(sgt("2027-06-12", "10:07").getTime() + 42_500);

    expect(endEarlyAt(PERIOD, now)).toEqual(sgt("2027-06-12", "10:00"));
  });

  it("[SPM-45][AC5] is null when that would leave no period at all", () => {
    // Started at 13:00 and ended at 13:10: there is no step for it to have covered.
    expect(endEarlyAt(PERIOD, sgt("2027-06-10", "13:10"))).toBeNull();
  });
});

describe("validatePeriodForm - what the dialog refuses before sending", () => {
  const filled: PeriodFormValues = { ...BOUNDS, reason: "maintenance", otherReason: "" };
  const GRID_ERROR = "Choose a time on a 15-minute step (:00, :15, :30 or :45).";
  const ORDER_ERROR = "The venue must become available again after it becomes unavailable.";
  const OVER_ERROR = "This period is already over.";
  /// Before the period in `filled`, so "today" never depends on when the tests run.
  const NOW = sgt("2026-10-09", "10:00");
  const validate = (values: PeriodFormValues) => validatePeriodForm(values, NOW);

  it("[SPM-45][AC1] accepts a complete period", () => {
    expect(validate(filled)).toEqual({});
  });

  it("[SPM-45][AC1] names every missing answer on an untouched form", () => {
    expect(validate(EMPTY_PERIOD_FORM)).toEqual({
      fromDay: "Enter the date the venue becomes unavailable.",
      fromTime: "Enter the time the venue becomes unavailable.",
      untilDay: "Enter the date the venue becomes available again.",
      untilTime: "Enter the time the venue becomes available again.",
      reason: "Choose a reason.",
    });
  });

  it.each(["13:10", "13:01", "13:59"])("[SPM-45][AC1] refuses a start time of %s, which is off the 15-minute grid", (fromTime) => {
    expect(validate({ ...filled, fromTime })).toEqual({ fromTime: GRID_ERROR });
  });

  it("[SPM-45][AC1] refuses a return time that is off the 15-minute grid", () => {
    expect(validate({ ...filled, untilTime: "17:40" })).toEqual({ untilTime: GRID_ERROR });
  });

  it.each(["00:00", "13:15", "13:30", "23:45"])("[SPM-45][AC1] accepts a time of %s", (fromTime) => {
    expect(validate({ ...filled, fromTime })).toEqual({});
  });

  it.each([
    ["at the same time", "2027-06-10", "13:00"],
    ["earlier the same day", "2027-06-10", "09:00"],
    ["on an earlier day, later in the day", "2027-06-09", "23:45"],
  ])("[SPM-45][AC2] refuses a return %s", (_case, untilDay, untilTime) => {
    expect(validate({ ...filled, untilDay, untilTime })).toEqual({ untilTime: ORDER_ERROR });
  });

  it("[SPM-45][AC2] accepts a return 15 minutes after the start", () => {
    expect(validate({ ...filled, untilDay: "2027-06-10", untilTime: "13:15" })).toEqual({});
  });

  it("[SPM-45][AC2] does not compare the two while one of them is missing or off the grid", () => {
    expect(validate({ ...filled, fromDay: "", untilDay: "2027-06-01" })).toEqual({
      fromDay: "Enter the date the venue becomes unavailable.",
    });
    expect(validate({ ...filled, fromTime: "13:10", untilDay: "2027-06-10", untilTime: "09:00" })).toEqual({
      fromTime: GRID_ERROR,
    });
  });

  describe("a period that is already over", () => {
    const past = { ...filled, fromDay: "2026-09-01", fromTime: "09:00" };

    it.each([
      ["ended last month", "2026-09-05", "17:00"],
      ["ended 15 minutes ago", "2026-10-09", "09:45"],
      ["ends at this very moment", "2026-10-09", "10:00"],
    ])("[SPM-45][AC1] is refused when it %s", (_case, untilDay, untilTime) => {
      expect(validate({ ...past, untilDay, untilTime })).toEqual({ untilTime: OVER_ERROR });
    });

    it("[SPM-45][AC1] is accepted when it began in the past and ends 15 minutes from now", () => {
      expect(validate({ ...past, untilDay: "2026-10-09", untilTime: "10:15" })).toEqual({});
    });

    it("[SPM-45][AC2] is reported as the wrong way round, not as over, when its return is before its start", () => {
      expect(validate({ ...past, untilDay: "2026-08-01", untilTime: "09:00" })).toEqual({ untilTime: ORDER_ERROR });
    });

    it("[SPM-45][AC1] is judged against the present moment when no time is passed in", () => {
      expect(validatePeriodForm({ ...past, untilDay: "2026-09-05", untilTime: "17:00" })).toEqual({ untilTime: OVER_ERROR });
    });
  });

  it.each(["", "   "])("[SPM-45][AC6] asks for a description when the reason is Other and %j was typed", (otherReason) => {
    expect(validate({ ...filled, reason: "other", otherReason })).toEqual({
      otherReason: "Describe the reason.",
    });
  });

  it("[SPM-45][AC6] accepts Other with a description", () => {
    expect(validate({ ...filled, reason: "other", otherReason: "Film crew on site" })).toEqual({});
  });
});

describe("periodPayload - what the dialog sends", () => {
  it("[SPM-45][AC6] sends the description, trimmed, when the reason is Other", () => {
    expect(periodPayload({ ...BOUNDS, reason: "other", otherReason: "  Film crew on site " })).toEqual({
      ...BOUNDS,
      reason: "other",
      otherReason: "Film crew on site",
    });
  });

  it("[SPM-45][AC6] leaves out a description typed before the reason was changed to one on the list", () => {
    expect(periodPayload({ ...BOUNDS, reason: "safety", otherReason: "Film crew on site" })).toEqual({
      ...BOUNDS,
      reason: "safety",
    });
  });
});
