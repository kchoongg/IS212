// Update Event Information (SPM-62): the edit form's own rules, apart from the
// screen (src/app/events/[id]/update/page.tsx) - what changed, what to send,
// and the checks run before sending. Labels and messages are the draft form's
// (src/lib/eventForm.ts), so the two read the same.

import type { FieldErrors } from "@/lib/formErrors";
import type { FormValues } from "@/lib/eventForm";
import { toIso } from "@/lib/eventForm";
import { importantChanges, type EventInfo, type ImportantChange } from "@/lib/eventChangeImpact";

/// The fields this form edits - FormValues minus equipment, sessions and the
/// registration settings (Configure Event Registration, SPM-64).
export type InformationValues = Pick<
  FormValues,
  | "title"
  | "category"
  | "purpose"
  | "description"
  | "startsAt"
  | "endsAt"
  | "expectedAttendance"
  | "preferredLayout"
  | "accessibilityNotes"
  | "specialRequirements"
  | "facilityIds"
>;

export function informationValues(values: FormValues): InformationValues {
  return {
    title: values.title,
    category: values.category,
    purpose: values.purpose,
    description: values.description,
    startsAt: values.startsAt,
    endsAt: values.endsAt,
    expectedAttendance: values.expectedAttendance,
    preferredLayout: values.preferredLayout,
    accessibilityNotes: values.accessibilityNotes,
    specialRequirements: values.specialRequirements,
    facilityIds: values.facilityIds,
  };
}

function toInfo(values: InformationValues): EventInfo {
  const at = (local: string) => (local ? new Date(local) : null);
  return {
    startsAt: at(values.startsAt),
    endsAt: at(values.endsAt),
    expectedAttendance: values.expectedAttendance === "" ? null : Number(values.expectedAttendance),
    preferredLayout: values.preferredLayout || null,
    facilityIds: values.facilityIds,
  };
}

/// What the form's edits change, for the live warning and the Confirmed
/// event's question. The same rule the server applies.
export function formChanges(initial: InformationValues, values: InformationValues): ImportantChange[] {
  return importantChanges(toInfo(initial), toInfo(values));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/// Only what changed - PATCH .../information leaves everything else alone,
/// and an unchanged field sent back must not look like an edit.
/// `scheduleEditable` is false for a multi-session event, whose times,
/// attendance and layout come from its sessions.
export function changedPayload(initial: InformationValues, values: InformationValues, scheduleEditable: boolean) {
  const payload: Record<string, unknown> = {};
  const title = values.title.trim();
  if (title !== initial.title) payload.title = title;
  for (const field of ["category", "purpose", "description"] as const) {
    if (values[field] !== initial[field]) payload[field] = values[field];
  }
  if (scheduleEditable) {
    if (values.startsAt !== initial.startsAt) payload.startsAt = toIso(values.startsAt);
    if (values.endsAt !== initial.endsAt) payload.endsAt = toIso(values.endsAt);
    if (values.expectedAttendance !== initial.expectedAttendance) {
      payload.expectedAttendance = Number(values.expectedAttendance);
    }
    if (values.preferredLayout !== initial.preferredLayout) payload.preferredLayout = values.preferredLayout || null;
  }
  for (const field of ["accessibilityNotes", "specialRequirements"] as const) {
    if (values[field] !== initial[field]) payload[field] = values[field];
  }
  if (!sameSet(values.facilityIds, initial.facilityIds)) payload.facilityIds = values.facilityIds;
  return payload;
}

/// The checks run before sending. The server runs the same ones.
export function validateInformation(
  initial: InformationValues,
  values: InformationValues,
  { scheduleEditable, registrationOpensAt, registrationClosesAt }: {
    scheduleEditable: boolean;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
  }
): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.title.trim()) errors.title = "Give the event a name so you can find it again.";
  if (!values.category) errors.category = "Choose the type of event.";
  if (!scheduleEditable) return errors;

  if (!values.startsAt) errors.startsAt = "Enter when the event starts.";
  if (!values.endsAt) errors.endsAt = "Enter when the event ends.";
  const starts = values.startsAt ? new Date(values.startsAt) : null;
  const ends = values.endsAt ? new Date(values.endsAt) : null;
  if (starts && ends && ends <= starts) errors.endsAt = "Ends at must be after starts at.";

  // The registration period is SPM-64's; moving the start must not break it.
  if (starts && values.startsAt !== initial.startsAt && !errors.startsAt) {
    const closes = registrationClosesAt ? new Date(registrationClosesAt) : null;
    const opens = registrationOpensAt ? new Date(registrationOpensAt) : null;
    if ((closes && closes > starts) || (opens && opens >= starts)) {
      errors.startsAt = "Registration closes after this start time. Change the registration period first.";
    }
  }

  if (values.expectedAttendance === "") {
    errors.expectedAttendance = "Enter how many people you expect.";
  } else {
    const n = Number(values.expectedAttendance);
    if (!Number.isInteger(n) || n < 1) errors.expectedAttendance = "Enter a whole number of people, at least 1.";
  }
  return errors;
}
