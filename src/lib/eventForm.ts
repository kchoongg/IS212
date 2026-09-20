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
  /// "This event has multiple sessions" (SPM-23, class clarification #74).
  /// While on, `sessions` carries the schedule, attendance, layout and
  /// equipment, and the event-level fields for those are neither shown, nor
  /// validated, nor sent. `sessions` is kept when the box is unticked so an
  /// accidental click does not lose the typing - it is just not submitted.
  multiSession: boolean;
  sessions: SessionRow[];
}

/// Quantities are held as strings while typing: a number input mid-edit is
/// legitimately "" or "1", neither of which should become NaN.
export interface EquipmentRow {
  equipmentId: string;
  quantityRequested: string;
  technicalRequirements: string;
}

/// One session of a multi-session event: its own timing, attendance, room
/// layout and equipment. Facilities, accessibility needs and registration stay
/// on the event - they describe the event, not one session of it.
export interface SessionRow {
  label: string;
  startsAt: string;
  endsAt: string;
  expectedAttendance: string;
  preferredLayout: string;
  equipment: EquipmentRow[];
}

export const blankSession = (): SessionRow => ({
  label: "",
  startsAt: "",
  endsAt: "",
  expectedAttendance: "",
  preferredLayout: "",
  equipment: [],
});

/// A multi-session event is at least two sessions - one session is just an
/// event. Turning the box on offers this many, and Remove stops here.
export const MIN_SESSIONS = 2;

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

/// The session-scoped version of availableEquipmentOptions. An item may be
/// requested once per EVENT (equipment_requests is unique on event + item, not
/// on session), so the picker in one session also excludes what every other
/// session has already chosen - the same "prevent it at the point of choice"
/// approach as the single-session picker.
export function availableSessionEquipmentOptions(
  catalogue: EquipmentItem[],
  sessions: SessionRow[],
  sessionIndex: number,
  rowIndex: number
): { value: string; label: string }[] {
  const selectedElsewhere = new Set(
    sessions
      .flatMap((session, s) =>
        session.equipment.filter((_, r) => !(s === sessionIndex && r === rowIndex))
      )
      .map((row) => row.equipmentId)
      .filter(Boolean)
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
  multiSession: false,
  sessions: [],
};

/// What is wrong with a set of equipment rows on their own, ignoring the rest
/// of the form: a row with no item chosen, or a quantity that is not a whole
/// number of at least 1. Shared by the event-level list and each session's,
/// and run for a DRAFT as well as a submit - unlike the other submit-only
/// rules, the server refuses these on a draft too (they are the wrong shape,
/// not merely incomplete), and its raw "Invalid uuid" is not something to show
/// a user.
export function equipmentRowError(rows: EquipmentRow[]): string | undefined {
  if (rows.some((row) => !row.equipmentId)) {
    return "Choose an item for every equipment row, or remove the empty ones.";
  }
  if (rows.some((row) => !(Number(row.quantityRequested) >= 1) || !Number.isInteger(Number(row.quantityRequested)))) {
    return "Every equipment row needs a quantity of at least 1.";
  }
  return undefined;
}

/// The event's own start, as far as the form can tell: the earliest session's
/// start for a multi-session event, otherwise "Starts at". The registration
/// window and the equipment section are stated against this ("before the event
/// starts"), and for a multi-session event that is when the first session
/// begins. Empty string when nothing usable has been entered yet.
export function effectiveStartsAt(values: FormValues): string {
  if (!values.multiSession) return values.startsAt;
  const starts = values.sessions
    .map((s) => s.startsAt)
    .filter((s) => s && !Number.isNaN(new Date(s).getTime()))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return starts[0] ?? "";
}

/// Mirrors the server's rules for the sessions of a multi-session event.
/// Errors are keyed `sessions.<n>.<field>` to match the inputs' `name`s, so
/// focusFirstError() can find the first one; a problem with the set as a whole
/// (too few sessions) goes under plain `sessions`.
///
/// A session's start and end are needed even for a draft: event_sessions'
/// times are NOT NULL, so a session cannot be saved half-empty the way an
/// event-level field can. Attendance and equipment are only needed to submit.
function validateSessions(values: FormValues, intent: "draft" | "submit"): FieldErrors {
  const errors: FieldErrors = {};

  if (values.sessions.length < MIN_SESSIONS) {
    errors.sessions = "Add at least two sessions, or untick multiple sessions.";
  }

  const now = new Date();
  values.sessions.forEach((session, i) => {
    const key = (field: string) => `sessions.${i}.${field}`;

    if (!session.startsAt) errors[key("startsAt")] = "Enter when this session starts.";
    if (!session.endsAt) errors[key("endsAt")] = "Enter when this session ends.";

    if (session.startsAt && session.endsAt && new Date(session.endsAt) <= new Date(session.startsAt)) {
      errors[key("endsAt")] = "Ends at must be after starts at.";
    }
    if (intent === "submit" && session.startsAt && new Date(session.startsAt) < now) {
      errors[key("startsAt")] = "The start date is in the past.";
    }

    if (intent === "submit") {
      const attendance = Number(session.expectedAttendance);
      if (!session.expectedAttendance) {
        errors[key("expectedAttendance")] = "Enter how many people you expect.";
      } else if (!Number.isInteger(attendance) || attendance < 1) {
        errors[key("expectedAttendance")] = "Enter a whole number of people, at least 1.";
      }
    }

    const rowError = equipmentRowError(session.equipment);
    if (rowError) errors[key("equipment")] = rowError;
  });

  // One item once per event, across every session together. The picker keeps
  // this from happening by hand; this is the check behind it.
  const ids = values.sessions.flatMap((s) => s.equipment.map((row) => row.equipmentId)).filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    errors.sessions =
      "Each item can only be requested once per event, across all sessions — change the quantity instead.";
  }

  return errors;
}

/// Mirrors the server's rules. `intent` is what separates a draft from a
/// submission — everything below the title is only required to submit.
export function validateForm(values: FormValues, intent: "draft" | "submit"): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.title.trim()) errors.title = "Give the event a name so you can find it again.";
  if (values.multiSession) Object.assign(errors, validateSessions(values, intent));

  // Event-level equipment rows are checked on a draft too (see
  // equipmentRowError). A multi-session event's rows are its sessions' own,
  // checked in validateSessions above.
  if (!values.multiSession) {
    const rowError = equipmentRowError(values.equipment);
    if (rowError) errors.equipment = rowError;
  }
  if (intent === "draft") return errors;

  if (!values.category) errors.category = "Choose the type of event.";

  // The event-level schedule, attendance and equipment only apply to a
  // single-session event; a multi-session one has them per session above.
  if (!values.multiSession) {
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
  }

  const eventStartsAt = effectiveStartsAt(values);

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
      eventStartsAt &&
      new Date(values.registrationOpensAt) >= new Date(eventStartsAt)
    ) {
      errors.registrationOpensAt = "Registration must open before the event starts.";
    }
    if (
      values.registrationClosesAt &&
      eventStartsAt &&
      new Date(values.registrationClosesAt) >= new Date(eventStartsAt) &&
      !errors.registrationClosesAt
    ) {
      errors.registrationClosesAt = "Registration must close before the event starts.";
    }
  }

  // Equipment rows are only meaningful once the event has dates — the
  // reservation window is derived from them (mirrors createEventSchema).
  // A multi-session event's equipment lives on its sessions (checked above).
  if (!values.multiSession && values.equipment.length > 0) {
    if (!values.startsAt || !values.endsAt) {
      errors.equipment = "Set the event date and time before requesting equipment.";
    } else if (equipmentRowError(values.equipment)) {
      // Already recorded above, before the draft/submit split.
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
    /// null / absent = requested for the whole event.
    sessionId?: string | null;
  }[];
  /// Absent on a single-session event and on responses from before sessions
  /// existed; both mean "no sessions".
  sessions?: {
    id: string;
    label: string | null;
    startsAt: string;
    endsAt: string;
    expectedAttendance: number | null;
    preferredLayout: string | null;
  }[];
}

/// Prefills the edit form from a saved draft. The inverse of the payload the
/// form sends back on save.
export function toFormValues(event: EventRecord): FormValues {
  const sessions = event.sessions ?? [];
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
    // Event-wide requests only; a session's own go on that session below.
    equipment: event.equipmentRequests.filter((e) => !e.sessionId).map(toEquipmentRow),
    multiSession: sessions.length > 0,
    sessions: sessions.map((session) => ({
      label: session.label ?? "",
      startsAt: toDateTimeLocalValue(session.startsAt),
      endsAt: toDateTimeLocalValue(session.endsAt),
      expectedAttendance: session.expectedAttendance != null ? String(session.expectedAttendance) : "",
      preferredLayout: session.preferredLayout ?? "",
      equipment: event.equipmentRequests.filter((e) => e.sessionId === session.id).map(toEquipmentRow),
    })),
  };
}

const toEquipmentRow = (e: EventRecord["equipmentRequests"][number]): EquipmentRow => ({
  equipmentId: e.equipmentId,
  quantityRequested: String(e.quantityRequested),
  technicalRequirements: e.technicalRequirements ?? "",
});

/// What the form sends for a multi-session event's sessions: the inverse of
/// the session half of toFormValues(). Empty strings become undefined so the
/// server sees "not given" rather than a blank label or layout. Only ever
/// called while `multiSession` is on - otherwise the form sends none (create)
/// or `[]` (edit, to drop the sessions a draft used to have).
export function sessionsPayload(values: FormValues) {
  return values.sessions.map((session) => ({
    label: session.label.trim() || undefined,
    startsAt: toIso(session.startsAt) as string,
    endsAt: toIso(session.endsAt) as string,
    expectedAttendance: session.expectedAttendance ? Number(session.expectedAttendance) : undefined,
    preferredLayout: session.preferredLayout || undefined,
    equipment: session.equipment.length
      ? session.equipment.map((row) => ({
          equipmentId: row.equipmentId,
          quantityRequested: Number(row.quantityRequested),
          technicalRequirements: row.technicalRequirements || undefined,
        }))
      : undefined,
  }));
}
