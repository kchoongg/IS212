import { describe, it, expect } from "vitest";
import { arrangementsFor, checkEventConfirmation } from "../eventConfirmation";
import type { ConfirmationInput } from "../eventConfirmation";

// Confirm Event (SPM-34). What must be in place before an event can be
// confirmed, and what the coordinator is told when it is not (#80).

const input = (over: Partial<ConfirmationInput> = {}): ConfirmationInput => ({
  sessions: [],
  bookings: [],
  equipment: [],
  ...over,
});

const approvedVenue = { sessionId: null, status: "approved" };
const reserved = (name: string, sessionId: string | null = null) => ({
  sessionId,
  status: "reserved",
  equipmentName: name,
});

describe("checkEventConfirmation — the happy paths", () => {
  // AC2, derived: an event that needs no equipment is complete with a room.
  it("confirms an event that has an approved venue and no equipment at all", () => {
    expect(checkEventConfirmation(input({ bookings: [approvedVenue] }))).toEqual({ ok: true });
  });

  it("confirms when every recorded requirement is reserved", () => {
    const result = checkEventConfirmation(
      input({ bookings: [approvedVenue], equipment: [reserved("Portable Stage"), reserved("Handheld Wireless Mic")] })
    );
    expect(result).toEqual({ ok: true });
  });

  // Boundary: Technical Support committed what they could. Whether the
  // shortfall is essential is the Coordinator's decision (#90). Submit for
  // safety check holds to the same rule (SPM-86, decided 2026-10-09).
  it("treats partially_fulfilled equipment as arranged", () => {
    const result = checkEventConfirmation(
      input({
        bookings: [approvedVenue],
        equipment: [{ sessionId: null, status: "partially_fulfilled", equipmentName: "Portable Stage" }],
      })
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("checkEventConfirmation — AC1 and AC3, refusing and saying why", () => {
  it("refuses an event with no venue at all, and says so", () => {
    const result = checkEventConfirmation(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no venue is booked for this event");
      expect(result.outstanding).toHaveLength(1);
    }
  });

  // Boundary: the request exists but nobody has agreed to it. This is the case
  // the strict reading of #80 exists for.
  it("refuses while the venue request is still pending, and distinguishes it from no venue", () => {
    const result = checkEventConfirmation(input({ bookings: [{ sessionId: null, status: "pending" }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("still awaiting a decision from Venue Staff");
  });

  it.each(["rejected", "cancelled"])("treats a %s booking as no booking", (status) => {
    const result = checkEventConfirmation(input({ bookings: [{ sessionId: null, status }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no venue is booked");
  });

  it("names the equipment that is not reserved, not merely that something is missing", () => {
    const result = checkEventConfirmation(
      input({
        bookings: [approvedVenue],
        equipment: [reserved("Portable Stage"), { sessionId: null, status: "requested", equipmentName: "Audio Mixing Desk" }],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Audio Mixing Desk");
      // The one that IS reserved must not be reported as outstanding.
      expect(result.error).not.toContain("Portable Stage");
    }
  });

  it("reports every outstanding arrangement at once, so the list is not drip-fed", () => {
    const result = checkEventConfirmation(
      input({ equipment: [{ sessionId: null, status: "requested", equipmentName: "Portable Stage" }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outstanding).toHaveLength(2);
      expect(result.error).toContain("no venue is booked");
      expect(result.error).toContain("Portable Stage");
    }
  });
});

describe("checkEventConfirmation — multi-session events", () => {
  const sessions = [
    { id: "s1", label: "Day 1" },
    { id: "s2", label: "Day 2" },
  ];

  it("requires a venue for every session", () => {
    const result = checkEventConfirmation(
      input({ sessions, bookings: [{ sessionId: "s1", status: "approved" }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("the Day 2 session");
      expect(result.error).not.toContain("the Day 1 session");
    }
  });

  it("confirms once every session has its own approved booking", () => {
    const result = checkEventConfirmation(
      input({
        sessions,
        bookings: [
          { sessionId: "s1", status: "approved" },
          { sessionId: "s2", status: "approved" },
        ],
      })
    );
    expect(result).toEqual({ ok: true });
  });

  // Boundary: one session's kit is short while the other's is fine. The
  // refusal has to name the session, or the coordinator cannot act on it.
  it("names the session whose equipment is outstanding", () => {
    const result = checkEventConfirmation(
      input({
        sessions,
        bookings: [
          { sessionId: "s1", status: "approved" },
          { sessionId: "s2", status: "approved" },
        ],
        equipment: [
          reserved("Portable Stage", "s1"),
          { sessionId: "s2", status: "requested", equipmentName: "Powered Speaker" },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Powered Speaker for the Day 2 session");
  });

  it("falls back to a neutral phrase for a session with no label", () => {
    const result = checkEventConfirmation(input({ sessions: [{ id: "s1", label: null }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("one session");
  });
});

describe("arrangementsFor — what the list itself looks like", () => {
  it("lists the venue first, then equipment", () => {
    const list = arrangementsFor(
      input({ bookings: [approvedVenue], equipment: [reserved("Portable Stage")] })
    );
    expect(list.map((a) => a.kind)).toEqual(["venue", "equipment"]);
    expect(list.every((a) => a.required && a.complete)).toBe(true);
  });

  // AC2 as it is implemented today: nothing can mark an arrangement as not
  // required, so equipment is simply absent from the list when none was
  // recorded. Track Outstanding Arrangements should set `required: false`
  // here rather than invent a second rule.
  it("omits equipment entirely when none was recorded", () => {
    const list = arrangementsFor(input({ bookings: [approvedVenue] }));
    expect(list.map((a) => a.kind)).toEqual(["venue"]);
  });
});

// ---------------------------------------------------------------------------
// Track Outstanding Arrangements (SPM-33)
// ---------------------------------------------------------------------------
//
// CONTRACT (SPM-33, written before the code) - what these tests expect of
// src/lib/eventConfirmation.ts. The existing exports keep their names; SPM-34's
// inputs above still work, because every new input field is optional.
//
//   ConfirmationInput
//     bookings[]   + id?, venueName?, needsReview?, reviewReason?, notRequired?
//     equipment[]  + id?, needsReview?, reviewReason?, notRequired?
//     registration? { enabled, capacity, opensAt, closesAt, notRequired? }
//
//   Arrangement (one row of the Readiness list)
//     kind         "venue" | "equipment" | "registration"
//     id           the booking's or equipment request's id; null for the
//                  "No venue booked" row and for registration
//     name         the venue's name, the equipment item's name,
//                  "Registration setup", or "No venue booked"
//     status       the booking's or request's own status; null otherwise
//     state        "complete" | "outstanding" | "not_required"
//     required     false once marked as not required
//     complete, missing, session   as before
//     flagReason   why it was flagged for review, in words; "" when it is not
//     waivable     true when the Coordinator may mark it as not required
//
//   arrangementsFor()      venue rows, then equipment rows, then registration
//   checkEventConfirmation() refuses on every row that is required and not complete
//
// Decided here, not in the story (change the test if the team wants otherwise):
//   - one row per PENDING or APPROVED booking; a rejected or cancelled one is
//     not listed. An event (or session) left with no pending or approved
//     booking that is still required gets a "No venue booked" row, which can
//     never be marked as not required
//   - one row per equipment line, not one per session
//   - only an OUTSTANDING row is waivable
//   - registration has a row only while registration is enabled; it is complete
//     with a capacity and both ends of the registration period
//   - the wording of every `missing` and `flagReason` below
//
// Not covered yet, on purpose (decided 2026-10-08): the Operational Safety
// Check row (AC6) and the rule that it cannot be marked as not required (AC9)
// wait for SPM-86, which defines the data they read.

const booking = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  sessionId: null,
  status: "approved",
  venueName: "Marina Auditorium",
  ...over,
});

const line = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  sessionId: null,
  status: "reserved",
  equipmentName: "Handheld Wireless Mic",
  ...over,
});

const registration = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  capacity: 80,
  opensAt: new Date("2027-05-01T01:00:00.000Z"),
  closesAt: new Date("2027-05-20T10:00:00.000Z"),
  ...over,
});

const rows = (over: Record<string, unknown> = {}) => arrangementsFor(input(over as Partial<ConfirmationInput>));
const check = (over: Record<string, unknown> = {}) =>
  checkEventConfirmation(input(over as Partial<ConfirmationInput>));
const named = (list: ReturnType<typeof arrangementsFor>, name: string) => list.find((a) => a.name === name)!;

describe("SPM-33 arrangementsFor — venue bookings (AC1, AC2)", () => {
  it("lists every venue booking of one event separately, each with its own status", () => {
    const list = rows({
      bookings: [booking(), booking({ id: "b2", status: "pending", venueName: "Orchard Studio" })],
    });

    expect(list).toHaveLength(2);
    expect(named(list, "Marina Auditorium")).toMatchObject({
      kind: "venue",
      id: "b1",
      status: "approved",
      state: "complete",
      complete: true,
    });
    expect(named(list, "Orchard Studio")).toMatchObject({
      kind: "venue",
      id: "b2",
      status: "pending",
      state: "outstanding",
      complete: false,
    });
  });

  it("names the venue that is still waiting on Venue Staff", () => {
    const list = rows({ bookings: [booking({ status: "pending", venueName: "Orchard Studio" })] });

    expect(list[0].missing).toBe("Orchard Studio for this event is still awaiting a decision from Venue Staff");
  });

  it.each(["rejected", "cancelled"])("does not list a %s booking", (status) => {
    const list = rows({ bookings: [booking(), booking({ id: "b2", status, venueName: "Orchard Studio" })] });

    expect(list.map((a) => a.name)).toEqual(["Marina Auditorium"]);
  });

  it("shows 'No venue booked' as outstanding when the event has no pending or approved booking", () => {
    const list = rows({ bookings: [booking({ status: "rejected" })] });

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "venue",
      id: null,
      name: "No venue booked",
      status: null,
      state: "outstanding",
      required: true,
      missing: "no venue is booked for this event",
    });
  });

  it("does not add 'No venue booked' while a booking is still awaiting a decision", () => {
    const list = rows({ bookings: [booking({ status: "pending" })] });

    expect(list.map((a) => a.name)).toEqual(["Marina Auditorium"]);
  });

  it("keeps each session's bookings with that session, and shows 'No venue booked' for a session with none", () => {
    const list = rows({
      sessions: [
        { id: "s1", label: "Day 1" },
        { id: "s2", label: "Day 2" },
      ],
      bookings: [
        booking({ sessionId: "s1" }),
        booking({ id: "b2", sessionId: "s1", status: "pending", venueName: "Orchard Studio" }),
      ],
    });

    expect(list.map((a) => [a.name, a.session?.label])).toEqual([
      ["Marina Auditorium", "Day 1"],
      ["Orchard Studio", "Day 1"],
      ["No venue booked", "Day 2"],
    ]);
  });
});

describe("SPM-33 arrangementsFor — a booking that names no session", () => {
  const sessions = [{ id: "s1", label: "Day 1" }];

  // Nothing the event holds goes unseen, but a room booked for no session in
  // particular does not give Day 1 its room.
  it("is still listed on a multi-session event, without standing in for a session's venue", () => {
    const list = rows({ sessions, bookings: [booking({ sessionId: null })] });

    expect(list.map((a) => [a.name, a.session?.label ?? null])).toEqual([
      ["No venue booked", "Day 1"],
      ["Marina Auditorium", null],
    ]);
  });

  it("is listed without a session when its session no longer exists", () => {
    const list = rows({ sessions, bookings: [booking({ sessionId: "s1" }), booking({ id: "b2", sessionId: "gone" })] });

    expect(list.map((a) => [a.id, a.session?.label ?? null])).toEqual([
      ["b1", "Day 1"],
      ["b2", null],
    ]);
  });

  it("gives a reason even when a flag was raised without one", () => {
    const list = rows({ bookings: [booking({ needsReview: true, reviewReason: null })] });

    expect(list[0]).toMatchObject({ state: "outstanding", flagReason: "no reason was recorded" });
  });
});

describe("SPM-33 arrangementsFor — equipment (AC3)", () => {
  it("lists every equipment line separately, each with its own status", () => {
    const list = rows({
      bookings: [booking()],
      equipment: [line(), line({ id: "r2", status: "requested", equipmentName: "Audio Mixing Desk" })],
    });

    expect(named(list, "Handheld Wireless Mic")).toMatchObject({
      kind: "equipment",
      id: "r1",
      status: "reserved",
      state: "complete",
    });
    expect(named(list, "Audio Mixing Desk")).toMatchObject({
      kind: "equipment",
      id: "r2",
      status: "requested",
      state: "outstanding",
      missing: "Audio Mixing Desk for this event is not reserved yet",
    });
  });

  it.each([
    ["requested", "Portable Stage for this event is not reserved yet"],
    ["under_review", "Portable Stage for this event is not reserved yet"],
    ["unavailable", "Portable Stage for this event is not reserved yet"],
  ])("shows a %s line as outstanding", (status, missing) => {
    const list = rows({ bookings: [booking()], equipment: [line({ status, equipmentName: "Portable Stage" })] });

    expect(named(list, "Portable Stage")).toMatchObject({ state: "outstanding", complete: false, missing });
  });

  // Decided 2026-10-10: SPM-86's rule. A line Technical Support could only
  // partly reserve is held, so there is nothing to mark as not required.
  it("shows a partially_fulfilled line as complete, with its own status", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "partially_fulfilled" })] });

    expect(named(list, "Handheld Wireless Mic")).toMatchObject({
      status: "partially_fulfilled",
      state: "complete",
      waivable: false,
    });
  });

  // Like a rejected or cancelled booking: it is no longer an arrangement.
  it("does not list a cancelled equipment line", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "cancelled" })] });

    expect(list.map((a) => a.kind)).toEqual(["venue"]);
    expect(check({ bookings: [booking()], equipment: [line({ status: "cancelled" })] })).toEqual({ ok: true });
  });

  it("lists venue bookings first, then equipment, then registration", () => {
    const list = rows({ bookings: [booking()], equipment: [line()], registration: registration() });

    expect(list.map((a) => a.kind)).toEqual(["venue", "equipment", "registration"]);
  });
});

describe("SPM-33 arrangementsFor — flagged for review (AC4)", () => {
  it("shows an approved booking that is flagged for review as outstanding, with why", () => {
    const list = rows({
      bookings: [booking({ needsReview: true, reviewReason: "event_schedule_changed" })],
    });

    expect(list[0]).toMatchObject({
      state: "outstanding",
      complete: false,
      flagReason: "the date or time changed",
      missing: "Marina Auditorium for this event is flagged for review: the date or time changed",
    });
  });

  it("shows reserved equipment that is flagged for review as outstanding, with why", () => {
    const list = rows({
      bookings: [booking()],
      equipment: [line({ needsReview: true, reviewReason: "event_schedule_changed" })],
    });

    expect(named(list, "Handheld Wireless Mic")).toMatchObject({
      state: "outstanding",
      flagReason: "the date or time changed",
      missing: "Handheld Wireless Mic for this event is flagged for review: the date or time changed",
    });
  });

  // The same column holds reasons from a venue change (SPM-39) and from an
  // event change (SPM-62), comma-separated.
  it("gives every reason a booking was flagged for, from a venue change and an event change alike", () => {
    const list = rows({
      bookings: [booking({ needsReview: true, reviewReason: "venue_retired,event_attendance_changed" })],
    });

    expect(list[0].flagReason).toBe("the venue has been retired; the expected attendance changed");
  });

  it("still shows a flag whose reason it does not recognise, rather than hiding it", () => {
    const list = rows({ bookings: [booking({ needsReview: true, reviewReason: "something_new" })] });

    expect(list[0].state).toBe("outstanding");
    expect(list[0].flagReason).not.toBe("");
  });

  it("gives no flag reason for an arrangement that is not flagged", () => {
    const list = rows({ bookings: [booking()], equipment: [line()] });

    expect(list.map((a) => a.flagReason)).toEqual(["", ""]);
    expect(list.every((a) => a.state === "complete")).toBe(true);
  });
});

describe("SPM-33 arrangementsFor — registration setup (AC5)", () => {
  it("has no registration row when registration is not enabled", () => {
    const list = rows({ bookings: [booking()], registration: registration({ enabled: false, capacity: null }) });

    expect(list.map((a) => a.kind)).toEqual(["venue"]);
  });

  it("shows registration setup as complete once it has a capacity and a registration period", () => {
    const list = rows({ bookings: [booking()], registration: registration() });

    expect(named(list, "Registration setup")).toMatchObject({
      kind: "registration",
      id: null,
      status: null,
      state: "complete",
      complete: true,
      missing: "",
    });
  });

  it.each([
    ["no capacity", { capacity: null }, "registration is enabled but has no capacity"],
    ["no opening date", { opensAt: null }, "registration is enabled but has no registration period"],
    ["no closing date", { closesAt: null }, "registration is enabled but has no registration period"],
    [
      "neither",
      { capacity: null, opensAt: null, closesAt: null },
      "registration is enabled but has no capacity or registration period",
    ],
  ])("shows registration that is enabled with %s as outstanding", (_case, over, missing) => {
    const list = rows({ bookings: [booking()], registration: registration(over) });

    expect(named(list, "Registration setup")).toMatchObject({ state: "outstanding", complete: false, missing });
  });
});

describe("SPM-33 arrangementsFor — not required (AC7, AC8, AC10)", () => {
  it("tells complete, outstanding and not-required arrangements apart", () => {
    const list = rows({
      bookings: [booking()],
      equipment: [
        line({ id: "r2", status: "requested", equipmentName: "Audio Mixing Desk" }),
        line({ id: "r3", status: "unavailable", equipmentName: "Portable Stage", notRequired: true }),
      ],
    });

    expect(list.map((a) => [a.name, a.state])).toEqual([
      ["Marina Auditorium", "complete"],
      ["Audio Mixing Desk", "outstanding"],
      ["Portable Stage", "not_required"],
    ]);
  });

  it.each([
    ["a venue booking", { bookings: [booking(), booking({ id: "b2", status: "pending", venueName: "Orchard Studio", notRequired: true })] }, "Orchard Studio"],
    ["an equipment line", { bookings: [booking()], equipment: [line({ status: "unavailable", notRequired: true })] }, "Handheld Wireless Mic"],
    ["registration setup", { bookings: [booking()], registration: registration({ capacity: null, notRequired: true }) }, "Registration setup"],
  ])("shows %s marked as not required as not required, not as outstanding or complete", (_case, over, name) => {
    const row = named(rows(over), name);

    expect(row).toMatchObject({ state: "not_required", required: false, complete: false });
  });

  it("keeps the booking's or line's own status on a row marked as not required", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "unavailable", notRequired: true })] });

    expect(named(list, "Handheld Wireless Mic").status).toBe("unavailable");
  });

  it("lets every outstanding booking, equipment line and registration setup be marked as not required", () => {
    const list = rows({
      bookings: [booking({ status: "pending" })],
      equipment: [line({ status: "requested" })],
      registration: registration({ capacity: null }),
    });

    expect(list.map((a) => [a.kind, a.waivable])).toEqual([
      ["venue", true],
      ["equipment", true],
      ["registration", true],
    ]);
  });

  it("does not offer it for an arrangement that is already complete", () => {
    const list = rows({ bookings: [booking()], equipment: [line()], registration: registration() });

    expect(list.every((a) => a.state === "complete" && !a.waivable)).toBe(true);
  });

  // Decided 2026-10-08: any booking can be waived, but an event always needs
  // somewhere to happen.
  it("never lets 'No venue booked' be marked as not required", () => {
    expect(rows()[0]).toMatchObject({ name: "No venue booked", waivable: false, required: true });
  });

  it("shows 'No venue booked' again once the event's only booking is marked as not required", () => {
    const list = rows({ bookings: [booking({ status: "pending", notRequired: true })] });

    expect(list.map((a) => [a.name, a.state])).toEqual([
      ["Marina Auditorium", "not_required"],
      ["No venue booked", "outstanding"],
    ]);
  });

  it("does not ask for another venue when one booking is not required and another is still held", () => {
    const list = rows({
      bookings: [booking(), booking({ id: "b2", status: "pending", venueName: "Orchard Studio", notRequired: true })],
    });

    expect(list.map((a) => a.name)).toEqual(["Marina Auditorium", "Orchard Studio"]);
  });
});

// Briefing 8f (Auditability) and "Activity History": "Significant actions are
// recorded, including who performed the action and when it occurred"; customer
// answer #14: "what changed, who changed it, and when". Waiving an arrangement
// decides whether an event can be confirmed, so it is one of those actions.
//
// CONTRACT, added 2026-10-09: bookings[], equipment[] and registration take
// notRequiredBy? (the person's name) and notRequiredAt? (a Date); an
// Arrangement carries them through as notRequiredBy and notRequiredAt, both
// null unless it is marked as not required.
describe("SPM-33 arrangementsFor — who marked it as not required, and when", () => {
  const AT = new Date("2026-10-08T03:00:00.000Z");
  const waived = { notRequired: true, notRequiredBy: "Daniel Tan", notRequiredAt: AT };

  it.each([
    ["a venue booking", { bookings: [booking(), booking({ id: "b2", status: "pending", venueName: "Orchard Studio", ...waived })] }, "Orchard Studio"],
    ["an equipment line", { bookings: [booking()], equipment: [line({ status: "unavailable", ...waived })] }, "Handheld Wireless Mic"],
    ["registration setup", { bookings: [booking()], registration: registration({ capacity: null, ...waived }) }, "Registration setup"],
  ])("says who marked %s as not required, and when", (_case, over, name) => {
    expect(named(rows(over), name)).toMatchObject({
      state: "not_required",
      notRequiredBy: "Daniel Tan",
      notRequiredAt: AT,
    });
  });

  it("names nobody on an arrangement that is not marked as not required", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "requested" })] });

    expect(list.map((a) => [a.notRequiredBy, a.notRequiredAt])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  // The columns record the latest decision either way, so after a reversal
  // they still hold who reversed it. That is not a waiver to show.
  it("names nobody once the decision has been reversed", () => {
    const list = rows({
      bookings: [booking()],
      equipment: [line({ status: "unavailable", ...waived, notRequired: false })],
    });

    expect(named(list, "Handheld Wireless Mic")).toMatchObject({
      state: "outstanding",
      notRequiredBy: null,
      notRequiredAt: null,
    });
  });
});

describe("SPM-33 checkEventConfirmation — what prevents confirmation (AC11)", () => {
  it.each([
    ["a pending booking", { bookings: [booking(), booking({ id: "b2", status: "pending", notRequired: true })] }],
    ["an equipment line Technical Support cannot provide", { bookings: [booking()], equipment: [line({ status: "unavailable", notRequired: true })] }],
    ["a flagged equipment line", { bookings: [booking()], equipment: [line({ needsReview: true, reviewReason: "event_schedule_changed", notRequired: true })] }],
    ["incomplete registration setup", { bookings: [booking()], registration: registration({ capacity: null, notRequired: true }) }],
  ])("confirms when the only thing outstanding is %s marked as not required", (_case, over) => {
    expect(check(over)).toEqual({ ok: true });
  });

  it("refuses while an approved booking is flagged for review, and says why", () => {
    const result = check({ bookings: [booking({ needsReview: true, reviewReason: "venue_retired" })] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "This event cannot be confirmed yet: Marina Auditorium for this event is flagged for review: the venue has been retired."
      );
    }
  });

  it("refuses while reserved equipment is flagged for review", () => {
    const result = check({
      bookings: [booking()],
      equipment: [line({ needsReview: true, reviewReason: "event_schedule_changed" })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outstanding.map((a) => a.name)).toEqual(["Handheld Wireless Mic"]);
  });

  it("refuses while registration is enabled but its setup is incomplete", () => {
    const result = check({ bookings: [booking()], registration: registration({ capacity: null }) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("This event cannot be confirmed yet: registration is enabled but has no capacity.");
    }
  });

  it("refuses when one of several venue bookings is still pending, naming only that one", () => {
    const result = check({
      bookings: [booking(), booking({ id: "b2", status: "pending", venueName: "Orchard Studio" })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Orchard Studio");
      expect(result.error).not.toContain("Marina Auditorium");
    }
  });

  it("refuses an event whose only booking is marked as not required: it still has no venue", () => {
    const result = check({ bookings: [booking({ status: "pending", notRequired: true })] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This event cannot be confirmed yet: no venue is booked for this event.");
  });

  it("leaves arrangements marked as not required out of what is preventing confirmation", () => {
    const result = check({
      bookings: [booking()],
      equipment: [
        line({ id: "r2", status: "requested", equipmentName: "Audio Mixing Desk" }),
        line({ id: "r3", status: "unavailable", equipmentName: "Portable Stage", notRequired: true }),
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outstanding.map((a) => a.name)).toEqual(["Audio Mixing Desk"]);
  });
});
