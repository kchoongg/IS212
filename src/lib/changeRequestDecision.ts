// Process Event Change Request (SPM-32): the rules for deciding an organiser's
// change request (Request Event Change, SPM-35), apart from the route and the
// screen that use them.
//
//   POST /api/events/[id]/change-requests/[requestId]/decision
//
// A change of details is decided item by item - each field it changes, and
// its equipment change - and each rejected item needs a reason (AC3,
// discussion #104). What an approval does to the event is Update Event
// Information's (SPM-62): the route hands approvedPayload() to
// applyEventInformation(), so "important", the flags and the move back to
// Planning are the same as for a direct edit (AC4).

import {
  EQUIPMENT_ITEM,
  FIELD_LABELS,
  type FacilityRef,
  type FieldChange,
  type RequestableField,
  type StoredDecision,
} from "@/lib/eventChangeRequest";
import type { UpdateEventInformationInput } from "@/lib/validation";

/// The equipment change's key among the decisions. Not a field: it is free
/// text, approved or rejected as one item and made on the Equipment tab.
export { EQUIPMENT_ITEM };

export type Outcome = StoredDecision["outcome"];
export type ItemDecision = StoredDecision;
export type Decisions = Record<string, ItemDecision>;

export const PROCESSED_MESSAGE = "Change request processed.";
export const ALREADY_PROCESSED = "This change request has already been processed.";
export const NOT_ASSIGNED = "Only the coordinator assigned to this event can process its change requests.";
export const UNDECIDED = "Approve or reject every change before saving.";
export const REQUEST_REASON_REQUIRED = "Give a reason for rejecting this request.";
export const APPROVE_CANCELLATION = "To approve it, cancel the event: use Cancel event on its Overview.";
export const POSTPONEMENT_NOT_YET =
  "Postponing an event isn't available yet (Postpone Event, SPM-38), so a postponement request can only be rejected for now.";
export const EQUIPMENT_TO_DO = "Update the Equipment tab to match the approved equipment change.";
export const RESCHEDULED = "The event has moved from Postponed to Approved.";
export const RESCHEDULED_HISTORY = "Rescheduled: change request approved";
export const TIMES_REVERSED =
  "With these decisions the event would end before it starts. Decide Starts at and Ends at together.";
export const REGISTRATION_CLOSES_AFTER_START =
  "Registration closes after this start time. Change the registration period first.";

export const closedEventMessage = (statusLabel: string) =>
  `This event is ${statusLabel}, so its changes can no longer be approved.`;
export const reasonRequired = (label: string) => `Give a reason for rejecting ${label}.`;

export function itemLabel(item: string): string {
  return item === EQUIPMENT_ITEM ? "Equipment changes" : (FIELD_LABELS[item as RequestableField] ?? item);
}

/// AC3: what the coordinator decides, in the request's own order.
export function decisionItems(changes: readonly FieldChange[], equipmentChanges: string | null): string[] {
  const items: string[] = changes.map((change) => change.field);
  if (equipmentChanges?.trim()) items.push(EQUIPMENT_ITEM);
  return items;
}

export type DecisionCheck =
  | { ok: true; decisions: Decisions }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/// AC2, AC3: every item decided, nothing that is not part of the request, and
/// a reason for every rejection. Reasons are trimmed; an approval keeps none.
export function checkDecisions(
  items: readonly string[],
  given: Record<string, { outcome: Outcome; reason?: string | null }>
): DecisionCheck {
  const unknown = Object.keys(given).find((key) => !items.includes(key));
  if (unknown) return { ok: false, error: `${itemLabel(unknown)} is not part of this change request.` };
  if (items.some((item) => !given[item])) return { ok: false, error: UNDECIDED };

  const decisions: Decisions = {};
  const fieldErrors: Record<string, string> = {};
  for (const item of items) {
    const { outcome, reason } = given[item];
    const trimmed = reason?.trim() || null;
    if (outcome === "rejected" && !trimmed) fieldErrors[item] = reasonRequired(itemLabel(item));
    decisions[item] = { outcome, reason: outcome === "rejected" ? trimmed : null };
  }
  const first = Object.values(fieldErrors)[0];
  if (first) return { ok: false, error: first, fieldErrors };
  return { ok: true, decisions };
}

/// The request's status once decided.
export function outcomeStatus(decisions: Decisions): "approved" | "rejected" | "partially_approved" {
  const outcomes = Object.values(decisions).map((d) => d.outcome);
  if (outcomes.every((o) => o === "approved")) return "approved";
  if (outcomes.every((o) => o === "rejected")) return "rejected";
  return "partially_approved";
}

/// AC4, AC6: the approved fields as Update Event Information takes them - only
/// those, so a rejected field is never sent and stays as it is. The equipment
/// change is not a field and is never in it.
export function approvedPayload(changes: readonly FieldChange[], decisions: Decisions): UpdateEventInformationInput {
  const payload: Record<string, unknown> = {};
  for (const { field, proposed } of changes) {
    if (decisions[field]?.outcome !== "approved") continue;
    if (field === "facilityIds") payload.facilityIds = ((proposed ?? []) as FacilityRef[]).map((f) => f.id);
    else if (field === "expectedAttendance" || field === "preferredLayout") payload[field] = proposed;
    else if (field === "startsAt" || field === "endsAt") payload[field] = proposed;
    else payload[field] = (proposed as string | null) ?? "";
  }
  return payload as UpdateEventInformationInput;
}

/// AC5: approving a new date for a Postponed event moves it to Approved.
export function reschedules(eventStatus: string, payload: UpdateEventInformationInput): boolean {
  return eventStatus === "postponed" && (payload.startsAt !== undefined || payload.endsAt !== undefined);
}

interface EventTimes {
  startsAt: Date | null;
  endsAt: Date | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
}

/// The approved times against what the event has, as Update Event Information
/// checks a direct edit: the end after the start, and a new start after the
/// registration period (SPM-64's rule). Null when they are fine.
export function checkApprovedTimes(event: EventTimes, payload: UpdateEventInformationInput): string | null {
  const startsAt = payload.startsAt !== undefined ? new Date(payload.startsAt) : event.startsAt;
  const endsAt = payload.endsAt !== undefined ? new Date(payload.endsAt) : event.endsAt;
  if (startsAt && endsAt && endsAt <= startsAt) return TIMES_REVERSED;
  if (payload.startsAt !== undefined && startsAt) {
    const closes = event.registrationClosesAt;
    const opens = event.registrationOpensAt;
    if ((closes && closes > startsAt) || (opens && opens >= startsAt)) return REGISTRATION_CLOSES_AFTER_START;
  }
  return null;
}
