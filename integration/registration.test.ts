// Attendee registration against a real database (SPM-51): the capacity limit
// counted on real rows.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST as register } from "@/app/api/registrations/route";
import { REGISTRATION_REFUSALS } from "@/lib/registrationEligibility";
import { createAttendee, createEvent, createWorld, destroyWorld, req, type TestEvent, type World } from "./world";

const DAY = "2031-07-15";
const DAY_MS = 86_400_000;

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

/// A Confirmed event open for registration right now (SPM-51 AC3), with
/// `capacity` places.
function openEvent(capacity: number): Promise<TestEvent> {
  return createEvent(world, {
    title: "Integration Open Day",
    day: DAY,
    start: "10:00",
    end: "16:00",
    status: "confirmed",
    fields: {
      registrationEnabled: true,
      registrationCapacity: capacity,
      registrationOpensAt: new Date(Date.now() - DAY_MS),
      registrationClosesAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
}

async function registerFor(event: TestEvent) {
  const attendee = await createAttendee(world);
  return register(req("POST", "/api/registrations", attendee, { eventId: event.id }));
}

function holdingAPlace(event: TestEvent) {
  return prisma.registration.count({ where: { eventId: event.id, status: "registered" } });
}

describe("registration capacity on a real database", () => {
  it("[SPM-51][AC9] (SPM-51-TC05, failure): once the capacity is reached, the next registration is refused", async () => {
    const event = await openEvent(1);

    expect((await registerFor(event)).status).toBe(201);
    const refused = await registerFor(event);

    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: REGISTRATION_REFUSALS.full });
    expect(await holdingAPlace(event)).toBe(1);
  });

  it(
    "[SPM-51][AC9] (SPM-51-TC04, boundary): a withdrawn attendee does not hold a place, so the last place can " +
      "still be taken - and then no more",
    async () => {
      const event = await openEvent(2);
      expect((await registerFor(event)).status).toBe(201);
      const leaving = await createAttendee(world);
      await prisma.registration.create({
        data: { eventId: event.id, attendeeId: leaving.id, status: "withdrawn", withdrawnAt: new Date() },
      });

      expect((await registerFor(event)).status).toBe(201);
      expect((await registerFor(event)).status).toBe(400);
      expect(await holdingAPlace(event)).toBe(2);
    }
  );
});
