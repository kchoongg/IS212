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
  })
  .strict();
export type ConfigureRegistrationInput = z.infer<typeof configureRegistrationSchema>;
