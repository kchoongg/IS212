import { z } from "zod";
import { SELF_REGISTERABLE_ROLES, type Role } from "../roles";

// ---- Auth ----

// CHANGED: `role` was the full six-role enum, which meant an anonymous caller
// could POST {"role":"ops_manager"} to the unauthenticated register route and
// be granted an internal account. Self-registration is now limited to the two
// external roles — see SELF_REGISTERABLE_ROLES in src/lib/roles.ts for why the
// list lives there rather than being spelled out again here.
// CHANGED: email is trimmed and lower-cased before it is checked or stored.
// Addresses are not case sensitive, and storing "Foo@Bar.com" verbatim left the
// owner unable to log in as "foo@bar.com" the next day (SPM-21 TC11).
export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(SELF_REGISTERABLE_ROLES as unknown as [Role, ...Role[]], {
    errorMap: () => ({
      message: "Choose Event Organiser or Attendee. Staff accounts are created by ConnectSphere.",
    }),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// The same normalisation as registerSchema, so the address typed here matches
// the one stored no matter how it was capitalised. The messages are written for
// the person reading them: they are shown against the field on the login form,
// not just logged.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
export type LoginInput = z.infer<typeof loginSchema>;
