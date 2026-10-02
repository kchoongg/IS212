// Status labels and tones. See UI_DESIGN.md §5.2.
//
// Every status string in the system — event, venue booking, equipment request,
// registration, clarification, change request — resolves through this file, so
// "Under review" reads the same and looks the same wherever it appears. The
// database stores lower_snake strings (DOCUMENTATION.md § "Statuses are
// strings, not enums"); the UI never shows them raw.

export type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

interface StatusMeta {
  label: string;
  tone: Tone;
}

const STATUS_META: Record<string, StatusMeta> = {
  // --- Event ---
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  under_review: { label: "Under review", tone: "info" },
  approved: { label: "Approved", tone: "progress" },
  planning: { label: "Planning", tone: "progress" },
  confirmed: { label: "Confirmed", tone: "success" },
  completed: { label: "Completed", tone: "neutral" },
  postponed: { label: "Postponed", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },

  // --- Venue booking (approved/rejected/cancelled shared with events) ---
  pending: { label: "Pending", tone: "warning" },

  // --- Equipment request ---
  requested: { label: "Requested", tone: "info" },
  reserved: { label: "Reserved", tone: "success" },
  partially_fulfilled: { label: "Partially fulfilled", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
  // SPM-48: the availability result on an equipment line (S-25 mockup chips).
  // Not stored anywhere - computed from stock, so they are not request statuses.
  available: { label: "Available", tone: "success" },
  partial: { label: "Partial", tone: "warning" },

  // --- Registration ---
  registered: { label: "Registered", tone: "success" },
  waitlisted: { label: "Waiting list", tone: "warning" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  attended: { label: "Attended", tone: "success" },

  // --- Clarification ---
  open: { label: "Open", tone: "warning" },
  answered: { label: "Answered", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
};

/// Unknown statuses degrade to a readable label rather than throwing — a new
/// status added server-side should never blank out a page.
export function statusLabel(status: string): string {
  return STATUS_META[status]?.label ?? humanise(status);
}

export function statusTone(status: string): Tone {
  return STATUS_META[status]?.tone ?? "neutral";
}

// Exported: also used to display other lower_snake enum-ish values (e.g.
// Event.category, Event.preferredLayout) with the same "Confirmed"-style
// capitalisation, rather than showing the raw stored string.
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/// Statuses that mean the event is finished or abandoned. Used to decide
/// whether to offer actions such as Cancel or Request change.
export const TERMINAL_EVENT_STATUSES = ["completed", "cancelled", "rejected"];

export function isTerminalEventStatus(status: string): boolean {
  return TERMINAL_EVENT_STATUSES.includes(status);
}

/// Statuses a request is in before the coordinator has approved it. Venue and
/// equipment arrangements wait for approval (SPM-54, decided 2026-10-02): the
/// first of them is what moves an Approved event into Planning.
export const PRE_APPROVAL_EVENT_STATUSES = ["draft", "submitted", "under_review"];

export function isBeforeApproval(status: string): boolean {
  return PRE_APPROVAL_EVENT_STATUSES.includes(status);
}
