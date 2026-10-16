// SPM-88 (AC5, AC6): closing a safety check after a significant change, in
// the caller's transaction. The Prisma mock stands in for the transaction.
//
// CONTRACT (SPM-88, written before the code):
//   src/lib/safetyCheckClose.ts
//     closeSafetyCheck(tx, eventId, actorId, why, now) -> boolean
//       the event's pending or approved check -> closed, recording who, when and why
//     closeSafetyCheckAfterChange(tx, event, actorId, why, confirmationReverted, now) -> boolean
//       Safety review / Safety approved -> Planning (guarded), a history row
//       "Safety check closed: <why>", and the check closed. A Confirmed event the
//       caller has just moved back to Planning has its approval closed too.

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma");
import type { Prisma } from "@prisma/client";
import { callArg, db } from "@/test/kit";
import { closeSafetyCheck, closeSafetyCheckAfterChange } from "@/lib/safetyCheckClose";

const tx = db as unknown as Prisma.TransactionClient;
const now = new Date("2026-10-15T06:30:00.000Z");

beforeEach(() => {
  db.safetyCheck.updateMany.mockResolvedValue({ count: 1 });
  db.event.updateMany.mockResolvedValue({ count: 1 });
});

describe("closeSafetyCheck", () => {
  it("closes the event's pending or approved check, recording who, when and why", async () => {
    expect(await closeSafetyCheck(tx, "e1", "u1", "the equipment changed", now)).toBe(true);

    expect(callArg(db.safetyCheck.updateMany)).toEqual({
      where: { eventId: "e1", status: { in: ["pending", "approved"] } },
      data: { status: "closed", decidedBy: "u1", decidedAt: now, decisionNote: "the equipment changed" },
    });
  });

  it("says so when there was no open check", async () => {
    db.safetyCheck.updateMany.mockResolvedValue({ count: 0 });

    expect(await closeSafetyCheck(tx, "e1", "u1", "the equipment changed", now)).toBe(false);
  });
});

describe("closeSafetyCheckAfterChange", () => {
  it.each(["safety_review", "safety_cleared"])(
    "SPM-88-TC07/TC10: moves a %s event back to Planning, records why, and closes its check",
    async (status) => {
      expect(await closeSafetyCheckAfterChange(tx, { id: "e1", status }, "u1", "the equipment changed", false, now)).toBe(true);

      expect(callArg(db.event.updateMany)).toEqual({ where: { id: "e1", status }, data: { status: "planning" } });
      expect(callArg(db.eventStatusHistory.create).data).toEqual({
        eventId: "e1",
        fromStatus: status,
        toStatus: "planning",
        changedBy: "u1",
        reason: "Safety check closed: the equipment changed",
      });
      expect(callArg(db.safetyCheck.updateMany).data.status).toBe("closed");
    }
  );

  it("does nothing when another change got there first", async () => {
    db.event.updateMany.mockResolvedValue({ count: 0 });

    expect(await closeSafetyCheckAfterChange(tx, { id: "e1", status: "safety_review" }, "u1", "x", false, now)).toBe(false);
    expect(db.eventStatusHistory.create).not.toHaveBeenCalled();
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
  });

  it("SPM-88-TC12: closes the approval of a Confirmed event the caller has just moved back", async () => {
    expect(await closeSafetyCheckAfterChange(tx, { id: "e1", status: "confirmed" }, "u1", "the equipment changed", true, now)).toBe(true);

    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect(callArg(db.safetyCheck.updateMany).where).toEqual({ eventId: "e1", status: { in: ["pending", "approved"] } });
  });

  it.each(["approved", "planning", "confirmed"])("SPM-88-TC11: leaves a %s event alone", async (status) => {
    expect(await closeSafetyCheckAfterChange(tx, { id: "e1", status }, "u1", "x", false, now)).toBe(false);
    expect(db.event.updateMany).not.toHaveBeenCalled();
    expect(db.safetyCheck.updateMany).not.toHaveBeenCalled();
  });
});
