// Request Event Change (SPM-35): the rules for an organiser's change request,
// apart from the routes and screens that use them.
//
//   POST /api/events/[id]/change-requests      the organiser asks
//   GET  /api/events/[id]/change-requests      the event's requests (Change requests card)
//   GET  /api/change-requests                  the coordinator's pending requests
//
// A request only records what is asked for. Nothing here, and nothing in the
// routes, changes the event or its arrangements (AC5, AC6): deciding a request
// is Process Event Change Request (SPM-32), Postpone Event and Cancel Event.
//
// The fields are Update Event Information's (SPM-62), and "Important" is its
// IMPORTANT_CHANGES (src/lib/eventChangeImpact.ts), so both stories mean the
// same thing by them. The proposed values are stored in the shape SPM-62's
// payload takes, for SPM-32 to apply.

import { CHANGE_LABELS, IMPORTANT_CHANGES, type ImportantChange } from "@/lib/eventChangeImpact";
import { formatDateTime } from "@/lib/format";
import { humanise } from "@/lib/statuses";
import type { UpdateEventInformationInput } from "@/lib/validation";

/// AC1: from approval until the event is over - and while Postponed, unlike
/// Update Event Information, since a postponed event's new date is asked for here.
export const CHANGE_REQUEST_STATUSES = [
  "approved",
  "planning",
  "safety_review",
  "safety_cleared",
  "confirmed",
  "postponed",
] as const;

export function canRequestChangeIn(status: string): boolean {
  return (CHANGE_REQUEST_STATUSES as readonly string[]).includes(status);
}

export const CHANGE_REQUEST_STATUS_MESSAGE =
  "A change can only be requested while the event is Approved, Planning, Safety review, Safety approved, Confirmed or Postponed.";
export const CHANGE_REQUEST_OWNER_MESSAGE = "Only the organiser who owns this event can request a change.";
export const REASON_REQUIRED = "Give a reason for the change.";
export const NOTHING_CHANGED = "Change at least one detail, or describe the equipment change.";
export const SESSIONS_FIXED =
  "Session times and attendance can't be changed here yet - describe the change in Reason for the change.";

export const CHANGE_REQUEST_KINDS = ["change", "postpone", "cancel"] as const;
export type ChangeRequestKind = (typeof CHANGE_REQUEST_KINDS)[number];

export const KIND_LABELS: Record<ChangeRequestKind, string> = {
  change: "Change of details",
  postpone: "Postponement",
  cancel: "Cancellation",
};

/// AC1: every field Update Event Information edits, in its form's order.
export const REQUESTABLE_FIELDS = [
  "title",
  "category",
  "purpose",
  "description",
  "startsAt",
  "endsAt",
  "expectedAttendance",
  "preferredLayout",
  "facilityIds",
  "accessibilityNotes",
  "specialRequirements",
] as const;
export type RequestableField = (typeof REQUESTABLE_FIELDS)[number];

/// The labels of the form the organiser fills in (and of Edit event information).
export const FIELD_LABELS: Record<RequestableField, string> = {
  title: "Event name",
  category: "Type of event",
  purpose: "Purpose",
  description: "Description",
  startsAt: "Starts at",
  endsAt: "Ends at",
  expectedAttendance: "Expected attendance",
  preferredLayout: "Preferred room layout",
  facilityIds: "Facilities and accessibility needs",
  accessibilityNotes: "Other accessibility notes",
  specialRequirements: "Anything else about the space",
};

/// The fields a multi-session event takes from its sessions - not editable in
/// SPM-62 either.
export const SESSION_DERIVED_FIELDS: readonly RequestableField[] = ["startsAt", "endsAt", "expectedAttendance", "preferredLayout"];

export interface FacilityRef {
  id: string;
  name: string;
}
export type FieldValue = string | number | null | FacilityRef[];

/// One entry of EventChangeRequest.changes.
export interface FieldChange {
  field: RequestableField;
  current: FieldValue;
  proposed: FieldValue;
}

/// The event's present values for the requestable fields.
export interface EventSnapshot {
  title: string | null;
  category: string | null;
  purpose: string | null;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  facilities: FacilityRef[];
  accessibilityNotes: string | null;
  specialRequirements: string | null;
}

/// An event row as the routes load it (with its facilities and their names).
export interface EventForSnapshot {
  title: string | null;
  category: string | null;
  purpose: string | null;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  accessibilityNotes: string | null;
  specialRequirements: string | null;
  facilityRequirements: { facilityId: string; facility: { name: string } }[];
}

export function snapshotOf(event: EventForSnapshot): EventSnapshot {
  return {
    title: event.title,
    category: event.category,
    purpose: event.purpose,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    expectedAttendance: event.expectedAttendance,
    preferredLayout: event.preferredLayout,
    facilities: event.facilityRequirements.map((r) => ({ id: r.facilityId, name: r.facility.name })),
    accessibilityNotes: event.accessibilityNotes,
    specialRequirements: event.specialRequirements,
  };
}

/// A blank text is no text.
const text = (value: string | null | undefined) => value?.trim() || null;
const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);
const byName = (a: FacilityRef, b: FacilityRef) => a.name.localeCompare(b.name);

function currentValue(event: EventSnapshot, field: RequestableField): FieldValue {
  if (field === "startsAt" || field === "endsAt") return iso(event[field]);
  if (field === "expectedAttendance") return event.expectedAttendance;
  if (field === "preferredLayout") return event.preferredLayout;
  if (field === "facilityIds") return [...event.facilities].sort(byName);
  return text(event[field]);
}

/// `value` is the proposal's own value for `field`, which it does send.
function proposedValue(
  field: RequestableField,
  value: string | number | null | string[],
  facilityNames: ReadonlyMap<string, string>
): FieldValue {
  if (field === "startsAt" || field === "endsAt") return iso(value as string);
  if (field === "facilityIds") {
    // A name the caller could not find reads as its id rather than vanishing.
    return [...new Set(value as string[])].map((id) => ({ id, name: facilityNames.get(id) ?? id })).sort(byName);
  }
  if (field === "expectedAttendance" || field === "preferredLayout") return value as number | string | null;
  return text(value as string);
}

function same(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const ids = new Set(a.map((f) => f.id));
    return a.length === b.length && b.every((f) => ids.has(f.id));
  }
  return a === b;
}

/// AC1, AC2: the fields the proposal actually changes, each with the value it
/// has now and the value proposed, in REQUESTABLE_FIELDS order. A field sent
/// with the value it already has is not a change. `facilityNames` names the
/// proposed facilities.
export function fieldChanges(
  event: EventSnapshot,
  proposal: UpdateEventInformationInput,
  facilityNames: ReadonlyMap<string, string>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of REQUESTABLE_FIELDS) {
    const value = proposal[field];
    if (value === undefined) continue;
    const current = currentValue(event, field);
    const proposed = proposedValue(field, value, facilityNames);
    if (!same(current, proposed)) changes.push({ field, current, proposed });
  }
  return changes;
}

const IMPORTANT_BECAUSE: Partial<Record<RequestableField, ImportantChange>> = {
  startsAt: "schedule",
  endsAt: "schedule",
  expectedAttendance: "attendance",
  preferredLayout: "venue_requirements",
  facilityIds: "venue_requirements",
};

/// AC4: what makes a request Important - each kind once, in IMPORTANT_CHANGES
/// order. Any equipment text counts: equipment is what is reserved for the event.
export function importantFor(changes: readonly Pick<FieldChange, "field">[], equipmentChanges: string | null): ImportantChange[] {
  const found = new Set<ImportantChange>();
  for (const change of changes) {
    const because = IMPORTANT_BECAUSE[change.field];
    if (because) found.add(because);
  }
  if (text(equipmentChanges)) found.add("equipment");
  return IMPORTANT_CHANGES.filter((change) => found.has(change));
}

/// AC2: a value as the request shows it.
export function showValue(field: RequestableField, value: FieldValue): string {
  if (field === "facilityIds") {
    const facilities = (value ?? []) as FacilityRef[];
    return facilities.length > 0 ? facilities.map((f) => f.name).join(", ") : "None";
  }
  if (field === "preferredLayout" && value == null) return "No preference";
  if (value == null || value === "") return "Not set";
  if (field === "startsAt" || field === "endsAt") return formatDateTime(String(value));
  if (field === "preferredLayout" || field === "category") return humanise(String(value));
  return String(value);
}

/// A row of event_change_requests as the routes load it.
export interface StoredChangeRequest {
  id: string;
  kind: string;
  status: string;
  reason: string;
  requestedAt: Date;
  requester: { fullName: string } | null;
  changes: unknown;
  equipmentChanges: string | null;
  isSignificant: boolean;
  proposedStartsAt: Date | null;
  proposedEndsAt: Date | null;
  proposedAttendance: number | null;
}

export interface DescribedChangeRequest {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  reason: string;
  requestedAt: string;
  requestedBy: string;
  important: boolean;
  /// The labels of what makes it Important ("Date and time", ...).
  affects: string[];
  rows: { field: RequestableField; label: string; current: string; proposed: string }[];
  equipmentChanges: string | null;
}

/// A request made before SPM-35 has only a proposed start, end and attendance;
/// its "current" is the event's value now, the best there is.
function legacyChanges(row: StoredChangeRequest, event: EventSnapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  if (row.proposedStartsAt) changes.push({ field: "startsAt", current: iso(event.startsAt), proposed: iso(row.proposedStartsAt) });
  if (row.proposedEndsAt) changes.push({ field: "endsAt", current: iso(event.endsAt), proposed: iso(row.proposedEndsAt) });
  if (row.proposedAttendance != null) {
    changes.push({ field: "expectedAttendance", current: event.expectedAttendance, proposed: row.proposedAttendance });
  }
  return changes;
}

/// AC2, AC4: a stored request, ready for the Change requests card and the
/// coordinator's Change Requests page.
export function describeChangeRequest(row: StoredChangeRequest, event: EventSnapshot): DescribedChangeRequest {
  const kind = row.kind as ChangeRequestKind;
  const changes: FieldChange[] =
    kind !== "change" ? [] : Array.isArray(row.changes) ? (row.changes as FieldChange[]) : legacyChanges(row, event);
  return {
    id: row.id,
    kind: row.kind,
    kindLabel: KIND_LABELS[kind] ?? humanise(row.kind),
    status: row.status,
    reason: row.reason,
    requestedAt: row.requestedAt.toISOString(),
    requestedBy: row.requester?.fullName ?? "Unknown",
    important: row.isSignificant,
    affects: importantFor(changes, row.equipmentChanges).map((change) => CHANGE_LABELS[change]),
    rows: changes.map((change) => ({
      field: change.field,
      label: FIELD_LABELS[change.field],
      current: showValue(change.field, change.current),
      proposed: showValue(change.field, change.proposed),
    })),
    equipmentChanges: row.equipmentChanges,
  };
}
