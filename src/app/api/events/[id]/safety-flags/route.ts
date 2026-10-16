import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canFlagForSafetyReview, canViewEvent } from "@/lib/permissions";
import { addReviewReasons } from "@/lib/reviewFlags";
import {
  FLAGGABLE_BOOKING_STATUSES,
  SAFETY_FLAG_FORBIDDEN_MESSAGE,
  SAFETY_FLAG_NONE_MESSAGE,
  SAFETY_FLAG_NOT_RETURNED_MESSAGE,
  SAFETY_FLAG_STALE_MESSAGE,
  SAFETY_RETURNED_REASON,
  UNFLAGGABLE_EQUIPMENT_STATUS,
  canFlagAfterReturn,
  safetyFlagsSchema,
} from "@/lib/safetyResolution";

/**
 * SPM-88 (AC3) - after the Safety Officer requests changes or rejects the
 * safety arrangement, the assigned coordinator flags the arrangements it
 * concerns for review.
 *
 *   POST /api/events/EVT-000123/safety-flags
 *   { venueBookingIds?: string[], equipmentRequestIds?: string[] }
 *
 * Flagged, never changed: each gets the review flag with the reason
 * "safety_check_returned", beside any it already had. The flags block
 * resubmission (SPM-86 AC2) until cleared in Review Flagged Arrangements
 * (SPM-68).
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canFlagForSafetyReview(actor, event)) {
      return forbidden(SAFETY_FLAG_FORBIDDEN_MESSAGE);
    }

    const { venueBookingIds, equipmentRequestIds } = safetyFlagsSchema.parse(await req.json());
    if (venueBookingIds.length + equipmentRequestIds.length === 0) {
      return NextResponse.json({ error: SAFETY_FLAG_NONE_MESSAGE }, { status: 400 });
    }

    const check = await prisma.safetyCheck.findFirst({
      where: { eventId: event.id },
      orderBy: { submittedAt: "desc" },
      select: { status: true },
    });
    if (!canFlagAfterReturn(event.status, check?.status)) {
      return NextResponse.json({ error: SAFETY_FLAG_NOT_RETURNED_MESSAGE }, { status: 400 });
    }

    const [bookings, equipment] = await Promise.all([
      venueBookingIds.length === 0
        ? []
        : prisma.venueBooking.findMany({
            where: { id: { in: venueBookingIds }, eventId: event.id, status: { in: FLAGGABLE_BOOKING_STATUSES } },
            select: { id: true, reviewReason: true },
          }),
      equipmentRequestIds.length === 0
        ? []
        : prisma.equipmentRequest.findMany({
            where: { id: { in: equipmentRequestIds }, eventId: event.id, status: { not: UNFLAGGABLE_EQUIPMENT_STATUS } },
            select: { id: true, reviewReason: true },
          }),
    ]);
    if (bookings.length !== new Set(venueBookingIds).size || equipment.length !== new Set(equipmentRequestIds).size) {
      return NextResponse.json({ error: SAFETY_FLAG_STALE_MESSAGE }, { status: 400 });
    }

    const now = new Date();
    const flag = (reviewReason: string | null) => ({
      needsReview: true,
      reviewReason: addReviewReasons(reviewReason, [SAFETY_RETURNED_REASON]),
      flaggedAt: now,
    });
    await prisma.$transaction(async (tx) => {
      for (const row of bookings) {
        await tx.venueBooking.update({ where: { id: row.id }, data: flag(row.reviewReason) });
      }
      for (const row of equipment) {
        await tx.equipmentRequest.update({ where: { id: row.id }, data: flag(row.reviewReason) });
      }
    });

    return NextResponse.json({ flagged: bookings.length + equipment.length });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
