import { describe, it, expect } from "vitest";
import {
  RECHECK_STATUSES,
  isRecheckCandidate,
  recheckBookings,
  recheckCandidateWhere,
  turnaroundChangeSentence,
  turnaroundChanged,
  type RecheckBooking,
} from "../turnaroundRecheck";
import { IMPACT_REASONS, impactSentence } from "../venueImpact";
import type { Interval, Turnaround } from "../venueTime";

// CONTRACT (SPM-80, written before the code) - what these tests expect to exist:
//   src/lib/turnaroundRecheck.ts, pure functions over plain data:
//     RECHECK_STATUSES = ["pending", "approved"]
//     isRecheckCandidate({ status, endsAt }, now)  / recheckCandidateWhere(now) - the same rule twice
//     turnaroundChanged(before, after)             - did setup or turnaround change?
//     turnaroundChangeSentence(before, after)      - "the setup time changed from 0 to 30 minutes"
//     recheckBookings(before, after, bookings, unavailable) -> [{ bookingId, reasons, clashesWith, unavailableDuring }]
//   src/lib/venueImpact.ts gains the reason code "booking_clash".
// Decided here, not in the story (change the test if the team wants otherwise):
//   - "future" is endsAt > now, the rule every other venue flag uses: a booking
//     under way still counts, one that has finished does not (AC7).
//   - only what the change NEWLY breaks is flagged, as with every other venue
//     edit (venueImpact.ts): a clash or overlap already there under the old
//     times was flagged, or refused, when it arose.
//   - one event's own bookings never clash with each other (findVenueConflict's
//     rule): a session's turnaround must not flag the same event's next session.
//   - a new overlap with an unavailable period reuses "venue_unavailable".

const at = (time: string, day = "2027-03-04") => new Date(`${day}T${time}:00+08:00`);
const NOW = at("08:00", "2026-10-20");

const NONE: Turnaround = { setupMinutes: 0, teardownMinutes: 0 };

function booking(id: string, start: string, end: string, overrides: Partial<RecheckBooking> = {}): RecheckBooking {
  return { id, eventId: `event-${id}`, startsAt: at(start), endsAt: at(end), ...overrides };
}

const period = (start: string, end: string): Interval => ({ startsAt: at(start), endsAt: at(end) });

describe("which bookings are re-checked", () => {
  it("[SPM-80][AC1] re-checks pending and confirmed bookings", () => {
    expect(RECHECK_STATUSES).toEqual(["pending", "approved"]);
    expect(isRecheckCandidate({ status: "pending", endsAt: at("12:00") }, NOW)).toBe(true);
    expect(isRecheckCandidate({ status: "approved", endsAt: at("12:00") }, NOW)).toBe(true);
  });

  it.each(["rejected", "withdrawn", "released", "expired"])("[SPM-80][AC1] does not re-check a %s booking", (status) => {
    expect(isRecheckCandidate({ status, endsAt: at("12:00") }, NOW)).toBe(false);
  });

  it("[SPM-80][AC7] does not re-check a booking that has already finished", () => {
    expect(isRecheckCandidate({ status: "approved", endsAt: new Date(NOW.getTime() - 60_000) }, NOW)).toBe(false);
    expect(isRecheckCandidate({ status: "approved", endsAt: NOW }, NOW)).toBe(false);
  });

  it("[SPM-80][AC1][AC7] still re-checks a booking that is under way", () => {
    expect(isRecheckCandidate({ status: "approved", endsAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(true);
  });

  it("[SPM-80][AC1][AC7] filters the database the same way", () => {
    expect(recheckCandidateWhere(NOW)).toEqual({ status: { in: ["pending", "approved"] }, endsAt: { gt: NOW } });
  });
});

describe("turnaroundChanged", () => {
  it("[SPM-80][AC1] is true when the setup time changes", () => {
    expect(turnaroundChanged(NONE, { setupMinutes: 15, teardownMinutes: 0 })).toBe(true);
  });

  it("[SPM-80][AC1] is true when the turnaround time changes", () => {
    expect(turnaroundChanged(NONE, { setupMinutes: 0, teardownMinutes: 45 })).toBe(true);
  });

  it("[SPM-80][AC1] is false when both are saved unchanged", () => {
    expect(turnaroundChanged({ setupMinutes: 30, teardownMinutes: 45 }, { setupMinutes: 30, teardownMinutes: 45 })).toBe(
      false
    );
  });
});

describe("turnaroundChangeSentence", () => {
  it("[SPM-80][AC5] names a changed setup time", () => {
    expect(turnaroundChangeSentence(NONE, { setupMinutes: 30, teardownMinutes: 0 })).toBe(
      "the setup time changed from 0 to 30 minutes"
    );
  });

  it("[SPM-80][AC5] names a changed turnaround time", () => {
    expect(turnaroundChangeSentence({ setupMinutes: 0, teardownMinutes: 45 }, { setupMinutes: 0, teardownMinutes: 15 })).toBe(
      "the turnaround time changed from 45 to 15 minutes"
    );
  });

  it("[SPM-80][AC5] names both when both changed", () => {
    expect(turnaroundChangeSentence(NONE, { setupMinutes: 30, teardownMinutes: 45 })).toBe(
      "the setup time changed from 0 to 30 minutes and the turnaround time changed from 0 to 45 minutes"
    );
  });
});

describe("recheckBookings - two bookings that now overlap", () => {
  // 10:00-12:00 and 12:30-14:00: half an hour apart with no setup or turnaround.
  const morning = booking("morning", "10:00", "12:00");
  const afternoon = booking("afternoon", "12:30", "14:00");

  it("[SPM-80][AC2] flags both, each naming the booking it clashes with, when the turnaround grows into the gap", () => {
    const findings = recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 45 }, [morning, afternoon], []);

    expect(findings).toEqual([
      { bookingId: "morning", reasons: ["booking_clash"], clashesWith: ["afternoon"], unavailableDuring: [] },
      { bookingId: "afternoon", reasons: ["booking_clash"], clashesWith: ["morning"], unavailableDuring: [] },
    ]);
  });

  it("[SPM-80][AC2] flags both when the setup grows into the gap", () => {
    const findings = recheckBookings(NONE, { setupMinutes: 45, teardownMinutes: 0 }, [morning, afternoon], []);

    expect(findings.map((f) => [f.bookingId, f.clashesWith])).toEqual([
      ["morning", ["afternoon"]],
      ["afternoon", ["morning"]],
    ]);
  });

  it("[SPM-80][AC2] counts the second booking's setup and the first one's turnaround together", () => {
    // 15 + 15 = 30 minutes: exactly fills the gap, so they only meet end to start.
    expect(recheckBookings(NONE, { setupMinutes: 15, teardownMinutes: 15 }, [morning, afternoon], [])).toEqual([]);
    // 15 + 30 = 45: now they overlap.
    expect(recheckBookings(NONE, { setupMinutes: 15, teardownMinutes: 30 }, [morning, afternoon], [])).toHaveLength(2);
  });

  it("[SPM-80][AC6] does not flag bookings whose periods only meet end to start", () => {
    expect(recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 30 }, [morning, afternoon], [])).toEqual([]);
  });

  it("[SPM-80][AC6] flags only the bookings that clash, not the rest of the venue's bookings", () => {
    const evening = booking("evening", "18:00", "21:00");

    const findings = recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 45 }, [morning, afternoon, evening], []);

    expect(findings.map((f) => f.bookingId)).toEqual(["morning", "afternoon"]);
  });

  it("[SPM-80][AC2] lists every booking a booking now clashes with", () => {
    const lunch = booking("lunch", "12:15", "12:30", { eventId: "event-lunch" });

    const findings = recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 45 }, [morning, lunch, afternoon], []);

    expect(findings.find((f) => f.bookingId === "morning")?.clashesWith).toEqual(["lunch", "afternoon"]);
  });

  it("[SPM-80][AC2] flags a clash across midnight", () => {
    const late = booking("late", "21:00", "23:30");
    const early = booking("early", "00:30", "03:00", { startsAt: at("00:30", "2027-03-05"), endsAt: at("03:00", "2027-03-05") });

    const findings = recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 90 }, [late, early], []);

    expect(findings.map((f) => f.bookingId)).toEqual(["late", "early"]);
  });

  it("[SPM-80][AC2] never flags one event's bookings for clashing with each other", () => {
    const first = booking("first", "10:00", "12:00", { eventId: "conference" });
    const second = booking("second", "12:30", "14:00", { eventId: "conference" });

    expect(recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 45 }, [first, second], [])).toEqual([]);
  });

  it("[SPM-80][AC2] does not flag a clash that was already there under the old times", () => {
    const before = { setupMinutes: 0, teardownMinutes: 45 };

    expect(recheckBookings(before, { setupMinutes: 0, teardownMinutes: 60 }, [morning, afternoon], [])).toEqual([]);
  });

  it("[SPM-80][AC6] flags nothing when the times shrink", () => {
    expect(
      recheckBookings({ setupMinutes: 30, teardownMinutes: 30 }, NONE, [booking("a", "10:00", "11:00"), booking("b", "11:00", "12:00")], [])
    ).toEqual([]);
  });

  it("[SPM-80][AC6] flags nothing when nothing changed", () => {
    const same = { setupMinutes: 0, teardownMinutes: 45 };
    expect(recheckBookings(same, same, [morning, afternoon], [])).toEqual([]);
  });
});

describe("recheckBookings - an unavailable period", () => {
  // The venue is out of use 14:00-16:00; the booking ends at 13:30.
  const maintenance = period("14:00", "16:00");
  const lunch = booking("lunch", "12:00", "13:30");

  it("[SPM-80][AC3] flags a booking whose new turnaround now runs into the period", () => {
    const findings = recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 45 }, [lunch], [maintenance]);

    expect(findings).toEqual([
      { bookingId: "lunch", reasons: ["venue_unavailable"], clashesWith: [], unavailableDuring: [maintenance] },
    ]);
  });

  it("[SPM-80][AC3] flags a booking whose new setup now starts inside the period", () => {
    const tea = booking("tea", "16:30", "18:00");

    const findings = recheckBookings(NONE, { setupMinutes: 45, teardownMinutes: 0 }, [tea], [maintenance]);

    expect(findings.map((f) => f.reasons)).toEqual([["venue_unavailable"]]);
  });

  it("[SPM-80][AC6] does not flag a booking whose new turnaround ends exactly as the period starts", () => {
    expect(recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 30 }, [lunch], [maintenance])).toEqual([]);
  });

  it("[SPM-80][AC3] does not flag a booking the period already overlapped under the old times", () => {
    // Flagged when the period was recorded (SPM-45).
    const before = { setupMinutes: 0, teardownMinutes: 45 };
    expect(recheckBookings(before, { setupMinutes: 0, teardownMinutes: 60 }, [lunch], [maintenance])).toEqual([]);
  });

  it("[SPM-80][AC2][AC3] reports both reasons when a booking now clashes with a booking and a period", () => {
    const next = booking("next", "13:45", "14:00");

    const findings = recheckBookings(NONE, { setupMinutes: 0, teardownMinutes: 45 }, [lunch, next], [maintenance]);

    expect(findings[0]).toEqual({
      bookingId: "lunch",
      reasons: ["booking_clash", "venue_unavailable"],
      clashesWith: ["next"],
      unavailableDuring: [maintenance],
    });
  });
});

describe("the new reason code", () => {
  it("[SPM-80][AC2][AC5] is a review reason with its own wording", () => {
    expect(IMPACT_REASONS).toContain("booking_clash");
    expect(impactSentence(["booking_clash"])).toBe(
      "with the venue's new setup or turnaround time, this booking overlaps another booking"
    );
  });
});
