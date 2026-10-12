// Record Equipment Unavailability (SPM-55). Technical Support record how many
// of an item's units are out of service (Equipment.quantityInMaintenance,
// SPM-48), which of AC1's three kinds it is, and why. The availability check
// already subtracts those units (checkAvailability()); this file adds what the
// screen shows and which reservations a change leaves short (AC4).
//
// There is no return date: customer #23 says neither an expected return date
// nor automatic pre-booking is specified, so units stay out until Technical
// Support return them (AC5).
//
// Pure functions over plain data, like the rest of src/lib.

import { checkAvailability, type Commitment } from "@/lib/equipmentAvailability";

/// AC1: "unavailable, damaged, or under maintenance".
export const OUT_OF_SERVICE_TYPES = ["unavailable", "damaged", "under_maintenance"] as const;
export type OutOfServiceType = (typeof OUT_OF_SERVICE_TYPES)[number];

const TYPE_LABELS: Record<OutOfServiceType, string> = {
  unavailable: "Unavailable",
  damaged: "Damaged",
  under_maintenance: "Under maintenance",
};

export function outOfServiceTypeLabel(type: string): string {
  return TYPE_LABELS[type as OutOfServiceType] ?? type;
}

/// The review-flag reason code an equipment change stores on a request
/// (EquipmentRequest.reviewReason, shared with SPM-62's codes).
export const EQUIPMENT_UNAVAILABLE_REASON = "equipment_unavailable";
export const EQUIPMENT_REASON_PROSE: Record<string, string> = {
  [EQUIPMENT_UNAVAILABLE_REASON]: "units of the equipment were marked out of service",
};

export type OperationalStatus = "available" | "partly_out_of_service" | "out_of_service";

/// AC6: an item's current operational status, as a status key for <StatusBadge>.
export function operationalStatus(item: { totalQuantity: number; quantityInMaintenance: number }): OperationalStatus {
  if (item.quantityInMaintenance <= 0) return "available";
  return item.quantityInMaintenance >= item.totalQuantity ? "out_of_service" : "partly_out_of_service";
}

/// "Under maintenance - Lamp replacement", "Damaged", or null when nothing is
/// recorded. Units recorded before SPM-55 have no type, so the reason alone.
export function outOfServiceSummary(type: string | null, reason: string | null): string | null {
  const parts = [type ? outOfServiceTypeLabel(type) : null, reason || null].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : null;
}

/// One reservation of the item: a Reserved or Partially fulfilled request of
/// an event that has not ended, with the window it holds the units for.
export interface HeldReservation {
  requestId: string;
  eventTitle: string | null;
  quantityReserved: number;
  startsAt: Date;
  endsAt: Date;
  transferLeadMs: number;
}

/// How many units are available to `r` when `outOfService` units are out,
/// counting every other reservation sharing its days - the same rule as Check
/// Equipment Availability (SPM-48).
function availableTo(
  item: { totalQuantity: number; isActive: boolean },
  outOfService: number,
  r: HeldReservation,
  all: readonly HeldReservation[]
): number {
  const commitments: Commitment[] = all
    .filter((other) => other.requestId !== r.requestId)
    .map((other) => ({
      eventTitle: other.eventTitle ?? "",
      quantity: other.quantityReserved,
      startsAt: other.startsAt,
      endsAt: other.endsAt,
      transferLeadMs: other.transferLeadMs,
    }));
  return checkAvailability({
    totalQuantity: item.totalQuantity,
    quantityInMaintenance: outOfService,
    isActive: item.isActive,
    requested: r.quantityReserved,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    transferLeadMs: r.transferLeadMs,
    commitments,
  }).available;
}

/// AC4: the reservations the units left after this change can no longer cover
/// but could before it, each with how many are now available to it. When
/// several share the same days and cannot all be covered, all are returned -
/// the system does not choose which event loses out (decided 2026-10-11). A
/// reservation already short before the change was flagged then.
export function newlyShortReservations(
  item: { totalQuantity: number; isActive: boolean },
  before: number,
  after: number,
  reservations: readonly HeldReservation[]
): (HeldReservation & { available: number })[] {
  return reservations
    .map((r) => ({
      r,
      was: availableTo(item, before, r, reservations),
      now: availableTo(item, after, r, reservations),
    }))
    .filter(({ r, was, now }) => now < r.quantityReserved && was >= r.quantityReserved)
    .map(({ r, now }) => ({ ...r, available: now }));
}
