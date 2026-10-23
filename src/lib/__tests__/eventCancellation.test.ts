import { describe, it, expect } from "vitest";
import {
  CHANGE_REQUEST_CLOSED_NOTE,
  EVENT_CANCELLED_MESSAGE,
  NOTHING_TO_RELEASE,
  NO_CANCELLATION_REASON,
  SAFETY_CHECK_CLOSED_NOTE,
  arrangementCancellationNote,
  cancellationConsequences,
  type CancellationInput,
} from "../eventCancellation";

// CONTRACT (SPM-37, written before the code) - what these tests expect to exist:
//   src/lib/eventCancellation.ts, pure:
//     cancellationConsequences(input) -> string[]: the lines under "Cancelling
//       will:" in the Cancel event dialog (UI_DESIGN.md §7.4, §7.5), in this
//       order - Approved bookings, Pending requests, reserved equipment, equipment
//       not yet reserved, pending change requests, the pending safety check,
//       registration. [] when there is nothing; the page then shows NOTHING_TO_RELEASE.
//     arrangementCancellationNote(reason) -> the reason stored on each released
//       or withdrawn booking: "Event cancelled: <reason>", or "Event cancelled."
//     EVENT_CANCELLED_MESSAGE, NO_CANCELLATION_REASON, NOTHING_TO_RELEASE,
//     CHANGE_REQUEST_CLOSED_NOTE, SAFETY_CHECK_CLOSED_NOTE
// Decided here, not in the story (docs/test-cases/SPM-37_test_cases.json,
// open_questions): every wording below.

const HALL = { name: "SPM37 Hall", code: "SPM37-HAL" };
const STUDIO = { name: "SPM37 Studio", code: "SPM37-STU" };
// 2 Nov 2027, 09:00-12:00 Singapore time.
const STARTS = "2027-11-02T01:00:00.000Z";
const ENDS = "2027-11-02T04:00:00.000Z";

function input(overrides: Partial<CancellationInput> = {}): CancellationInput {
  return {
    bookings: [],
    equipment: [],
    pendingChangeRequests: 0,
    safetyCheckPending: false,
    registration: { enabled: false, registered: 0, waitlisted: 0 },
    ...overrides,
  };
}

const booking = (status: string, venue = HALL, session: { label: string | null } | null = null) => ({
  status,
  startsAt: STARTS,
  endsAt: ENDS,
  venue,
  session,
});

const line = (status: string, name: string, quantityRequested: number, quantityReserved: number | null = null) => ({
  status,
  quantityRequested,
  quantityReserved,
  equipment: { name },
});

describe("the messages", () => {
  it("[SPM-37][AC1] says the event was cancelled and its arrangements released", () => {
    expect(EVENT_CANCELLED_MESSAGE).toBe("The event has been cancelled. Its venue bookings and equipment have been released.");
  });

  it("[SPM-37][AC8] says when no reason was recorded", () => {
    expect(NO_CANCELLATION_REASON).toBe("No reason was recorded.");
  });

  it("[SPM-37][AC1] says when there is nothing to release", () => {
    expect(NOTHING_TO_RELEASE).toBe("This event has no venue bookings, equipment or registration to release.");
  });

  it("[SPM-37][AC5] notes why a change request was closed", () => {
    expect(CHANGE_REQUEST_CLOSED_NOTE).toBe("Closed because the event was cancelled.");
  });

  it("[SPM-37][AC6] notes why a safety check was closed", () => {
    expect(SAFETY_CHECK_CLOSED_NOTE).toBe("Event cancelled");
  });
});

describe("arrangementCancellationNote", () => {
  it("[SPM-37][AC8] carries the Coordinator's reason onto each booking", () => {
    expect(arrangementCancellationNote("The client has called off the summit.")).toBe(
      "Event cancelled: The client has called off the summit."
    );
  });

  it("[SPM-37][AC8] trims the reason", () => {
    expect(arrangementCancellationNote("  Sponsor pulled out.  ")).toBe("Event cancelled: Sponsor pulled out.");
  });

  it.each([undefined, null, "", "   "])("[SPM-37][AC8] reads 'Event cancelled.' when the reason is %j", (reason) => {
    expect(arrangementCancellationNote(reason)).toBe("Event cancelled.");
  });
});

describe("cancellationConsequences", () => {
  it("[SPM-37][AC1] is empty for an event that holds nothing", () => {
    expect(cancellationConsequences(input())).toEqual([]);
  });

  it("[SPM-37][AC3][AC4] releases each approved booking and withdraws each pending request, at every venue", () => {
    expect(cancellationConsequences(input({ bookings: [booking("pending", STUDIO), booking("approved", HALL)] }))).toEqual([
      "Release SPM37 Hall (SPM37-HAL) on 2 Nov 2027, 09:00–12:00",
      "Withdraw the request for SPM37 Studio (SPM37-STU) on 2 Nov 2027, 09:00–12:00",
    ]);
  });

  it("[SPM-37][AC3] names a session's booking by its session", () => {
    expect(cancellationConsequences(input({ bookings: [booking("approved", HALL, { label: "Day 1" })] }))).toEqual([
      "Release SPM37 Hall (SPM37-HAL) for Day 1 on 2 Nov 2027, 09:00–12:00",
    ]);
  });

  it("[SPM-37][AC3] calls a session with no label 'Session'", () => {
    expect(cancellationConsequences(input({ bookings: [booking("pending", STUDIO, { label: null })] }))).toEqual([
      "Withdraw the request for SPM37 Studio (SPM37-STU) for Session on 2 Nov 2027, 09:00–12:00",
    ]);
  });

  it.each(["rejected", "withdrawn", "released", "expired"])(
    "[SPM-37][AC3] leaves out a %s booking, which holds nothing",
    (status) => {
      expect(cancellationConsequences(input({ bookings: [booking(status)] }))).toEqual([]);
    }
  );

  it("[SPM-37][AC3] releases what was reserved, and cancels what was only requested", () => {
    const equipment = [
      line("requested", "SPM37 Lectern Mic", 1),
      line("reserved", "SPM37 Projector", 2, 2),
      line("partially_fulfilled", "SPM37 Screen", 4, 3),
      line("under_review", "SPM37 Clicker", 2),
      line("unavailable", "SPM37 Smoke Machine", 1, 0),
    ];

    expect(cancellationConsequences(input({ equipment }))).toEqual([
      "Release 2 × SPM37 Projector",
      "Release 3 × SPM37 Screen",
      "Cancel the request for 1 × SPM37 Lectern Mic",
      "Cancel the request for 2 × SPM37 Clicker",
      "Cancel the request for 1 × SPM37 Smoke Machine",
    ]);
  });

  it("[SPM-37][AC3] falls back to the quantity requested for a reserved line with no reserved quantity recorded", () => {
    expect(cancellationConsequences(input({ equipment: [line("reserved", "SPM37 Projector", 2, null)] }))).toEqual([
      "Release 2 × SPM37 Projector",
    ]);
  });

  it("[SPM-37][AC3] leaves out an equipment line that is already cancelled", () => {
    expect(cancellationConsequences(input({ equipment: [line("cancelled", "SPM37 Projector", 2)] }))).toEqual([]);
  });

  it.each([
    [1, "Close 1 pending change request"],
    [2, "Close 2 pending change requests"],
  ])("[SPM-37][AC5] closes %i pending change request(s)", (count, text) => {
    expect(cancellationConsequences(input({ pendingChangeRequests: count }))).toEqual([text]);
  });

  it("[SPM-37][AC6] closes the pending safety check", () => {
    expect(cancellationConsequences(input({ safetyCheckPending: true }))).toEqual(["Close the pending safety check"]);
  });

  it("[SPM-37][AC7] closes registration, saying how many are registered and waiting", () => {
    const registration = { enabled: true, registered: 1, waitlisted: 0 };

    expect(cancellationConsequences(input({ registration }))).toEqual([
      "Close registration: 1 registered, 0 on the waiting list",
    ]);
  });

  it("[SPM-37][AC7] says nothing about registration when it is off", () => {
    const registration = { enabled: false, registered: 3, waitlisted: 1 };

    expect(cancellationConsequences(input({ registration }))).toEqual([]);
  });

  it("[SPM-37][AC3][AC4][AC5][AC6][AC7] lists everything, bookings first and registration last", () => {
    const all = input({
      bookings: [booking("pending", STUDIO), booking("approved", HALL)],
      equipment: [line("requested", "SPM37 Lectern Mic", 1), line("reserved", "SPM37 Projector", 2, 2)],
      pendingChangeRequests: 1,
      safetyCheckPending: true,
      registration: { enabled: true, registered: 12, waitlisted: 3 },
    });

    expect(cancellationConsequences(all)).toEqual([
      "Release SPM37 Hall (SPM37-HAL) on 2 Nov 2027, 09:00–12:00",
      "Withdraw the request for SPM37 Studio (SPM37-STU) on 2 Nov 2027, 09:00–12:00",
      "Release 2 × SPM37 Projector",
      "Cancel the request for 1 × SPM37 Lectern Mic",
      "Close 1 pending change request",
      "Close the pending safety check",
      "Close registration: 12 registered, 3 on the waiting list",
    ]);
  });
});
