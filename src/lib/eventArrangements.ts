// Track Outstanding Arrangements (SPM-33): the one place that reads an event's
// arrangements from the database, for the two things that judge them - the
// Readiness tab (GET /api/events/[id]/arrangements) and Confirm
// (PATCH /api/events/[id]). The rules are in src/lib/eventConfirmation.ts and
// stay pure; this file only gathers what they read, so the list a Coordinator
// is shown and the refusal they get on confirming always come from the same
// rows.
//
// When an arrangement is added, load its data here and add it to
// ConfirmationInput - both callers get it.

import { prisma } from "./prisma";
import type { ConfirmationInput } from "./eventConfirmation";

const BY = { select: { fullName: true } } as const;

/// The parts of the event row itself that count as an arrangement: its
/// registration settings (SPM-64). The name of whoever marked the setup as not
/// required is optional - Confirm does not load it, the Readiness tab does.
export interface EventArrangementFields {
  id: string;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /// SPM-64: the booking the registration capacity is measured against.
  registrationVenueBookingId?: string | null;
  registrationNotRequired?: boolean;
  registrationNotRequiredAt?: Date | null;
  registrationNotRequiredByUser?: { fullName: string } | null;
}

export async function loadConfirmationInput(event: EventArrangementFields): Promise<ConfirmationInput> {
  const [sessions, bookings, equipment, safetyCheck] = await Promise.all([
    prisma.eventSession.findMany({
      where: { eventId: event.id },
      orderBy: { startsAt: "asc" },
      select: { id: true, label: true },
    }),
    prisma.venueBooking.findMany({
      where: { eventId: event.id },
      // Oldest first: the order the coordinator asked for the rooms in.
      orderBy: { requestedAt: "asc" },
      select: {
        id: true,
        sessionId: true,
        status: true,
        needsReview: true,
        reviewReason: true,
        notRequired: true,
        notRequiredAt: true,
        notRequiredByUser: BY,
        // SPM-90: what the space is for.
        purpose: true,
        // SPM-82 (AC10): when an expired hold ran out, for its outstanding row.
        holdExpiresAt: true,
        venue: { select: { name: true } },
      },
    }),
    prisma.equipmentRequest.findMany({
      where: { eventId: event.id },
      orderBy: { requestedAt: "asc" },
      select: {
        id: true,
        sessionId: true,
        status: true,
        needsReview: true,
        reviewReason: true,
        notRequired: true,
        notRequiredAt: true,
        notRequiredByUser: BY,
        equipment: { select: { name: true } },
      },
    }),
    // SPM-33 AC6: the latest Operational Safety Check (SPM-86). Earlier ones
    // are history; only the latest says where the event stands.
    prisma.safetyCheck.findFirst({
      where: { eventId: event.id },
      orderBy: { submittedAt: "desc" },
      select: { id: true, status: true, submittedAt: true, submitter: BY },
    }),
  ]);

  return {
    sessions,
    bookings: bookings.map((b) => ({
      id: b.id,
      sessionId: b.sessionId,
      status: b.status,
      venueName: b.venue.name,
      purpose: b.purpose,
      // SPM-82 (AC10): an expired hold's row says when it ran out.
      holdExpiresAt: b.holdExpiresAt,
      needsReview: b.needsReview,
      reviewReason: b.reviewReason,
      notRequired: b.notRequired,
      notRequiredBy: b.notRequiredByUser?.fullName ?? null,
      notRequiredAt: b.notRequiredAt,
    })),
    equipment: equipment.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      status: r.status,
      equipmentName: r.equipment.name,
      needsReview: r.needsReview,
      reviewReason: r.reviewReason,
      notRequired: r.notRequired,
      notRequiredBy: r.notRequiredByUser?.fullName ?? null,
      notRequiredAt: r.notRequiredAt,
    })),
    registration: {
      enabled: event.registrationEnabled,
      capacity: event.registrationCapacity,
      opensAt: event.registrationOpensAt,
      closesAt: event.registrationClosesAt,
      measuredBookingId: event.registrationVenueBookingId ?? null,
      notRequired: event.registrationNotRequired ?? false,
      notRequiredBy: event.registrationNotRequiredByUser?.fullName ?? null,
      notRequiredAt: event.registrationNotRequiredAt ?? null,
    },
    safetyCheck: safetyCheck
      ? {
          id: safetyCheck.id,
          status: safetyCheck.status,
          submittedBy: safetyCheck.submitter?.fullName ?? null,
          submittedAt: safetyCheck.submittedAt,
        }
      : null,
  };
}
