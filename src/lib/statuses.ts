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
  // SPM-86: submitted for an Operational Safety Check, waiting on the Safety
  // Officer - waiting on someone else's review, so the same tone as Under review.
  safety_review: { label: "Safety review", tone: "info" },
  // SPM-87: the Safety Officer approved it; the Coordinator confirms next. A
  // step towards Confirmed, so the same tone as Approved and Planning.
  // Stored as safety_cleared: "safety_approved" is already the Readiness
  // tab's safety check badge (SPM-33).
  safety_cleared: { label: "Safety approved", tone: "progress" },
  confirmed: { label: "Confirmed", tone: "success" },
  completed: { label: "Completed", tone: "neutral" },
  postponed: { label: "Postponed", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "danger" },

  // --- Venue booking (approved/rejected shared with events) ---
  pending: { label: "Pending", tone: "warning" },
  // SPM-67: taken back by the Coordinator - a withdrawn request ("withdrawn",
  // below with Registration, reads the same) or a released booking. Grey, as
  // neither holds the room any more.
  released: { label: "Released", tone: "neutral" },
  // SPM-82: a tentative hold not approved in time. Grey: it holds nothing, and
  // stays on the event record so the Coordinator can see what happened (AC8).
  expired: { label: "Expired", tone: "neutral" },

  // --- Equipment request ---
  requested: { label: "Requested", tone: "info" },
  reserved: { label: "Reserved", tone: "success" },
  partially_fulfilled: { label: "Partially fulfilled", tone: "warning" },
  // SPM-50: "Unavailable" was renamed for display - Technical Support has
  // decided this item can't be provided. Kept apart in wording from the
  // availability chip's "None available" below, which is worked out from stock.
  unavailable: { label: "Cannot be provided", tone: "danger" },
  // SPM-48: the availability result on an equipment line (S-25 mockup chips).
  // Not stored anywhere - computed from stock, so they are not request statuses.
  available: { label: "Available", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  // The availability result "unavailable" is shown under this key (see
  // availabilityStatusKey() below), so it never reads
  // the same as a request Technical Support marked "Cannot be provided".
  none_available: { label: "None available", tone: "danger" },
  // SPM-55: an equipment item's operational status (Equipment page). Worked
  // out from how many units are out of service, so not a request status.
  partly_out_of_service: { label: "Partly out of service", tone: "warning" },
  out_of_service: { label: "Out of service", tone: "danger" },

  // --- Registration ---
  registered: { label: "Registered", tone: "success" },
  waitlisted: { label: "Waiting list", tone: "warning" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  // SPM-65 (AC3): a different tone from Registered, so a checked-in attendee
  // stands out on the registration list by colour as well as by label.
  attended: { label: "Attended", tone: "info" },

  // --- Whether an attendee can register now (SPM-51, registrationState()) ---
  // Not stored anywhere: worked out from the event and its seats, so these
  // keys are prefixed to stay apart from the clarification "open"/"closed".
  registration_open: { label: "Open", tone: "success" },
  registration_not_open: { label: "Not open yet", tone: "info" },
  registration_closed: { label: "Closed", tone: "neutral" },
  registration_full: { label: "Full", tone: "danger" },
  registration_no_period: { label: "Dates not set", tone: "neutral" },

  // --- Arrangement, on the Readiness tab (SPM-33) ---
  // Not stored anywhere: worked out by arrangementsFor() in
  // eventConfirmation.ts. Three states that must never look alike (AC7, AC10).
  complete: { label: "Complete", tone: "success" },
  outstanding: { label: "Outstanding", tone: "warning" },
  not_required: { label: "Not required", tone: "neutral" },
  // The Operational Safety Check on the Readiness tab (SPM-33 AC6), from its
  // latest SafetyCheck (SPM-86). Prefixed so a pending check reads "Awaiting
  // review", never a booking's "Pending".
  safety_not_submitted: { label: "Not submitted", tone: "warning" },
  safety_awaiting_review: { label: "Awaiting review", tone: "info" },
  safety_approved: { label: "Approved", tone: "success" },
  safety_changes_requested: { label: "Changes requested", tone: "warning" },
  safety_rejected: { label: "Rejected", tone: "danger" },

  // --- Clarification ---
  open: { label: "Open", tone: "warning" },
  answered: { label: "Answered", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
};

/// SPM-50: the key an equipment availability result is shown under. The
/// result "unavailable" (no stock free) displays as "None available", so it
/// never reads like the request status "Cannot be provided", which is
/// Technical Support's decision rather than a stock count.
export function availabilityStatusKey(status: "available" | "partial" | "unavailable"): string {
  return status === "unavailable" ? "none_available" : status;
}

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
export const TERMINAL_EVENT_STATUSES = ["completed", "cancelled", "rejected", "withdrawn"];

export function isTerminalEventStatus(status: string): boolean {
  return TERMINAL_EVENT_STATUSES.includes(status);
}

/// Statuses a request is in before the coordinator has approved it. Venue and
/// equipment arrangements wait for approval (SPM-54, decided 2026-10-02): the
/// first of them is what moves an Approved event into Planning.
export const PRE_APPROVAL_EVENT_STATUSES = ["draft", "submitted", "under_review"];

export function isBeforeApproval(status: string): boolean {
  return PRE_APPROVAL_EVENT_STATUSES.includes(status); }
/// SPM-27: which from -> to moves the event lifecycle allows
/// (docs/ConnectSphere_Status_Lifecycle.drawio). Who may make each move is
/// STATUS_TRANSITION_ROLES in permissions.ts. A terminal status has no entry,
/// so nothing moves out of it.
const EVENT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  // SPM-37 (AC1): cancelled at any stage that has an assigned coordinator
  // (#68; confirmed 2026-10-22), so from Under review too.
  under_review: ["approved", "rejected", "withdrawn", "cancelled"],
  approved: ["planning", "cancelled"],
  planning: ["confirmed", "postponed", "cancelled", "safety_review"],
  // SPM-86: the Safety Officer's decision (SPM-87) or a significant change
  // (SPM-88) returns the event to Planning. Otherwise it can only be
  // cancelled - not postponed, nor confirmed until approved and back in
  // Planning (decided 2026-10-09).
  // SPM-87: approving moves it on to Safety approved (AC7).
  safety_review: ["planning", "cancelled", "safety_cleared"],
  // SPM-87: the Coordinator confirms a safety-approved event; a significant
  // change returns it to Planning (SPM-88); it can still be cancelled.
  safety_cleared: ["confirmed", "planning", "cancelled"],
  confirmed: ["completed", "postponed", "cancelled"],
  // Resuming goes back through Approved, so Planning is only ever entered
  // from Approved.
  postponed: ["approved", "cancelled"],
};

export function canTransition(from: string, to: string): boolean {
  return EVENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionError(from: string, to: string): string {
  return `This event is ${statusLabel(from)} and can't be moved to ${statusLabel(to)}.`;
}
