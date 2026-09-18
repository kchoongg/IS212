import { z } from "zod";
import { SELF_REGISTERABLE_ROLES, type Role } from "../roles";

// ---- Auth ----

// CHANGED: `role` was the full six-role enum, which meant an anonymous caller
// could POST {"role":"ops_manager"} to the unauthenticated register route and
// be granted an internal account. Self-registration is now limited to the two
// external roles — see SELF_REGISTERABLE_ROLES in src/lib/roles.ts for why the
// list lives there rather than being spelled out again here.
export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(SELF_REGISTERABLE_ROLES as unknown as [Role, ...Role[]], {
    errorMap: () => ({
      message: "Choose Event Organiser or Attendee. Staff accounts are created by ConnectSphere.",
    }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;
