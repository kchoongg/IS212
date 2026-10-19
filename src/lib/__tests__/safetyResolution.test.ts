// SPM-88 - Resolve Safety Check Outcome: the pure rules.
//
// CONTRACT (SPM-88, written before the code):
//   src/lib/safetyResolution.ts
//     SAFETY_RETURNED_REASON = "safety_check_returned", worded by SAFETY_REASON_PROSE (AC3)
//     SAFETY_HELD_STATUSES = ["safety_review", "safety_cleared"] - where a significant change
//       closes the check and returns the event to Planning (AC5, AC6)
//     canFlagAfterReturn(eventStatus, latestCheckStatus) - only in Planning after a returned check
//     closeReasonFor(changes) - what changed, in words, for a closed check (ImportantChange list)
//     CLOSE_REASONS - the words for the arrangement routes' changes
//     safetyHistoryLine(check) - one line of the "Safety check history" card (AC1)
//   safetyCheckSummary() (src/lib/safetyDecision.ts) words a closed check:
//     "Closed after a change on <date and time>: <what changed>"
// Wording: docs/test-cases/SPM-88_test_cases.json, DECIDED 2026-10-15.

import { describe, expect, it } from "vitest";
import {
  CLOSE_REASONS,
  SAFETY_HELD_STATUSES,
  SAFETY_REASON_PROSE,
  SAFETY_RETURNED_REASON,
  canFlagAfterReturn,
  closeReasonFor,
  safetyHistoryLine,
} from "@/lib/safetyResolution";
import { safetyCheckSummary } from "@/lib/safetyDecision";

const submitted = { submittedAt: "2026-10-08T06:00:00.000Z", submittedBy: "Daniel Tan" };
const decided = { decidedAt: "2026-10-09T02:00:00.000Z", decidedBy: "Hana Yusof" };

describe("the flag a returned check sets (AC3)", () => {
  it("[SPM-88][AC3] is safety_check_returned, worded for the flagged list", () => {
    expect(SAFETY_RETURNED_REASON).toBe("safety_check_returned");
    expect(SAFETY_REASON_PROSE).toEqual({ safety_check_returned: "the Safety Officer returned the safety check" });
  });
});

describe("canFlagAfterReturn (AC3)", () => {
  it.each(["changes_requested", "rejected"])("[SPM-88][AC3] SPM-88-TC03: allows flagging in Planning after a check was %s", (status) => {
    expect(canFlagAfterReturn("planning", status)).toBe(true);
  });

  it.each([
    ["planning", "approved"],
    ["planning", "closed"],
    ["planning", null],
    ["safety_review", "pending"],
    ["safety_cleared", "approved"],
    ["confirmed", "rejected"],
  ])("[SPM-88][AC3] SPM-88-TC05: refuses an event %s whose latest check is %s", (eventStatus, check) => {
    expect(canFlagAfterReturn(eventStatus, check)).toBe(false);
  });
});

describe("SAFETY_HELD_STATUSES (AC5, AC6)", () => {
  it("[SPM-88][AC5][AC6] are Safety review and Safety approved", () => {
    expect(SAFETY_HELD_STATUSES).toEqual(["safety_review", "safety_cleared"]);
  });
});

describe("closeReasonFor (AC5, AC6)", () => {
  it("[SPM-88][AC5][AC6] SPM-88-TC07: words one important change", () => {
    expect(closeReasonFor(["attendance"])).toBe("the expected attendance changed");
  });

  it("[SPM-88][AC5][AC6] SPM-88-TC12: words several, in order", () => {
    expect(closeReasonFor(["schedule", "venue_requirements", "equipment"])).toBe(
      "the date or time changed, the venue requirements changed, the equipment changed"
    );
  });

  it("[SPM-88][AC5][AC6] words the arrangement routes' changes", () => {
    expect(CLOSE_REASONS).toEqual({
      equipment: "the equipment changed",
      bookingRequested: "a venue booking was requested",
      bookingWithdrawn: "a venue booking was withdrawn",
      bookingReleased: "a venue booking was released",
    });
  });
});

describe("safetyCheckSummary - a closed check (AC5, AC6)", () => {
  it("[SPM-88][AC5][AC6] SPM-88-TC07: says when it was closed and why", () => {
    expect(
      safetyCheckSummary({
        status: "closed",
        ...submitted,
        decidedAt: "2026-10-15T06:30:00.000Z",
        decidedBy: "Daniel Tan",
        decisionNote: "the expected attendance changed",
      })
    ).toBe("Closed after a change on 15 Oct 2026, 14:30: the expected attendance changed");
  });

  it("[SPM-88][AC5][AC6] leaves out a reason it does not have", () => {
    expect(
      safetyCheckSummary({ status: "closed", ...submitted, decidedAt: "2026-10-15T06:30:00.000Z", decidedBy: null, decisionNote: null })
    ).toBe("Closed after a change on 15 Oct 2026, 14:30");
  });
});

describe("safetyHistoryLine (AC1)", () => {
  it("[SPM-88][AC1] SPM-88-TC01: a change request - who submitted, who decided, and the changes", () => {
    expect(
      safetyHistoryLine({ status: "changes_requested", ...submitted, ...decided, decisionNote: "Add a second fire marshal." })
    ).toBe(
      "Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Changes requested by Hana Yusof, 9 Oct 2026, 10:00. Changes required: Add a second fire marshal."
    );
  });

  it("[SPM-88][AC1] SPM-88-TC01: a rejection - with its reason", () => {
    expect(safetyHistoryLine({ status: "rejected", ...submitted, ...decided, decisionNote: "Fire exits blocked." })).toBe(
      "Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Rejected by Hana Yusof, 9 Oct 2026, 10:00. Reason: Fire exits blocked."
    );
  });

  it("[SPM-88][AC1] an approval - no reason", () => {
    expect(safetyHistoryLine({ status: "approved", ...submitted, ...decided, decisionNote: null })).toBe(
      "Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Approved by Hana Yusof, 9 Oct 2026, 10:00"
    );
  });

  it("[SPM-88][AC1] SPM-88-TC04: a pending one is awaiting review", () => {
    expect(safetyHistoryLine({ status: "pending", ...submitted, decidedAt: null, decidedBy: null, decisionNote: null })).toBe(
      "Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Awaiting review"
    );
  });

  it("[SPM-88][AC1] a closed one says why", () => {
    expect(
      safetyHistoryLine({ status: "closed", ...submitted, decidedAt: "2026-10-15T06:30:00.000Z", decidedBy: "Daniel Tan", decisionNote: "the equipment changed" })
    ).toBe("Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Closed after a change on 15 Oct 2026, 14:30: the equipment changed");
  });

  it("[SPM-88][AC1] leaves out names it does not know", () => {
    expect(
      safetyHistoryLine({ status: "approved", submittedAt: submitted.submittedAt, submittedBy: null, decidedAt: decided.decidedAt, decidedBy: null, decisionNote: null })
    ).toBe("Submitted 8 Oct 2026, 14:00 - Approved 9 Oct 2026, 10:00");
  });
});
