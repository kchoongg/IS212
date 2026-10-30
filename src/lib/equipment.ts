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

import type { NotificationContent } from "@/lib/notifications";

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

/// The rules for recording units out of service, kept out of the route so they
/// can be tested. `null` means the request is fine.
///  * you cannot have more units out of service than the item has in total
///    (the create route enforces the same rule)
export function checkOutOfService(totalQuantity: number, quantityOutOfService: number): string | null {
  if (quantityOutOfService > totalQuantity) {
    return `Only ${totalQuantity} unit${totalQuantity === 1 ? "" : "s"} in total - cannot mark ${quantityOutOfService} as out of service`;
  }
  return null;
}

/// The reason only makes sense while some units are out of service: recording
/// "0 out of service" clears it, so a stale reason never outlives the problem.
export function outOfServiceReasonFor(quantityOutOfService: number, reason: string | undefined): string | null {
  if (quantityOutOfService === 0) return null;
  return reason && reason.length > 0 ? reason : null;
}

/// SPM-53 (AC10): what Technical Support Staff are told when the assigned
/// Coordinator adds, removes or changes the quantity of an equipment
/// requirement. One wording for the routes that make those changes.
export function equipmentChangeNotification(input: {
  eventId: string;
  eventTitle: string | null;
  equipmentName: string;
  change: { kind: "added"; quantity: number } | { kind: "removed" } | { kind: "quantity"; from: number; to: number };
}): NotificationContent {
  const { change, equipmentName: item } = input;
  const event = `"${input.eventTitle ?? "Untitled event"}"`;
  const body =
    change.kind === "added"
      ? `${item} × ${change.quantity} was added to ${event}.`
      : change.kind === "removed"
        ? `${item} was removed from ${event}.`
        : `${item} on ${event} changed from ${change.from} to ${change.to}.`;
  return { type: "equipment_requirement_changed", title: "Equipment requirement changed", body, eventId: input.eventId };
}
