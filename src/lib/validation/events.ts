import { z } from "zod";
import { deriveEventFromSessions } from "../eventSessions";

// ---- Events ----

// Shared by createEventSchema and updateEventDraftSchema: one equipment
// request line, quantity against a catalogue item.
const equipmentItemSchema = z.object({
  // Messages worded for the person at the form, not the developer: these are
  // shown as-is under Equipment (or Sessions) when a request gets past the
  // client's own check, and Zod's defaults ("Invalid uuid", "Number must be
  // greater than 0") mean nothing to them. Same words as equipmentRowError()
  // in src/lib/eventForm.ts.
  equipmentId: z.string().uuid("Choose an item for every equipment row, or remove the empty ones."),
  quantityRequested: z
    .number()
    .int("Every equipment row needs a quantity of at least 1.")
    .positive("Every equipment row needs a quantity of at least 1."),
  technicalRequirements: z.string().optional(),
});

// SPM-23 (class clarification #74): one session of a multi-session event, with
// its own timing, attendance, room layout and equipment. `startsAt` / `endsAt`
// are required even on a draft - event_sessions.starts_at / ends_at are
// NOT NULL - so a session is either saved with its times or not saved.
const sessionSchema = z.object({
  // Display label only, e.g. "Day 1 - Keynotes".
  label: z.string().trim().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  expectedAttendance: z.number().int().positive().optional(),
  preferredLayout: z.string().optional(),
  equipment: z.array(equipmentItemSchema).optional(),
});
export type SessionInput = z.infer<typeof sessionSchema>;

// `[]` is meaningful on an edit (turn multi-session off and drop the sessions)
// so it is allowed; a single session is not - one session is just an event.
// Ordering is checked here rather than on sessionSchema so the message can say
// WHICH session, since the API reports every nested failure under `sessions`.
const sessionsSchema = z.array(sessionSchema).superRefine((sessions, ctx) => {
  if (sessions.length === 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A multi-session event needs at least two sessions",
    });
  }
  sessions.forEach((session, i) => {
    if (new Date(session.endsAt) <= new Date(session.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Session ${i + 1}: ends at must be after starts at`,
        path: [i, "endsAt"],
      });
    }
  });
});

// The event's own start once sessions are in play: the earliest session. The
// registration-window rules below are stated against "the event start", and
// for a multi-session event that is when the first session begins.
type ScheduleFields = {
  startsAt?: string;
  endsAt?: string;
  sessions?: SessionInput[];
};
const effectiveStartsAt = (d: ScheduleFields): string | undefined =>
  d.sessions?.length ? deriveEventFromSessions(d.sessions)?.startsAt.toISOString() : d.startsAt;
const effectiveEndsAt = (d: ScheduleFields): string | undefined =>
  d.sessions?.length ? deriveEventFromSessions(d.sessions)?.endsAt.toISOString() : d.endsAt;

// EquipmentRequest is unique on (eventId, equipmentId) - NOT on session too -
// so an item can be requested once per EVENT, across the event-level list and
// every session's list together.
const hasDuplicateEquipment = (d: {
  equipment?: { equipmentId: string }[];
  sessions?: SessionInput[];
}): boolean => {
  const ids = [
    ...(d.equipment ?? []).map((e) => e.equipmentId),
    ...(d.sessions ?? []).flatMap((s) => (s.equipment ?? []).map((e) => e.equipmentId)),
  ];
  return new Set(ids).size !== ids.length;
};
const DUPLICATE_ACROSS_SESSIONS =
  "Each item can only be requested once per event, across all sessions - change the quantity instead";

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

    // ADDED (SPM-23, multi-session events): when present, the sessions carry
    // the schedule, attendance, layout and equipment, and the event's own
    // startsAt / endsAt / expectedAttendance are derived from them by the route
    // (see deriveEventFromSessions) rather than taken from this body.
    sessions: sessionsSchema.optional(),
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
  .refine(
    (d) => {
      const start = effectiveStartsAt(d);
      return !d.registrationOpensAt || !start || new Date(d.registrationOpensAt) < new Date(start);
    },
    {
      message: "registrationOpensAt must be before the event starts",
      path: ["registrationOpensAt"],
    }
  )
  .refine(
    (d) => {
      const start = effectiveStartsAt(d);
      return !d.registrationClosesAt || !start || new Date(d.registrationClosesAt) < new Date(start);
    },
    {
      message: "registrationClosesAt must be before the event starts",
      path: ["registrationClosesAt"],
    }
  )
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
  // nowhere to hang. With sessions, the event's dates are its sessions' dates.
  .refine(
    (d) => !d.equipment?.length || (effectiveStartsAt(d) != null && effectiveEndsAt(d) != null),
    {
      message: "Set the event date and time before requesting equipment",
      path: ["equipment"],
    }
  )
  // The rule above covers an event-level list against itself; this one adds
  // the sessions, which share the same (eventId, equipmentId) uniqueness.
  .refine((d) => !d.sessions?.length || !hasDuplicateEquipment(d), {
    message: DUPLICATE_ACROSS_SESSIONS,
    path: ["sessions"],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventStatusSchema = z.object({
  status: z.enum([
    "draft", "submitted", "under_review", "rejected", "approved",
    "planning", "postponed", "confirmed", "completed", "cancelled", "withdrawn",
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
    // `[]` clears the event's sessions (multi-session turned off); omitted
    // leaves them alone; two or more replaces them wholesale.
    sessions: sessionsSchema.optional(),
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
  )
  .refine((d) => !d.sessions?.length || !hasDuplicateEquipment(d), {
    message: DUPLICATE_ACROSS_SESSIONS,
    path: ["sessions"],
  });
export type UpdateEventDraftInput = z.infer<typeof updateEventDraftSchema>;

// SPM-62: the assigned coordinator updating an event's information after
// approval. Every field optional - only what changed is sent - but none of the
// required ones may be cleared, since the event has long since left draft.
// Strict: the organiser, coordinator, status, equipment (Equipment tab,
// SPM-47), sessions (follow-up story) and registration settings (Configure
// Event Registration, SPM-64) are not changed here, and a body that tries is
// refused rather than half-applied. Messages as in eventForm.ts.
export const updateEventInformationSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a name so you can find it again.").optional(),
    category: z.string().trim().min(1, "Choose the type of event.").optional(),
    purpose: z.string().optional(),
    description: z.string().optional(),
    startsAt: z.string({ invalid_type_error: "Enter when the event starts." }).datetime().optional(),
    endsAt: z.string({ invalid_type_error: "Enter when the event ends." }).datetime().optional(),
    expectedAttendance: z
      .number({ invalid_type_error: "Enter how many people you expect." })
      .int("Enter a whole number of people, at least 1.")
      .positive("Enter a whole number of people, at least 1.")
      .optional(),
    // null = "No preference", which is a real choice to save.
    preferredLayout: z.string().nullable().optional(),
    accessibilityNotes: z.string().optional(),
    specialRequirements: z.string().optional(),
    facilityIds: z.array(z.string().uuid()).optional(),
  })
  .strict();
export type UpdateEventInformationInput = z.infer<typeof updateEventInformationSchema>;

// SPM-30: assign or reassign an event's coordinator. The route checks the
// person is an active Event Coordinator; this only checks the shape.
export const assignCoordinatorSchema = z.object({
  coordinatorId: z.string().uuid("Choose a coordinator."),
});
export type AssignCoordinatorInput = z.infer<typeof assignCoordinatorSchema>;
