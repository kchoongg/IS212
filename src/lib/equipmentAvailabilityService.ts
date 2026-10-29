// SPM-48 — loads what the availability rules need and runs them for one event.
// The rules are in equipmentAvailability.ts, the per-line assembly in
// equipmentAvailabilityLines.ts; this file only reads the database.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HOLDS_STOCK_WHERE } from "@/lib/equipmentAvailability";
import type { AvailabilityResult } from "@/lib/equipmentAvailability";
import {
  assembleLines,
  type AvailabilityLine,
  type EventAvailability,
  type OtherRequest,
  type RequestedLine,
} from "@/lib/equipmentAvailabilityLines";

/// Either the shared client or one $transaction hands the callback - both
/// expose the same query methods this file uses.
type Db = PrismaClient | Prisma.TransactionClient;

// Bookings that say "this event is going to be at that venue". A rejected or
// cancelled booking does not; an approved one wins over a pending one.
const VENUE_CHOSEN_STATUSES = ["approved", "pending"];

interface BookingRef {
  venueId: string;
  sessionId: string | null;
  status: string;
}

/// The venue for the whole event (session-less booking) or for one session,
/// falling back to the whole-event booking when a session has none of its own.
export function venueFor(bookings: BookingRef[], sessionId: string | null): string | null {
  const usable = bookings.filter((b) => VENUE_CHOSEN_STATUSES.includes(b.status));
  const pick = (id: string | null) =>
    usable.find((b) => b.sessionId === id && b.status === "approved") ??
    usable.find((b) => b.sessionId === id);
  return (sessionId ? pick(sessionId) : undefined)?.venueId ?? pick(null)?.venueId ?? null;
}

/// "Held by" names the session too when a hold belongs to one, so a session
/// held by its own event's other session reads sensibly ("Two-Day Summit ·
/// Day 1"), not as the event blocking itself.
function heldByLabel(eventTitle: string | null, sessionLabel: string | null): string | null {
  if (!sessionLabel) return eventTitle;
  return `${eventTitle ?? "Untitled event"} · ${sessionLabel}`;
}

/// SPM-50: what the Equipment request screen shows beside each line's
/// availability - the Coordinator's requirements (AC1) and Technical
/// Support's own update (AC2-AC4). Not needed by the availability rules, so
/// kept out of assembleLines and added on here.
export interface LineReview {
  technicalRequirements: string | null;
  staffNotes: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  /// SPM-77 (AC3): the alternative Technical Support suggested that is waiting
  /// for the Coordinator's decision, if any.
  pendingSuggestion: PendingSuggestion | null;
}

export interface PendingSuggestion {
  id: string;
  equipmentName: string;
  quantity: number;
  note: string;
  suggestedByName: string;
  suggestedAt: Date;
}

/// The fields of another request that holds stock, as checked against a line.
const OTHER_REQUEST_SELECT = {
  id: true,
  equipmentId: true,
  status: true,
  quantityReserved: true,
  sessionId: true,
  session: { select: { label: true, startsAt: true, endsAt: true } },
  event: {
    select: {
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      venueBookings: { select: { venueId: true, sessionId: true, status: true } },
    },
  },
} satisfies Prisma.EquipmentRequestSelect;

type OtherRequestRow = Prisma.EquipmentRequestGetPayload<{ select: typeof OTHER_REQUEST_SELECT }>;

function toOtherRequest(o: OtherRequestRow): OtherRequest {
  return {
    requestId: o.id,
    equipmentId: o.equipmentId,
    eventTitle: heldByLabel(o.event.title, o.session?.label ?? null),
    requestStatus: o.status,
    quantityReserved: o.quantityReserved,
    eventStatus: o.event.status,
    startsAt: o.session?.startsAt ?? o.event.startsAt,
    endsAt: o.session?.endsAt ?? o.event.endsAt,
    venueId: venueFor(o.event.venueBookings, o.sessionId),
  };
}

export interface ReviewedEventAvailability extends EventAvailability {
  lines: (AvailabilityLine & LineReview)[];
}

/// Availability of every equipment line the event has requested. Each line is
/// checked against every other request that holds the same item - other
/// events', and this event's own other sessions', which compete for the same
/// units - but never against itself.
export async function loadEventAvailability(eventId: string): Promise<ReviewedEventAvailability | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      venueBookings: { select: { venueId: true, sessionId: true, status: true } },
      equipmentRequests: {
        where: { status: { not: "cancelled" } },
        orderBy: { requestedAt: "asc" },
        select: {
          id: true,
          quantityRequested: true,
          quantityReserved: true,
          status: true,
          technicalRequirements: true,
          staffNotes: true,
          reviewedAt: true,
          reviewer: { select: { fullName: true } },
          // SPM-77: at most one is pending (a partial unique index).
          suggestions: {
            where: { status: "pending" },
            take: 1,
            select: {
              id: true,
              quantity: true,
              note: true,
              suggestedAt: true,
              equipment: { select: { name: true } },
              suggester: { select: { fullName: true } },
            },
          },
          sessionId: true,
          session: { select: { label: true, startsAt: true, endsAt: true } },
          equipment: {
            select: {
              id: true,
              name: true,
              totalQuantity: true,
              quantityInMaintenance: true,
              isActive: true,
              locationVenueId: true,
            },
          },
        },
      },
    },
  });
  if (!event) return null;

  const requested: RequestedLine[] = event.equipmentRequests.map((r) => ({
    requestId: r.id,
    quantityRequested: r.quantityRequested,
    requestStatus: r.status,
    quantityReserved: r.quantityReserved,
    equipment: r.equipment,
    sessionId: r.sessionId,
    sessionLabel: r.session?.label ?? null,
    startsAt: r.session?.startsAt ?? event.startsAt,
    endsAt: r.session?.endsAt ?? event.endsAt,
    venueId: venueFor(event.venueBookings, r.sessionId),
  }));

  const equipmentIds = [...new Set(requested.map((l) => l.equipment.id))];
  const otherRows = equipmentIds.length
    ? await prisma.equipmentRequest.findMany({
        where: {
          equipmentId: { in: equipmentIds },
          ...HOLDS_STOCK_WHERE,
        },
        select: OTHER_REQUEST_SELECT,
      })
    : [];

  const others = otherRows.map(toOtherRequest);

  const availability = assembleLines(requested, others);
  const reviews = new Map<string, LineReview>(
    event.equipmentRequests.map((r) => {
      const pending = r.suggestions[0];
      return [
        r.id,
        {
          technicalRequirements: r.technicalRequirements,
          staffNotes: r.staffNotes,
          reviewedByName: r.reviewer?.fullName ?? null,
          reviewedAt: r.reviewedAt,
          pendingSuggestion: pending
            ? {
                id: pending.id,
                equipmentName: pending.equipment.name,
                quantity: pending.quantity,
                note: pending.note,
                suggestedByName: pending.suggester.fullName,
                suggestedAt: pending.suggestedAt,
              }
            : null,
        },
      ];
    })
  );
  return {
    ...availability,
    lines: availability.lines.map((line) => ({ ...line, ...reviews.get(line.requestId)! })),
  };
}

/// SPM-49: one requested line's fresh availability, read with `db` - normally
/// a `$transaction` callback, so the read happens under the row lock the
/// reserve route takes on the equipment item first. Reusing loadEventAvailability
/// here would also load every OTHER line of the event, which the caller does
/// not need and would rather not pay for inside a lock.
export async function loadSingleLineAvailability(db: Db, requestId: string): Promise<AvailabilityLine | null> {
  const request = await db.equipmentRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      quantityRequested: true,
      quantityReserved: true,
      status: true,
      sessionId: true,
      session: { select: { label: true, startsAt: true, endsAt: true } },
      equipment: {
        select: {
          id: true,
          name: true,
          totalQuantity: true,
          quantityInMaintenance: true,
          isActive: true,
          locationVenueId: true,
        },
      },
      event: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          venueBookings: { select: { venueId: true, sessionId: true, status: true } },
        },
      },
    },
  });
  if (!request) return null;

  const line: RequestedLine = {
    requestId: request.id,
    quantityRequested: request.quantityRequested,
    requestStatus: request.status,
    quantityReserved: request.quantityReserved,
    equipment: request.equipment,
    sessionId: request.sessionId,
    sessionLabel: request.session?.label ?? null,
    startsAt: request.session?.startsAt ?? request.event.startsAt,
    endsAt: request.session?.endsAt ?? request.event.endsAt,
    venueId: venueFor(request.event.venueBookings, request.sessionId),
  };

  // Every other hold on this item, including this event's own other sessions -
  // the same rule as loadEventAvailability - but never this request itself, so
  // re-reserving a line does not count its current reservation against it.
  const otherRows = await db.equipmentRequest.findMany({
    where: {
      equipmentId: request.equipment.id,
      id: { not: request.id },
      ...HOLDS_STOCK_WHERE,
    },
    select: OTHER_REQUEST_SELECT,
  });
  const others = otherRows.map(toOtherRequest);

  return assembleLines([line], others).lines[0];
}

/// What loadAlternativeAvailability() needs of the requirement. The callers
/// read the requirement anyway (for the access check, or again inside the
/// suggestion route's transaction), so they select this with it.
export const ALTERNATIVE_REQUEST_SELECT = {
  id: true,
  sessionId: true,
  session: { select: { label: true, startsAt: true, endsAt: true } },
  event: {
    select: {
      startsAt: true,
      endsAt: true,
      venueBookings: { select: { venueId: true, sessionId: true, status: true } },
    },
  },
} satisfies Prisma.EquipmentRequestSelect;

export type AlternativeRequest = Prisma.EquipmentRequestGetPayload<{ select: typeof ALTERNATIVE_REQUEST_SELECT }>;

/// SPM-77 (AC2): whether `quantity` of another item - a suggested alternative
/// - would be free for this requirement's dates, at its venue, by the same
/// rules as the line itself. Read with `db`, so the suggestion route can
/// re-check inside its transaction. `alternative` null when the item is not in
/// the catalogue.
export async function loadAlternativeAvailability(
  db: Db,
  request: AlternativeRequest,
  equipmentId: string,
  quantity: number
): Promise<AlternativeAvailability> {
  const alternative = await db.equipment.findUnique({
    where: { id: equipmentId },
    select: {
      id: true,
      name: true,
      totalQuantity: true,
      quantityInMaintenance: true,
      isActive: true,
      locationVenueId: true,
    },
  });
  if (!alternative) return { alternative: null, result: null };

  // The alternative is not requested by this line, so nothing of it is the
  // line's own: every hold on it counts, this event's other lines included.
  const otherRows = await db.equipmentRequest.findMany({
    where: { equipmentId: alternative.id, ...HOLDS_STOCK_WHERE },
    select: OTHER_REQUEST_SELECT,
  });

  const line: RequestedLine = {
    requestId: request.id,
    quantityRequested: quantity,
    requestStatus: "requested",
    quantityReserved: null,
    equipment: alternative,
    sessionId: request.sessionId,
    sessionLabel: request.session?.label ?? null,
    startsAt: request.session?.startsAt ?? request.event.startsAt,
    endsAt: request.session?.endsAt ?? request.event.endsAt,
    venueId: venueFor(request.event.venueBookings, request.sessionId),
  };
  return {
    alternative: { id: alternative.id, name: alternative.name, isActive: alternative.isActive },
    result: assembleLines([line], otherRows.map(toOtherRequest)).lines[0].result,
  };
}

export interface AlternativeAvailability {
  alternative: { id: string; name: string; isActive: boolean } | null;
  /// NULL when the item is unknown or the event has no dates yet.
  result: AvailabilityResult | null;
}
