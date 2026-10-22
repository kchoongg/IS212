// Which existing bookings a venue edit puts at risk.
//
// The acceptance criterion this exists for (Manage Venue Catalogue, discussion
// board #120 and #122): "When a venue's attributes are updated or it is
// retired, existing bookings that may be affected are flagged for review
// rather than automatically changed, and the assigned Coordinator is
// notified."
//
// Everything here is a PURE function over plain data - no Prisma, no
// NextRequest - for the same reason src/lib/permissions.ts is: the rules are
// the part worth testing, and they should be testable without a database.
// src/app/api/venues/[id]/route.ts loads the rows, calls assessVenueEdit(),
// and writes the flags and notifications.
//
// Nothing here changes a booking. Flagging is the whole point: a booking that
// no longer fits its venue is a judgement call for the assigned Coordinator,
// not something a PATCH on the venue may silently rewrite.

/// Why a booking was flagged. Stored in `VenueBooking.reviewReason` as these
/// codes, comma-separated - not as prose, so a screen can group and filter by
/// them. IMPACT_REASON_PROSE below is the human wording.
export const IMPACT_REASONS = [
  "venue_retired",
  "layout_removed",
  "layout_capacity_below_attendance",
  "max_capacity_below_attendance",
  "mandatory_facility_removed",
  // SPM-45: an unavailable period overlaps the booking's occupied time. Not a venue
  // EDIT, so problemsFor() below never produces it - the unavailability routes
  // add it themselves (src/lib/venueUnavailabilityService.ts). Kept apart from
  // venue_retired because SPM-68 lists "venue retired" and "venue blocked" as
  // two reasons. Last, so the stored order of the older codes does not move.
  "venue_unavailable",
  // SPM-80: a change to the venue's setup or turnaround time makes this
  // booking's occupied period overlap another booking's. Not a problemsFor()
  // rule either - PATCH /api/venues/[id] adds it through recheckBookings()
  // (src/lib/turnaroundRecheck.ts), which knows which booking it clashes with.
  "booking_clash",
] as const;

export type ImpactReason = (typeof IMPACT_REASONS)[number];

export const IMPACT_REASON_PROSE: Record<ImpactReason, string> = {
  venue_retired: "the venue has been retired",
  layout_removed: "the booked layout is no longer offered at this venue",
  layout_capacity_below_attendance:
    "the booked layout no longer seats the expected attendance",
  max_capacity_below_attendance:
    "the venue's maximum capacity is now below the expected attendance",
  mandatory_facility_removed:
    "a facility this event requires is no longer available at this venue",
  venue_unavailable: "the venue is unavailable during this booking",
  booking_clash: "with the venue's new setup or turnaround time, this booking overlaps another booking",
};

/// The parts of a venue an impact decision depends on, before or after an
/// edit. Declared structurally rather than as the Prisma type so these
/// functions can be tested with object literals.
export interface VenueState {
  isActive: boolean;
  maxCapacity: number;
  layouts: readonly { layoutName: string; capacity: number }[];
  facilityIds: readonly string[];
}

/// The parts of a booking an impact decision depends on. `expectedAttendance`
/// and the mandatory facility list belong to the event, which this module only
/// ever reads - the events domain is Kristen's (SCHEMA_REFERENCE.md § "Who
/// owns what"), and this feature writes to venue_bookings and notifications
/// only.
export interface BookingState {
  id: string;
  /// Nullable in the schema, which is why max_capacity_below_attendance has to
  /// exist as a separate rule: a booking with no layout has no per-layout
  /// number to check against.
  layoutName: string | null;
  expectedAttendance: number | null;
  mandatoryFacilityIds: readonly string[];
}

export interface AffectedBooking {
  bookingId: string;
  reasons: ImpactReason[];
}

// ---------------------------------------------------------------------------
// WHICH BOOKINGS ARE EVEN CANDIDATES
// ---------------------------------------------------------------------------

/// Is this booking one the AC's "existing bookings that may be affected" could
/// refer to?
///
/// `approved` only. A pending booking is not yet a commitment - there is
/// nothing to protect by flagging it, because nothing has been promised to
/// anyone. Only an approved booking represents a commitment that a venue
/// change can break. (Not "whoever edited the venue will notice when they come
/// to approve it" - a different member of Venue Staff may decide it days
/// later.) `rejected` and `cancelled` are likewise not commitments.
///
/// Future only. `endsAt > now` rather than `startsAt > now`, so a booking that
/// is under way right now still counts; one that has finished cannot be
/// affected by anything and flagging it is pure noise in the review queue.
export function isReviewCandidate(
  booking: { status: string; endsAt: Date },
  now: Date
): boolean {
  return booking.status === "approved" && booking.endsAt.getTime() > now.getTime();
}

/// The same rule as isReviewCandidate(), expressed as a Prisma `where` clause
/// so the route filters in the database instead of loading every booking a
/// venue has ever had. Keep the two in step - the tests assert they agree.
/// (Same arrangement as canViewEvent()/eventListWhere() in permissions.ts.)
export function reviewCandidateWhere(now: Date): {
  status: string;
  endsAt: { gt: Date };
} {
  return { status: "approved", endsAt: { gt: now } };
}

// ---------------------------------------------------------------------------
// THE RULES
// ---------------------------------------------------------------------------

/// Everything wrong with this venue state for this booking, regardless of what
/// caused it.
///
/// Read this as a snapshot, not a diff. assessBookingImpact() runs it over the
/// before state and the after state and keeps the difference, which is what
/// makes the whole module behave sensibly without any extra bookkeeping:
///
///   - an edit that changes the name, the address or the setup minutes
///     produces identical problem sets, so nothing is flagged;
///   - a problem that was already true before the edit is not re-flagged, so
///     an unrelated edit to an already-broken booking stays quiet;
///   - saving the same form twice flags once, because the second save has
///     nothing new to report.
function problemsFor(state: VenueState, booking: BookingState): ImpactReason[] {
  const problems: ImpactReason[] = [];

  if (!state.isActive) {
    problems.push("venue_retired");
  }

  const layout =
    booking.layoutName == null
      ? undefined
      : state.layouts.find((l) => l.layoutName === booking.layoutName);

  if (booking.layoutName != null && !layout) {
    problems.push("layout_removed");
  }

  // A null expectedAttendance means there is no threshold to compare against,
  // so neither capacity rule can fire. The field is nullable only so a draft
  // can be incomplete; an event with an approved booking and no headcount is a
  // data problem for a different ticket, not something to flag a venue for.
  if (booking.expectedAttendance != null) {
    if (layout && layout.capacity < booking.expectedAttendance) {
      problems.push("layout_capacity_below_attendance");
    }
    if (state.maxCapacity < booking.expectedAttendance) {
      problems.push("max_capacity_below_attendance");
    }
  }

  // Mandatory requirements only. A missing nice-to-have must NOT disqualify a
  // venue (EventFacilityRequirement.isMandatory in schema.prisma), so it must
  // not flag a booking either - the route passes only the mandatory ones.
  const missingFacility = booking.mandatoryFacilityIds.some(
    (facilityId) => !state.facilityIds.includes(facilityId)
  );
  if (missingFacility) {
    problems.push("mandatory_facility_removed");
  }

  return problems;
}

/// What this edit newly broke for this booking. Empty means "leave it alone".
export function assessBookingImpact(
  before: VenueState,
  after: VenueState,
  booking: BookingState
): ImpactReason[] {
  const already = new Set(problemsFor(before, booking));
  return problemsFor(after, booking).filter((reason) => !already.has(reason));
}

/// The route's entry point: every candidate booking this edit newly broke.
/// Bookings with nothing new wrong are dropped, so the result is exactly the
/// set to flag and notify on.
export function assessVenueEdit(
  before: VenueState,
  after: VenueState,
  bookings: readonly BookingState[]
): AffectedBooking[] {
  const affected: AffectedBooking[] = [];
  for (const booking of bookings) {
    const reasons = assessBookingImpact(before, after, booking);
    if (reasons.length > 0) {
      affected.push({ bookingId: booking.id, reasons });
    }
  }
  return affected;
}

// ---------------------------------------------------------------------------
// STORING AND WORDING THE REASONS
// ---------------------------------------------------------------------------

const SEPARATOR = ",";

/// Codes for the `reviewReason` column, always in IMPACT_REASONS order so the
/// stored string is stable and comparable.
export function formatReviewReason(reasons: readonly ImpactReason[]): string {
  return orderReasons(reasons).join(SEPARATOR);
}

/// Reads the column back. Unknown codes are dropped rather than trusted - the
/// column is a plain string with no database constraint behind it.
export function parseReviewReason(value: string | null | undefined): ImpactReason[] {
  if (!value) return [];
  const codes = value.split(SEPARATOR).map((code) => code.trim());
  return orderReasons(codes.filter(isImpactReason));
}

/// A booking flagged by an earlier edit keeps that reason when a later edit
/// adds another one. Overwriting would lose why it was flagged in the first
/// place, and there is no un-flag path yet for a coordinator to have cleared
/// it deliberately.
export function mergeReasons(
  existing: readonly ImpactReason[],
  added: readonly ImpactReason[]
): ImpactReason[] {
  return orderReasons([...existing, ...added]);
}

/// "the venue has been retired; the booked layout is no longer offered at this
/// venue" - the clause list for a notification body.
export function impactSentence(reasons: readonly ImpactReason[]): string {
  return orderReasons(reasons)
    .map((reason) => IMPACT_REASON_PROSE[reason])
    .join("; ");
}

function isImpactReason(value: string): value is ImpactReason {
  return (IMPACT_REASONS as readonly string[]).includes(value);
}

/// Unique, in declaration order. Callers get a stable string no matter what
/// order the rules happened to fire in.
function orderReasons(reasons: readonly ImpactReason[]): ImpactReason[] {
  return IMPACT_REASONS.filter((reason) => reasons.includes(reason));
}
