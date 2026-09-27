import { z } from "zod";

// ---- Venues ----

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
  setupMinutes: z.number().int().nonnegative().optional(),
  teardownMinutes: z.number().int().nonnegative().optional(),
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

// ADDED (SPM-40): GET /api/venues/search. Query strings, so every value
// arrives as text; empty strings are treated as "filter not set" rather than
// errors, because that is what an untouched form field sends.
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
