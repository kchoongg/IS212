// SPM-51 Register for Event - who may register for an event right now (written test-first):
//   src/lib/registrationEligibility.ts
//     registrationState(event, seatsTaken, now) -> { kind: "open" } or the reason it isn't, checked in order:
//       not_confirmed, disabled, no_period, not_open { opensAt }, closed { closesAt }, full
//     REGISTRATION_REFUSALS[kind] - the message the register route answers with
//     SEAT_TAKING - the registration statuses that take a seat
// Manual cases: docs/test-cases/SPM-51_test_cases.json (TC04-TC10; wording decided there).
import { describe, it, expect } from "vitest";
import {
  REGISTRATION_REFUSALS,
  SEAT_TAKING,
  WITHDRAW_REFUSALS,
  canWithdraw,
  registrationCounts,
  registrationState,
  withdrawRefusal,
} from "../registrationEligibility";

const OPENS = new Date("2026-09-01T01:00:00.000Z"); // 1 Sept 2026, 09:00 Singapore
const CLOSES = new Date("2027-12-31T09:00:00.000Z"); // 31 Dec 2027, 17:00 Singapore
const NOW = new Date("2026-10-10T04:00:00.000Z");
const minute = 60_000;

function event(overrides: Record<string, unknown> = {}) {
  return {
    status: "confirmed",
    registrationEnabled: true,
    registrationCapacity: 3,
    registrationOpensAt: OPENS,
    registrationClosesAt: CLOSES,
    ...overrides,
  };
}

describe("AC3 an event is eligible only when Confirmed, enabled and within its registration period", () => {
  it("is open for a Confirmed event with registration on, inside its period, with a seat left (TC02)", () => {
    expect(registrationState(event(), 0, NOW)).toEqual({ kind: "open" });
  });

  it.each(["approved", "planning", "postponed", "completed", "cancelled"])("is not open while the event is %s (TC09)", (status) => {
    expect(registrationState(event({ status }), 0, NOW)).toEqual({ kind: "not_confirmed" });
  });

  it.each([
    ["no opening date", { registrationOpensAt: null }],
    ["no closing date", { registrationClosesAt: null }],
    ["no dates at all", { registrationOpensAt: null, registrationClosesAt: null }],
  ])("is not open with %s (TC08)", (_what, overrides) => {
    expect(registrationState(event(overrides), 0, NOW)).toEqual({ kind: "no_period" });
  });

  it("checks Confirmed before anything else", () => {
    expect(registrationState(event({ status: "planning", registrationEnabled: false }), 3, NOW)).toEqual({
      kind: "not_confirmed",
    });
  });
});

describe("AC4 before the period opens or after it closes, nobody can register", () => {
  it("is not open a minute before it opens, saying when it opens (TC06)", () => {
    expect(registrationState(event(), 0, new Date(OPENS.getTime() - minute))).toEqual({ kind: "not_open", opensAt: OPENS });
  });

  it("is open from the moment it opens", () => {
    expect(registrationState(event(), 0, OPENS)).toEqual({ kind: "open" });
  });

  it("is still open at the moment it closes", () => {
    expect(registrationState(event(), 0, CLOSES)).toEqual({ kind: "open" });
  });

  it("is closed a minute after, saying when it closed (TC07)", () => {
    expect(registrationState(event(), 0, new Date(CLOSES.getTime() + minute))).toEqual({ kind: "closed", closesAt: CLOSES });
  });
});

describe("AC8 registration is not available when it is turned off", () => {
  it("is not open with registration off (TC10)", () => {
    expect(registrationState(event({ registrationEnabled: false }), 0, NOW)).toEqual({ kind: "disabled" });
  });
});

describe("AC9 registration stops once the capacity is reached", () => {
  it("is open with one seat left (TC04)", () => {
    expect(registrationState(event(), 2, NOW)).toEqual({ kind: "open" });
  });

  it("is full once every seat is taken (TC05)", () => {
    expect(registrationState(event(), 3, NOW)).toEqual({ kind: "full" });
  });

  it("has no limit when no capacity is set", () => {
    expect(registrationState(event({ registrationCapacity: null }), 500, NOW)).toEqual({ kind: "open" });
  });

  it("counts registered and attended attendees as taking a seat, not waitlisted or withdrawn ones (TC04)", () => {
    expect(SEAT_TAKING).toEqual(["registered", "attended"]);
  });

  it("says the period, not fullness, when both apply", () => {
    expect(registrationState(event(), 3, new Date(CLOSES.getTime() + minute))).toMatchObject({ kind: "closed" });
  });
});

describe("the refusal each state gives", () => {
  it("words each one as the register route answers it", () => {
    expect(REGISTRATION_REFUSALS).toEqual({
      not_confirmed: "Event is not open for registration yet",
      disabled: "Registration is not enabled for this event",
      no_period: "Registration dates haven't been set for this event",
      not_open: "Registration has not opened yet",
      closed: "Registration has closed",
      full: "This event is full",
    });
  });
});

// SPM-52 Withdraw from Event.
describe("SPM-52 AC1 only a registration holding a seat can be withdrawn", () => {
  const NOW = new Date("2026-10-13T04:00:00Z");
  const upcoming = { status: "confirmed", endsAt: new Date("2028-03-04T09:00:00Z") };

  it("lets a registered attendee withdraw from an upcoming event", () => {
    expect(withdrawRefusal("registered", upcoming, NOW)).toBeNull();
    expect(canWithdraw("registered", upcoming, NOW)).toBe(true);
  });

  it.each(["waitlisted", "withdrawn", "attended"])("does not let a %s registration be withdrawn", (status) => {
    expect(withdrawRefusal(status, upcoming, NOW)).toBe(WITHDRAW_REFUSALS.not_active);
    expect(canWithdraw(status, upcoming, NOW)).toBe(false);
  });

  it("does not let a registration for a cancelled event be withdrawn", () => {
    expect(withdrawRefusal("registered", { ...upcoming, status: "cancelled" }, NOW)).toBe(WITHDRAW_REFUSALS.cancelled);
  });

  it("does not let a registration for a completed event be withdrawn", () => {
    expect(withdrawRefusal("registered", { ...upcoming, status: "completed" }, NOW)).toBe(WITHDRAW_REFUSALS.over);
  });

  it("does not let a registration be withdrawn once the event has ended, even before it is marked completed", () => {
    const ended = { status: "confirmed", endsAt: new Date("2026-10-12T09:00:00Z") };
    expect(withdrawRefusal("registered", ended, NOW)).toBe(WITHDRAW_REFUSALS.over);
    expect(withdrawRefusal("registered", { ...ended, endsAt: NOW }, NOW)).toBe(WITHDRAW_REFUSALS.over);
  });

  it("reads the end time as the screens receive it, an ISO string", () => {
    expect(canWithdraw("registered", { status: "confirmed", endsAt: "2026-10-12T09:00:00.000Z" }, NOW)).toBe(false);
    expect(canWithdraw("registered", { status: "confirmed", endsAt: "2028-03-04T09:00:00.000Z" }, NOW)).toBe(true);
  });
});

describe("SPM-52 AC4 + AC5 the registrations counted for the organiser and coordinator", () => {
  it("counts registered and attended as places taken, and withdrawn on its own", () => {
    expect(
      registrationCounts([
        { status: "registered", count: 10 },
        { status: "attended", count: 2 },
        { status: "waitlisted", count: 4 },
        { status: "withdrawn", count: 3 },
      ])
    ).toEqual({ taken: 12, withdrawn: 3 });
  });

  it("gives a withdrawn registration back its place", () => {
    const before = registrationCounts([{ status: "registered", count: 5 }]);
    const after = registrationCounts([
      { status: "registered", count: 4 },
      { status: "withdrawn", count: 1 },
    ]);

    expect(before).toEqual({ taken: 5, withdrawn: 0 });
    expect(after).toEqual({ taken: 4, withdrawn: 1 });
  });

  it("is zero for an event nobody has registered for", () => {
    expect(registrationCounts([])).toEqual({ taken: 0, withdrawn: 0 });
  });
});
