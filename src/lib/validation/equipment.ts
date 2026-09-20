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
