import { z } from "zod";

// ---- Auth ----

export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["organiser", "coordinator", "venue_staff", "tech_support", "attendee", "ops_manager"]),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Events ----

export const createEventSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  purpose: z.string().optional(),
  description: z.string().optional(),
  proposedDate: z.string().datetime().optional(),
  timeSlot: z.enum(["AM", "PM", "Night"]).optional(),
  expectedAttendance: z.number().int().positive().optional(),
  accessibilityNeeds: z.string().optional(),
  registrationEnabled: z.boolean().optional(),
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

// ---- Venues ----

export const createVenueSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  capacity: z.number().int().positive(),
  accessibilityFeatures: z.string().optional(),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

// ---- Equipment ----

export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  totalQuantity: z.number().int().nonnegative(),
  location: z.string().optional(),
});
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

// ---- Registrations ----

export const createRegistrationSchema = z.object({
  eventId: z.string().uuid(),
  dietaryNeeds: z.string().optional(),
  accessibilityNeeds: z.string().optional(),
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
