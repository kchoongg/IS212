import { z } from "zod";
import { OUT_OF_SERVICE_TYPES } from "@/lib/equipmentOutOfService";

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

// ---- Equipment requests (per event, S-16) ----

// ADDED (SPM-47): the Coordinator's own add/update screen, separate from the
// `equipment` array embedded in createEventSchema (S-08). That one creates
// rows alongside a new event; this one manages rows on an event that already
// exists, so it never touches event fields, and update only ever touches
// quantity and technical requirements — never the equipment item itself
// (changing the item is "remove this row, add another", not an edit) — and,
// for the same reason, never the session either (see sessionId below).
//
// ADDED: sessionId — a multi-session event's requirement can be scoped to one
// EventSession rather than the whole event (class clarification #74). Null
// means "applies to the whole event", exactly the pre-session behaviour.
// EventSession itself (prisma/schema.prisma, migration
// 20260918061723_add_event_sessions) is schema-only groundwork from SPM-25 —
// no route creates one yet, so this is always undefined/null in practice
// until that exists; the route validates it defensively regardless.
export const addEquipmentRequestSchema = z.object({
  equipmentId: z.string().uuid(),
  quantityRequested: z.number().int().positive(),
  technicalRequirements: z.string().optional(),
  sessionId: z.string().uuid().optional(),
});
export type AddEquipmentRequestInput = z.infer<typeof addEquipmentRequestSchema>;

export const updateEquipmentRequestSchema = z
  .object({
    quantityRequested: z.number().int().positive().optional(),
    technicalRequirements: z.string().optional(),
  })
  .refine((d) => d.quantityRequested !== undefined || d.technicalRequirements !== undefined, {
    message: "Nothing to update",
  });
export type UpdateEquipmentRequestInput = z.infer<typeof updateEquipmentRequestSchema>;

// ---- Technical Support's update of one request line (SPM-50) ----

// Only the shape is checked here. Which status a line may move to, the reason
// "Unavailable" needs and the 500-character cap depend on the line's current
// status, so they live in src/lib/equipmentFulfilment.ts where the route and
// the screen share them.
export const updateEquipmentFulfilmentSchema = z.object({
  status: z.string().min(1),
  staffNotes: z.string(),
});
export type UpdateEquipmentFulfilmentInput = z.infer<typeof updateEquipmentFulfilmentSchema>;

// ---- Adjusting a reservation (SPM-69) ----

// The new reserved quantity. At least 1: freeing all of it is Release, its own
// action. Whether it fits what was requested and what is free depends on the
// line, so src/lib/equipmentReservation.ts checks that.
export const adjustReservationSchema = z.object({
  quantity: z.number().int().positive(),
});
export type AdjustReservationInput = z.infer<typeof adjustReservationSchema>;

// Releasing one. The reason's rules (required, 500 characters) are in
// checkReleaseReason(), shared with the screen.
export const releaseReservationSchema = z.object({
  reason: z.string(),
});
export type ReleaseReservationInput = z.infer<typeof releaseReservationSchema>;

// ---- Suggesting an alternative (SPM-77) ----

// The note's rules (required, 500 characters) and everything that depends on
// the line - its status, the item, what is free - are in
// src/lib/equipmentSuggestion.ts, shared with the screen.
export const suggestAlternativeSchema = z.object({
  equipmentId: z.string().uuid(),
  quantity: z.number().int().positive(),
  note: z.string(),
});
export type SuggestAlternativeInput = z.infer<typeof suggestAlternativeSchema>;

// The availability check before recording it (AC2): query-string values.
export const alternativeAvailabilityQuerySchema = z.object({
  equipmentId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
});

// The Coordinator's answer to it.
export const decideSuggestionSchema = z.object({
  decision: z.enum(["accept", "decline"]),
});
export type DecideSuggestionInput = z.infer<typeof decideSuggestionSchema>;

// ---- Recording units out of service (SPM-48 AC7 / SPM-55) ----

// How many units of an item are unavailable, damaged or under maintenance - one
// number, because equipment is tracked as a pooled quantity, not unit by unit.
// The reason is free text and optional (SPM-55: "can provide a reason").
// "Cannot exceed the total" needs the item, so the route checks that
// (see checkOutOfService in src/lib/equipment.ts).
// SPM-55: which of the three kinds it is, required while any unit is out.
export const recordOutOfServiceSchema = z
  .object({
    quantityOutOfService: z.number().int().nonnegative(),
    type: z.enum(OUT_OF_SERVICE_TYPES).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.quantityOutOfService === 0 || d.type !== undefined, {
    message: "Choose a type.",
    path: ["type"],
  });
export type RecordOutOfServiceInput = z.infer<typeof recordOutOfServiceSchema>;
