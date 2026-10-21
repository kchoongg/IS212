// Event status changes against a real database: two changes to one event at
// the same moment, e.g. Approve in one tab and Reject in another.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { PATCH as changeEvent } from "@/app/api/events/[id]/route";
import { createEvent, createWorld, destroyWorld, params, req, type TestEvent, type World } from "./world";

let world: World;

beforeEach(async () => {
  world = await createWorld();
});

afterEach(async () => {
  await destroyWorld(world);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function moveTo(event: TestEvent, status: string, reason?: string) {
  return changeEvent(
    req("PATCH", `/api/events/${event.reference}`, world.coordinator, { status, reason }),
    params({ id: event.reference })
  );
}

describe("event status changes on a real database", () => {
  it("[SPM-26] (conflict): approving and rejecting one request at the same moment - exactly one is made", async () => {
    const event = await createEvent(world, {
      title: "Integration Status Forum",
      day: "2031-09-02",
      start: "09:00",
      end: "12:00",
      status: "under_review",
    });

    // Both read "Under review" before either saves. Without the row lock and
    // the second read inside the transaction, both would be written.
    const responses = await Promise.all([moveTo(event, "approved"), moveTo(event, "rejected", "Out of budget")]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const history = await prisma.eventStatusHistory.findMany({ where: { eventId: event.id } });
    expect(history).toHaveLength(1);
    const saved = await prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: { status: true } });
    expect(saved.status).toBe(history[0].toStatus);
  });
});
