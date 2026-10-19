// Equipment reservation against a real database: Technical Support reserving
// equipment (SPM-49) and the availability check that counts reservations
// (SPM-48), with the real Prisma client, transactions and row locks.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as getAvailability } from "@/app/api/events/[id]/equipment/availability/route";
import { POST as reserve } from "@/app/api/events/[id]/equipment/[requestId]/reserve/route";
import { createEquipment, createEvent, createWorld, destroyWorld, params, req, sgt, type TestEvent, type World } from "./world";

const DAY = "2031-06-10";

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

/// An event in Planning - where Technical Support can see and reserve its
/// equipment - that has asked for `quantity` of `equipmentId` for 10:00-16:00.
async function planningEventAsking(title: string, equipmentId: string, quantity: number) {
  const event = await createEvent(world, { title, day: DAY, start: "10:00", end: "16:00", status: "planning" });
  const line = await prisma.equipmentRequest.create({
    data: {
      eventId: event.id,
      equipmentId,
      quantityRequested: quantity,
      startsAt: sgt(DAY, "10:00"),
      endsAt: sgt(DAY, "16:00"),
      requestedBy: world.coordinator.id,
    },
    select: { id: true },
  });
  return { event, lineId: line.id };
}

function reserveLine(event: TestEvent, lineId: string) {
  return reserve(
    req("POST", `/api/events/${event.reference}/equipment/${lineId}/reserve`, world.techSupport),
    params({ id: event.reference, requestId: lineId })
  );
}

async function availableFor(event: TestEvent, lineId: string): Promise<number> {
  const res = await getAvailability(
    req("GET", `/api/events/${event.reference}/equipment/availability`, world.techSupport),
    params({ id: event.reference })
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  const line = body.lines.find((l: { requestId: string }) => l.requestId === lineId);
  return line.result.available;
}

describe("equipment reservation on a real database", () => {
  it(
    "SPM-49 AC4, AC5 and SPM-48 AC4 (SPM-49-TC09, TC15, normal and boundary): a reservation reduces what an " +
      "overlapping event can have, and that event can then reserve only what is left",
    async () => {
      const projector = await createEquipment(world, 3);
      const first = await planningEventAsking("Integration Morning Expo", projector.id, 2);
      const second = await planningEventAsking("Integration Afternoon Expo", projector.id, 2);

      // Nothing is reserved yet: a request alone holds no stock (SPM-48 AC4).
      expect(await availableFor(second.event, second.lineId)).toBe(3);

      const reserved = await reserveLine(first.event, first.lineId);
      expect(reserved.status).toBe(200);
      expect(await reserved.json()).toMatchObject({ status: "reserved", quantityReserved: 2 });

      // Same day, so the second event now sees 3 - 2 = 1.
      expect(await availableFor(second.event, second.lineId)).toBe(1);

      // It asked for 2 and is given the 1 that is left, never more (AC5).
      const partial = await reserveLine(second.event, second.lineId);
      expect(partial.status).toBe(200);
      expect(await partial.json()).toMatchObject({ status: "partially_fulfilled", quantityReserved: 1 });
    }
  );

  it(
    "SPM-49 AC5 (SPM-49-TC16, conflict): two Technical Support reservations of the last unit at the same moment - " +
      "exactly one gets it",
    async () => {
      const projector = await createEquipment(world, 1);
      const first = await planningEventAsking("Integration Gala A", projector.id, 1);
      const second = await planningEventAsking("Integration Gala B", projector.id, 1);

      // Without the row lock on the equipment item in the reserve route, both
      // would read "1 available" and both would reserve it.
      const responses = await Promise.all([
        reserveLine(first.event, first.lineId),
        reserveLine(second.event, second.lineId),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
      const refused = responses.find((r) => r.status === 400)!;
      expect(await refused.json()).toEqual({ error: "Nothing is available for these dates any more." });

      const lines = await prisma.equipmentRequest.findMany({
        where: { equipmentId: projector.id },
        select: { status: true, quantityReserved: true },
        orderBy: { status: "asc" },
      });
      expect(lines).toEqual([
        { status: "requested", quantityReserved: null },
        { status: "reserved", quantityReserved: 1 },
      ]);
    }
  );
});
