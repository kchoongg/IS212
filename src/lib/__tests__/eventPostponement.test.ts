import { describe, it, expect } from "vitest";
import {
  arrangementPostponementNote,
  postponeDialogText,
  postponementConsequences,
  type PostponementInput,
} from "../eventPostponement";

// SPM-38 - Postpone Event: what the Postpone event dialog lists, and the notes
// written on what the postponement lets go.

const nothing: PostponementInput = {
  bookings: [],
  equipment: [],
  pendingPostponementRequests: 0,
  safetyCheck: null,
  registration: { enabled: false, registered: 0, waitlisted: 0 },
};

// 12 Jan 2028, 09:00-12:00 Singapore time.
const booking = (status: string, name: string, code: string, session: { label: string | null } | null = null) => ({
  status,
  startsAt: "2028-01-12T01:00:00.000Z",
  endsAt: "2028-01-12T04:00:00.000Z",
  venue: { name, code },
  session,
});

const line = (status: string, name: string, quantityRequested: number, quantityReserved: number | null = null) => ({
  status,
  quantityRequested,
  quantityReserved,
  equipment: { name },
});

describe("postponementConsequences", () => {
  it("[SPM-38][AC1] lists nothing for an event that holds nothing", () => {
    expect(postponementConsequences(nothing)).toEqual([]);
  });

  it("[SPM-38][AC3] releases approved bookings and withdraws pending requests, at every venue", () => {
    expect(
      postponementConsequences({
        ...nothing,
        bookings: [
          booking("pending", "SPM38 Studio", "SPM38-STU"),
          booking("approved", "SPM38 Hall", "SPM38-HAL", { label: "Day 1" }),
        ],
      })
    ).toEqual([
      "Release SPM38 Hall (SPM38-HAL) for Day 1 on 12 Jan 2028, 09:00–12:00",
      "Withdraw the request for SPM38 Studio (SPM38-STU) on 12 Jan 2028, 09:00–12:00",
    ]);
  });

  it("[SPM-38][AC3] releases reserved equipment and cancels lines not yet reserved, skipping cancelled ones", () => {
    expect(
      postponementConsequences({
        ...nothing,
        equipment: [
          line("requested", "SPM38 Lectern Mic", 1),
          line("partially_fulfilled", "SPM38 Projector", 2, 1),
          line("cancelled", "SPM38 Screen", 1),
        ],
      })
    ).toEqual(["Release 1 × SPM38 Projector", "Cancel the request for 1 × SPM38 Lectern Mic"]);
  });

  it.each([
    [1, "Close the pending postponement request"],
    [2, "Close 2 pending postponement requests"],
  ])("[SPM-38][AC2] closes %i pending postponement request(s)", (count, text) => {
    expect(postponementConsequences({ ...nothing, pendingPostponementRequests: count })).toEqual([text]);
  });

  it.each([
    ["pending", "Close the pending safety check"],
    ["approved", "Close the safety approval"],
  ] as const)("[SPM-38][AC4] names a %s safety check", (safetyCheck, text) => {
    expect(postponementConsequences({ ...nothing, safetyCheck })).toEqual([text]);
  });

  it("[SPM-38][AC8] pauses registration, with how many hold a place, only when it is on", () => {
    expect(
      postponementConsequences({ ...nothing, registration: { enabled: true, registered: 1, waitlisted: 0 } })
    ).toEqual(["Pause registration until the event is confirmed again: 1 registered, 0 on the waiting list"]);
    expect(
      postponementConsequences({ ...nothing, registration: { enabled: false, registered: 4, waitlisted: 1 } })
    ).toEqual([]);
  });
});

describe("arrangementPostponementNote", () => {
  it("[SPM-38][AC5] carries the reason onto each released booking", () => {
    expect(arrangementPostponementNote("  Board approval pending ")).toBe("Event postponed: Board approval pending");
  });

  it.each([null, undefined, "", "   "])("[SPM-38][AC5] says only 'Event postponed.' for the reason %j", (reason) => {
    expect(arrangementPostponementNote(reason)).toBe("Event postponed.");
  });
});

describe("postponeDialogText", () => {
  it("[SPM-38][AC1] names the event, or says 'This event' when it has no title", () => {
    expect(postponeDialogText("SPM38 Lantern Gala")).toBe(
      "SPM38 Lantern Gala will be marked Postponed. Its new date is set later, through a change request."
    );
    expect(postponeDialogText(null)).toBe(
      "This event will be marked Postponed. Its new date is set later, through a change request."
    );
  });
});
