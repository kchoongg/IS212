// SPM-69 — Release or Adjust Equipment Reservation. "As Technical Support
// Staff, I want to release or adjust an equipment reservation so that reserved
// quantities match what the event now needs and unneeded equipment is free for
// other events."
//
// The rules for the reservation route (PATCH / DELETE .../reservation) and the
// Equipment request screen, kept here so both use the same ones:
//
//  * Only a line that holds stock can be released or adjusted - reserved,
//    partly fulfilled, or sent back by the Coordinator with units still
//    reserved (AC7, holdsStock() in equipmentAvailability.ts).
//  * Releasing marks the line "released" and keeps quantityReserved as the
//    record of what it held (AC8); availability stops counting it (AC4).
//  * Adjusting never goes above what is free for the event's dates (AC3), nor
//    above what the event requested - Technical Support matches the
//    Coordinator's requirement, it does not add to it (team decision).
//  * The line's status follows the new quantity, as reserving sets it (AC5).

import { holdsStock } from "@/lib/equipmentAvailability";
import type { NotificationContent } from "@/lib/notifications";

export const RESERVATION_NOTIFICATION_TYPES = {
  released: "equipment_reservation_released",
  adjusted: "equipment_reservation_adjusted",
} as const;

/// Why this line cannot be released, or null if it can.
export function checkRelease(status: string, quantityReserved: number | null): string | null {
  return holdsStock(status, quantityReserved) ? null : "Only reserved equipment can be released.";
}

/// The status a line has once `quantity` of what it requested is reserved.
export function adjustedStatus(quantity: number, quantityRequested: number): "reserved" | "partially_fulfilled" {
  return quantity >= quantityRequested ? "reserved" : "partially_fulfilled";
}

export interface AdjustableLine {
  status: string;
  quantityRequested: number;
  quantityReserved: number | null;
}

/// Why this line's reservation cannot become `quantity`, or null if it can.
/// `available` is how many the line itself could hold for its dates (its own
/// reservation not counted against it); null when the event has no dates yet.
export function checkAdjustment(line: AdjustableLine, quantity: number, available: number | null): string | null {
  if (!holdsStock(line.status, line.quantityReserved)) return "Only reserved equipment can be adjusted.";
  if (quantity > line.quantityRequested) {
    return `The event requested ${line.quantityRequested} — a reservation cannot be more than that.`;
  }
  // v8 ignore next -- holdsStock() passed, and a line holding stock always has a quantity reserved
  const current = line.quantityReserved ?? 0;
  if (quantity === current && adjustedStatus(quantity, line.quantityRequested) === line.status) {
    return "That is already the reserved quantity.";
  }
  // Reducing frees units and takes none, so it needs no availability check.
  if (quantity > current) {
    if (available === null) return "Set the event date and time before reserving equipment";
    if (quantity > available) return `Only ${available} available for this event's dates.`;
  }
  return null;
}

export interface RequirementChange {
  quantityRequested?: number;
  technicalRequirements?: string;
}

/// AC7: whether the Coordinator's change sends this line back to Technical
/// Support as Requested - only a line holding stock, and only when the save
/// actually changes something.
export function sendsBackForReview(
  existing: AdjustableLine & { technicalRequirements: string | null },
  change: RequirementChange
): boolean {
  if (!holdsStock(existing.status, existing.quantityReserved)) return false;
  const quantityChanged = change.quantityRequested !== undefined && change.quantityRequested !== existing.quantityRequested;
  const requirementsChanged =
    change.technicalRequirements !== undefined && change.technicalRequirements !== (existing.technicalRequirements ?? "");
  return quantityChanged || requirementsChanged;
}

interface ReservationRef {
  eventId: string;
  eventTitle: string | null;
  equipmentName: string;
}

const titleOf = (title: string | null) => title ?? "Untitled event";

/// AC6: what the assigned Coordinator is told when a reservation is released.
export function releasedNotification(ref: ReservationRef & { quantity: number }): NotificationContent {
  return {
    type: RESERVATION_NOTIFICATION_TYPES.released,
    title: "Equipment reservation released",
    body: `Technical Support released the ${ref.quantity} ${ref.equipmentName} reserved for ${titleOf(ref.eventTitle)}.`,
    eventId: ref.eventId,
  };
}

/// AC6: what the assigned Coordinator is told when a reservation changes.
export function adjustedNotification(ref: ReservationRef & { from: number; to: number }): NotificationContent {
  return {
    type: RESERVATION_NOTIFICATION_TYPES.adjusted,
    title: "Equipment reservation changed",
    body: `Technical Support changed the ${ref.equipmentName} reserved for ${titleOf(ref.eventTitle)} from ${ref.from} to ${ref.to}.`,
    eventId: ref.eventId,
  };
}
