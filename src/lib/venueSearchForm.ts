// The S-14 venue search form (SPM-40): its values, how an event fills them
// in, and how they become the query string of GET /api/venues/search.
//
// Pure, like eventForm.ts and venueForm.ts, so "what does searching for this
// event pre-fill?" is testable without rendering the page.

import { toWallClock } from "@/lib/venueSearch";

export interface SearchFormValues {
  /// Singapore wall-clock "YYYY-MM-DDTHH:MM", as a datetime-local input holds it.
  from: string;
  to: string;
  attendance: string;
  /// "" = any building.
  building: string;
  /// "" = any layout.
  layout: string;
  /// Facility and accessibility ids together; the page shows them as two groups.
  facilityIds: string[];
}

export const EMPTY_SEARCH: SearchFormValues = {
  from: "",
  to: "",
  attendance: "",
  building: "",
  layout: "",
  facilityIds: [],
};

/// The shape of GET /api/events/[id] that pre-filling reads.
export interface SearchableEvent {
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  facilityRequirements: { facilityId: string; isMandatory: boolean }[];
  sessions?: {
    id: string;
    startsAt: string;
    endsAt: string;
    expectedAttendance: number | null;
    preferredLayout: string | null;
  }[];
}

/// "Search and filter venues USING EVENT REQUIREMENTS" - the story's own words.
/// Opening S-14 for an event fills the form from it:
///   - date and time, attendance and layout from the event, or from one of its
///     sessions when `sessionId` is given - sessions may differ in all three
///     (#74), and a multi-session event's own start/end span every session,
///     which no single booking would cover;
///   - facilities and accessibility from its MANDATORY requirements only. A
///     nice-to-have must not disqualify a venue (EventFacilityRequirement.
///     isMandatory), and AC7 would hide every venue lacking it.
/// Location is left as "any": an event has no location requirement to copy.
/// Everything stays editable - a pre-fill is a starting point, not a lock.
export function searchFromEvent(event: SearchableEvent, sessionId?: string): SearchFormValues {
  const session = sessionId ? event.sessions?.find((s) => s.id === sessionId) : undefined;
  const startsAt = session?.startsAt ?? event.startsAt;
  const endsAt = session?.endsAt ?? event.endsAt;
  // A session with no headcount or layout of its own inherits the event's.
  const attendance = session?.expectedAttendance ?? event.expectedAttendance;
  const layout = session?.preferredLayout ?? event.preferredLayout;

  return {
    from: startsAt ? toWallClock(new Date(startsAt)) : "",
    to: endsAt ? toWallClock(new Date(endsAt)) : "",
    attendance: attendance != null ? String(attendance) : "",
    building: "",
    layout: layout ?? "",
    facilityIds: event.facilityRequirements.filter((r) => r.isMandatory).map((r) => r.facilityId),
  };
}

/// The form -> "from=...&to=...&attendance=..." for GET /api/venues/search.
/// Unset filters are left out entirely, so the URL says only what was asked.
export function searchQuery(values: SearchFormValues, eventReference?: string): string {
  const params = new URLSearchParams();
  if (values.from && values.to) {
    params.set("from", values.from);
    params.set("to", values.to);
  }
  if (values.attendance.trim()) params.set("attendance", values.attendance.trim());
  if (values.building) params.set("building", values.building);
  if (values.layout) params.set("layout", values.layout);
  if (values.facilityIds.length) params.set("facilityIds", values.facilityIds.join(","));
  if (eventReference) params.set("event", eventReference);
  return params.toString();
}

/// Checked before searching, so an obviously incomplete request never leaves
/// the page. The server re-checks all of it (venueSearchQuerySchema).
export function searchFormErrors(values: SearchFormValues): Partial<Record<"to" | "attendance", string>> {
  const errors: Partial<Record<"to" | "attendance", string>> = {};
  if (Boolean(values.from) !== Boolean(values.to)) {
    errors.to = "Give both a start and an end, or clear both.";
  } else if (values.from && values.to && values.to <= values.from) {
    errors.to = "The end must be after the start.";
  }
  const attendance = values.attendance.trim();
  if (attendance && !(Number.isInteger(Number(attendance)) && Number(attendance) > 0)) {
    errors.attendance = "Enter a whole number of people, 1 or more.";
  }
  return errors;
}

/// Should opening S-14 for this event move it from Approved to Planning?
///
/// The status lifecycle diagram labels Approved -> Planning "search", the BPMN
/// puts "Search venues & check suitability" straight after approval, and the
/// seed's history reason for Planning is "Venue search started" - so the team
/// has already decided that starting the venue search is what begins planning.
/// Only the ASSIGNED coordinator may make that move (STATUS_TRANSITION_ROLES,
/// canSetEventStatus), and only from Approved: the status route does not check
/// the from-status, so this guard is what stops a Confirmed event being pulled
/// back to Planning just because someone searched for it again.
export function shouldStartPlanning(
  event: { status: string; coordinatorId: string | null },
  user: { id: string; role: string }
): boolean {
  return event.status === "approved" && user.role === "coordinator" && event.coordinatorId === user.id;
}

/// The status history reason - the seed's own wording for this move.
export const START_PLANNING_REASON = "Venue search started";
