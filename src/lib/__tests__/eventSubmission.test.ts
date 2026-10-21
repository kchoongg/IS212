import { describe, it, expect } from "vitest";
import { missingSubmissionFields, type SubmissionInput } from "../eventSubmission";

// What a request needs before it leaves draft (SPM-23 AC7, SPM-25 AC1). The
// submit step uses it, and SPM-26 uses the same rule to keep a request that
// is Under review complete when the organiser updates it.

const complete = (over: Partial<SubmissionInput> = {}): SubmissionInput => ({
  title: "Gala Dinner",
  category: "conference",
  startsAt: new Date("2027-03-04T01:00:00.000Z"),
  endsAt: new Date("2027-03-04T09:00:00.000Z"),
  expectedAttendance: 100,
  ...over,
});

describe("missingSubmissionFields", () => {
  it("[SPM-23][AC7] [SPM-25][AC1] finds nothing missing on a complete request with no sessions", () => {
    expect(missingSubmissionFields(complete(), [])).toEqual([]);
  });

  it("[SPM-23][AC7] [SPM-25][AC1] names every missing field, in form order", () => {
    const empty = complete({ title: "", category: null, startsAt: null, endsAt: null, expectedAttendance: null });

    expect(missingSubmissionFields(empty, [])).toEqual(["title", "category", "startsAt", "endsAt", "expectedAttendance"]);
  });

  // An attendance of 0 is a figure, not a gap.
  it("[SPM-23][AC7] [SPM-25][AC1] accepts an expected attendance of 0", () => {
    expect(missingSubmissionFields(complete({ expectedAttendance: 0 }), [{ expectedAttendance: 0 }])).toEqual([]);
  });

  // The event's own figure is derived from its largest session, so it is set
  // as soon as any session has one - each session is checked in its own right.
  it("[SPM-23][AC7] [SPM-25][AC1] names each session with no expected attendance, numbered from 1", () => {
    const sessions = [{ expectedAttendance: 80 }, { expectedAttendance: null }, { expectedAttendance: null }];

    expect(missingSubmissionFields(complete(), sessions)).toEqual([
      "session 2 expectedAttendance",
      "session 3 expectedAttendance",
    ]);
  });
});
