// Update Event Information (SPM-62): which changes to an event's information
// are important, and which existing arrangements they put at risk.
//
// Acceptance criteria this exists for:
//   - "Important information such as date, time, attendance, venue and
//     equipment requirements is identified as affecting existing arrangements."
//   - "... the affected arrangements are identified and flagged for review
//     rather than automatically changed."
//   - "Given the event is Confirmed and the change affects its essential
//     arrangements ... the event status reverts (e.g. to Planning)."
//
// PURE functions over plain data, like src/lib/venueImpact.ts: the rules are
// the part worth testing, without a database. The information route
// (src/app/api/events/[id]/information/route.ts) loads the rows, calls these,
// and writes the flags; the edit page calls importantChanges() for its live
// warning. Process Event Change Request (SPM-32), Request Event Change
// (SPM-35) and Resolve Safety Check Outcome (SPM-88) apply the same rule, so
// "important" means one thing everywhere.
//
// Nothing here changes an arrangement. The coordinator keeps or replaces each
// flagged one in Review Flagged Arrangements (SPM-68).

export const IMPORTANT_CHANGES = ["schedule", "attendance", "venue_requirements", "equipment"] as const;
export type ImportantChange = (typeof IMPORTANT_CHANGES)[number];

/// The form's amber warning and the status history name changes this way.
export const CHANGE_LABELS: Record<ImportantChange, string> = {
  schedule: "Date and time",
  attendance: "Expected attendance",
  venue_requirements: "Venue requirements",
  equipment: "Equipment requirements",
};

/// The parts of an event an importance decision depends on. Declared
/// structurally so the page (strings from a form) and the route (Prisma rows)
/// can both build one.
export interface EventInfo {
  startsAt: Date | null;
  endsAt: Date | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  /// Required facilities and accessibility needs together - both are what the
  /// venue must have (EventFacilityRequirement).
  facilityIds: readonly string[];
}

const sameMoment = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/// What changed between two states of the event, in IMPORTANT_CHANGES order.
/// A snapshot comparison, so a value changed and changed back is no change.
/// Never "equipment": that comes from the Equipment tab, not from this info.
export function importantChanges(before: EventInfo, after: EventInfo): ImportantChange[] {
  const changes: ImportantChange[] = [];
  if (!sameMoment(before.startsAt, after.startsAt) || !sameMoment(before.endsAt, after.endsAt)) {
    changes.push("schedule");
  }
  if ((before.expectedAttendance ?? null) !== (after.expectedAttendance ?? null)) {
    changes.push("attendance");
  }
  if (
    (before.preferredLayout ?? null) !== (after.preferredLayout ?? null) ||
    !sameSet(before.facilityIds, after.facilityIds)
  ) {
    changes.push("venue_requirements");
  }
  return changes;
}

// ---------------------------------------------------------------------------
// WHAT A CHANGE FLAGS
// ---------------------------------------------------------------------------

/// Why an arrangement was flagged by a change to its event. Stored alongside
/// SPM-39's venue codes (src/lib/venueImpact.ts) in the same reviewReason
/// columns, comma-separated.
export const CHANGE_REASONS = ["event_schedule_changed", "event_attendance_changed", "event_requirements_changed"] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];

export const CHANGE_REASON_PROSE: Record<ChangeReason, string> = {
  event_schedule_changed: "the date or time changed",
  event_attendance_changed: "the expected attendance changed",
  event_requirements_changed: "the venue requirements changed",
};

const REASON_FOR: Partial<Record<ImportantChange, ChangeReason>> = {
  schedule: "event_schedule_changed",
  attendance: "event_attendance_changed",
  venue_requirements: "event_requirements_changed",
};

/// Which kind of arrangement each change puts at risk. A booking was chosen
/// for the date, the headcount and the room's requirements; equipment and
/// registrations only for the date.
const AFFECTS = {
  venueBookings: ["schedule", "attendance", "venue_requirements"],
  equipmentRequests: ["schedule"],
  registrations: ["schedule"],
} as const satisfies Record<string, readonly ImportantChange[]>;

/// Pending or approved, and not over: a rejected or cancelled booking holds
/// nothing, and one that has finished cannot be affected.
const BOOKING_STATUSES = ["pending", "approved"];
/// Everything still in Technical Support's hands or already reserved.
const EQUIPMENT_STATUSES = ["requested", "under_review", "reserved", "partially_fulfilled"];

interface Arrangement {
  id: string;
  status: string;
  endsAt: Date;
}

export interface Arrangements {
  venueBookings: readonly Arrangement[];
  equipmentRequests: readonly Arrangement[];
  /// Attendees registered or on the waiting list.
  registrationCount: number;
}

export interface FlaggedArrangement {
  id: string;
  reasons: ChangeReason[];
}

export interface AffectedArrangements {
  venueBookings: FlaggedArrangement[];
  equipmentRequests: FlaggedArrangement[];
  registrations: { reasons: ChangeReason[] } | null;
}

function reasonsFor(changes: readonly ImportantChange[], applies: readonly ImportantChange[]): ChangeReason[] {
  const reasons = changes
    .filter((change) => applies.includes(change))
    .map((change) => REASON_FOR[change])
    .filter((reason): reason is ChangeReason => reason !== undefined);
  return CHANGE_REASONS.filter((reason) => reasons.includes(reason));
}

/// The arrangements this change flags, each with the reasons THIS change
/// adds. Merging them into reasons already stored is mergeReviewReason().
export function affectedArrangements(
  changes: readonly ImportantChange[],
  arrangements: Arrangements,
  now: Date
): AffectedArrangements {
  const live = (row: Arrangement, statuses: string[]) =>
    statuses.includes(row.status) && row.endsAt.getTime() > now.getTime();

  const flag = (rows: readonly Arrangement[], statuses: string[], applies: readonly ImportantChange[]) => {
    const reasons = reasonsFor(changes, applies);
    if (reasons.length === 0) return [];
    return rows.filter((row) => live(row, statuses)).map((row) => ({ id: row.id, reasons }));
  };

  const registrationReasons = reasonsFor(changes, AFFECTS.registrations);
  return {
    venueBookings: flag(arrangements.venueBookings, BOOKING_STATUSES, AFFECTS.venueBookings),
    equipmentRequests: flag(arrangements.equipmentRequests, EQUIPMENT_STATUSES, AFFECTS.equipmentRequests),
    registrations:
      registrationReasons.length > 0 && arrangements.registrationCount > 0 ? { reasons: registrationReasons } : null,
  };
}

/// A Confirmed event goes back to Planning when the change flags what
/// confirmation depends on - its venue or its equipment (SPM-34). Not for
/// registrations alone.
export function revertsConfirmation(status: string, affected: AffectedArrangements): boolean {
  return (
    status === "confirmed" && (affected.venueBookings.length > 0 || affected.equipmentRequests.length > 0)
  );
}

// ---------------------------------------------------------------------------
// STORING AND WORDING
// ---------------------------------------------------------------------------

/// The stored reasons plus the new ones, each once. Unlike venueImpact's
/// parseReviewReason(), codes this module does not know are KEPT: the column
/// is shared with SPM-39 (and later SPM-45, SPM-55, SPM-80), and dropping
/// their reasons would lose why the arrangement was flagged.
export function mergeReviewReason(existing: string | null | undefined, added: readonly string[]): string {
  const codes = (existing ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
  for (const code of added) {
    if (!codes.includes(code)) codes.push(code);
  }
  return codes.join(",");
}

/// "the expected attendance changed; the venue requirements changed"
export function reviewLine(reasons: readonly ChangeReason[]): string {
  return CHANGE_REASONS.filter((reason) => reasons.includes(reason))
    .map((reason) => CHANGE_REASON_PROSE[reason])
    .join("; ");
}

/// The status history entry when a Confirmed event goes back to Planning:
/// "Event information changed: Date and time, Expected attendance".
export function historyReason(changes: readonly ImportantChange[]): string {
  return `Event information changed: ${changes.map((change) => CHANGE_LABELS[change]).join(", ")}`;
}

export const attendeeCount = (count: number) => `${count} ${count === 1 ? "attendee" : "attendees"}`;
