import { describe, it, expect } from "vitest";
import { deriveEventFromSessions, equipmentWindow, EQUIPMENT_LOAD_WINDOW_MS } from "../eventSessions";

describe("deriveEventFromSessions", () => {
  it("returns null for an event with no sessions, so the caller keeps the event's own values", () => {
    expect(deriveEventFromSessions(undefined)).toBeNull();
    expect(deriveEventFromSessions(null)).toBeNull();
    expect(deriveEventFromSessions([])).toBeNull();
  });

  it("takes the earliest start and the latest end, whatever order the sessions arrive in", () => {
    const derived = deriveEventFromSessions([
      { startsAt: "2026-12-06T01:00:00.000Z", endsAt: "2026-12-06T09:00:00.000Z" },
      { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z" },
      { startsAt: "2026-12-07T01:00:00.000Z", endsAt: "2026-12-07T04:00:00.000Z" },
    ]);
    expect(derived?.startsAt.toISOString()).toBe("2026-12-05T01:00:00.000Z");
    expect(derived?.endsAt.toISOString()).toBe("2026-12-07T04:00:00.000Z");
  });

  it("spans a gap between sessions rather than treating each day separately", () => {
    // Day 1 and day 3, nothing on day 2: the event still runs across all three.
    const derived = deriveEventFromSessions([
      { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z" },
      { startsAt: "2026-12-07T01:00:00.000Z", endsAt: "2026-12-07T09:00:00.000Z" },
    ]);
    expect(derived?.startsAt.toISOString()).toBe("2026-12-05T01:00:00.000Z");
    expect(derived?.endsAt.toISOString()).toBe("2026-12-07T09:00:00.000Z");
  });

  it("uses the largest session for attendance, not the sum", () => {
    // A venue has to hold one session at a time, and the same people usually
    // attend several - 300 + 80 would overstate it.
    const derived = deriveEventFromSessions([
      { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z", expectedAttendance: 300 },
      { startsAt: "2026-12-06T01:00:00.000Z", endsAt: "2026-12-06T09:00:00.000Z", expectedAttendance: 80 },
    ]);
    expect(derived?.expectedAttendance).toBe(300);
  });

  it("ignores sessions with no attendance figure, and is undefined when none has one", () => {
    const withOne = deriveEventFromSessions([
      { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z", expectedAttendance: null },
      { startsAt: "2026-12-06T01:00:00.000Z", endsAt: "2026-12-06T09:00:00.000Z", expectedAttendance: 80 },
    ]);
    expect(withOne?.expectedAttendance).toBe(80);

    const withNone = deriveEventFromSessions([
      { startsAt: "2026-12-05T01:00:00.000Z", endsAt: "2026-12-05T09:00:00.000Z" },
      { startsAt: "2026-12-06T01:00:00.000Z", endsAt: "2026-12-06T09:00:00.000Z" },
    ]);
    expect(withNone?.expectedAttendance).toBeUndefined();
  });

  it("accepts Date objects as well as ISO strings (the route reads sessions back from Prisma)", () => {
    const derived = deriveEventFromSessions([
      { startsAt: new Date("2026-12-05T01:00:00.000Z"), endsAt: new Date("2026-12-05T09:00:00.000Z") },
      { startsAt: new Date("2026-12-06T01:00:00.000Z"), endsAt: new Date("2026-12-06T09:00:00.000Z") },
    ]);
    expect(derived?.startsAt.toISOString()).toBe("2026-12-05T01:00:00.000Z");
  });
});

describe("equipmentWindow", () => {
  it("holds equipment two hours before the start and two hours after the end", () => {
    const window = equipmentWindow(new Date("2026-12-05T09:00:00.000Z"), new Date("2026-12-05T17:00:00.000Z"));
    expect(window.startsAt.toISOString()).toBe("2026-12-05T07:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-12-05T19:00:00.000Z");
    expect(EQUIPMENT_LOAD_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("does not mutate the dates it is given", () => {
    const start = new Date("2026-12-05T09:00:00.000Z");
    equipmentWindow(start, new Date("2026-12-05T17:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-12-05T09:00:00.000Z");
  });
});
