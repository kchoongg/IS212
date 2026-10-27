import { describe, it, expect } from "vitest";
import { arrangementsFor, blockingArrangements, checkEventConfirmation } from "../eventConfirmation";
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
  it("[SPM-34][AC1][AC2] confirms an event that has an approved venue and no equipment at all", () => {
    expect(checkEventConfirmation(input({ bookings: [approvedVenue] }))).toEqual({ ok: true });
  });

  it("[SPM-34][AC1][AC2] confirms when every recorded requirement is reserved", () => {
    const result = checkEventConfirmation(
      input({ bookings: [approvedVenue], equipment: [reserved("Portable Stage"), reserved("Handheld Wireless Mic")] })
    );
    expect(result).toEqual({ ok: true });
  });

  // Boundary: Technical Support committed what they could. Whether the
  // shortfall is essential is the Coordinator's decision (#90). Submit for
  // safety check holds to the same rule (SPM-86, decided 2026-10-09).
  it("[SPM-34][AC1][AC2] treats partially_fulfilled equipment as arranged", () => {
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
  it("[SPM-34][AC3] refuses an event with no venue at all, and says so", () => {
    const result = checkEventConfirmation(input());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no venue is booked for this event");
      expect(result.outstanding).toHaveLength(1);
    }
  });

  // Boundary: the request exists but nobody has agreed to it. This is the case
  // the strict reading of #80 exists for.
  it("[SPM-34][AC3] refuses while the venue request is still pending, and distinguishes it from no venue", () => {
    const result = checkEventConfirmation(input({ bookings: [{ sessionId: null, status: "pending" }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("still awaiting a decision from Venue Staff");
  });

  it.each(["rejected", "cancelled"])("[SPM-34][AC3] treats a %s booking as no booking", (status) => {
    const result = checkEventConfirmation(input({ bookings: [{ sessionId: null, status }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no venue is booked");
  });

  it("[SPM-34][AC3] names the equipment that is not reserved, not merely that something is missing", () => {
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

  it("[SPM-34][AC3] reports every outstanding arrangement at once, so the list is not drip-fed", () => {
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

  it("[SPM-34][AC2] [SPM-42][AC4] requires a venue for every session", () => {
    const result = checkEventConfirmation(
      input({ sessions, bookings: [{ sessionId: "s1", status: "approved" }] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("the Day 2 session");
      expect(result.error).not.toContain("the Day 1 session");
    }
  });

  it("[SPM-34][AC2] [SPM-42][AC4] confirms once every session has its own approved booking", () => {
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
  it("[SPM-34][AC2] [SPM-42][AC4] names the session whose equipment is outstanding", () => {
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

  it("[SPM-34][AC2] [SPM-42][AC4] falls back to a neutral phrase for a session with no label", () => {
    const result = checkEventConfirmation(input({ sessions: [{ id: "s1", label: null }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("one session");
  });
});

describe("arrangementsFor — what the list itself looks like", () => {
  it("[SPM-33] lists the venue first, then equipment", () => {
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
  it("[SPM-33] omits equipment entirely when none was recorded", () => {
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
//   - registration (SPM-64's rule, kept when the two stories met on
//     2026-10-12): required only while enabled - while off, the row is "Not
//     required" and not `waived`; complete with a capacity, both ends of the
//     registration period and a measured booking that is still active
//   - the wording of every `missing` and `flagReason` below
//
// The Operational Safety Check row (AC6, AC9) is at the end of this file:
// it reads the SafetyCheck record SPM-86 added.

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
  it("[SPM-33][AC1][AC2] lists every venue booking of one event separately, each with its own status", () => {
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

  it("[SPM-33][AC1][AC2] names the venue that is still waiting on Venue Staff", () => {
    const list = rows({ bookings: [booking({ status: "pending", venueName: "Orchard Studio" })] });

    expect(list[0].missing).toBe("Orchard Studio for this event is still awaiting a decision from Venue Staff");
  });

  it.each(["rejected", "cancelled"])("[SPM-33][AC1][AC2] does not list a %s booking", (status) => {
    const list = rows({ bookings: [booking(), booking({ id: "b2", status, venueName: "Orchard Studio" })] });

    expect(list.map((a) => a.name)).toEqual(["Marina Auditorium"]);
  });

  it("[SPM-33][AC1][AC2] shows 'No venue booked' as outstanding when the event has no pending or approved booking", () => {
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

  it("[SPM-33][AC1][AC2] does not add 'No venue booked' while a booking is still awaiting a decision", () => {
    const list = rows({ bookings: [booking({ status: "pending" })] });

    expect(list.map((a) => a.name)).toEqual(["Marina Auditorium"]);
  });

  it("[SPM-33][AC1][AC2] keeps each session's bookings with that session, and shows 'No venue booked' for a session with none", () => {
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
  it("[SPM-33][AC2] is still listed on a multi-session event, without standing in for a session's venue", () => {
    const list = rows({ sessions, bookings: [booking({ sessionId: null })] });

    expect(list.map((a) => [a.name, a.session?.label ?? null])).toEqual([
      ["No venue booked", "Day 1"],
      ["Marina Auditorium", null],
    ]);
  });

  it("[SPM-33][AC2] is listed without a session when its session no longer exists", () => {
    const list = rows({ sessions, bookings: [booking({ sessionId: "s1" }), booking({ id: "b2", sessionId: "gone" })] });

    expect(list.map((a) => [a.id, a.session?.label ?? null])).toEqual([
      ["b1", "Day 1"],
      ["b2", null],
    ]);
  });

  it("[SPM-33][AC4] gives a reason even when a flag was raised without one", () => {
    const list = rows({ bookings: [booking({ needsReview: true, reviewReason: null })] });

    expect(list[0]).toMatchObject({ state: "outstanding", flagReason: "no reason was recorded" });
  });
});

describe("SPM-33 arrangementsFor — equipment (AC3)", () => {
  it("[SPM-33][AC3] lists every equipment line separately, each with its own status", () => {
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
  ])("[SPM-33][AC3] shows a %s line as outstanding", (status, missing) => {
    const list = rows({ bookings: [booking()], equipment: [line({ status, equipmentName: "Portable Stage" })] });

    expect(named(list, "Portable Stage")).toMatchObject({ state: "outstanding", complete: false, missing });
  });

  // Decided 2026-10-10: SPM-86's rule. A line Technical Support could only
  // partly reserve is held, so there is nothing to mark as not required.
  it("[SPM-33][AC3] shows a partially_fulfilled line as complete, with its own status", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "partially_fulfilled" })] });

    expect(named(list, "Handheld Wireless Mic")).toMatchObject({
      status: "partially_fulfilled",
      state: "complete",
      waivable: false,
    });
  });

  // Like a rejected or cancelled booking: it is no longer an arrangement.
  it("[SPM-33][AC3] does not list a cancelled equipment line", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "cancelled" })] });

    expect(list.map((a) => a.kind)).toEqual(["venue"]);
    expect(check({ bookings: [booking()], equipment: [line({ status: "cancelled" })] })).toEqual({ ok: true });
  });

  it("[SPM-33] lists venue bookings first, then equipment, then registration", () => {
    const list = rows({ bookings: [booking()], equipment: [line()], registration: registration() });

    expect(list.map((a) => a.kind)).toEqual(["venue", "equipment", "registration"]);
  });
});

describe("SPM-33 arrangementsFor — flagged for review (AC4)", () => {
  it("[SPM-33][AC4] shows an approved booking that is flagged for review as outstanding, with why", () => {
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

  it("[SPM-33][AC4] shows reserved equipment that is flagged for review as outstanding, with why", () => {
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
  it("[SPM-33][AC4] gives every reason a booking was flagged for, from a venue change and an event change alike", () => {
    const list = rows({
      bookings: [booking({ needsReview: true, reviewReason: "venue_retired,event_attendance_changed" })],
    });

    expect(list[0].flagReason).toBe("the venue has been retired; the expected attendance changed");
  });

  // SPM-55: Technical Support took units out of service, leaving a reservation short.
  it("[SPM-33][AC4] words a flag raised when equipment was marked out of service (SPM-55)", () => {
    const list = rows({
      bookings: [booking()],
      equipment: [line({ needsReview: true, reviewReason: "equipment_unavailable" })],
    });

    expect(named(list, "Handheld Wireless Mic")).toMatchObject({
      state: "outstanding",
      flagReason: "units of the equipment were marked out of service",
    });
  });

  it("[SPM-33][AC4] still shows a flag whose reason it does not recognise, rather than hiding it", () => {
    const list = rows({ bookings: [booking({ needsReview: true, reviewReason: "something_new" })] });

    expect(list[0].state).toBe("outstanding");
    expect(list[0].flagReason).not.toBe("");
  });

  it("[SPM-33][AC4] gives no flag reason for an arrangement that is not flagged", () => {
    const list = rows({ bookings: [booking()], equipment: [line()] });

    expect(list.map((a) => a.flagReason)).toEqual(["", ""]);
    expect(list.every((a) => a.state === "complete")).toBe(true);
  });
});

describe("SPM-33 arrangementsFor — registration setup (AC5)", () => {
  // SPM-64's rule (kept when the two stories met, 2026-10-12): registration
  // that is off is not required - but nobody waived it, so it cannot be
  // "marked as required" again.
  it("[SPM-33][AC5] shows registration that is not enabled as not required, and not as waived", () => {
    const list = rows({ bookings: [booking()], registration: registration({ enabled: false, capacity: null }) });

    expect(named(list, "Registration setup")).toMatchObject({
      state: "not_required",
      required: false,
      waived: false,
      waivable: false,
      notRequiredBy: null,
      note: "Registration is not enabled for this event.",
    });
    expect(checkEventConfirmation(input({ bookings: [booking()], registration: registration({ enabled: false, capacity: null }) }))).toEqual({ ok: true });
  });

  it("[SPM-33][AC5] marks only what the Coordinator waived as waived", () => {
    const list = rows({
      bookings: [booking()],
      equipment: [line({ status: "unavailable", notRequired: true }), line({ id: "r2", equipmentName: "Lectern" })],
    });

    expect(list.map((a) => [a.name, a.waived])).toEqual([
      ["Marina Auditorium", false],
      ["Handheld Wireless Mic", true],
      ["Lectern", false],
    ]);
  });

  it("[SPM-33][AC5] shows registration setup as complete once it has a capacity and a registration period", () => {
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
    ["no capacity", { capacity: null }, "registration setup is incomplete (still needed: registration capacity)"],
    ["no opening date", { opensAt: null }, "registration setup is incomplete (still needed: opening date)"],
    ["no closing date", { closesAt: null }, "registration setup is incomplete (still needed: closing date)"],
    [
      "neither",
      { capacity: null, opensAt: null, closesAt: null },
      "registration setup is incomplete (still needed: registration capacity, opening date, closing date)",
    ],
  ])("[SPM-33][AC5] shows registration that is enabled with %s as outstanding", (_case, over, missing) => {
    const list = rows({ bookings: [booking()], registration: registration(over) });

    expect(named(list, "Registration setup")).toMatchObject({ state: "outstanding", complete: false, missing });
  });
});

describe("SPM-33 arrangementsFor — not required (AC7, AC8, AC10)", () => {
  it("[SPM-33][AC7][AC10] tells complete, outstanding and not-required arrangements apart", () => {
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
  ])("[SPM-33][AC10] shows %s marked as not required as not required, not as outstanding or complete", (_case, over, name) => {
    const row = named(rows(over), name);

    expect(row).toMatchObject({ state: "not_required", required: false, complete: false });
  });

  it("[SPM-33][AC10] keeps the booking's or line's own status on a row marked as not required", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "unavailable", notRequired: true })] });

    expect(named(list, "Handheld Wireless Mic").status).toBe("unavailable");
  });

  it("[SPM-33][AC8] lets every outstanding booking, equipment line and registration setup be marked as not required", () => {
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

  it("[SPM-33][AC8] does not offer it for an arrangement that is already complete", () => {
    const list = rows({ bookings: [booking()], equipment: [line()], registration: registration() });

    expect(list.every((a) => a.state === "complete" && !a.waivable)).toBe(true);
  });

  // Decided 2026-10-08: any booking can be waived, but an event always needs
  // somewhere to happen.
  it("[SPM-33][AC8] never lets 'No venue booked' be marked as not required", () => {
    expect(rows()[0]).toMatchObject({ name: "No venue booked", waivable: false, required: true });
  });

  it("[SPM-33][AC8][AC1] shows 'No venue booked' again once the event's only booking is marked as not required", () => {
    const list = rows({ bookings: [booking({ status: "pending", notRequired: true })] });

    expect(list.map((a) => [a.name, a.state])).toEqual([
      ["Marina Auditorium", "not_required"],
      ["No venue booked", "outstanding"],
    ]);
  });

  it("[SPM-33][AC8][AC1] does not ask for another venue when one booking is not required and another is still held", () => {
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
  ])("[SPM-33][AC10] says who marked %s as not required, and when", (_case, over, name) => {
    expect(named(rows(over), name)).toMatchObject({
      state: "not_required",
      notRequiredBy: "Daniel Tan",
      notRequiredAt: AT,
    });
  });

  it("[SPM-33][AC10] names nobody on an arrangement that is not marked as not required", () => {
    const list = rows({ bookings: [booking()], equipment: [line({ status: "requested" })] });

    expect(list.map((a) => [a.notRequiredBy, a.notRequiredAt])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  // The columns record the latest decision either way, so after a reversal
  // they still hold who reversed it. That is not a waiver to show.
  it("[SPM-33][AC10] names nobody once the decision has been reversed", () => {
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
  ])("[SPM-33][AC11] confirms when the only thing outstanding is %s marked as not required", (_case, over) => {
    expect(check(over)).toEqual({ ok: true });
  });

  it("[SPM-33][AC11] refuses while an approved booking is flagged for review, and says why", () => {
    const result = check({ bookings: [booking({ needsReview: true, reviewReason: "venue_retired" })] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "This event cannot be confirmed yet: Marina Auditorium for this event is flagged for review: the venue has been retired."
      );
    }
  });

  it("[SPM-33][AC11] refuses while reserved equipment is flagged for review", () => {
    const result = check({
      bookings: [booking()],
      equipment: [line({ needsReview: true, reviewReason: "event_schedule_changed" })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outstanding.map((a) => a.name)).toEqual(["Handheld Wireless Mic"]);
  });

  it("[SPM-33][AC11] refuses while registration is enabled but its setup is incomplete", () => {
    const result = check({ bookings: [booking()], registration: registration({ capacity: null }) });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "This event cannot be confirmed yet: registration setup is incomplete (still needed: registration capacity)."
      );
    }
  });

  it("[SPM-33][AC11] [SPM-90][AC6] refuses when one of several venue bookings is still pending, naming only that one", () => {
    const result = check({
      bookings: [booking(), booking({ id: "b2", status: "pending", venueName: "Orchard Studio" })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Orchard Studio");
      expect(result.error).not.toContain("Marina Auditorium");
    }
  });

  it("[SPM-33][AC11] refuses an event whose only booking is marked as not required: it still has no venue", () => {
    const result = check({ bookings: [booking({ status: "pending", notRequired: true })] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This event cannot be confirmed yet: no venue is booked for this event.");
  });

  it("[SPM-33][AC11] leaves arrangements marked as not required out of what is preventing confirmation", () => {
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

// ---------------------------------------------------------------------------
// SPM-33 AC6 and AC9: the Operational Safety Check (SPM-86)
// ---------------------------------------------------------------------------
//
// CONTRACT (added 2026-10-12, written before the code):
//   ConfirmationInput.safetyCheck?  the event's LATEST SafetyCheck as
//     { id, status, submittedBy (name or null), submittedAt }, or null when it
//     was never submitted. Left out (undefined) = no safety row at all, which
//     is how Submit for safety check (safetyCheck.ts) asks its own question.
//   One row, last: kind "safety_check", name "Operational Safety Check",
//     id = the check's id (null when never submitted), status = one of the
//     display keys below, never waivable (AC9).
//   Arrangement gains
//     blocksConfirmation  true for every row. CHANGED (SPM-88, AC8/AC9): the
//       safety row used to block only while its check was PENDING; Resolve
//       Safety Check Outcome turned the gate on, so Confirm waits for an
//       approved check. Confirm refuses, and the blocking count counts, only
//       rows that block.
//     note  "Submitted by Daniel Tan on 9 Oct 2026, 14:30" for a submitted
//       check, "" otherwise.
//
//   SafetyCheck.status  ->  status (label)                     state
//   (never submitted)       safety_not_submitted (Not submitted)  outstanding
//   pending                 safety_awaiting_review (Awaiting review) outstanding
//   approved                safety_approved (Approved)              complete
//   changes_requested       safety_changes_requested (Changes requested) outstanding
//   rejected                safety_rejected (Rejected)              outstanding
//   closed (SPM-88)         safety_not_submitted (Not submitted)  outstanding
//
// Decided here, not in the story: the display keys, the wording of `missing`
// and `note`, and that a check closed by a change (SPM-88) reads as not
// submitted, since it has to be submitted again.

describe("SPM-33 arrangementsFor — the Operational Safety Check (AC6, AC9)", () => {
  const SUBMITTED = new Date("2026-10-09T06:30:00.000Z"); // 14:30 in Singapore
  const check = (status: string) => ({ id: "sc1", status, submittedBy: "Daniel Tan", submittedAt: SUBMITTED });
  const safetyRow = (safetyCheck: ConfirmationInput["safetyCheck"]) =>
    named(rows({ bookings: [booking()], safetyCheck }), "Operational Safety Check");

  it("[SPM-33][AC6] has no safety row when it is not asked about", () => {
    expect(rows({ bookings: [booking()] }).map((a) => a.kind)).toEqual(["venue"]);
  });

  it("[SPM-33][AC6] shows the safety check as a required item, after everything else", () => {
    const list = rows({ bookings: [booking()], equipment: [line()], registration: registration(), safetyCheck: null });

    expect(list.map((a) => a.kind)).toEqual(["venue", "equipment", "registration", "safety_check"]);
  });

  it("[SPM-33][AC6] shows a check that was never submitted as not submitted and outstanding", () => {
    expect(safetyRow(null)).toMatchObject({
      kind: "safety_check",
      id: null,
      name: "Operational Safety Check",
      session: null,
      status: "safety_not_submitted",
      state: "outstanding",
      required: true,
      complete: false,
      missing: "the Operational Safety Check has not been submitted yet",
      note: "",
    });
  });

  it.each([
    ["pending", "safety_awaiting_review", "outstanding", "the Operational Safety Check is awaiting the Safety Officer's review"],
    ["approved", "safety_approved", "complete", ""],
    ["changes_requested", "safety_changes_requested", "outstanding", "the Safety Officer asked for changes in the Operational Safety Check"],
    ["rejected", "safety_rejected", "outstanding", "the Safety Officer rejected the safety arrangement"],
    ["closed", "safety_not_submitted", "outstanding", "the Operational Safety Check has to be submitted again"],
  ])("[SPM-33][AC6] shows a %s check as %s", (status, shown, state, missing) => {
    expect(safetyRow(check(status))).toMatchObject({ id: "sc1", status: shown, state, missing });
  });

  it("[SPM-33][AC6] still lists a check whose status it does not recognise, as outstanding", () => {
    expect(safetyRow(check("something_new"))).toMatchObject({
      status: "safety_something_new",
      state: "outstanding",
      missing: "the Operational Safety Check is not approved yet",
    });
  });

  it("[SPM-33][AC6] says who submitted the check and when", () => {
    expect(safetyRow(check("pending")).note).toBe("Submitted by Daniel Tan on 9 Oct 2026, 14:30");
  });

  it("[SPM-33][AC6] still says when it was submitted if the submitter cannot be named", () => {
    expect(safetyRow({ ...check("pending"), submittedBy: null }).note).toBe("Submitted on 9 Oct 2026, 14:30");
  });

  // AC9.
  it.each([null, "pending", "approved", "changes_requested", "rejected", "closed"])(
    "[SPM-33][AC9] can never be marked as not required (latest check: %s)",
    (status) => {
      expect(safetyRow(status === null ? null : check(status)).waivable).toBe(false);
    }
  );

  // SPM-88 (AC8, AC9): Confirm waits for the Safety Officer's approval.
  it("[SPM-88][AC8][AC9] SPM-88-TC13: stops confirmation while the check was never submitted", () => {
    expect(safetyRow(null).blocksConfirmation).toBe(true);
    expect(checkEventConfirmation(input({ bookings: [booking()], safetyCheck: null }))).toMatchObject({
      ok: false,
      error: "This event cannot be confirmed yet: the Operational Safety Check has not been submitted yet.",
    });
  });

  it("[SPM-88][AC8][AC9] blocks confirmation while the check is awaiting the Safety Officer's review", () => {
    expect(safetyRow(check("pending")).blocksConfirmation).toBe(true);
    const result = checkEventConfirmation(input({ bookings: [booking()], safetyCheck: check("pending") }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "This event cannot be confirmed yet: the Operational Safety Check is awaiting the Safety Officer's review."
      );
    }
  });

  it.each([
    ["changes_requested", "the Safety Officer asked for changes in the Operational Safety Check"],
    ["rejected", "the Safety Officer rejected the safety arrangement"],
    ["closed", "the Operational Safety Check has to be submitted again"],
  ])("[SPM-88][AC8][AC9] SPM-88-TC08: stops confirmation once the check is %s", (status, missing) => {
    expect(checkEventConfirmation(input({ bookings: [booking()], safetyCheck: check(status) }))).toMatchObject({
      ok: false,
      error: `This event cannot be confirmed yet: ${missing}.`,
    });
  });

  it("[SPM-88][AC8][AC9] SPM-88-TC09: lets an event with an approved check be confirmed", () => {
    expect(checkEventConfirmation(input({ bookings: [booking()], safetyCheck: check("approved") }))).toEqual({ ok: true });
  });

  it("[SPM-88][AC8][AC9] counts the safety check among what blocks confirmation", () => {
    const list = rows({ bookings: [booking({ status: "pending" })], equipment: [line()], safetyCheck: null });

    expect(list.map((a) => [a.kind, a.blocksConfirmation])).toEqual([
      ["venue", true],
      ["equipment", true],
      ["safety_check", true],
    ]);
    expect(blockingArrangements(list).map((a) => a.kind)).toEqual(["venue", "safety_check"]);
  });

  it("[SPM-88][AC3] SPM-88-TC03: words an arrangement flagged after a returned safety check", () => {
    const [flagged] = rows({ bookings: [booking({ needsReview: true, reviewReason: "safety_check_returned" })] });
    expect(flagged.flagReason).toBe("the Safety Officer returned the safety check");
  });

  it("[SPM-33] gives every other row an empty note", () => {
    const list = rows({ bookings: [booking()], equipment: [line()], registration: registration() });

    expect(list.map((a) => a.note)).toEqual(["", "", ""]);
  });
});

// SPM-64 AC8: registration setup is an arrangement the event needs only when
// registration is enabled. Incomplete while the capacity, the opening date or
// the closing date is missing, or while the booking the capacity was measured
// against is no longer active. Manual cases SPM-64-TC16 to TC18.
describe("AC8 incomplete registration setup is outstanding and blocks confirmation", () => {
  const MEASURED = "booking-1";
  const venue = { id: MEASURED, sessionId: null, status: "approved" };
  const setup = (over: Partial<NonNullable<ConfirmationInput["registration"]>> = {}) => ({
    enabled: true,
    capacity: 60,
    opensAt: new Date("2027-03-01T01:00:00.000Z"),
    closesAt: new Date("2027-04-27T09:00:00.000Z"),
    measuredBookingId: MEASURED,
    ...over,
  });
  const registrationOf = (over = {}) =>
    arrangementsFor(input({ bookings: [venue], registration: setup(over) })).find((a) => a.kind === "registration");

  it.each([
    ["the capacity", { capacity: null, measuredBookingId: null }, "registration capacity"],
    ["the opening date", { opensAt: null }, "opening date"],
    ["the closing date", { closesAt: null }, "closing date"],
  ])("[SPM-64][AC8] is outstanding while %s is missing, naming it (TC16)", (_what, over, named) => {
    expect(registrationOf(over)).toMatchObject({
      required: true,
      complete: false,
      missing: `registration setup is incomplete (still needed: ${named})`,
    });
  });

  it("[SPM-64][AC8] names everything missing in one go, and refuses confirmation with it (TC16)", () => {
    const result = checkEventConfirmation(
      input({ bookings: [venue], registration: setup({ capacity: null, opensAt: null, closesAt: null, measuredBookingId: null }) })
    );

    expect(result).toMatchObject({
      ok: false,
      error:
        "This event cannot be confirmed yet: registration setup is incomplete (still needed: registration capacity, opening date, closing date).",
    });
  });

  it("[SPM-64][AC8] is outstanding while the booking the capacity was measured against is no longer active (TC18)", () => {
    const result = checkEventConfirmation(
      input({
        bookings: [{ id: MEASURED, sessionId: null, status: "rejected" }, { id: "booking-2", sessionId: null, status: "approved" }],
        registration: setup(),
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error:
        "This event cannot be confirmed yet: registration capacity is measured against a venue booking that is no longer active.",
    });
  });

  it("[SPM-64][AC8] is complete once every setting is in place, and confirmation goes ahead (TC16)", () => {
    expect(registrationOf()).toMatchObject({ required: true, complete: true, missing: "" });
    expect(checkEventConfirmation(input({ bookings: [venue], registration: setup() }))).toEqual({ ok: true });
  });

  it("[SPM-64][AC8] is not required while registration is turned off, however incomplete (TC17)", () => {
    const off = setup({ enabled: false, capacity: null, opensAt: null, closesAt: null, measuredBookingId: null });

    expect(registrationOf(off)).toMatchObject({ required: false });
    expect(checkEventConfirmation(input({ bookings: [venue], registration: off }))).toEqual({ ok: true });
  });

  it("[SPM-64][AC8] comes after the venue and equipment in the list", () => {
    const list = arrangementsFor(
      input({ bookings: [venue], equipment: [reserved("Portable Stage")], registration: setup() })
    );
    expect(list.map((a) => a.kind)).toEqual(["venue", "equipment", "registration"]);
  });
});

// SPM-90 (written before the code): a booking carries what its space is for
// (BookingInput.purpose), each venue row carries it (Arrangement.purpose), and
// an unconfirmed booking is identified by it (AC5, AC6).
describe("SPM-90 — what each venue booking's space is for", () => {
  const hall = booking({ purpose: "Main programme" });
  const breakout = booking({ id: "b2", status: "pending", venueName: "Orchard Studio", purpose: "Breakout room" });

  it("[SPM-90][AC5] SPM-90-TC07: carries each booking's purpose on its own row", () => {
    const list = rows({ bookings: [hall, breakout] });

    expect(named(list, "Marina Auditorium")).toMatchObject({ purpose: "Main programme", state: "complete" });
    expect(named(list, "Orchard Studio")).toMatchObject({ purpose: "Breakout room", state: "outstanding" });
  });

  it("[SPM-90][AC6] SPM-90-TC08: refuses to confirm while one of two rooms is pending, naming that room and what it is for", () => {
    const result = check({ bookings: [hall, breakout] });

    expect(result).toMatchObject({
      ok: false,
      error:
        "This event cannot be confirmed yet: Orchard Studio (Breakout room) for this event is still awaiting a decision from Venue Staff.",
    });
    expect(result.ok === false && result.outstanding.map((a) => a.id)).toEqual(["b2"]);
  });

  it("[SPM-90][AC6] SPM-90-TC09: confirms once every room is approved", () => {
    expect(check({ bookings: [hall, { ...breakout, status: "approved" }] })).toEqual({ ok: true });
  });

  it("[SPM-90][AC5] names the session as well as the purpose on a multi-session event", () => {
    const list = rows({
      sessions: [{ id: "s1", label: "Day 1" }],
      bookings: [{ ...breakout, sessionId: "s1" }],
    });

    expect(named(list, "Orchard Studio").missing).toBe(
      "Orchard Studio (Breakout room) for the Day 1 session is still awaiting a decision from Venue Staff"
    );
  });

  it.each([null, undefined, "  "])("[SPM-90][AC7] SPM-90-TC10: names a booking with no purpose (%j) as before", (purpose) => {
    const [row] = rows({ bookings: [booking({ status: "pending", purpose })] });

    expect(row.purpose).toBeNull();
    expect(row.missing).toBe("Marina Auditorium for this event is still awaiting a decision from Venue Staff");
  });

  it("[SPM-90] gives rows that are not bookings no purpose", () => {
    const [noVenue] = rows();

    expect(noVenue).toMatchObject({ name: "No venue booked", purpose: null });
  });
});

// SPM-82 (AC10): a tentative hold that expired leaves the room unarranged.
// It stays outstanding - named, with when it expired - until the Coordinator
// has a newer request for the same space, or marks it as not required.
describe("SPM-82 — an expired tentative hold", () => {
  const EXPIRED_AT = new Date("2026-10-01T01:00:00.000Z"); // 1 Oct 2026, 09:00 in Singapore
  const expired = booking({ id: "x1", status: "expired", venueName: "SPM82 Hold Room", holdExpiresAt: EXPIRED_AT });

  it("[SPM-82][AC10] SPM-82-TC08: is outstanding, saying when it expired and what to do", () => {
    const [row] = rows({ bookings: [expired] });

    expect(row).toMatchObject({ kind: "venue", id: "x1", name: "SPM82 Hold Room", status: "expired", state: "outstanding" });
    expect(row.missing).toBe(
      "the hold on SPM82 Hold Room for this event expired on 1 Oct 2026, 09:00 - submit a new request"
    );
  });

  it("[SPM-82][AC10] SPM-82-TC08: stands in for 'No venue booked' rather than adding it as well", () => {
    expect(rows({ bookings: [expired] }).map((a) => a.name)).toEqual(["SPM82 Hold Room"]);
  });

  it("[SPM-82][AC5] SPM-82-TC08 (AC5): is not a booking - confirmation is refused on it", () => {
    expect(check({ bookings: [expired] })).toMatchObject({
      ok: false,
      error:
        "This event cannot be confirmed yet: the hold on SPM82 Hold Room for this event expired on 1 Oct 2026, 09:00 - submit a new request.",
    });
  });

  it("[SPM-82][AC10] SPM-82-TC09: is replaced by a newer request for the same space, which is what then waits", () => {
    const renewed = booking({ id: "n1", status: "pending", venueName: "SPM82 Hold Room" });
    const list = rows({ bookings: [expired, renewed] });

    expect(list.map((a) => a.id)).toEqual(["n1"]);
    expect(list[0].missing).toBe("SPM82 Hold Room for this event is still awaiting a decision from Venue Staff");
  });

  it("[SPM-82][AC10] is replaced once the newer request is approved, so the event can be confirmed", () => {
    expect(check({ bookings: [expired, booking({ id: "n1", status: "approved" })] })).toEqual({ ok: true });
  });

  it("[SPM-82][AC10] SPM-82-TC09: with no purpose recorded (a booking from before SPM-90), is replaced by any newer request for its session", () => {
    const renewed = booking({ id: "n1", status: "pending", venueName: "SPM82 Hold Room", purpose: "Main programme" });

    expect(rows({ bookings: [expired, renewed] }).map((a) => a.id)).toEqual(["n1"]);
  });

  it("[SPM-82][AC10] is not replaced by an older request - only one made after it", () => {
    const older = booking({ id: "o1", status: "approved", venueName: "Marina Auditorium" });

    expect(rows({ bookings: [older, expired] }).find((a) => a.id === "x1")).toMatchObject({ state: "outstanding" });
  });

  it("[SPM-82][AC10] SPM-90: is not replaced by a request for a different space of the same event", () => {
    const breakout = booking({ id: "x2", status: "expired", venueName: "Orchard Studio", purpose: "Breakout room", holdExpiresAt: EXPIRED_AT });
    const hall = booking({ id: "h1", status: "approved", purpose: "Main programme" });
    const list = rows({ bookings: [breakout, hall] });

    expect(list.find((a) => a.id === "x2")).toMatchObject({ state: "outstanding", purpose: "Breakout room" });
    expect(list.find((a) => a.id === "h1")).toMatchObject({ state: "complete" });
  });

  it("[SPM-82][AC10] is replaced only within its own session of a multi-session event", () => {
    const sessions = [{ id: "s1", label: "Day 1" }, { id: "s2", label: "Day 2" }];
    const list = rows({
      sessions,
      bookings: [{ ...expired, sessionId: "s1" }, booking({ id: "d2", sessionId: "s2", status: "approved" })],
    });

    expect(list.find((a) => a.id === "x1")).toMatchObject({ state: "outstanding" });
    expect(list.find((a) => a.id === "x1")!.missing).toContain("for the Day 1 session expired on");
  });

  it("[SPM-82][AC10] [SPM-33][AC8] can be marked as not required while outstanding, and then is shown as not required", () => {
    expect(rows({ bookings: [expired] })[0]).toMatchObject({ waivable: true });

    const waived = { ...expired, notRequired: true, notRequiredAt: EXPIRED_AT, notRequiredBy: "Daniel Tan" };
    expect(rows({ bookings: [waived] }).find((a) => a.id === "x1")).toMatchObject({
      state: "not_required",
      waived: true,
      notRequiredBy: "Daniel Tan",
    });
  });

  it("[SPM-82][AC10] names a hold whose expiry was never recorded without a date", () => {
    const [row] = rows({ bookings: [{ ...expired, holdExpiresAt: null }] });

    expect(row.missing).toBe("the hold on SPM82 Hold Room for this event expired - submit a new request");
  });

  it("[SPM-82][AC10] names the room generically when the booking does not carry its name", () => {
    const [row] = rows({ bookings: [{ ...expired, id: undefined, venueName: undefined }] });

    expect(row).toMatchObject({ id: null, name: "Venue", state: "outstanding" });
    expect(row.missing).toBe("the hold on the venue for this event expired on 1 Oct 2026, 09:00 - submit a new request");
  });

  it("[SPM-82][AC10] is still listed on a multi-session event when it names no session", () => {
    const list = rows({ sessions: [{ id: "s1", label: "Day 1" }], bookings: [{ ...expired, sessionId: null }] });

    expect(list.map((a) => [a.id, a.session?.label ?? null, a.state])).toEqual([
      [null, "Day 1", "outstanding"],
      ["x1", null, "outstanding"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// SPM-77: a suggested alternative waiting for the Coordinator's decision. The
// line is outstanding until it is decided - on the Equipment tab, so the
// Readiness tab neither waives it nor decides it - and Submit for safety check
// (SPM-86) refuses on the same row.
// ---------------------------------------------------------------------------
describe("SPM-77 arrangementsFor — a suggested alternative waiting for a decision", () => {
  const WAITING = "Ring Light for this event has a suggested alternative (Podium Light) waiting for your decision";
  const ringLight = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    sessionId: null,
    status: "partially_fulfilled",
    equipmentName: "Ring Light",
    pendingSuggestion: "Podium Light",
    ...over,
  });
  const row = (over: Record<string, unknown> = {}) =>
    arrangementsFor(input({ bookings: [approvedVenue], equipment: [ringLight(over)] })).find((a) => a.kind === "equipment")!;

  it("[SPM-77][AC5][AC6] shows a partly fulfilled line as outstanding while a suggestion waits, saying so", () => {
    expect(row()).toMatchObject({
      state: "outstanding",
      required: true,
      complete: false,
      missing: WAITING,
      waivable: false,
      awaitingDecision: true,
    });
  });

  it("[SPM-77][AC5][AC6] names the waiting suggestion rather than 'not reserved yet' on a line that cannot be provided", () => {
    expect(row({ status: "unavailable" }).missing).toBe(WAITING);
  });

  it("[SPM-77][AC5][AC6] names it rather than the flag on a flagged line", () => {
    expect(row({ status: "reserved", needsReview: true, reviewReason: "event_schedule_changed" }).missing).toBe(WAITING);
  });

  it("[SPM-77][AC5][AC6] keeps a line marked as not required outstanding while a suggestion waits", () => {
    expect(row({ status: "unavailable", notRequired: true, notRequiredBy: "Daniel Tan", notRequiredAt: new Date() })).toMatchObject({
      state: "outstanding",
      waived: false,
      waivable: false,
      notRequiredBy: null,
      notRequiredAt: null,
      missing: WAITING,
    });
  });

  it("[SPM-77][AC6] shows the line as it was once the suggestion is decided", () => {
    expect(row({ pendingSuggestion: null })).toMatchObject({ state: "complete", missing: "", awaitingDecision: false });
    expect(row({ status: "unavailable", notRequired: true, pendingSuggestion: null })).toMatchObject({
      state: "not_required",
      waived: true,
    });
  });

  it("[SPM-77][AC5][AC6] holds Confirm back on the same row", () => {
    const check = checkEventConfirmation(input({ bookings: [approvedVenue], equipment: [ringLight()] }));

    expect(check.ok).toBe(false);
    expect(!check.ok && check.error).toContain(WAITING);
  });
});
