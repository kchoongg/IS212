// SPM-68 - reads what Review Flagged Arrangements needs from the database and
// runs the rules in flaggedArrangements.ts over it. The rules stay pure; this
// file only gathers what they read, for both callers of
// /api/flagged-arrangements: the list (GET) and keeping one (POST) - so what a
// Coordinator is shown and what Keep decides always come from the same rows.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadSingleLineAvailability } from "@/lib/equipmentAvailabilityService";
import {
  assessFlaggedBooking,
  assessFlaggedEquipment,
  type BookingAssessment,
  type EquipmentAssessment,
} from "@/lib/flaggedArrangements";
import { eventReference } from "@/lib/format";

/// Arrangements that still hold, or ask for, something. A rejected, withdrawn
/// or released booking (SPM-67) and a cancelled or refused equipment line have
/// nothing left to review, whatever flag they still carry.
export const REVIEWABLE_BOOKING_STATUSES = ["pending", "approved"];
export const REVIEWABLE_EQUIPMENT_STATUSES = ["requested", "under_review", "reserved", "partially_fulfilled"];

const EVENT_SUMMARY = { id: true, sequenceNumber: true, title: true, status: true, coordinatorId: true } as const;

/// A flagged venue booking with its event's present requirements and
/// everything of the venue the live check reads.
export const FLAGGED_BOOKING_SELECT = {
  id: true,
  status: true,
  notRequired: true,
  needsReview: true,
  reviewReason: true,
  flaggedAt: true,
  startsAt: true,
  endsAt: true,
  layoutName: true,
  session: {
    select: { id: true, label: true, startsAt: true, endsAt: true, expectedAttendance: true, preferredLayout: true },
  },
  event: {
    select: {
      ...EVENT_SUMMARY,
      startsAt: true,
      endsAt: true,
      expectedAttendance: true,
      preferredLayout: true,
      facilityRequirements: {
        select: { facilityId: true, isMandatory: true, facility: { select: { name: true, category: true } } },
      },
    },
  },
  venue: {
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      setupMinutes: true,
      teardownMinutes: true,
      layouts: { select: { layoutName: true, capacity: true } },
      facilities: { select: { facilityId: true } },
      // Only what can stand in a booking's way (SPM-44).
      bookings: {
        where: { status: { in: REVIEWABLE_BOOKING_STATUSES } },
        select: {
          id: true,
          eventId: true,
          status: true,
          startsAt: true,
          endsAt: true,
          sessionId: true,
          event: { select: { sequenceNumber: true, title: true } },
        },
      },
      unavailability: { select: { startsAt: true, endsAt: true, reason: true } },
    },
  },
} satisfies Prisma.VenueBookingSelect;

export type FlaggedBookingRow = Prisma.VenueBookingGetPayload<{ select: typeof FLAGGED_BOOKING_SELECT }>;

export const FLAGGED_EQUIPMENT_SELECT = {
  id: true,
  status: true,
  notRequired: true,
  needsReview: true,
  reviewReason: true,
  flaggedAt: true,
  quantityRequested: true,
  quantityReserved: true,
  session: { select: { id: true, label: true } },
  event: { select: EVENT_SUMMARY },
  equipment: { select: { id: true, name: true } },
} satisfies Prisma.EquipmentRequestSelect;

export type FlaggedEquipmentRow = Prisma.EquipmentRequestGetPayload<{ select: typeof FLAGGED_EQUIPMENT_SELECT }>;

/// How a flagged item names its event. The reference, not the id: it is what
/// the page links to.
export function eventSummary(event: { sequenceNumber: number; title: string | null; status: string }) {
  return { reference: eventReference(event.sequenceNumber), title: event.title, status: event.status };
}

/// AC4: the booking judged against the event as it is now. A session's
/// booking is judged by that session's own time, attendance and layout, as a
/// request for it was (SPM-42); the facilities are always the event's.
export function assessBookingRow(row: FlaggedBookingRow): BookingAssessment {
  const { event, session, venue } = row;
  const schedule = session
    ? { startsAt: session.startsAt, endsAt: session.endsAt }
    : event.startsAt && event.endsAt
      ? { startsAt: event.startsAt, endsAt: event.endsAt }
      : null;

  return assessFlaggedBooking({
    booking: { id: row.id, eventId: event.id, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt },
    schedule,
    holder: session ? "session" : "event",
    needs: {
      expectedAttendance: session ? session.expectedAttendance : event.expectedAttendance,
      preferredLayout: session ? session.preferredLayout : event.preferredLayout,
      requirements: event.facilityRequirements.map((r) => ({
        facilityId: r.facilityId,
        name: r.facility.name,
        category: r.facility.category,
        isMandatory: r.isMandatory,
      })),
    },
    venue: {
      name: venue.name,
      isActive: venue.isActive,
      setupMinutes: venue.setupMinutes,
      teardownMinutes: venue.teardownMinutes,
      layouts: venue.layouts,
      facilityIds: venue.facilities.map((f) => f.facilityId),
      bookings: venue.bookings.map((b) => ({
        id: b.id,
        eventId: b.eventId,
        status: b.status,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        sessionId: b.sessionId,
        // Enough to name the other event in "is already booked for …".
        eventReference: eventReference(b.event.sequenceNumber),
        eventTitle: b.event.title,
      })),
      unavailability: venue.unavailability,
    },
  });
}

/// AC5: the line's availability for the event's present dates - the result
/// Technical Support see (SPM-49), which never counts the line's own units.
export async function assessEquipmentRow(
  row: Pick<FlaggedEquipmentRow, "id" | "status" | "quantityRequested" | "quantityReserved">
): Promise<EquipmentAssessment> {
  const line = await loadSingleLineAvailability(prisma, row.id);
  return assessFlaggedEquipment({
    status: row.status,
    quantityRequested: row.quantityRequested,
    quantityReserved: row.quantityReserved,
    available: line?.result?.available ?? null,
  });
}
