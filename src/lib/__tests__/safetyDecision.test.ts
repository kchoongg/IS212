// SPM-87 - Conduct Operational Safety Check: the pure rules.
//
// CONTRACT (SPM-87, written before the code):
//   src/lib/safetyDecision.ts
//     SAFETY_DECISIONS = ["approved", "changes_requested", "rejected"]
//     SAFETY_CHECK_DECIDED_MESSAGE = "This safety check has already been decided."
//     safetyDecisionSchema (zod): { decision, note? } - note trimmed, at most 1,000 characters,
//       required for changes_requested ("Describe the changes required.") and rejected
//       ("Give a reason for rejecting."), on path "note"; dropped for approved.
//     statusAfterDecision(decision)  -> "safety_cleared" | "planning"   (AC7, AC8)
//     decisionDoneMessage(decision)  -> the message the Safety Officer sees
//     decisionNotification(decision, eventLabel, note) -> { type, title, body } (AC9)
//     safetyCheckSummary(check)      -> the event's "Safety check" row (AC10)
// Decided here (docs/test-cases/SPM-87_test_cases.json, DECIDED 2026-10-13): all wording.

import { describe, expect, it } from "vitest";
import {
  SAFETY_CHECK_DECIDED_MESSAGE,
  SAFETY_DECISIONS,
  decisionDoneMessage,
  decisionNotification,
  safetyCheckSummary,
  safetyDecisionSchema,
  statusAfterDecision,
} from "@/lib/safetyDecision";

describe("the three decisions (AC3-AC5)", () => {
  it("[SPM-87][AC3][AC4][AC5] are approve, request changes and reject", () => {
    expect(SAFETY_DECISIONS).toEqual(["approved", "changes_requested", "rejected"]);
  });

  it("[SPM-87][AC11] SPM-87-TC09: refuses a second decision with one message", () => {
    expect(SAFETY_CHECK_DECIDED_MESSAGE).toBe("This safety check has already been decided.");
  });
});

describe("safetyDecisionSchema (AC4-AC6)", () => {
  const errorsFor = (body: unknown) => {
    const result = safetyDecisionSchema.safeParse(body);
    return result.success ? null : result.error.flatten().fieldErrors;
  };

  it("[SPM-87][AC3] SPM-87-TC03: approves without a reason, and drops one given", () => {
    expect(safetyDecisionSchema.parse({ decision: "approved" })).toEqual({ decision: "approved" });
    expect(safetyDecisionSchema.parse({ decision: "approved", note: "fine" })).toEqual({ decision: "approved" });
  });

  it("[SPM-87][AC5] SPM-87-TC06: keeps the changes required, trimmed", () => {
    expect(safetyDecisionSchema.parse({ decision: "changes_requested", note: "  Add a marshal.  " })).toEqual({
      decision: "changes_requested",
      note: "Add a marshal.",
    });
  });

  it.each([
    ["rejected", undefined, "Give a reason for rejecting."],
    ["rejected", "", "Give a reason for rejecting."],
    ["changes_requested", "   ", "Describe the changes required."],
  ])("[SPM-87][AC6] SPM-87-TC08: asks for a reason when %s has %j", (decision, note, message) => {
    expect(errorsFor({ decision, note })).toEqual({ note: [message] });
  });

  it("[SPM-87][AC6] accepts a reason of exactly 1,000 characters and refuses 1,001", () => {
    expect(errorsFor({ decision: "rejected", note: "x".repeat(1000) })).toBeNull();
    expect(errorsFor({ decision: "rejected", note: "x".repeat(1001) })?.note).toHaveLength(1);
  });

  it("[SPM-87][AC6] refuses a decision that is not one of the three", () => {
    expect(errorsFor({ decision: "maybe" })?.decision).toHaveLength(1);
  });
});

describe("statusAfterDecision (AC7, AC8)", () => {
  it.each([
    ["approved", "safety_cleared"],
    ["changes_requested", "planning"],
    ["rejected", "planning"],
  ] as const)("[SPM-87][AC7][AC8] %s moves the event to %s", (decision, status) => {
    expect(statusAfterDecision(decision)).toBe(status);
  });
});

describe("decisionDoneMessage", () => {
  it.each([
    ["approved", "Safety check approved. The coordinator has been notified."],
    ["changes_requested", "Changes requested. The event is back in Planning and the coordinator has been notified."],
    ["rejected", "Safety arrangement rejected. The event is back in Planning and the coordinator has been notified."],
  ] as const)("[SPM-87] words %s", (decision, message) => {
    expect(decisionDoneMessage(decision)).toBe(message);
  });
});

describe("decisionNotification (AC9)", () => {
  it("[SPM-87][AC9] SPM-87-TC12: tells the coordinator the changes required", () => {
    expect(decisionNotification("changes_requested", "SPM87 Lakeside Conference (EVT-000007)", "Add a marshal.")).toEqual({
      type: "safety_check_decided",
      title: "Safety check: changes requested",
      body: "The Safety Officer requested changes to SPM87 Lakeside Conference (EVT-000007). Changes required: Add a marshal. The event is back in Planning; resubmit it once the changes are made.",
    });
  });

  it("[SPM-87][AC9] tells the coordinator the reason for a rejection", () => {
    const n = decisionNotification("rejected", "Gala (EVT-000007)", "Too crowded.");
    expect(n.title).toBe("Safety check: rejected");
    expect(n.body).toContain("Reason: Too crowded.");
    expect(n.body).toContain("back in Planning");
  });

  it("[SPM-87][AC9] tells the coordinator an approved event can proceed", () => {
    const n = decisionNotification("approved", "Gala (EVT-000007)", undefined);
    expect(n).toEqual({
      type: "safety_check_decided",
      title: "Safety check: approved",
      body: "The Safety Officer approved Gala (EVT-000007). You can now proceed to confirm it.",
    });
  });
});

describe("safetyCheckSummary (AC10) - the event's 'Safety check' row, in Singapore time", () => {
  const submitted = { submittedAt: "2026-10-09T06:30:00.000Z", submittedBy: "Daniel Tan" };
  const decided = { decidedAt: "2026-10-13T06:30:00.000Z", decidedBy: "Hana Yusof" };

  it("[SPM-87][AC10] SPM-86: a pending check says who submitted it and when", () => {
    expect(safetyCheckSummary({ status: "pending", ...submitted, decidedAt: null, decidedBy: null, decisionNote: null })).toBe(
      "Awaiting review · submitted by Daniel Tan, 9 Oct 2026, 14:30"
    );
  });

  it("[SPM-87][AC10] SPM-87-TC03: an approval says who decided and when", () => {
    expect(safetyCheckSummary({ status: "approved", ...submitted, ...decided, decisionNote: null })).toBe(
      "Approved · decided by Hana Yusof, 13 Oct 2026, 14:30"
    );
  });

  it("[SPM-87][AC10] SPM-87-TC06: a change request adds the changes required", () => {
    expect(
      safetyCheckSummary({ status: "changes_requested", ...submitted, ...decided, decisionNote: "Add a marshal." })
    ).toBe("Changes requested · decided by Hana Yusof, 13 Oct 2026, 14:30. Changes required: Add a marshal.");
  });

  it("[SPM-87][AC10] SPM-87-TC07: a rejection adds the reason", () => {
    expect(safetyCheckSummary({ status: "rejected", ...submitted, ...decided, decisionNote: "Too crowded." })).toBe(
      "Rejected · decided by Hana Yusof, 13 Oct 2026, 14:30. Reason: Too crowded."
    );
  });

  it("[SPM-87][AC10] leaves out a name it does not know", () => {
    expect(safetyCheckSummary({ status: "pending", submittedAt: submitted.submittedAt, submittedBy: null, decidedAt: null, decidedBy: null, decisionNote: null })).toBe(
      "Awaiting review · submitted, 9 Oct 2026, 14:30"
    );
    expect(safetyCheckSummary({ status: "approved", ...submitted, decidedAt: decided.decidedAt, decidedBy: null, decisionNote: null })).toBe(
      "Approved · decided, 13 Oct 2026, 14:30"
    );
  });
});
