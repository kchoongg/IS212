// Database half of SPM-45 (Record Venue Unavailability), shared by the two
// route files under src/app/api/venues/[id]/unavailability. The rules it
// applies live in src/lib/venueUnavailability.ts and src/lib/venueImpact.ts.

import type { Prisma } from "@prisma/client";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { notifyUser } from "@/lib/notifications";
import {
  formatReviewReason,
  impactSentence,
  mergeReasons,
  parseReviewReason,
  reviewCandidateWhere,
  type ImpactReason,
} from "@/lib/venueImpact";
import type { VenueUnavailabilityInput } from "@/lib/validation";
import {
  bookingInPeriod,
  describePeriod,
  periodBounds,
  periodInterval,
  unavailabilityReasonLabel,
  type PeriodBounds,
} from "@/lib/venueUnavailability";
import type { Interval } from "@/lib/venueSlots";

const REASON: ImpactReason = "venue_unavailable";

/// The venue fields the unavailability routes need.
export const PERIOD_VENUE_SELECT = {
  id: true,
  code: true,
  name: true,
  setupMinutes: true,
  teardownMinutes: true,
} as const;

interface PeriodVenue {
  id: string;
  code: string;
  name: string;
  setupMinutes: number;
  teardownMinutes: number;
}

/// A period as the screens receive it: days and slots, never raw timestamps.
/// `otherReason` is the row's notes - the description of an "other" reason.
export function periodJson(row: { id: string; startsAt: Date; endsAt: Date; reason: string; notes: string | null }) {
  return { id: row.id, ...periodBounds(row), reason: row.reason, otherReason: row.notes ?? null };
}

/// What to write for a validated request: the interval, the reason, and the
/// description only when the reason is "other".
export function periodColumns(input: VenueUnavailabilityInput) {
  return {
    ...periodInterval(input),
    reason: input.reason,
    notes: input.reason === "other" ? (input.otherReason ?? null) : null,
  };
}

/**
 * Flag the venue's bookings that `period` covers, and notify each one's
 * coordinator - AC3: "it is flagged and the Coordinator notified as for a
 * retired venue; bookings outside the period are not flagged."
 *
 * Same candidates and same writes as retiring a venue (SPM-39): only approved
 * bookings that have not finished, the review flag and one notification each,
 * and never a change to the booking's venue, layout, times or status (#120,
 * #122; Week 7 Change #2: "the existing event itself should not automatically
 * be cancelled").
 *
 * `previous` is the period as it stood before a change. A booking it already
 * covered was flagged then, so only newly covered bookings are flagged now.
 * Nothing is ever un-flagged here: clearing a flag is the Coordinator's
 * decision (SPM-68).
 */
export async function flagBookingsInPeriod(
  tx: Prisma.TransactionClient,
  venue: PeriodVenue,
  period: Interval & { reason: string; notes: string | null },
  bounds: PeriodBounds,
  now: Date,
  previous?: Interval
) {
  const candidates = await tx.venueBooking.findMany({
    where: { venueId: venue.id, ...reviewCandidateWhere(now) },
    include: {
      session: { select: { label: true } },
      event: { select: { id: true, title: true, coordinatorId: true } },
    },
  });

  const venueLabel = formatVenue(venue.name, venue.code);
  const why =
    unavailabilityReasonLabel(period.reason) + (period.notes ? ` - ${period.notes}` : "");
  const flaggedBookings = [];

  for (const booking of candidates) {
    if (!bookingInPeriod(booking, venue, period)) continue;
    if (previous && bookingInPeriod(booking, venue, previous)) continue;

    // Keep whatever an earlier venue change flagged; this adds to it.
    const existing = booking.needsReview ? parseReviewReason(booking.reviewReason) : [];
    await tx.venueBooking.update({
      where: { id: booking.id },
      data: {
        needsReview: true,
        reviewReason: formatReviewReason(mergeReasons(existing, [REASON])),
        flaggedAt: now,
      },
    });

    // The assigned Coordinator, or the requester while the event has none -
    // the same fallback PATCH /api/venues/[id] uses.
    const recipientId = booking.event.coordinatorId ?? booking.requestedBy;
    await notifyUser(tx, recipientId, {
      type: "booking_venue_unavailable",
      title: "Venue unavailable - booking needs review",
      body:
        `${venueLabel}: ${impactSentence([REASON])}. ${describePeriod(bounds)} ` +
        `The approved booking for ${booking.event.title ?? "an event"}` +
        `${booking.session?.label ? ` (${booking.session.label})` : ""} on ` +
        `${formatDateTimeRange(booking.startsAt, booking.endsAt)} is flagged for review - ` +
        `nothing has been changed automatically. Reason given: ${why}`,
      eventId: booking.eventId,
    });

    flaggedBookings.push({
      bookingId: booking.id,
      eventId: booking.eventId,
      eventTitle: booking.event.title,
      sessionId: booking.sessionId,
      sessionLabel: booking.session?.label ?? null,
      reasons: [REASON],
      notifiedUserId: recipientId,
    });
  }

  return flaggedBookings;
}
