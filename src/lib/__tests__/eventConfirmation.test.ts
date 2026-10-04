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
  // shortfall is essential is the Coordinator's decision (#90).
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
