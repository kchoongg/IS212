import { z } from "zod";

// ---- Registrations ----

// CHANGED: dietaryNeeds -> dietaryRequirements,
//          accessibilityNeeds -> accessibilityRequirements (match schema).
export const createRegistrationSchema = z.object({
  eventId: z.string().uuid(),
  dietaryRequirements: z.string().optional(),
  accessibilityRequirements: z.string().optional(),
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

// SPM-57: the assigned coordinator adding an Attendee account by its email
// address (AC1). Emails are stored lower-case (see auth.ts), so it is matched
// that way. The requirements are the registration's own, as in
// createRegistrationSchema; a blank one is not recorded.
const requirement = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const addAttendeeSchema = z.object({
  email: z
    .string({ required_error: "Enter the attendee's email address" })
    .trim()
    .toLowerCase()
    .min(1, "Enter the attendee's email address")
    .email("Enter a valid email address"),
  dietaryRequirements: requirement,
  accessibilityRequirements: requirement,
});
export type AddAttendeeInput = z.infer<typeof addAttendeeSchema>;

// SPM-64: the assigned coordinator configuring an event's registration. Every
// field optional - only what changed is sent. Strict, as SPM-62's schema is:
// a body carrying anything else is refused rather than half-applied.
export const configureRegistrationSchema = z
  .object({
    registrationEnabled: z.boolean().optional(),
    // Messages as on the event request form (eventForm.ts).
    registrationCapacity: z
      .number({ invalid_type_error: "Enter a whole number, at least 1." })
      .int("Enter a whole number, at least 1.")
      .positive("Enter a whole number, at least 1.")
      .optional(),
    // AC4: which of the event's venue bookings the capacity is measured
    // against. Only needed when it has several active ones.
    registrationVenueBookingId: z.string().uuid().optional(),
    registrationOpensAt: z.string().datetime().optional(),
    registrationClosesAt: z.string().datetime().optional(),
  })
  .strict();
export type ConfigureRegistrationInput = z.infer<typeof configureRegistrationSchema>;

// SPM-52: an attendee withdrawing their own registration. The only change the
// route makes, so the only value it takes. Strict, as above.
export const withdrawRegistrationSchema = z.object({ status: z.literal("withdrawn") }).strict();
export type WithdrawRegistrationInput = z.infer<typeof withdrawRegistrationSchema>;

// SPM-66: joining a full event's waiting list - the same optional needs as
// registering, kept for when a place is accepted.
export const joinWaitingListSchema = z
  .object({
    dietaryRequirements: z.string().optional(),
    accessibilityRequirements: z.string().optional(),
  })
  .strict();
export type JoinWaitingListInput = z.infer<typeof joinWaitingListSchema>;

// SPM-66 (AC6, AC7): the attendee's answer to a place offered to them.
export const respondToOfferSchema = z.object({ response: z.enum(["accept", "decline"]) }).strict();
export type RespondToOfferInput = z.infer<typeof respondToOfferSchema>;

// SPM-66 (AC9): the coordinator offering a place to a chosen waitlisted attendee.
export const offerPlaceSchema = z.object({ registrationId: z.string().uuid() }).strict();
export type OfferPlaceInput = z.infer<typeof offerPlaceSchema>;
