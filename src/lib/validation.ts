import { z } from "zod";

// ---- Auth ----

export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["organiser", "coordinator", "venue_staff", "tech_support", "attendee", "ops_manager"]),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Events ----

// CHANGED: proposedDate + timeSlot replaced by startsAt + endsAt.
// The schema stores a real start/end timestamp rather than a date plus an
// AM/PM/Night bucket, because venue conflict detection compares actual
// intervals - "PM" cannot be checked against another booking.
export const createEventSchema = z
  .object({
    title: z.string().min(1),
    category: z.string().optional(),
    purpose: z.string().optional(),
    description: z.string().optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    expectedAttendance: z.number().int().positive().optional(),
    preferredLayout: z.string().optional(),
    accessibilityNotes: z.string().optional(),
    specialRequirements: z.string().optional(),
    registrationEnabled: z.boolean().optional(),
    registrationCapacity: z.number().int().positive().optional(),
  })
  .refine((d) => !d.startsAt || !d.endsAt || new Date(d.endsAt) > new Date(d.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  })
  .refine((d) => !d.registrationEnabled || d.registrationCapacity != null, {
    message: "registrationCapacity is required when registrationEnabled is true",
    path: ["registrationCapacity"],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventStatusSchema = z.object({
  status: z.enum([
    "draft", "submitted", "under_review", "rejected", "approved",
    "planning", "postponed", "confirmed", "completed", "cancelled",
  ]),
  reason: z.string().optional(),
});
export type UpdateEventStatusInput = z.infer<typeof updateEventStatusSchema>;

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

// ---- Equipment ----

// CHANGED: `type` renamed to category (matches the schema field).
// `location` removed - equipment is tracked as a pooled quantity, not as
// individual units with a physical home. See the mismatch report.
export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  totalQuantity: z.number().int().nonnegative(),
  quantityInMaintenance: z.number().int().nonnegative().optional(),
});
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

// ---- Registrations ----

// CHANGED: dietaryNeeds -> dietaryRequirements,
//          accessibilityNeeds -> accessibilityRequirements (match schema).
export const createRegistrationSchema = z.object({
  eventId: z.string().uuid(),
  dietaryRequirements: z.string().optional(),
  accessibilityRequirements: z.string().optional(),
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
