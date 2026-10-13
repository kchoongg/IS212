// Confirm Event (SPM-34) and Track Outstanding Arrangements (SPM-33). An event
// is confirmed once the arrangements that event actually needs are in place —
// discussion #80: approval means there is enough information to plan,
// confirmation means every arrangement the event requires is done, and the
// system should refuse to confirm while a required one is incomplete.
//
// ONE rule serves two screens: the Readiness tab lists arrangementsFor(), and
// Confirm refuses on the rows of that same list that are required and not
// complete. So what the Coordinator is shown as outstanding is exactly what
// stops them confirming.
//
// What is listed (decided 2026-10-08):
//
//   venue         one row per PENDING or APPROVED booking - an event can have
//                 several (SPM-81), each named with what its space is for
//                 (SPM-90), and every one that is still required must be
//                 approved before the event is confirmed (SPM-90 AC6). A rejected or cancelled request is not an
//                 arrangement and is not listed. An event, or each session of
//                 a multi-session event, that is left with no such booking
//                 still required gets a "No venue booked" row: every event
//                 happens somewhere, so that row can never be waived.
//   equipment     one row per equipment line the coordinator recorded. An
//                 event that needs no equipment has none.
//   registration  one row (SPM-64 AC8). Required only while registration is
//                 enabled (#80: "some events may not require ... attendee
//                 registration"); while it is off the row is "Not required",
//                 and it was not the Coordinator who decided that. Complete
//                 once it has a capacity, an opening date and a closing date,
//                 and the booking the capacity was measured against is still
//                 active (Week 7 change #4: a tentative hold may expire).
//                 SPM-64's rule and wording, kept when the two stories met.
//
// "Complete" is deliberately strict (decided 2026-10-03): a venue booking must
// be APPROVED, because a pending request is a question Venue Staff have not
// answered, and equipment must be RESERVED or PARTIALLY FULFILLED - Technical
// Support have committed what they can, and the same statuses take stock from
// other events (COMMITTING_REQUEST_STATUSES in equipmentAvailability.ts). This
// is the rule Submit for safety check uses too (SPM-86, decided 2026-10-09), so
// Submit and Confirm never disagree. A line that is requested, under review or
// cannot be provided is outstanding until the Coordinator marks it as not
// required (#90, #106). An arrangement flagged for review (SPM-39, SPM-62) is
// outstanding too, whatever its status, until it is resolved (SPM-68).
//
// The Coordinator can mark any booking, equipment line or the registration
// setup as NOT REQUIRED for this event, and reverse it. It then prevents
// nothing, and is shown as such with who decided and when (briefing 8f).
//
// The OPERATIONAL SAFETY CHECK (SPM-86) is the last row, from the event's
// latest SafetyCheck: required, complete only once approved, and never
// waivable (SPM-33 AC9). While the check is PENDING it blocks confirmation:
// the event is in Safety review, which cannot move to Confirmed until the
// Safety Officer decides (SPM-86's lifecycle). Otherwise it does not stop
// Confirm yet: that gate is Resolve Safety Check Outcome's (SPM-88, decided
// 2026-10-08), and the Safety Officer's decision (SPM-87) is not built, so
// nothing could ever be confirmed if it did. SPM-88 turns it on by setting
// SAFETY_CHECK_BLOCKS_CONFIRMATION to true.
//
// ADDING AN ARRANGEMENT: add its kind to ArrangementKind, its data to
// ConfirmationInput, and a block in arrangementsFor() that builds its row with
// arrangement(). Leave the kind out of WAIVABLE_KINDS and pass `waivable:
// false` if it can never be marked as not required. The route, the Readiness
// tab and the blocking count need no change.
//
// Pure functions over plain data, like the rest of src/lib.

import { CHANGE_REASON_PROSE } from "./eventChangeImpact";
import { IMPACT_REASON_PROSE } from "./venueImpact";
import { EQUIPMENT_REASON_PROSE } from "./equipmentOutOfService";
import { formatDateTime } from "./format";
import { liveBookings } from "@/lib/registrationSettings";

/// Bookings that are arrangements at all: asked for, or held.
const BOOKING_LISTED = ["pending", "approved"];
/// Statuses that mean the arrangement is actually held, not merely asked for.
const BOOKING_HELD = "approved";
/// The same as EQUIPMENT_HELD in safetyCheck.ts (SPM-86).
const EQUIPMENT_HELD = ["reserved", "partially_fulfilled"];
const EQUIPMENT_DROPPED = "cancelled";

export type ArrangementKind = "venue" | "equipment" | "registration" | "safety_check";

/// Whether an outstanding Operational Safety Check stops Confirm. False until
/// Resolve Safety Check Outcome (SPM-88) adds that gate - see the header.
export const SAFETY_CHECK_BLOCKS_CONFIRMATION = false;

/// The kinds a Coordinator may mark as not required. The route's request
/// schema is built from this list, so a kind that is not here cannot be waived
/// however the request is written.
export const WAIVABLE_KINDS = ["venue", "equipment", "registration"] as const satisfies readonly ArrangementKind[];

export type ArrangementState = "complete" | "outstanding" | "not_required";

export interface SessionRef {
  id: string;
  label: string | null;
}

export interface Arrangement {
  kind: ArrangementKind;
  /// The booking's or equipment request's id. Null for "No venue booked" and
  /// for registration, which belong to the event itself.
  id: string | null;
  /// The venue, the equipment item, "Registration setup" or "No venue booked".
  name: string;
  /// Null for a single-session event, or for something recorded against the
  /// whole event rather than one session.
  session: SessionRef | null;
  /// The booking's or request's own status; null where there is none.
  status: string | null;
  state: ArrangementState;
  /// False once the Coordinator has marked it as not required.
  required: boolean;
  complete: boolean;
  /// What is still missing, in the coordinator's own terms. Empty unless outstanding.
  missing: string;
  /// Why it was flagged for review, in words. Empty when it is not flagged.
  flagReason: string;
  /// Whether it may be marked as not required now: only an outstanding one.
  waivable: boolean;
  /// True only when the Coordinator marked it as not required - so it can be
  /// marked as required again. Registration that is switched off is not
  /// required too, but nobody waived it.
  waived: boolean;
  /// Who marked it as not required, and when. Null unless it is marked.
  notRequiredBy: string | null;
  notRequiredAt: Date | null;
  /// SPM-90: what a venue booking's space is for ("Breakout room"). Null for a
  /// booking made without one, and for everything that is not a booking.
  purpose: string | null;
  /// Whether, while outstanding, it stops Confirm. False only for the
  /// Operational Safety Check, until SPM-88.
  blocksConfirmation: boolean;
  /// A line of context, e.g. who submitted the safety check and when. "" for none.
  note: string;
}

/// The Coordinator's decision that an arrangement is not required.
interface Waiver {
  notRequired?: boolean;
  /// The person's name, for display.
  notRequiredBy?: string | null;
  notRequiredAt?: Date | null;
}

/// A review flag raised by a venue change (SPM-39) or an event change (SPM-62).
interface ReviewFlag {
  needsReview?: boolean;
  /// Comma-separated reason codes, as stored.
  reviewReason?: string | null;
}

export interface BookingInput extends Waiver, ReviewFlag {
  id?: string;
  sessionId: string | null;
  status: string;
  venueName?: string;
  /// SPM-90: what this space is for.
  purpose?: string | null;
}

export interface EquipmentInput extends Waiver, ReviewFlag {
  id?: string;
  sessionId: string | null;
  status: string;
  equipmentName: string;
}

/// The event's registration settings (SPM-64), as saved.
export interface RegistrationSetup {
  enabled: boolean;
  capacity: number | null;
  opensAt: Date | null;
  closesAt: Date | null;
  /// Event.registrationVenueBookingId: the booking the capacity is measured against.
  measuredBookingId?: string | null;
}

export interface RegistrationInput extends RegistrationSetup, Waiver {}

export interface RegistrationGaps {
  /// In the order the form asks for them.
  stillNeeded: ("registration capacity" | "opening date" | "closing date")[];
  /// A capacity was measured against a booking that is no longer pending or
  /// approved - rejected, cancelled, or an expired tentative hold.
  bookingLost: boolean;
}

/// What registration setup still lacks (SPM-64). Also what the Registration
/// card's "Registration setup is incomplete" alert shows, so the two never
/// disagree. Only meaningful while registration is enabled.
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

/// The event's latest Operational Safety Check (SPM-86).
export interface SafetyCheckInput {
  id: string;
  /// pending | approved | changes_requested | rejected | closed
  status: string;
  /// The person's name, for display.
  submittedBy: string | null;
  submittedAt: Date;
}

export interface ConfirmationInput {
  /// Empty for a single-session event.
  sessions: readonly SessionRef[];
  bookings: readonly BookingInput[];
  equipment: readonly EquipmentInput[];
  /// Omitted by a caller that has nothing to say about registration.
  registration?: RegistrationInput;
  /// Null when the event was never submitted for a safety check. Absent means
  /// "not asked": no safety row - how Submit for safety check uses this list.
  safetyCheck?: SafetyCheckInput | null;
}

/** "the Morning briefing session" / "this event" — how a refusal refers to it. */
function whose(session: SessionRef | null): string {
  if (!session) return "this event";
  return session.label ? `the ${session.label} session` : "one session";
}

/// Every reason code a flag may carry, in words: venue edits and unavailable
/// periods (SPM-39, SPM-45), event changes (SPM-62) and equipment taken out of
/// service (SPM-55). The same three sources as safetyCheck.ts.
const REASON_PROSE: Record<string, string> = {
  ...IMPACT_REASON_PROSE,
  ...CHANGE_REASON_PROSE,
  ...EQUIPMENT_REASON_PROSE,
};

/// "the venue has been retired; the date or time changed". Every writer of a
/// reviewReason column knows only its own codes (src/lib/reviewFlags.ts), so a
/// code this file has not been taught is still shown, in its plainest form,
/// rather than hiding that the arrangement is flagged.
function flagReasonFor(flag: ReviewFlag): string {
  if (!flag.needsReview) return "";
  const reasons = (flag.reviewReason ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => REASON_PROSE[code] ?? code.replace(/_/g, " "));
  return reasons.length > 0 ? reasons.join("; ") : "no reason was recorded";
}

/// One row. `problem` is what is missing ("" when nothing is); the state,
/// whether it is required, and whether it can be waived all follow from that
/// and from the Coordinator's decision.
function arrangement(
  row: Pick<Arrangement, "kind" | "id" | "name" | "session" | "status"> & { purpose?: string | null },
  problem: string,
  {
    waiver = {},
    flagReason = "",
    waivable = true,
    blocksConfirmation = true,
    note = "",
    notNeeded = false,
  }: {
    waiver?: Waiver;
    flagReason?: string;
    waivable?: boolean;
    blocksConfirmation?: boolean;
    note?: string;
    /// Not required, but not by the Coordinator's decision (registration off).
    notNeeded?: boolean;
  } = {}
): Arrangement {
  const waived = waiver.notRequired === true;
  const notRequired = waived || notNeeded;
  const outstanding = !notRequired && problem !== "";
  return {
    ...row,
    purpose: row.purpose ?? null,
    state: notRequired ? "not_required" : outstanding ? "outstanding" : "complete",
    required: !notRequired,
    complete: !notRequired && !outstanding,
    missing: outstanding ? problem : "",
    flagReason,
    waivable: outstanding && waivable,
    waived,
    notRequiredBy: waived ? (waiver.notRequiredBy ?? null) : null,
    notRequiredAt: waived ? (waiver.notRequiredAt ?? null) : null,
    blocksConfirmation,
    note,
  };
}

const SAFETY = "the Operational Safety Check";

/// How each SafetyCheck status is shown, and what is missing while it is not
/// approved (SPM-33 AC6). A check closed by a change (SPM-88) has to be
/// submitted again, so it reads as not submitted.
const SAFETY_STATES: Record<string, { shown: string; missing: string }> = {
  pending: { shown: "awaiting_review", missing: `${SAFETY} is awaiting the Safety Officer's review` },
  approved: { shown: "approved", missing: "" },
  changes_requested: { shown: "changes_requested", missing: `the Safety Officer asked for changes in ${SAFETY}` },
  rejected: { shown: "rejected", missing: "the Safety Officer rejected the safety arrangement" },
  closed: { shown: "not_submitted", missing: `${SAFETY} has to be submitted again` },
};

function safetyRow(check: SafetyCheckInput | null): Arrangement {
  const state = check
    ? (SAFETY_STATES[check.status] ?? { shown: check.status, missing: `${SAFETY} is not approved yet` })
    : { shown: "not_submitted", missing: `${SAFETY} has not been submitted yet` };
  const note = check
    ? `Submitted${check.submittedBy ? ` by ${check.submittedBy}` : ""} on ${formatDateTime(check.submittedAt)}`
    : "";
  return arrangement(
    {
      kind: "safety_check",
      id: check?.id ?? null,
      name: "Operational Safety Check",
      session: null,
      status: `safety_${state.shown}`,
    },
    state.missing,
    {
      waivable: false,
      blocksConfirmation: SAFETY_CHECK_BLOCKS_CONFIRMATION || check?.status === "pending",
      note,
    }
  );
}

/// Every arrangement of this event, complete or not, in the order a
/// coordinator would work through them: the rooms, then the kit, then
/// registration.
export function arrangementsFor(input: ConfirmationInput): Arrangement[] {
  const { sessions, bookings, equipment, registration } = input;
  const out: Arrangement[] = [];

  // --- Venue: each booking on its own, per session (or for the whole event) --
  const listed = bookings.filter((b) => BOOKING_LISTED.includes(b.status));
  const sessionOf = (sessionId: string | null) =>
    sessionId == null ? null : (sessions.find((s) => s.id === sessionId) ?? null);

  const bookingRow = (b: BookingInput, session: SessionRef | null): Arrangement => {
    const flagReason = flagReasonFor(b);
    // SPM-90 (AC6): the booking is identified by what its space is for too -
    // "Orchard Studio (Breakout room) for this event".
    const purpose = b.purpose?.trim() || null;
    const subject = `${b.venueName ?? "the venue"}${purpose ? ` (${purpose})` : ""} for ${whose(session)}`;
    const problem =
      b.status !== BOOKING_HELD
        ? `${subject} is still awaiting a decision from Venue Staff`
        : flagReason
          ? `${subject} is flagged for review: ${flagReason}`
          : "";
    return arrangement(
      { kind: "venue", id: b.id ?? null, name: b.venueName ?? "Venue", session, status: b.status, purpose },
      problem,
      { waiver: b, flagReason }
    );
  };

  const venueHolders: (SessionRef | null)[] = sessions.length > 0 ? [...sessions] : [null];
  for (const session of venueHolders) {
    const mine = listed.filter((b) => session === null || b.sessionId === session.id);
    out.push(...mine.map((b) => bookingRow(b, session)));

    // A booking marked as not required does not hold this event a room.
    if (!mine.some((b) => !b.notRequired)) {
      out.push(
        arrangement(
          { kind: "venue", id: null, name: "No venue booked", session, status: null },
          `no venue is booked for ${whose(session)}`,
          { waivable: false }
        )
      );
    }
  }
  // A booking of a multi-session event that names no session (or one that no
  // longer exists) is still listed, so nothing the event holds goes unseen.
  if (sessions.length > 0) {
    out.push(...listed.filter((b) => sessionOf(b.sessionId) === null).map((b) => bookingRow(b, null)));
  }

  // --- Equipment: each line on its own ---------------------------------------
  for (const item of equipment) {
    if (item.status === EQUIPMENT_DROPPED) continue;
    const session = sessions.length > 0 ? sessionOf(item.sessionId) : null;
    const flagReason = flagReasonFor(item);
    const subject = `${item.equipmentName} for ${whose(session)}`;
    const problem = !EQUIPMENT_HELD.includes(item.status)
      ? `${subject} is not reserved yet`
      : flagReason
        ? `${subject} is flagged for review: ${flagReason}`
        : "";
    out.push(
      arrangement(
        { kind: "equipment", id: item.id ?? null, name: item.equipmentName, session, status: item.status },
        problem,
        { waiver: item, flagReason }
      )
    );
  }

  // --- Registration (SPM-64 AC8) ---------------------------------------------
  if (registration) {
    const { stillNeeded, bookingLost } = registrationGaps(registration, bookings);
    const lacking = [
      ...(stillNeeded.length > 0 ? [`registration setup is incomplete (still needed: ${stillNeeded.join(", ")})`] : []),
      ...(bookingLost ? ["registration capacity is measured against a venue booking that is no longer active"] : []),
    ];
    out.push(
      arrangement(
        { kind: "registration", id: null, name: "Registration setup", session: null, status: null },
        registration.enabled ? lacking.join("; ") : "",
        registration.enabled
          ? { waiver: registration }
          : { notNeeded: true, note: "Registration is not enabled for this event." }
      )
    );
  }

  // --- The Operational Safety Check, last: it reviews everything above -------
  if (input.safetyCheck !== undefined) {
    out.push(safetyRow(input.safetyCheck));
  }

  return out;
}

/// The rows preventing confirmation: required, not complete, and of a kind
/// Confirm waits for.
export function blockingArrangements(arrangements: readonly Arrangement[]): Arrangement[] {
  return arrangements.filter((a) => a.required && !a.complete && a.blocksConfirmation);
}

export type ConfirmationCheck =
  | { ok: true }
  | { ok: false; error: string; outstanding: Arrangement[] };

/// SPM-34 AC1 and AC3, SPM-33 AC11: confirmation is refused while a required
/// arrangement is incomplete, and the refusal names what is incomplete rather
/// than only that something is. An arrangement marked as not required is not
/// required, so it never appears here.
export function checkEventConfirmation(input: ConfirmationInput): ConfirmationCheck {
  const outstanding = blockingArrangements(arrangementsFor(input));
  if (outstanding.length === 0) return { ok: true };

  return {
    ok: false,
    error: `This event cannot be confirmed yet: ${outstanding.map((a) => a.missing).join("; ")}.`,
    outstanding,
  };
}
