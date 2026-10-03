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

/// Statuses that mean the arrangement is actually held, not merely asked for.
const BOOKING_HELD = "approved";
/// Mirrors COMMITTING_REQUEST_STATUSES in equipmentAvailability.ts: these are
/// the requests that take stock away from other events, so they are the ones
/// that count as arranged. `partially_fulfilled` counts - Technical Support
/// have committed what they can, and the shortfall is their decision to make,
/// not a reason to hold up the whole event.
const EQUIPMENT_HELD = ["reserved", "partially_fulfilled"];

export type ArrangementKind = "venue" | "equipment";

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

export interface ConfirmationInput {
  /// Empty for a single-session event.
  sessions: readonly SessionRef[];
  bookings: readonly { sessionId: string | null; status: string }[];
  equipment: readonly { sessionId: string | null; status: string; equipmentName: string }[];
}

/** "the Morning briefing session" / "this event" — how a refusal refers to it. */
function whose(session: SessionRef | null): string {
  if (!session) return "this event";
  return session.label ? `the ${session.label} session` : "one session";
}

/// Every arrangement this event needs, complete or not, in the order a
/// coordinator would work through them: the room first, then its kit.
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
