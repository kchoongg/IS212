import { z } from "zod";
import { BOOKING_STEP_MINUTES, isDayKey, isOnGrid } from "@/lib/venueTime";
import { SPACE_ATTENDANCE_ERROR, SPACE_PURPOSE_MAX, SPACE_PURPOSE_REQUIRED } from "@/lib/venueSuitability";
import {
  OTHER_REASON_ERROR,
  OTHER_REASON_MAX,
  PERIOD_ORDER_ERROR,
  TIME_GRID_ERROR,
  UNAVAILABILITY_REASONS,
  periodInterval,
} from "@/lib/venueUnavailability";

// ---- Venues ----

const stepMinutes = z
  .number()
  .int()
  .nonnegative()
  .multipleOf(BOOKING_STEP_MINUTES, { message: "Enter minutes in 15-minute steps: 0, 15, 30, 45 and so on." });

// CHANGED: `location` split into building/floor/address (story 9 filters by
// location, so it has to be queryable, not one free-text blob). `capacity`
// renamed to maxCapacity. `accessibilityFeatures` removed - accessibility is
// one category of Facility, linked via facilityIds below, not a text field.
export const createVenueSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  description: z.string().optional(),
  building: z.string().min(1),
  floor: z.string().optional(),
  address: z.string().optional(),
  maxCapacity: z.number().int().positive(),
  opensAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  closesAt: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  /// SPM-93 AC5: in 15-minute steps, zero included - the smallest unit of
  /// booking (#126, #128). venueForm.ts gives the same message on screen.
  setupMinutes: stepMinutes.optional(),
  teardownMinutes: stepMinutes.optional(),
  /// Facility IDs this venue has, both `facility` and `accessibility` ones.
  facilityIds: z.array(z.string().uuid()).optional(),
  /// Optional per-layout capacities, e.g. [{ layoutName: "theatre", capacity: 500 }]
  layouts: z
    .array(
      z.object({
        layoutName: z.string().min(1),
        capacity: z.number().int().positive(),
      })
    )
    .optional(),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

// ADDED (SPM-40): GET /api/venues/search. Query strings, so every value
// arrives as text; empty strings are treated as "filter not set" rather than
// errors, because that is what an untouched form field sends.
/// A layout picker's "Not set" arrives as "", which means no layout.
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const venueSearchQuerySchema = z
  .object({
    /// Singapore wall-clock time, "YYYY-MM-DDTHH:MM" - what a datetime-local
    /// input produces. Converted to an instant by parseWallClock() in the
    /// route, which is also where an impossible date is caught.
    from: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional()),
    to: z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional()),
    attendance: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
    building: z.preprocess(blankToUndefined, z.string().max(100).optional()),
    layout: z.preprocess(blankToUndefined, z.string().max(50).optional()),
    /// Comma-separated Facility ids - facilities and accessibility features alike.
    facilityIds: z.preprocess(
      (value) =>
        typeof value === "string"
          ? value.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      z.array(z.string().uuid()).max(50).optional()
    ),
    /// The event being searched for, as its reference ("EVT-000123").
    event: z.preprocess(blankToUndefined, z.string().max(20).optional()),
  })
  .refine((q) => (q.from == null) === (q.to == null), {
    message: "Give both a start and an end, or neither",
    path: ["to"],
  })
  // Plain string comparison is safe: both are zero-padded, same format.
  .refine((q) => q.from == null || q.to == null || q.to > q.from, {
    message: "The end must be after the start",
    path: ["to"],
  });
export type VenueSearchQuery = z.infer<typeof venueSearchQuerySchema>;

// ADDED: PATCH /api/venues/[id]. Every field optional - an absent field means
// "leave this alone", the same convention updateEventDraftSchema uses. A
// PRESENT `layouts` or `facilityIds` array is a full replacement of that
// relation, which is how a layout or a facility gets REMOVED from a venue, and
// removal is exactly what flags existing bookings for review (venueImpact.ts).
export const updateVenueSchema = createVenueSchema
  .partial()
  .extend({
    /// Retiring a venue is `isActive: false`, never a delete: VenueBooking
    /// holds a plain foreign key to Venue with no cascade, so deleting a
    /// booked venue would fail at the database, and past bookings must keep
    /// pointing at the room they were held in.
    isActive: z.boolean().optional(),
    /// Why the venue changed or was retired. Deliberately NOT stored on Venue
    /// - there is no column for it and we are not adding one. It goes into the
    /// notification sent to the coordinators of affected bookings, which is
    /// where a human will actually read it.
    reason: z.string().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to change",
  })
  .refine(
    (data) => {
      if (!data.layouts) return true;
      const names = data.layouts.map((l) => l.layoutName);
      return new Set(names).size === names.length;
    },
    {
      message: "Each layout may appear only once",
      path: ["layouts"],
    }
  );
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;

// ADDED (SPM-46): the query string of GET /api/venues/[id]/availability.
//
// Both optional - an absent `from` means today and an absent `to` means a week
// on - and both are LOCAL calendar days, because that is what a person picks
// from a calendar. Only the format and that each is a real date are checked
// here; defaults, "to is not before from" and the maximum span need to know
// today's date, so they live in resolveAvailabilityRange()
// (src/lib/venueAvailability.ts) where that can be passed in and tested.
const availabilityDay = z
  .string()
  .refine(isDayKey, { message: "Use a real date written as YYYY-MM-DD, e.g. 2026-09-28" });

export const venueAvailabilityQuerySchema = z.object({
  from: availabilityDay.optional(),
  to: availabilityDay.optional(),
});
export type VenueAvailabilityQuery = z.infer<typeof venueAvailabilityQuerySchema>;

// ADDED (SPM-42): POST /api/events/[id]/venue-bookings. SPM-93: a date and a
// start and end time instead of slots. The times are only required to be
// strings here: an off-grid or inverted time is refused by
// checkVenueBookingRequest() (src/lib/venueBookingRequest.ts), with the
// message and the field the screen shows (AC3).
export const createVenueBookingSchema = z.object({
  venueId: z.string().uuid(),
  /// Required by the route when the event has sessions.
  sessionId: z.string().uuid().optional(),
  day: availabilityDay,
  startTime: z.string().max(5),
  endTime: z.string().max(5),
  /// 'Venue requirements' (AC6). Optional; blank means none given.
  requirementsNote: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
  /// SPM-90 (AC1): what this space is for, e.g. "Main programme".
  purpose: z.string().trim().min(1, SPACE_PURPOSE_REQUIRED).max(SPACE_PURPOSE_MAX),
  /// SPM-90: the space's own attendance and layout. Left out, the route uses
  /// the session's, else the event's (AC2). A null layout means "not set".
  expectedAttendance: z.number().int().min(1, SPACE_ATTENDANCE_ERROR).optional(),
  layoutName: z.preprocess(blankToNull, z.string().trim().max(50).nullable().optional()),
});
export type CreateVenueBookingInput = z.infer<typeof createVenueBookingSchema>;

// ADDED (SPM-45): POST /api/venues/[id]/unavailability and PATCH
// .../unavailability/[periodId]. A period is stated as the date and time the
// venue becomes unavailable and the date and time it is available again, on
// the 15-minute grid (AC1; #126, #128), and the second must be later (AC2).
// `otherReason` only means something for "other", where it is required; the
// routes ignore it for any other reason.
const gridTime = z.string().refine(isOnGrid, { message: TIME_GRID_ERROR });

export const venueUnavailabilitySchema = z
  .object({
    fromDay: availabilityDay,
    fromTime: gridTime,
    untilDay: availabilityDay,
    untilTime: gridTime,
    reason: z.enum(UNAVAILABILITY_REASONS),
    otherReason: z.preprocess(blankToUndefined, z.string().trim().max(OTHER_REASON_MAX).optional()),
  })
  .superRefine((period, ctx) => {
    // A refused day or time still reaches here; there is nothing to compare.
    const readable =
      isDayKey(period.fromDay) && isDayKey(period.untilDay) && isOnGrid(period.fromTime) && isOnGrid(period.untilTime);
    const { startsAt, endsAt } = periodInterval(period);
    if (readable && endsAt.getTime() <= startsAt.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: PERIOD_ORDER_ERROR, path: ["untilTime"] });
    }
    if (period.reason === "other" && !period.otherReason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: OTHER_REASON_ERROR, path: ["otherReason"] });
    }
  });
export type VenueUnavailabilityInput = z.infer<typeof venueUnavailabilitySchema>;

// ADDED (SPM-43): PATCH /api/venue-bookings/[id]. A blank `reason` is allowed
// through on purpose - checkBookingDecision() (src/lib/venueBookingReview.ts)
// refuses it with the message the screen shows. The suggestion (AC6) exists
// only on a rejection: approving with amended details is not allowed (#110).
export const decideVenueBookingSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }).strict(),
  z.object({
    decision: z.literal("reject"),
    reason: z.string().max(2000),
    suggestedVenueId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    suggestedAlternative: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
  }),
]);
export type DecideVenueBookingInput = z.infer<typeof decideVenueBookingSchema>;

// ADDED (SPM-67): PATCH /api/events/[id]/venue-bookings/[bookingId]. The
// assigned Coordinator withdraws a pending request or releases an approved
// booking. The reason is optional (AC5 "can record"); a blank one is none.
export const changeVenueBookingSchema = z
  .object({
    action: z.enum(["withdraw", "release"]),
    reason: z.preprocess(blankToUndefined, z.string().trim().max(2000).optional()),
  })
  .strict();
export type ChangeVenueBookingInput = z.infer<typeof changeVenueBookingSchema>;

/// SPM-82 (AC3): Venue Staff move a tentative hold's expiry. The rules - in the
/// future, not after the event starts, only while pending - are
/// checkHoldExpiryChange() (src/lib/holdExpiry.ts); this only checks it is a
/// date at all.
export const changeHoldExpirySchema = z.object({
  holdExpiresAt: z.coerce.date({ message: "Choose the date and time the hold should expire." }),
});
export type ChangeHoldExpiryInput = z.infer<typeof changeHoldExpirySchema>;
