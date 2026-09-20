import { z } from "zod";

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
