// SPM-36 (AC6): the sweep that completes events still Confirmed 7 days after
// they ended. It runs whenever events are read.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { completeDueEvents } from "../eventCompletionService";
import { db } from "@/test/kit";

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const NOW = sgt("2026-11-10T18:00:00");

const sqlOf = (n: number) => {
  const [strings, ...values] = db.$queryRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join("?").replace(/\s+/g, " "), values };
};

describe("completeDueEvents", () => {
  it("[SPM-36][AC6] completes every Confirmed event that ended 7 or more days ago, and only those", async () => {
    await completeDueEvents(db as never, NOW);

    const { text, values } = sqlOf(0);
    expect(text).toContain("UPDATE events SET status = 'completed'");
    expect(text).toContain("WHERE status = 'confirmed' AND ends_at <= ?");
    expect(values).toEqual([NOW, sgt("2026-11-03T18:00:00")]);
  });

  it("[SPM-36][AC6] records nothing when no event is due", async () => {
    db.$queryRaw.mockResolvedValueOnce([]);

    expect(await completeDueEvents(db as never, NOW)).toBe(0);
    expect(db.eventStatusHistory.createMany).not.toHaveBeenCalled();
  });

  it("[SPM-36][AC6] records each automatic completion in the status history, with no user", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "e1" }, { id: "e2" }]);

    expect(await completeDueEvents(db as never, NOW)).toBe(2);
    expect(db.eventStatusHistory.createMany).toHaveBeenCalledWith({
      data: ["e1", "e2"].map((eventId) => ({
        eventId,
        fromStatus: "confirmed",
        toStatus: "completed",
        changedBy: null,
        changedAt: NOW,
        reason: "Completed automatically 7 days after the event ended",
      })),
    });
  });

  it("[SPM-36][AC3] changes nothing but the event's status", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "e1" }]);

    await completeDueEvents(db as never, NOW);

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(0).text).not.toMatch(/venue_bookings|equipment/);
  });
});
