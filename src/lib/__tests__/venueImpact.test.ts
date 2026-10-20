import { describe, it, expect } from "vitest";
import {
  IMPACT_REASONS,
  assessBookingImpact,
  assessVenueEdit,
  formatReviewReason,
  impactSentence,
  isReviewCandidate,
  mergeReasons,
  parseReviewReason,
  reviewCandidateWhere,
  type BookingState,
  type ImpactReason,
  type VenueState,
} from "../venueImpact";

// Traces to the Manage Venue Catalogue AC (discussion board #120, #122):
// affected bookings are FLAGGED, never changed. These tests are the definition
// of "affected" - if the definition moves, it moves here first.

const HEARING_LOOP = "fac-hearing-loop";
const WIFI = "fac-wifi";

/// Jurong Training Room as the seed has it, near enough: a classroom that
/// seats 60 and an event that expects 55, so a small reduction breaks it.
const VENUE: VenueState = {
  isActive: true,
  maxCapacity: 60,
  layouts: [
    { layoutName: "classroom", capacity: 60 },
    { layoutName: "u_shape", capacity: 36 },
    { layoutName: "theatre", capacity: 70 },
  ],
  facilityIds: [WIFI, HEARING_LOOP],
};

const BOOKING: BookingState = {
  id: "booking-1",
  layoutName: "classroom",
  expectedAttendance: 55,
  mandatoryFacilityIds: [HEARING_LOOP],
};

function edit(changes: Partial<VenueState>): VenueState {
  return { ...VENUE, ...changes };
}

function impactOf(changes: Partial<VenueState>, booking: BookingState = BOOKING) {
  return assessBookingImpact(VENUE, edit(changes), booking);
}

describe("assessBookingImpact - what counts as affected", () => {
  it("[SPM-39][AC7] flags nothing when the edit touches attributes a booking does not depend on", () => {
    // Renaming a room, correcting its address or changing its turnaround time
    // cannot make it unsuitable. If this ever flags, coordinators will learn
    // to ignore the flag, and the AC is worth nothing.
    expect(impactOf({})).toEqual([]);
  });

  it("[SPM-39][AC7] flags every candidate booking when the venue is retired", () => {
    expect(impactOf({ isActive: false })).toEqual(["venue_retired"]);
  });

  it("[SPM-39][AC7] does not flag when a retired venue is brought back", () => {
    const retired = edit({ isActive: false });
    expect(assessBookingImpact(retired, VENUE, BOOKING)).toEqual([]);
  });

  it("[SPM-39][AC7] flags when the booked layout is no longer offered", () => {
    const withoutClassroom = VENUE.layouts.filter((l) => l.layoutName !== "classroom");
    expect(impactOf({ layouts: withoutClassroom })).toEqual(["layout_removed"]);
  });

  it("[SPM-39][AC7] ignores the removal of a layout this booking does not use", () => {
    const withoutUShape = VENUE.layouts.filter((l) => l.layoutName !== "u_shape");
    expect(impactOf({ layouts: withoutUShape })).toEqual([]);
  });

  it("[SPM-39][AC7] flags when the booked layout drops below the expected attendance", () => {
    const reduced = [{ layoutName: "classroom", capacity: 40 }, ...VENUE.layouts.slice(1)];
    expect(impactOf({ layouts: reduced })).toEqual(["layout_capacity_below_attendance"]);
  });

  it("[SPM-39][AC7] does not flag a capacity reduction that still fits the event", () => {
    const reduced = [{ layoutName: "classroom", capacity: 56 }, ...VENUE.layouts.slice(1)];
    expect(impactOf({ layouts: reduced })).toEqual([]);
  });

  it("[SPM-39][AC7] does not flag a capacity increase", () => {
    const raised = [{ layoutName: "classroom", capacity: 90 }, ...VENUE.layouts.slice(1)];
    expect(impactOf({ layouts: raised })).toEqual([]);
  });

  it("[SPM-39][AC7] catches a maxCapacity drop for a booking that has no layout recorded", () => {
    // layoutName is nullable, so the per-layout rule cannot be the only
    // capacity check or these bookings would never be flagged at all.
    const noLayout: BookingState = { ...BOOKING, layoutName: null };
    expect(impactOf({ maxCapacity: 30 }, noLayout)).toEqual([
      "max_capacity_below_attendance",
    ]);
  });

  it("[SPM-39][AC7] flags when a mandatory facility is removed", () => {
    expect(impactOf({ facilityIds: [WIFI] })).toEqual(["mandatory_facility_removed"]);
  });

  it("[SPM-39][AC7] does not flag when a facility the event did not require is removed", () => {
    // A missing nice-to-have must not disqualify a venue (isMandatory in
    // schema.prisma), so it must not flag a booking either.
    expect(impactOf({ facilityIds: [HEARING_LOOP] })).toEqual([]);
  });

  it("[SPM-39][AC7] does not flag on capacity when the event has no expected attendance", () => {
    const noHeadcount: BookingState = { ...BOOKING, expectedAttendance: null };
    const reduced = [{ layoutName: "classroom", capacity: 2 }, ...VENUE.layouts.slice(1)];
    expect(impactOf({ layouts: reduced, maxCapacity: 2 }, noHeadcount)).toEqual([]);
  });

  it("[SPM-39][AC7] reports every reason when one edit breaks several things at once", () => {
    expect(
      impactOf({ isActive: false, maxCapacity: 10, layouts: [], facilityIds: [] })
    ).toEqual([
      "venue_retired",
      "layout_removed",
      "max_capacity_below_attendance",
      "mandatory_facility_removed",
    ]);
  });

  it("[SPM-39][AC7] reports reasons in a stable order however the edit is written", () => {
    const reasons = impactOf({ isActive: false, facilityIds: [] });
    expect(reasons).toEqual(["venue_retired", "mandatory_facility_removed"]);
  });
});

describe("assessBookingImpact - problems that were already true", () => {
  const alreadyTooSmall = edit({ layouts: [{ layoutName: "classroom", capacity: 40 }] });

  it("[SPM-39][AC7] does not re-flag a problem the edit did not introduce", () => {
    // The room was already too small before this edit; this edit only renamed
    // it. The booking is already flagged from whenever it first broke.
    const renamed = { ...alreadyTooSmall };
    expect(assessBookingImpact(alreadyTooSmall, renamed, BOOKING)).toEqual([]);
  });

  it("[SPM-39][AC7] stays quiet when the same edit is saved twice", () => {
    const after = edit({ isActive: false });
    expect(assessBookingImpact(VENUE, after, BOOKING)).toEqual(["venue_retired"]);
    expect(assessBookingImpact(after, after, BOOKING)).toEqual([]);
  });

  it("[SPM-39][AC7] still flags a different problem introduced by a later edit", () => {
    const alsoRetired = { ...alreadyTooSmall, isActive: false };
    expect(assessBookingImpact(alreadyTooSmall, alsoRetired, BOOKING)).toEqual([
      "venue_retired",
    ]);
  });
});

describe("assessVenueEdit", () => {
  const bookings: BookingState[] = [
    BOOKING,
    { id: "booking-2", layoutName: "theatre", expectedAttendance: 65, mandatoryFacilityIds: [] },
    { id: "booking-3", layoutName: "u_shape", expectedAttendance: 20, mandatoryFacilityIds: [] },
  ];

  it("[SPM-39][AC7] returns only the bookings this edit newly broke", () => {
    // classroom 60 -> 30: booking-1 (55 people) breaks, the other two use
    // different layouts and are untouched.
    const after = edit({
      layouts: [{ layoutName: "classroom", capacity: 30 }, ...VENUE.layouts.slice(1)],
    });
    expect(assessVenueEdit(VENUE, after, bookings)).toEqual([
      { bookingId: "booking-1", reasons: ["layout_capacity_below_attendance"] },
    ]);
  });

  it("[SPM-39][AC7] returns every booking when the venue is retired", () => {
    const after = edit({ isActive: false });
    expect(assessVenueEdit(VENUE, after, bookings).map((b) => b.bookingId)).toEqual([
      "booking-1",
      "booking-2",
      "booking-3",
    ]);
  });

  it("[SPM-39][AC7] returns nothing for an edit with no impact", () => {
    expect(assessVenueEdit(VENUE, edit({}), bookings)).toEqual([]);
  });

  it("[SPM-39][AC7] returns nothing when there are no candidate bookings", () => {
    expect(assessVenueEdit(VENUE, edit({ isActive: false }), [])).toEqual([]);
  });
});

describe("isReviewCandidate", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  const future = { startsAt: new Date("2026-10-01T09:00:00Z"), endsAt: new Date("2026-10-01T17:00:00Z") };
  const past = { startsAt: new Date("2026-08-01T09:00:00Z"), endsAt: new Date("2026-08-01T17:00:00Z") };

  it("[SPM-39][AC7] takes a future approved booking", () => {
    expect(isReviewCandidate({ status: "approved", ...future }, now)).toBe(true);
  });

  it("[SPM-39][AC7] takes a booking that is under way right now", () => {
    const inProgress = { endsAt: new Date("2026-09-19T17:00:00Z") };
    expect(isReviewCandidate({ status: "approved", ...inProgress }, now)).toBe(true);
  });

  it("[SPM-39][AC7] leaves a finished booking alone", () => {
    expect(isReviewCandidate({ status: "approved", ...past }, now)).toBe(false);
  });

  it("[SPM-39][AC7] leaves pending, rejected and cancelled bookings alone", () => {
    // A pending booking is not a commitment - nothing has been promised to
    // anyone, so there is nothing for a flag to protect.
    for (const status of ["pending", "rejected", "cancelled"]) {
      expect(isReviewCandidate({ status, ...future }, now)).toBe(false);
    }
  });
});

describe("reviewCandidateWhere", () => {
  it("[SPM-39][AC7] agrees with isReviewCandidate on every combination", () => {
    // The route filters in the database; the predicate is the definition.
    // They have to answer the same question or the flags go wrong silently.
    const now = new Date("2026-09-19T10:00:00Z");
    const where = reviewCandidateWhere(now);
    const matchesWhere = (b: { status: string; endsAt: Date }) =>
      b.status === where.status && b.endsAt.getTime() > where.endsAt.gt.getTime();

    const statuses = ["pending", "approved", "rejected", "cancelled"];
    const endings = [new Date("2026-08-01T17:00:00Z"), new Date("2026-10-01T17:00:00Z")];

    for (const status of statuses) {
      for (const endsAt of endings) {
        const booking = { status, endsAt };
        expect(matchesWhere(booking)).toBe(isReviewCandidate(booking, now));
      }
    }
  });
});

describe("reviewReason round trip", () => {
  it("[SPM-39][AC7] stores codes, not prose, so a screen can filter on them", () => {
    expect(formatReviewReason(["venue_retired", "layout_removed"])).toBe(
      "venue_retired,layout_removed"
    );
  });

  it("[SPM-39][AC7] reads back what it wrote", () => {
    const reasons: ImpactReason[] = ["layout_removed", "mandatory_facility_removed"];
    expect(parseReviewReason(formatReviewReason(reasons))).toEqual(reasons);
  });

  it("[SPM-39][AC7] normalises order, so the same set always stores the same string", () => {
    expect(formatReviewReason(["mandatory_facility_removed", "venue_retired"])).toBe(
      formatReviewReason(["venue_retired", "mandatory_facility_removed"])
    );
  });

  it("[SPM-39][AC7] survives an empty or unrecognised column", () => {
    // The column is a plain string with no constraint behind it.
    expect(parseReviewReason(null)).toEqual([]);
    expect(parseReviewReason("")).toEqual([]);
    expect(parseReviewReason("something_someone_typed")).toEqual([]);
    expect(parseReviewReason("venue_retired,typo")).toEqual(["venue_retired"]);
  });
});

describe("mergeReasons", () => {
  it("[SPM-39][AC7] keeps the reason an earlier edit flagged when a later one adds another", () => {
    expect(mergeReasons(["layout_removed"], ["venue_retired"])).toEqual([
      "venue_retired",
      "layout_removed",
    ]);
  });

  it("[SPM-39][AC7] does not duplicate a reason that is already recorded", () => {
    expect(mergeReasons(["venue_retired"], ["venue_retired"])).toEqual(["venue_retired"]);
  });
});

describe("impactSentence", () => {
  it("[SPM-39][AC7] gives every reason human wording for the notification body", () => {
    const sentences = Object.fromEntries(IMPACT_REASONS.map((reason) => [reason, impactSentence([reason])]));
    expect(sentences).toEqual({
      venue_retired: "the venue has been retired",
      layout_removed: "the booked layout is no longer offered at this venue",
      layout_capacity_below_attendance: "the booked layout no longer seats the expected attendance",
      max_capacity_below_attendance: "the venue's maximum capacity is now below the expected attendance",
      mandatory_facility_removed: "a facility this event requires is no longer available at this venue",
      venue_unavailable: "the venue is unavailable during this booking",
    });
  });

  it("[SPM-39][AC7] joins several reasons into one clause list", () => {
    expect(impactSentence(["venue_retired", "layout_removed"])).toBe(
      "the venue has been retired; the booked layout is no longer offered at this venue"
    );
  });

  // SPM-45: an unavailable period flags a booking
  // with its own reason, kept apart from "venue_retired" (SPM-68 lists "venue
  // retired" and "venue blocked" as two reasons).
  it("[SPM-45][AC3] words a booking caught by an unavailable period", () => {
    expect(impactSentence(["venue_unavailable" as ImpactReason])).toBe(
      "the venue is unavailable during this booking"
    );
  });
});
