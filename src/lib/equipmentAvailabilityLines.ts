// SPM-48 — turns loaded rows into one availability result per requested
// equipment line, for the Equipment request screen (S-25). Pure: the rows are
// fetched by equipmentAvailabilityService.ts; the rules live in
// equipmentAvailability.ts.

import {
  allLinesAvailable,
  checkAvailability,
  committedQuantity,
  transferLeadFor,
  type AvailabilityResult,
  type Commitment,
} from "@/lib/equipmentAvailability";

/// One requested equipment line of the event being checked.
export interface RequestedLine {
  requestId: string;
  quantityRequested: number;
  /// The equipment request's own status (requested, under_review, reserved ...).
  requestStatus: string;
  /// What Technical Support has committed so far. NULL until reviewed.
  quantityReserved: number | null;
  equipment: {
    id: string;
    name: string;
    totalQuantity: number;
    quantityInMaintenance: number;
    isActive: boolean;
    /// NULL = ConnectSphere storage.
    locationVenueId: string | null;
  };
  /// Set for a multi-session event's session-specific line.
  sessionId: string | null;
  sessionLabel: string | null;
  /// The event's own times, or the session's own times for a session line -
  /// never the widened request window. NULL while the event has no dates.
  startsAt: Date | null;
  endsAt: Date | null;
  /// The venue this event (or session) is booked at. NULL until one is chosen.
  venueId: string | null;
}

/// Another request for some equipment item: another event's, or another
/// session's of the same event (sessions compete for the same units too).
export interface OtherRequest {
  /// Lets a line skip itself when the event's own requests are included.
  requestId?: string;
  equipmentId: string;
  eventTitle: string | null;
  requestStatus: string;
  quantityReserved: number | null;
  eventStatus: string;
  startsAt: Date | null;
  endsAt: Date | null;
  venueId: string | null;
}

export interface AvailabilityLine {
  requestId: string;
  requestStatus: string;
  quantityRequested: number;
  quantityReserved: number | null;
  equipmentId: string;
  equipmentName: string;
  sessionId: string | null;
  sessionLabel: string | null;
  /// False when no venue is chosen yet, so no transfer time was worked out.
  venueChosen: boolean;
  /// Transfer + preparation time applied before the event, in minutes. 0 when
  /// the equipment is already at the venue, or no venue is chosen yet.
  transferMinutes: number;
  /// NULL when the event has no dates yet, so nothing can be checked.
  result: AvailabilityResult | null;
}

export interface EventAvailability {
  lines: AvailabilityLine[];
  /// False if any line is short OR could not be checked - drives the banner
  /// "Not everything requested is available."
  allAvailable: boolean;
}

export function assembleLines(requested: RequestedLine[], others: OtherRequest[]): EventAvailability {
  const lines = requested.map((line): AvailabilityLine => {
    const base = {
      requestId: line.requestId,
      requestStatus: line.requestStatus,
      quantityRequested: line.quantityRequested,
      quantityReserved: line.quantityReserved,
      equipmentId: line.equipment.id,
      equipmentName: line.equipment.name,
      sessionId: line.sessionId,
      sessionLabel: line.sessionLabel,
    };
    if (!line.startsAt || !line.endsAt) {
      return { ...base, venueChosen: line.venueId !== null, transferMinutes: 0, result: null };
    }

    const { leadMs, venueChosen } = transferLeadFor(line.equipment.locationVenueId, line.venueId);

    const commitments: Commitment[] = [];
    for (const other of others) {
      if (other.equipmentId !== line.equipment.id || other.requestId === line.requestId) continue;
      const quantity = committedQuantity({
        status: other.requestStatus,
        quantityReserved: other.quantityReserved,
        eventStatus: other.eventStatus,
      });
      if (quantity === 0 || !other.startsAt || !other.endsAt) continue;
      commitments.push({
        eventTitle: other.eventTitle ?? "Untitled event",
        quantity,
        startsAt: other.startsAt,
        endsAt: other.endsAt,
        transferLeadMs: transferLeadFor(line.equipment.locationVenueId, other.venueId).leadMs,
      });
    }

    const result = checkAvailability({
      totalQuantity: line.equipment.totalQuantity,
      quantityInMaintenance: line.equipment.quantityInMaintenance,
      isActive: line.equipment.isActive,
      requested: line.quantityRequested,
      startsAt: line.startsAt,
      endsAt: line.endsAt,
      transferLeadMs: leadMs,
      commitments,
    });
    return { ...base, venueChosen, transferMinutes: Math.round(leadMs / 60000), result };
  });

  const checked = lines.every((l) => l.result !== null);
  return {
    lines,
    allAvailable: checked && allLinesAvailable(lines.map((l) => l.result!)),
  };
}
