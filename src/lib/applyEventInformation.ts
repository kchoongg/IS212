// Update Event Information (SPM-62): applying a change to an event's
// information, and everything that follows from it - flagging the
// arrangements it puts at risk, and moving a Confirmed event back to Planning.
//
// Process Event Change Request (SPM-32) applies an approved change "with the
// same rules as a direct edit by the Coordinator", so the rules live here and
// in src/lib/eventChangeImpact.ts, not in the route. Like beginPlanning.ts this
// needs a Prisma transaction, so it is not one of the pure src/lib modules;
// the decisions themselves are eventChangeImpact's, and tested there.
//
// No notifications: telling the organiser and attendees is Receive Event
// Notifications (SPM-53).

import type { Prisma } from "@prisma/client";
import {
  affectedArrangements,
  attendeeCount,
  historyReason,
  importantChanges,
  mergeReviewReason,
  reviewLine,
  revertsConfirmation,
  type EventInfo,
  type ImportantChange,
} from "@/lib/eventChangeImpact";
import type { UpdateEventInformationInput } from "@/lib/validation";

/// The event as the caller loaded it: the fields compared and merged here,
/// with its facility requirements.
export interface EventForChange {
  id: string;
  title: string | null;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  registrationReviewReason: string | null;
  facilityRequirements: { facilityId: string }[];
}

export interface AppliedChange {
  event: unknown;
  importantChanges: ImportantChange[];
  statusReverted: boolean;
  /// What THIS change flagged, worded for the person who made it.
  flagged: string[];
}

/// Statuses whose attendees still hold a place.
const HOLDING_A_PLACE = ["registered", "waitlisted"];

export function eventInfoOf(event: EventForChange): EventInfo {
  return {
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    expectedAttendance: event.expectedAttendance,
    preferredLayout: event.preferredLayout,
    facilityIds: event.facilityRequirements.map((r) => r.facilityId),
  };
}

/// The event's information once `data` is applied: what the cross-field
/// rules and the importance comparison are checked against.
export function mergedEventInfo(event: EventForChange, data: UpdateEventInformationInput): EventInfo {
  const before = eventInfoOf(event);
  return {
    startsAt: data.startsAt !== undefined ? new Date(data.startsAt) : before.startsAt,
    endsAt: data.endsAt !== undefined ? new Date(data.endsAt) : before.endsAt,
    expectedAttendance: data.expectedAttendance !== undefined ? data.expectedAttendance : before.expectedAttendance,
    preferredLayout: data.preferredLayout !== undefined ? data.preferredLayout : before.preferredLayout,
    facilityIds: data.facilityIds !== undefined ? data.facilityIds : before.facilityIds,
  };
}

/// Saves the change and flags what it affects, in the caller's transaction.
/// The caller has already checked who may make it, the event's status and
/// the field rules.
export async function applyEventInformation(
  tx: Prisma.TransactionClient,
  event: EventForChange,
  data: UpdateEventInformationInput,
  actorId: string,
  now: Date = new Date()
): Promise<AppliedChange> {
  const changes = importantChanges(eventInfoOf(event), mergedEventInfo(event, data));

  // Only an important change can affect an arrangement, so an ordinary edit
  // reads none of them.
  const [bookings, equipment, registrationCount] =
    changes.length === 0
      ? [[], [], 0]
      : await Promise.all([
          tx.venueBooking.findMany({
            where: { eventId: event.id },
            select: {
              id: true,
              status: true,
              endsAt: true,
              reviewReason: true,
              session: { select: { label: true } },
              venue: { select: { name: true, code: true } },
            },
            orderBy: { startsAt: "asc" },
          }),
          tx.equipmentRequest.findMany({
            where: { eventId: event.id },
            select: {
              id: true,
              status: true,
              endsAt: true,
              quantityRequested: true,
              reviewReason: true,
              equipment: { select: { name: true } },
            },
            orderBy: { requestedAt: "asc" },
          }),
          tx.registration.count({ where: { eventId: event.id, status: { in: HOLDING_A_PLACE } } }),
        ]);

  const affected = affectedArrangements(
    changes,
    { venueBookings: bookings, equipmentRequests: equipment, registrationCount },
    now
  );
  const statusReverted = revertsConfirmation(event.status, affected);

  // A requirement list being replaced is cleared first and rebuilt below, as
  // the draft edit does. Everything the organiser ticked is mandatory.
  if (data.facilityIds !== undefined) {
    await tx.eventFacilityRequirement.deleteMany({ where: { eventId: event.id } });
  }

  const updated = await tx.event.update({
    where: { id: event.id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.startsAt !== undefined ? { startsAt: new Date(data.startsAt) } : {}),
      ...(data.endsAt !== undefined ? { endsAt: new Date(data.endsAt) } : {}),
      ...(data.expectedAttendance !== undefined ? { expectedAttendance: data.expectedAttendance } : {}),
      ...(data.preferredLayout !== undefined ? { preferredLayout: data.preferredLayout } : {}),
      ...(data.accessibilityNotes !== undefined ? { accessibilityNotes: data.accessibilityNotes } : {}),
      ...(data.specialRequirements !== undefined ? { specialRequirements: data.specialRequirements } : {}),
      ...(data.facilityIds?.length
        ? { facilityRequirements: { create: data.facilityIds.map((facilityId) => ({ facilityId, isMandatory: true })) } }
        : {}),
      ...(affected.registrations
        ? { registrationReviewReason: mergeReviewReason(event.registrationReviewReason, affected.registrations.reasons) }
        : {}),
      // Back to Planning so it can be confirmed again (AC6). Not a lifecycle
      // move anyone makes through the status route - see canTransition().
      ...(statusReverted ? { status: "planning", confirmedAt: null } : {}),
    },
  });

  // Flagged, never changed: the booking keeps its times and status, the
  // equipment its status. The coordinator decides in SPM-68.
  for (const { id, reasons } of affected.venueBookings) {
    const row = bookings.find((b) => b.id === id)!;
    await tx.venueBooking.update({
      where: { id },
      data: { needsReview: true, reviewReason: mergeReviewReason(row.reviewReason, reasons), flaggedAt: now },
    });
  }
  for (const { id, reasons } of affected.equipmentRequests) {
    const row = equipment.find((r) => r.id === id)!;
    await tx.equipmentRequest.update({
      where: { id },
      data: { needsReview: true, reviewReason: mergeReviewReason(row.reviewReason, reasons), flaggedAt: now },
    });
  }

  if (statusReverted) {
    await tx.eventStatusHistory.create({
      data: {
        eventId: event.id,
        fromStatus: event.status,
        toStatus: "planning",
        changedBy: actorId,
        reason: historyReason(changes),
      },
    });
  }

  const flagged = [
    ...affected.venueBookings.map(({ id, reasons }) => {
      const { venue, session } = bookings.find((b) => b.id === id)!;
      const room = `${venue.name} (${venue.code})`;
      return `Venue booking: ${session?.label ? `${session.label}: ${room}` : room} – ${reviewLine(reasons)}`;
    }),
    ...affected.equipmentRequests.map(({ id, reasons }) => {
      const { equipment: item, quantityRequested } = equipment.find((r) => r.id === id)!;
      return `Equipment: ${item.name} × ${quantityRequested} – ${reviewLine(reasons)}`;
    }),
    ...(affected.registrations
      ? [`Registrations: ${attendeeCount(registrationCount)} – ${reviewLine(affected.registrations.reasons)}`]
      : []),
  ];

  return { event: updated, importantChanges: changes, statusReverted, flagged };
}
