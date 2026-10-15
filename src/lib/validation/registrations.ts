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
