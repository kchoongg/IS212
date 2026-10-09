// Confirm Event (SPM-34). An event is confirmed once the arrangements that
// event actually needs are in place — discussion #80: approval means there is
// enough information to plan, confirmation means every arrangement the event
// requires is done, and the system should refuse to confirm while a required
// one is incomplete.
//
// What "required" means here is DERIVED from the event, not stored:
//
//   venue      always required. Every event happens somewhere, and a
//              multi-session event needs a room for each session (SPM-42 AC4
//              books per session, so confirmation checks per session).
//   equipment  required only when the coordinator recorded a requirement. An
//              event that needs no equipment confirms with a venue alone.
//   registration  required only while registration is enabled (SPM-64 AC8;
//              #80: "some events may not require ... attendee registration").
//              Complete once it has a capacity, an opening date and a closing
//              date, and the booking the capacity was measured against is
//              still active (Week 7 change #4: a tentative hold may expire).
//
// AC2 also allows the coordinator to mark an arrangement as NOT required.
// Nothing can record that yet - it belongs to Track Outstanding Arrangements -
// so `required` is computed below rather than read. When that story lands it
// should set `required` here instead of adding a second rule elsewhere.
//
// "Complete" is deliberately strict (decided 2026-10-03): a venue booking must
// be APPROVED, because a pending request is a question Venue Staff have not
// answered, and equipment must be RESERVED, for the same reason. Confirming on
// the strength of a request nobody has agreed to is exactly the double-booking
// the brief warns about (#35).
//
// Pure functions over plain data, like the rest of src/lib.

import { liveBookings } from "@/lib/registrationSettings";

/// Statuses that mean the arrangement is actually held, not merely asked for.
const BOOKING_HELD = "approved";
/// Mirrors COMMITTING_REQUEST_STATUSES in equipmentAvailability.ts: these are
/// the requests that take stock away from other events, so they are the ones
/// that count as arranged. `partially_fulfilled` counts - Technical Support
/// have committed what they can. Whether the shortfall is essential is the
/// Coordinator's decision (#90), which they make by confirming or not.
const EQUIPMENT_HELD = ["reserved", "partially_fulfilled"];

export type ArrangementKind = "venue" | "equipment" | "registration";

export interface SessionRef {
  id: string;
  label: string | null;
}

export interface Arrangement {
  kind: ArrangementKind;
  /// Null for a single-session event, or for equipment recorded against the
  /// whole event rather than one session.
  session: SessionRef | null;
  required: boolean;
  complete: boolean;
  /// What is still missing, in the coordinator's own terms. Empty when done.
  missing: string;
}

/// The event's registration settings (SPM-64), as saved.
export interface RegistrationSetup {
  enabled: boolean;
  capacity: number | null;
  opensAt: Date | null;
  closesAt: Date | null;
  /// Event.registrationVenueBookingId: the booking the capacity is measured against.
  measuredBookingId: string | null;
}

export interface ConfirmationInput {
  /// Empty for a single-session event.
  sessions: readonly SessionRef[];
  /// `id` is needed only to tell whether registration's measured booking is
  /// still active.
  bookings: readonly { id?: string; sessionId: string | null; status: string }[];
  equipment: readonly { sessionId: string | null; status: string; equipmentName: string }[];
  /// Omitted by a caller that has nothing to say about registration.
  registration?: RegistrationSetup;
}

export interface RegistrationGaps {
  /// In the order the form asks for them.
  stillNeeded: ("registration capacity" | "opening date" | "closing date")[];
  /// A capacity was measured against a booking that is no longer pending or
  /// approved - rejected, cancelled, or an expired tentative hold.
  bookingLost: boolean;
}

/// What registration setup still lacks. Also what the Registration card's
/// "Registration setup is incomplete" alert shows, so the two never disagree.
/// Only meaningful while registration is enabled.
export function registrationGaps(
  setup: RegistrationSetup,
  bookings: readonly { id?: string; status: string }[]
): RegistrationGaps {
  const stillNeeded: RegistrationGaps["stillNeeded"] = [];
  if (setup.capacity == null) stillNeeded.push("registration capacity");
  if (!setup.opensAt) stillNeeded.push("opening date");
  if (!setup.closesAt) stillNeeded.push("closing date");
  // Active means what the capacity may be measured against (SPM-64 AC3).
  const bookingLost =
    setup.measuredBookingId != null && !liveBookings(bookings).some((b) => b.id === setup.measuredBookingId);
  return { stillNeeded, bookingLost };
}

/** "the Morning briefing session" / "this event" — how a refusal refers to it. */
function whose(session: SessionRef | null): string {
  if (!session) return "this event";
  return session.label ? `the ${session.label} session` : "one session";
}

/// Every arrangement this event needs, complete or not, in the order a
/// coordinator would work through them: the room first, then its kit, then
/// registration.
export function arrangementsFor(input: ConfirmationInput): Arrangement[] {
  const { sessions, bookings, equipment } = input;
  const out: Arrangement[] = [];

  // --- Venue, once per session (or once for the whole event) ---------------
  const venueHolders: (SessionRef | null)[] = sessions.length > 0 ? [...sessions] : [null];
  for (const session of venueHolders) {
    const held = bookings.some(
      (b) => b.status === BOOKING_HELD && (session === null || b.sessionId === session.id)
    );
    const requested = bookings.some(
      (b) => b.status === "pending" && (session === null || b.sessionId === session.id)
    );
    out.push({
      kind: "venue",
      session,
      required: true,
      complete: held,
      missing: held
        ? ""
        : requested
          ? `the venue for ${whose(session)} is still awaiting a decision from Venue Staff`
          : `no venue is booked for ${whose(session)}`,
    });
  }

  // --- Equipment, only where some was recorded -----------------------------
  // Grouped by session so a refusal can name which part of the event is short,
  // the same way the venue check does.
  const byHolder = new Map<string | null, typeof equipment>();
  for (const item of equipment) {
    const key = sessions.length > 0 ? item.sessionId : null;
    byHolder.set(key, [...(byHolder.get(key) ?? []), item]);
  }

  for (const [sessionId, items] of byHolder) {
    const session = sessionId == null ? null : (sessions.find((s) => s.id === sessionId) ?? null);
    const outstanding = items.filter((i) => !EQUIPMENT_HELD.includes(i.status));
    out.push({
      kind: "equipment",
      session,
      required: true,
      complete: outstanding.length === 0,
      missing:
        outstanding.length === 0
          ? ""
          : `${outstanding.map((i) => i.equipmentName).join(", ")} for ${whose(session)} ${
              outstanding.length === 1 ? "is" : "are"
            } not reserved yet`,
    });
  }

  // --- Registration, only once enabled ---------------------------------------
  if (input.registration) {
    const { stillNeeded, bookingLost } = registrationGaps(input.registration, bookings);
    const missing = [
      ...(stillNeeded.length > 0 ? [`registration setup is incomplete (still needed: ${stillNeeded.join(", ")})`] : []),
      ...(bookingLost ? ["registration capacity is measured against a venue booking that is no longer active"] : []),
    ];
    out.push({
      kind: "registration",
      session: null,
      required: input.registration.enabled,
      complete: missing.length === 0,
      missing: missing.join("; "),
    });
  }

  return out;
}

export type ConfirmationCheck =
  | { ok: true }
  | { ok: false; error: string; outstanding: Arrangement[] };

/// AC1 and AC3: confirmation is refused while a required arrangement is
/// incomplete, and the refusal names what is incomplete rather than only that
/// something is.
export function checkEventConfirmation(input: ConfirmationInput): ConfirmationCheck {
  const outstanding = arrangementsFor(input).filter((a) => a.required && !a.complete);
  if (outstanding.length === 0) return { ok: true };

  return {
    ok: false,
    error: `This event cannot be confirmed yet: ${outstanding.map((a) => a.missing).join("; ")}.`,
    outstanding,
  };
}
