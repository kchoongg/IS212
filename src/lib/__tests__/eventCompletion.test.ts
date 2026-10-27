// SPM-36 - Mark Event as Completed. The pure rules: when an event has ended,
// and when one still Confirmed is completed automatically (#71).

import { describe, expect, it } from "vitest";
import {
  AUTO_COMPLETE_AFTER_DAYS,
  AUTO_COMPLETE_REASON,
  NOT_ENDED_MESSAGE,
  autoCompleteCutoff,
  completedMessage,
  hasEnded,
} from "@/lib/eventCompletion";
import { canMarkEventCompleted } from "@/lib/permissions";

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const NOW = sgt("2026-11-10T18:00:00");

describe("hasEnded (AC1)", () => {
  it("[SPM-36][AC1] says an event whose end has passed has ended", () => {
    expect(hasEnded(sgt("2026-11-10T17:59:00"), NOW)).toBe(true);
  });

  it("[SPM-36][AC1] counts the end itself as ended", () => {
    expect(hasEnded(NOW, NOW)).toBe(true);
  });

  it("[SPM-36][AC1] says an event still running or ahead has not ended", () => {
    expect(hasEnded(sgt("2026-11-10T18:01:00"), NOW)).toBe(false);
  });

  it("[SPM-36][AC1] reads an end sent as text, as the API sends it", () => {
    expect(hasEnded("2026-11-10T09:00:00.000Z", NOW)).toBe(true);
  });

  it.each([null, undefined])("[SPM-36][AC1] says an event with no end (%s) has not ended", (endsAt) => {
    expect(hasEnded(endsAt, NOW)).toBe(false);
  });
});

describe("autoCompleteCutoff (AC6)", () => {
  it("[SPM-36][AC6] is exactly 7 x 24 hours before now", () => {
    expect(AUTO_COMPLETE_AFTER_DAYS).toBe(7);
    expect(autoCompleteCutoff(NOW)).toEqual(sgt("2026-11-03T18:00:00"));
  });
});

describe("wording", () => {
  it("[SPM-36][AC1] SPM-36-TC04: refuses an event that has not ended in these words", () => {
    expect(NOT_ENDED_MESSAGE).toBe("This event hasn't ended yet, so it can't be marked completed.");
  });

  it("[SPM-36][AC6] records an automatic completion with this reason", () => {
    expect(AUTO_COMPLETE_REASON).toBe("Completed automatically 7 days after the event ended");
  });

  it("[SPM-36][AC1] SPM-36-TC01: confirms the completion by the event's title", () => {
    expect(completedMessage("SPM36 Harbour Awards Night")).toBe("SPM36 Harbour Awards Night has been marked as completed.");
  });

  it.each([null, undefined, ""])("[SPM-36][AC1] says 'This event' when there is no title (%s)", (title) => {
    expect(completedMessage(title)).toBe("This event has been marked as completed.");
  });
});

describe("canMarkEventCompleted (AC1, AC2)", () => {
  const coordinator = { id: "c1", role: "coordinator", organisationId: null };
  const event = (overrides: Record<string, unknown> = {}) => ({
    organiserId: "o1",
    organisationId: "org1",
    coordinatorId: "c1",
    status: "confirmed",
    endsAt: sgt("2026-11-09T17:00:00"),
    ...overrides,
  });

  it("[SPM-36][AC1] offers it to the assigned coordinator once a Confirmed event has ended", () => {
    expect(canMarkEventCompleted(coordinator, event(), NOW)).toBe(true);
  });

  it("[SPM-36][AC1] does not offer it before the event has ended", () => {
    expect(canMarkEventCompleted(coordinator, event({ endsAt: sgt("2026-11-12T17:00:00") }), NOW)).toBe(false);
  });

  it.each(["planning", "safety_cleared", "postponed", "completed", "cancelled"])(
    "[SPM-36][AC2][AC5] does not offer it on a %s event",
    (status) => {
      expect(canMarkEventCompleted(coordinator, event({ status }), NOW)).toBe(false);
    }
  );

  it.each([
    ["another coordinator", { id: "c2", role: "coordinator", organisationId: null }],
    ["the organiser", { id: "o1", role: "organiser", organisationId: "org1" }],
    ["the Event Coordinator Lead", { id: "l1", role: "ops_manager", organisationId: null }],
  ])("[SPM-36][AC1] does not offer it to %s", (_who, actor) => {
    expect(canMarkEventCompleted(actor, event(), NOW)).toBe(false);
  });
});
