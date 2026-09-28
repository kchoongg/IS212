import { z } from "zod";
import { isDayKey } from "@/lib/venueSlots";

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
