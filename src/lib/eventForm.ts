// Shared by the "new event" and "edit draft" screens (SPM-23 / SPM-24). The
// two forms are the same fields validated the same way — keeping one copy
// means a rule changed here cannot drift between create and edit.

import { toDateTimeLocalValue } from "@/lib/format";
import type { FieldErrors } from "@/lib/formErrors";

export const CATEGORIES = [
  "conference",
  "workshop",
  "training",
  "exhibition",
  "meeting",
  "seminar",
  "networking",
  "other",
];

export const LAYOUTS = ["theatre", "classroom", "boardroom", "banquet", "exhibition", "u_shape", "cabaret"];

export const toOptions = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, "-"),
  }));

export interface FormValues {
  title: string;
  category: string;
  purpose: string;
  description: string;
  startsAt: string;
  endsAt: string;
  expectedAttendance: string;
  preferredLayout: string;
  accessibilityNotes: string;
  specialRequirements: string;
  registrationEnabled: boolean;
  registrationCapacity: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  /// Facility ids from GET /api/facilities — both categories in one list,
  /// because that is how the API takes them.
  facilityIds: string[];
  equipment: EquipmentRow[];
}

/// Quantities are held as strings while typing: a number input mid-edit is
/// legitimately "" or "1", neither of which should become NaN.
export interface EquipmentRow {
  equipmentId: string;
  quantityRequested: string;
  technicalRequirements: string;
}

export interface Facility {
  id: string;
  name: string;
  category: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  category: string | null;
}

/// Which catalogue items a given equipment row's picker should offer: every
/// active item except what another row already has selected. Requesting the
/// same item twice is never valid (the server rejects it, and duplicate rows
/// don't mean anything a higher quantity on one row doesn't already say), so
/// this prevents it at the point of choice rather than catching it after
/// Save/Submit - the picker itself is the validation.
export function availableEquipmentOptions(
  catalogue: EquipmentItem[],
  equipment: EquipmentRow[],
  rowIndex: number
): { value: string; label: string }[] {
  const selectedElsewhere = new Set(
    equipment.filter((_, i) => i !== rowIndex).map((row) => row.equipmentId).filter(Boolean)
  );
  return catalogue
    .filter((item) => !selectedElsewhere.has(item.id))
    .map((item) => ({
      value: item.id,
      label: item.category ? `${item.name} — ${item.category}` : item.name,
    }));
}

export const INITIAL: FormValues = {
  title: "",
  category: "",
  purpose: "",
  description: "",
  startsAt: "",
  endsAt: "",
  expectedAttendance: "",
  preferredLayout: "",
  accessibilityNotes: "",
  specialRequirements: "",
  registrationEnabled: false,
  registrationCapacity: "",
  registrationOpensAt: "",
  registrationClosesAt: "",
  facilityIds: [],
  equipment: [],
};

/// Mirrors the server's rules. `intent` is what separates a draft from a
/// submission — everything below the title is only required to submit.
export function validateForm(values: FormValues, intent: "draft" | "submit"): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.title.trim()) errors.title = "Give the event a name so you can find it again.";
  if (intent === "draft") return errors;

  if (!values.category) errors.category = "Choose the type of event.";
  if (!values.startsAt) errors.startsAt = "Enter when the event starts.";
  if (!values.endsAt) errors.endsAt = "Enter when the event ends.";

  if (values.startsAt && values.endsAt && new Date(values.endsAt) <= new Date(values.startsAt)) {
    errors.endsAt = "Ends at must be after starts at.";
  }
  if (values.startsAt && new Date(values.startsAt) < new Date()) {
    errors.startsAt = "The start date is in the past.";
  }

  const attendance = Number(values.expectedAttendance);
  if (!values.expectedAttendance) {
    errors.expectedAttendance = "Enter how many people you expect.";
  } else if (!Number.isInteger(attendance) || attendance < 1) {
    errors.expectedAttendance = "Enter a whole number of people, at least 1.";
  }

  // Enforced by createEventSchema too; checked here so the user is told before
  // the round trip.
  if (values.registrationEnabled) {
    const capacity = Number(values.registrationCapacity);
    if (!values.registrationCapacity) {
      errors.registrationCapacity = "Enter how many attendees can register.";
    } else if (!Number.isInteger(capacity) || capacity < 1) {
      errors.registrationCapacity = "Enter a whole number, at least 1.";
    }

    // Both optional, but if given they must make sense against each other
    // and against the event's own start (mirrors createEventSchema).
    if (
      values.registrationOpensAt &&
      values.registrationClosesAt &&
      new Date(values.registrationClosesAt) <= new Date(values.registrationOpensAt)
    ) {
      errors.registrationClosesAt = "Registration closes at must be after it opens.";
    }
    if (
      values.registrationOpensAt &&
      values.startsAt &&
      new Date(values.registrationOpensAt) >= new Date(values.startsAt)
    ) {
      errors.registrationOpensAt = "Registration must open before the event starts.";
    }
    if (
      values.registrationClosesAt &&
      values.startsAt &&
      new Date(values.registrationClosesAt) >= new Date(values.startsAt) &&
      !errors.registrationClosesAt
    ) {
      errors.registrationClosesAt = "Registration must close before the event starts.";
    }
  }

  // Equipment rows are only meaningful once the event has dates — the
  // reservation window is derived from them (mirrors createEventSchema).
  if (values.equipment.length > 0) {
    if (!values.startsAt || !values.endsAt) {
      errors.equipment = "Set the event date and time before requesting equipment.";
    } else if (values.equipment.some((row) => !row.equipmentId)) {
      errors.equipment = "Choose an item for every equipment row, or remove the empty ones.";
    } else if (values.equipment.some((row) => Number(row.quantityRequested) < 1)) {
      errors.equipment = "Every equipment row needs a quantity of at least 1.";
    } else {
      const ids = values.equipment.map((row) => row.equipmentId);
      if (new Set(ids).size !== ids.length) {
        errors.equipment =
          "Each item can only be requested once — change the quantity instead of adding a second row.";
      }
    }
  }

  return errors;
}

/// datetime-local gives "YYYY-MM-DDTHH:mm"; the API expects a full ISO string.
export function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/// The shape GET /api/events/[id] returns, trimmed to what the form needs.
export interface EventRecord {
  title: string | null;
  category: string | null;
  purpose: string | null;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  expectedAttendance: number | null;
  preferredLayout: string | null;
  accessibilityNotes: string | null;
  specialRequirements: string | null;
  registrationEnabled: boolean;
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  facilityRequirements: { facilityId: string }[];
  equipmentRequests: {
    equipmentId: string;
    quantityRequested: number;
    technicalRequirements: string | null;
  }[];
}

/// Prefills the edit form from a saved draft. The inverse of the payload the
/// form sends back on save.
export function toFormValues(event: EventRecord): FormValues {
  return {
    title: event.title ?? "",
    category: event.category ?? "",
    purpose: event.purpose ?? "",
    description: event.description ?? "",
    startsAt: toDateTimeLocalValue(event.startsAt),
    endsAt: toDateTimeLocalValue(event.endsAt),
    expectedAttendance: event.expectedAttendance != null ? String(event.expectedAttendance) : "",
    preferredLayout: event.preferredLayout ?? "",
    accessibilityNotes: event.accessibilityNotes ?? "",
    specialRequirements: event.specialRequirements ?? "",
    registrationEnabled: event.registrationEnabled,
    registrationCapacity: event.registrationCapacity != null ? String(event.registrationCapacity) : "",
    registrationOpensAt: toDateTimeLocalValue(event.registrationOpensAt),
    registrationClosesAt: toDateTimeLocalValue(event.registrationClosesAt),
    facilityIds: event.facilityRequirements.map((f) => f.facilityId),
    equipment: event.equipmentRequests.map((e) => ({
      equipmentId: e.equipmentId,
      quantityRequested: String(e.quantityRequested),
      technicalRequirements: e.technicalRequirements ?? "",
    })),
  };
}
