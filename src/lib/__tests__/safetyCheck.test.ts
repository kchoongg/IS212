// SPM-86 - whether an event's arrangements are ready for an Operational Safety
// Check (AC1, AC2).
//
// CONTRACT (SPM-86, written before the code and built to it):
//   src/lib/safetyCheck.ts
//     checkSafetySubmission(input) -> { ok: true } | { ok: false, error, outstanding: string[] }
//       input: { sessions, bookings: { sessionId, status, venueName, needsReview, reviewReason }[],
//                equipment: { sessionId, status, equipmentName, needsReview, reviewReason }[] }
//     SAFETY_CHECK_PENDING_MESSAGE = "A safety check is already pending for this event."
//   The outstanding reasons are Confirm event's (arrangementsFor, SPM-34) first, then
//   every HELD arrangement that is flagged for review, with its reasons in words.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the wording of the refusal and of a flagged item
//   - a flag on a booking or request that is not held (pending, rejected, requested...) adds
//     nothing: an unheld item is already named, and a rejected one is not in play

import { describe, expect, it } from "vitest";
import { SAFETY_CHECK_PENDING_MESSAGE, checkSafetySubmission } from "@/lib/safetyCheck";

const VENUE = "Orchard Seminar Room";
const MIC = "Handheld Wireless Mic";

function booking(overrides: Record<string, unknown> = {}) {
  return { sessionId: null, status: "approved", venueName: VENUE, needsReview: false, reviewReason: null, ...overrides };
}

function item(overrides: Record<string, unknown> = {}) {
  return { sessionId: null, status: "reserved", equipmentName: MIC, needsReview: false, reviewReason: null, ...overrides };
}

function check(input: { sessions?: { id: string; label: string | null }[]; bookings?: object[]; equipment?: object[] }) {
  return checkSafetySubmission({
    sessions: input.sessions ?? [],
    bookings: (input.bookings ?? []) as Parameters<typeof checkSafetySubmission>[0]["bookings"],
    equipment: (input.equipment ?? []) as Parameters<typeof checkSafetySubmission>[0]["equipment"],
  });
}

const PREFIX = "This event cannot be submitted for a safety check yet: ";

describe("checkSafetySubmission - ready (AC1)", () => {
  it("[SPM-86][AC1] accepts an approved venue and reserved equipment", () => {
    expect(check({ bookings: [booking()], equipment: [item()] })).toEqual({ ok: true });
  });

  it("[SPM-86][AC1] accepts equipment Technical Support could only partly supply, as Confirm event does", () => {
    expect(check({ bookings: [booking()], equipment: [item({ status: "partially_fulfilled" })] })).toEqual({ ok: true });
  });

  it("[SPM-86][AC1] accepts an event that recorded no equipment at all", () => {
    expect(check({ bookings: [booking()] })).toEqual({ ok: true });
  });

  it("[SPM-86][AC1] ignores a flag on a booking that is no longer in play", () => {
    const rejected = booking({ status: "rejected", needsReview: true, reviewReason: "event_schedule_changed" });
    expect(check({ bookings: [rejected, booking()], equipment: [item()] })).toEqual({ ok: true });
  });
});

// SPM-77: a suggested alternative still waiting for the Coordinator's decision
// keeps the event in Planning, where the decision can be made.
describe("checkSafetySubmission - a suggested alternative waiting for a decision (SPM-77)", () => {
  const waiting = "Ring Light for this event has a suggested alternative (Podium Light) waiting for the Coordinator's decision";

  it("[SPM-77][AC5][AC6] refuses while a partly fulfilled item has one, naming the item and the alternative", () => {
    const result = check({
      bookings: [booking()],
      equipment: [item(), item({ status: "partially_fulfilled", equipmentName: "Ring Light", pendingSuggestion: "Podium Light" })],
    });

    expect(result).toEqual({ ok: false, error: `${PREFIX}${waiting}.`, outstanding: [waiting] });
  });

  it("[SPM-77][AC5][AC6] refuses even when the item was marked as not required - decline the suggestion instead", () => {
    const result = check({
      bookings: [booking()],
      equipment: [item({ status: "unavailable", equipmentName: "Ring Light", notRequired: true, pendingSuggestion: "Podium Light" })],
    });

    expect(!result.ok && result.outstanding).toEqual([waiting]);
  });

  it("[SPM-77][AC5][AC6] accepts an item whose suggestion has been decided", () => {
    expect(check({ bookings: [booking()], equipment: [item({ pendingSuggestion: null })] })).toEqual({ ok: true });
  });
});

describe("checkSafetySubmission - refused (AC2)", () => {
  it("[SPM-86][AC2] names a pending venue and an unreserved item, and not the item that is reserved", () => {
    const result = check({
      bookings: [booking({ status: "pending" })],
      equipment: [item(), item({ status: "requested", equipmentName: "Audio Mixing Desk" })],
    });

    expect(result).toEqual({
      ok: false,
      error:
        PREFIX +
        "the venue for this event is still awaiting a decision from Venue Staff; " +
        "Audio Mixing Desk for this event is not reserved yet.",
      outstanding: [
        "the venue for this event is still awaiting a decision from Venue Staff",
        "Audio Mixing Desk for this event is not reserved yet",
      ],
    });
  });

  it("[SPM-86][AC2] refuses an event with no venue at all", () => {
    const result = check({ equipment: [item()] });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(PREFIX + "no venue is booked for this event.");
  });

  it("[SPM-86][AC2] refuses an approved venue booking that is flagged for review, with the reason in words", () => {
    const flagged = booking({ needsReview: true, reviewReason: "event_schedule_changed" });

    const result = check({ bookings: [flagged], equipment: [item()] });

    expect(result).toEqual({
      ok: false,
      error: PREFIX + `the venue booking at ${VENUE} for this event is flagged for review (the date or time changed).`,
      outstanding: [`the venue booking at ${VENUE} for this event is flagged for review (the date or time changed)`],
    });
  });

  // SPM-88 (AC3, SPM-88-TC04): flags set after a returned check block resubmission.
  it("[SPM-86][AC2] refuses an arrangement flagged after the safety check was returned, saying so", () => {
    const flagged = booking({ needsReview: true, reviewReason: "safety_check_returned" });

    const result = check({ bookings: [flagged], equipment: [item()] });

    expect(result).toMatchObject({
      ok: false,
      outstanding: [
        `the venue booking at ${VENUE} for this event is flagged for review (the Safety Officer returned the safety check)`,
      ],
    });
  });

  it("[SPM-86][AC2] refuses reserved equipment that is flagged for review, naming only that item", () => {
    const flagged = item({ needsReview: true, reviewReason: "event_schedule_changed" });

    const result = check({ bookings: [booking()], equipment: [flagged] });

    expect(!result.ok && result.error).toBe(
      PREFIX + `${MIC} for this event is flagged for review (the date or time changed).`
    );
  });

  it("[SPM-86][AC2] flags partly fulfilled equipment the same as reserved", () => {
    const flagged = item({ status: "partially_fulfilled", needsReview: true, reviewReason: "event_schedule_changed" });

    expect(check({ bookings: [booking()], equipment: [flagged] }).ok).toBe(false);
  });

  it("[SPM-86][AC2] words a reason a venue edit stored (SPM-39)", () => {
    const flagged = booking({ needsReview: true, reviewReason: "venue_retired" });

    const result = check({ bookings: [flagged] });

    expect(!result.ok && result.error).toBe(
      PREFIX + `the venue booking at ${VENUE} for this event is flagged for review (the venue has been retired).`
    );
  });

  it("[SPM-86][AC2] words a reason SPM-55 stored when units went out of service", () => {
    const flagged = item({ needsReview: true, reviewReason: "equipment_unavailable" });

    const result = check({ bookings: [booking()], equipment: [flagged] });

    expect(!result.ok && result.error).toBe(
      PREFIX + `${MIC} for this event is flagged for review (units of the equipment were marked out of service).`
    );
  });

  it("[SPM-86][AC2] lists every reason a flag carries", () => {
    const flagged = booking({ needsReview: true, reviewReason: "event_schedule_changed,event_attendance_changed" });

    const result = check({ bookings: [flagged] });

    expect(!result.ok && result.error).toContain(
      "is flagged for review (the date or time changed, the expected attendance changed)."
    );
  });

  it("[SPM-86][AC2] still refuses a flag whose reason it does not recognise", () => {
    const flagged = booking({ needsReview: true, reviewReason: "something_new" });

    const result = check({ bookings: [flagged] });

    expect(!result.ok && result.error).toBe(
      PREFIX + `the venue booking at ${VENUE} for this event is flagged for review.`
    );
  });

  it("[SPM-86][AC2] still refuses a flag with no reason stored", () => {
    const result = check({ bookings: [booking({ needsReview: true, reviewReason: null })] });

    expect(!result.ok && result.error).toBe(PREFIX + `the venue booking at ${VENUE} for this event is flagged for review.`);
  });

  it("[SPM-86][AC2] calls a session with no label 'one session'", () => {
    const result = check({
      sessions: [{ id: "s1", label: null }],
      bookings: [booking({ sessionId: "s1", needsReview: true, reviewReason: "venue_retired" })],
    });

    expect(!result.ok && result.outstanding).toEqual([
      `the venue booking at ${VENUE} for one session is flagged for review (the venue has been retired)`,
    ]);
  });

  it("[SPM-86][AC2] names the session of a flagged booking on a multi-session event", () => {
    const sessions = [
      { id: "s1", label: "Day 1" },
      { id: "s2", label: "Day 2" },
    ];
    const result = check({
      sessions,
      bookings: [
        booking({ sessionId: "s1" }),
        booking({ sessionId: "s2", needsReview: true, reviewReason: "event_schedule_changed" }),
      ],
    });

    expect(!result.ok && result.error).toBe(
      PREFIX + `the venue booking at ${VENUE} for the Day 2 session is flagged for review (the date or time changed).`
    );
  });

  it("[SPM-86][AC2] lists unheld arrangements before flagged ones", () => {
    const result = check({
      bookings: [booking({ needsReview: true, reviewReason: "venue_retired" })],
      equipment: [item({ status: "requested" })],
    });

    expect(!result.ok && result.outstanding).toEqual([
      `${MIC} for this event is not reserved yet`,
      `the venue booking at ${VENUE} for this event is flagged for review (the venue has been retired)`,
    ]);
  });
});

describe("SAFETY_CHECK_PENDING_MESSAGE (AC6)", () => {
  it("[SPM-86][AC6] is the message for a second submission", () => {
    expect(SAFETY_CHECK_PENDING_MESSAGE).toBe("A safety check is already pending for this event.");
  });
});

// Added when SPM-33 (Track Outstanding Arrangements) was merged in. AC1:
// "equipment arrangements are reserved or marked as not required".
describe("checkSafetySubmission - arrangements marked as not required (SPM-33)", () => {
  it("[SPM-86][AC1] [SPM-33][AC11] accepts an event whose only unreserved item is marked as not required", () => {
    const result = checkSafetySubmission({
      sessions: [],
      bookings: [booking()],
      equipment: [item(), item({ equipmentName: "Portable Stage", status: "unavailable", notRequired: true })],
    });

    expect(result).toEqual({ ok: true });
  });

  it("[SPM-86][AC1] [SPM-33][AC11] accepts a spare venue request that is marked as not required while another venue is approved", () => {
    const result = checkSafetySubmission({
      sessions: [],
      bookings: [booking(), booking({ status: "pending", venueName: "Orchard Studio", notRequired: true })],
      equipment: [],
    });

    expect(result).toEqual({ ok: true });
  });

  it("[SPM-86][AC2] [SPM-33][AC11] does not name a flagged booking or item that is marked as not required", () => {
    const flag = { needsReview: true, reviewReason: "event_schedule_changed", notRequired: true };
    const result = checkSafetySubmission({
      sessions: [],
      bookings: [booking(), booking({ venueName: "Orchard Studio", ...flag })],
      equipment: [item({ ...flag })],
    });

    expect(result).toEqual({ ok: true });
  });

  it("[SPM-86][AC2] [SPM-33][AC11] still refuses an event whose only venue booking is marked as not required", () => {
    const result = checkSafetySubmission({
      sessions: [],
      bookings: [booking({ notRequired: true })],
      equipment: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outstanding).toEqual(["no venue is booked for this event"]);
  });
});
