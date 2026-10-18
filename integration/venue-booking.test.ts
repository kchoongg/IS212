// Venue booking against a real database: the request route (SPM-42/44), Venue
// Staff's decision route (SPM-43) and the availability calendar (SPM-46), with
// the real Prisma client, real transactions and real row locks.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET as getAvailability } from "@/app/api/venues/[id]/availability/route";
import { POST as requestBooking } from "@/app/api/events/[id]/venue-bookings/route";
import { PATCH as decideBooking } from "@/app/api/venue-bookings/[id]/route";
import { createEvent, createWorld, destroyWorld, params, req, type TestEvent, type World } from "./world";

// Far enough ahead that no hold expires and no event has started.
const DAY = "2031-05-06";

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

function request(event: TestEvent, start: string, end: string) {
  return requestBooking(
    req("POST", `/api/events/${event.reference}/venue-bookings`, world.coordinator, {
      venueId: world.venue.id,
      day: DAY,
      startTime: start,
      endTime: end,
      purpose: "Main programme",
    }),
    params({ id: event.reference })
  );
}

async function entriesOn(day: string) {
  const res = await getAvailability(
    req("GET", `/api/venues/${world.venue.id}/availability?from=${day}&to=${day}`, world.coordinator),
    params({ id: world.venue.id })
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.days[0].entries as { kind: string; from: string; to: string; bookingId?: string; holdId?: string }[];
}

describe("venue booking on a real database", () => {
  it(
    "SPM-44 AC4, AC5 and AC9: of two requests for the same venue at overlapping times sent at the same moment, " +
      "exactly one is accepted and the other is refused, naming the request in its way",
    async () => {
      const morning = await createEvent(world, { title: "Integration Morning Forum", day: DAY, start: "10:00", end: "12:00" });
      const midday = await createEvent(world, { title: "Integration Midday Forum", day: DAY, start: "11:00", end: "13:00" });

      // Both sent before either is answered: without the venue row lock in the
      // request route, each would pass the clash check before the other's row
      // was written, and both would be accepted.
      const responses = await Promise.all([request(morning, "10:00", "12:00"), request(midday, "11:00", "13:00")]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
      const acceptedIndex = responses.findIndex((r) => r.status === 201);
      const winner = [morning, midday][acceptedIndex];
      const refusal = await responses[1 - acceptedIndex].json();
      expect(refusal.error).toContain(`${world.venue.name} is on hold for ${winner.reference} ${winner.title}`);

      // And the database agrees: one active booking for the room, the winner's.
      const active = await prisma.venueBooking.findMany({
        where: { venueId: world.venue.id, status: { in: ["pending", "approved"] } },
        select: { eventId: true, status: true },
      });
      expect(active).toEqual([{ eventId: winner.id, status: "pending" }]);
    }
  );

  it(
    "SPM-43 AC3 and AC7: a booking request approved by Venue Staff becomes a confirmed booking - " +
      "the calendar shows the room booked for those times, and another event cannot then be booked into them",
    async () => {
      const forum = await createEvent(world, { title: "Integration Approved Forum", day: DAY, start: "10:00", end: "12:00" });

      const requested = await request(forum, "10:00", "12:00");
      expect(requested.status).toBe(201);
      const booking = await requested.json();
      // Until Venue Staff decide, the calendar shows it as a tentative hold
      // (holdId), not a booking.
      expect(await entriesOn(DAY)).toEqual([
        expect.objectContaining({ kind: "requested", from: "10:00", to: "12:00", holdId: booking.id }),
      ]);

      const decided = await decideBooking(
        req("PATCH", `/api/venue-bookings/${booking.id}`, world.venueStaff, { decision: "approve" }),
        params({ id: booking.id })
      );
      expect(decided.status).toBe(200);
      expect(await decided.json()).toMatchObject({ id: booking.id, status: "approved" });

      // The room is now shown as booked for exactly those times...
      expect(await entriesOn(DAY)).toEqual([
        expect.objectContaining({ kind: "booked", from: "10:00", to: "12:00", bookingId: booking.id }),
      ]);

      // ...and is unavailable to another event for any overlapping time.
      const other = await createEvent(world, { title: "Integration Late Forum", day: DAY, start: "11:00", end: "13:00" });
      const refused = await request(other, "11:00", "13:00");
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toContain(
        `${world.venue.name} is already booked for ${forum.reference} ${forum.title}`
      );
    }
  );
});
