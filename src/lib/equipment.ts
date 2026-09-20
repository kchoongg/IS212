// Shared equipment-reservation helpers. See UI_DESIGN.md §S-16 / §6.2.
//
// EquipmentRequest.startsAt / endsAt are NOT NULL and are derived from the
// event's own times — kit leaves the store before doors open and comes back
// after they close. One constant here keeps the organiser's create-event flow
// (S-08, src/app/api/events/route.ts) and the coordinator's own add/update
// flow (S-16, src/app/api/events/[id]/equipment) from drifting apart.
//
// NOTE: checking availability against stock (SPM-48), reserving it (SPM-49),
// and Technical Support's review/update workflow (SPM-50) are separate
// tickets — not built here.

export const EQUIPMENT_LOAD_WINDOW_MS = 2 * 60 * 60 * 1000;

export function equipmentWindowFor(
  eventStartsAt: Date | null,
  eventEndsAt: Date | null
): { startsAt: Date; endsAt: Date } | null {
  if (!eventStartsAt || !eventEndsAt) return null;
  return {
    startsAt: new Date(eventStartsAt.getTime() - EQUIPMENT_LOAD_WINDOW_MS),
    endsAt: new Date(eventEndsAt.getTime() + EQUIPMENT_LOAD_WINDOW_MS),
  };
}
