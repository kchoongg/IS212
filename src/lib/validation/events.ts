import { z } from "zod";

// ---- Events ----

// Shared by createEventSchema and updateEventDraftSchema: one equipment
// request line, quantity against a catalogue item.
const equipmentItemSchema = z.object({
  equipmentId: z.string().uuid(),
  quantityRequested: z.number().int().positive(),
  technicalRequirements: z.string().optional(),
});

// CHANGED: proposedDate + timeSlot replaced by startsAt + endsAt.
// The schema stores a real start/end timestamp rather than a date plus an
// AM/PM/Night bucket, because venue conflict detection compares actual
// intervals - "PM" cannot be checked against another booking.
export const createEventSchema = z
  .object({
    // .trim() runs before .min(1): a title of only whitespace (e.g. " ")
    // must not pass as a name, and the stored value should never carry
    // leading/trailing whitespace a user didn't mean to type.
    title: z.string().trim().min(1, "Title cannot be blank"),
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
    registrationOpensAt: z.string().datetime().optional(),
    registrationClosesAt: z.string().datetime().optional(),

    // ADDED: facility and accessibility requirements as rows rather than
    // prose. Venue suitability (story 11) has to match an event's needs
    // against what each venue has, and free text cannot be matched. These are
    // Facility ids from GET /api/facilities; the category split (facility vs
    // accessibility) is presentation, so both arrive in one list.
    facilityIds: z.array(z.string().uuid()).optional(),

    // ADDED: equipment the organiser is asking for, as quantities against
    // catalogue items. Each entry becomes an EquipmentRequest for Technical
    // Support to review.
    equipment: z.array(equipmentItemSchema).optional(),
  })
  .refine((d) => !d.startsAt || !d.endsAt || new Date(d.endsAt) > new Date(d.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  })
  .refine((d) => !d.registrationEnabled || d.registrationCapacity != null, {
    message: "registrationCapacity is required when registrationEnabled is true",
    path: ["registrationCapacity"],
  })
  .refine(
    (d) =>
      !d.registrationOpensAt ||
      !d.registrationClosesAt ||
      new Date(d.registrationClosesAt) > new Date(d.registrationOpensAt),
    {
      message: "registrationClosesAt must be after registrationOpensAt",
      path: ["registrationClosesAt"],
    }
  )
  // Per UI_DESIGN.md §6.2: registration has to close before the event
  // actually starts - registering people into an event already underway
  // isn't a real window.
  .refine((d) => !d.registrationOpensAt || !d.startsAt || new Date(d.registrationOpensAt) < new Date(d.startsAt), {
    message: "registrationOpensAt must be before the event starts",
    path: ["registrationOpensAt"],
  })
  .refine((d) => !d.registrationClosesAt || !d.startsAt || new Date(d.registrationClosesAt) < new Date(d.startsAt), {
    message: "registrationClosesAt must be before the event starts",
    path: ["registrationClosesAt"],
  })
  // EquipmentRequest is unique on (eventId, equipmentId): the same item twice
  // in one request would fail at the database with an opaque error, so reject
  // it here where the message can name the problem.
  .refine(
    (d) => {
      if (!d.equipment) return true;
      const ids = d.equipment.map((e) => e.equipmentId);
      return new Set(ids).size === ids.length;
    },
    {
      message: "Each piece of equipment can only be requested once — change the quantity instead",
      path: ["equipment"],
    }
  )
  // EquipmentRequest.startsAt / endsAt are NOT NULL, and the reservation
  // window is derived from the event's own times. Equipment without dates has
  // nowhere to hang.
  .refine((d) => !d.equipment?.length || (d.startsAt != null && d.endsAt != null), {
    message: "Set the event date and time before requesting equipment",
    path: ["equipment"],
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

// SPM-24: editing a saved draft. Every field is optional — the organiser may
// only be changing one thing — so this cannot reuse createEventSchema, which
// requires a title. Cross-field rules that depend on values already stored on
// the event (e.g. endsAt vs. a startsAt from an earlier save) are checked in
// the route against the merged record, not here against the payload alone.
export const updateEventDraftSchema = z
  .object({
    // Same rule as createEventSchema: whitespace-only is not a title.
    title: z.string().trim().min(1, "Title cannot be blank").optional(),
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
    registrationOpensAt: z.string().datetime().optional(),
    registrationClosesAt: z.string().datetime().optional(),
    facilityIds: z.array(z.string().uuid()).optional(),
    equipment: z.array(equipmentItemSchema).optional(),
  })
  // Payload-only check — replacing the equipment list with the same item
  // twice is never valid, regardless of what's already stored.
  .refine(
    (d) => {
      if (!d.equipment) return true;
      const ids = d.equipment.map((e) => e.equipmentId);
      return new Set(ids).size === ids.length;
    },
    {
      message: "Each piece of equipment can only be requested once — change the quantity instead",
      path: ["equipment"],
    }
  );
export type UpdateEventDraftInput = z.infer<typeof updateEventDraftSchema>;
