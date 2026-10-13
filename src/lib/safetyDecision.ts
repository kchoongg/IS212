// Conduct Operational Safety Check (SPM-87, Week 7 change #6): "The Safety
// Officer may approve the event, reject the safety arrangement, or request
// changes... The event cannot proceed to preparation until the Safety Officer
// has approved it."
//
// The decision completes the event's latest SafetyCheck (SPM-86): approving
// moves the event to Safety approved (stored as `safety_cleared`, AC7) for the
// Coordinator to confirm; rejecting or requesting changes returns it to
// Planning (AC8) with the reason or the changes required, which the
// Coordinator acts on (SPM-88).
//
// Pure functions and the request schema, like the rest of src/lib.

import { z } from "zod";
import { formatDateTime } from "@/lib/format";

export const SAFETY_DECISIONS = ["approved", "changes_requested", "rejected"] as const;
export type SafetyDecision = (typeof SAFETY_DECISIONS)[number];

/// AC11: a submission is decided once.
export const SAFETY_CHECK_DECIDED_MESSAGE = "This safety check has already been decided.";

const NOTE_REQUIRED: Record<Exclude<SafetyDecision, "approved">, string> = {
  rejected: "Give a reason for rejecting.",
  changes_requested: "Describe the changes required.",
};

/// AC4-AC6: a reason is required to reject or request changes, and none is
/// kept for an approval.
export const safetyDecisionSchema = z
  .object({
    decision: z.enum(SAFETY_DECISIONS),
    note: z.string().trim().max(1000, "Keep it to 1,000 characters or fewer.").optional(),
  })
  .superRefine((d, ctx) => {
    if (d.decision !== "approved" && !d.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: NOTE_REQUIRED[d.decision] });
    }
  })
  // The output type says what the check above guarantees: a reject or a
  // change request always carries its note, so callers need no fallback.
  .transform(
    (d): { decision: "approved" } | { decision: "changes_requested" | "rejected"; note: string } =>
      d.decision === "approved" ? { decision: d.decision } : { decision: d.decision, note: d.note as string }
  );

/// AC7, AC8.
export function statusAfterDecision(decision: SafetyDecision): "safety_cleared" | "planning" {
  return decision === "approved" ? "safety_cleared" : "planning";
}

const DONE: Record<SafetyDecision, string> = {
  approved: "Safety check approved. The coordinator has been notified.",
  changes_requested: "Changes requested. The event is back in Planning and the coordinator has been notified.",
  rejected: "Safety arrangement rejected. The event is back in Planning and the coordinator has been notified.",
};

export function decisionDoneMessage(decision: SafetyDecision): string {
  return DONE[decision];
}

/// The status-history reason for each decision.
export const DECISION_HISTORY_REASON: Record<SafetyDecision, string> = {
  approved: "Safety check approved",
  changes_requested: "Safety check: changes requested",
  rejected: "Safety check rejected",
};

/// AC9: what the assigned Coordinator is told, with the reason or the changes.
export function decisionNotification(decision: SafetyDecision, eventLabel: string, note: string | undefined) {
  const type = "safety_check_decided";
  if (decision === "approved") {
    return {
      type,
      title: "Safety check: approved",
      body: `The Safety Officer approved ${eventLabel}. You can now proceed to confirm it.`,
    };
  }
  if (decision === "changes_requested") {
    return {
      type,
      title: "Safety check: changes requested",
      body: `The Safety Officer requested changes to ${eventLabel}. Changes required: ${note} The event is back in Planning; resubmit it once the changes are made.`,
    };
  }
  return {
    type,
    title: "Safety check: rejected",
    body: `The Safety Officer rejected the safety arrangement for ${eventLabel}. Reason: ${note} The event is back in Planning.`,
  };
}

export interface SafetyCheckView {
  status: string;
  submittedAt: string;
  submittedBy: string | null;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
}

const OUTCOME: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

/// The event's "Safety check" row (SPM-86 AC8, SPM-87 AC10), staff only:
///   "Awaiting review · submitted by Daniel Tan, 9 Oct 2026, 14:30"
///   "Changes requested · decided by Hana Yusof, 13 Oct 2026, 14:30. Changes required: …"
export function safetyCheckSummary(check: SafetyCheckView): string {
  const decided = OUTCOME[check.status];
  if (!decided || !check.decidedAt) {
    const by = check.submittedBy ? ` by ${check.submittedBy}` : "";
    return `Awaiting review · submitted${by}, ${formatDateTime(check.submittedAt)}`;
  }
  const by = check.decidedBy ? ` by ${check.decidedBy}` : "";
  const line = `${decided} · decided${by}, ${formatDateTime(check.decidedAt)}`;
  if (!check.decisionNote) return line;
  const label = check.status === "rejected" ? "Reason" : "Changes required";
  return `${line}. ${label}: ${check.decisionNote}`;
}
