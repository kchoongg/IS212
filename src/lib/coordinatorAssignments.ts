// Event Coordinator Lead: Rename Role and View Assignments (SPM-84, Week 7
// change #5). The Lead is the Event Operations Manager under a new name
// (forum #128, #129): the role key stays `ops_manager`, and SPM-30's
// unassigned queue, assign and reassign become the Lead's by the rename. What
// is new is oversight: every Event Coordinator with the number of active
// events they hold, and every active event with its coordinator, filterable
// by coordinator and status.
//
// Pure, like the rest of src/lib; GET /api/assignments loads the rows.

/// AC1: the refusals name the Lead.
export const LEAD_ONLY_MESSAGE = "Only the Event Coordinator Lead can assign coordinators";
export const LEAD_ONLY_REASON = "Assigning coordinators is the Event Coordinator Lead's role.";

/// AC6: "An active event is one that is not Draft, Rejected, Withdrawn,
/// Cancelled or Completed." In lifecycle order, as the Status filter offers them.
export const ACTIVE_EVENT_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "planning",
  "safety_review",
  "safety_cleared",
  "confirmed",
  "postponed",
];

export function isActiveEvent(status: string): boolean {
  return ACTIVE_EVENT_STATUSES.includes(status);
}

export interface CoordinatorAccount {
  id: string;
  fullName: string;
  isActive: boolean;
}

export interface CoordinatorWorkload extends CoordinatorAccount {
  activeEvents: number;
}

interface CountableEvent {
  status: string;
  coordinator: { id: string } | null;
}

/// AC4, AC10: each coordinator with the number of active events assigned to
/// them, A to Z. One with none is listed with 0. A deactivated account is
/// listed only while it still holds an active event, so those events never
/// drop out of the counts unseen.
export function coordinatorWorkload(
  coordinators: readonly CoordinatorAccount[],
  events: readonly CountableEvent[]
): CoordinatorWorkload[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.coordinator && isActiveEvent(event.status)) {
      counts.set(event.coordinator.id, (counts.get(event.coordinator.id) ?? 0) + 1);
    }
  }
  return coordinators
    .map((c) => ({ id: c.id, fullName: c.fullName, isActive: c.isActive, activeEvents: counts.get(c.id) ?? 0 }))
    .filter((c) => c.isActive || c.activeEvents > 0)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/// "all" for any, "unassigned" for no coordinator, else a coordinator's id.
export interface ActiveEventFilters {
  coordinator: string;
  status: string;
}

/// AC7: by assigned coordinator and by status, together.
export function filterActiveEvents<T extends CountableEvent>(events: readonly T[], filters: ActiveEventFilters): T[] {
  return events.filter((event) => {
    if (filters.status !== "all" && event.status !== filters.status) return false;
    if (filters.coordinator === "all") return true;
    if (filters.coordinator === "unassigned") return event.coordinator === null;
    return event.coordinator?.id === filters.coordinator;
  });
}
