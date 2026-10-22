// Re-check Bookings When Setup or Turnaround Time Changes (SPM-80) against a
// real database: Venue Staff change a venue's setup or turnaround time through
// PATCH /api/venues/[id], and the venue's existing bookings are re-checked with
// the real Prisma client - flagged, never changed - and new requests are
// checked with the new times.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { PATCH as editVenue } from "@/app/api/venues/[id]/route";
import { POST as requestBooking } from "@/app/api/events/[id]/venue-bookings/route";
import { createEvent, createWorld, destroyWorld, params, req, sgt, type TestEvent, type World } from "./world";

// Far enough ahead that no hold expires and no event has started.
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

/// A booking row of `event` at the world's venue, as Venue Staff left it.
async function bookingFor(event: TestEvent, start: string, end: string, status = "approved", day = DAY) {
  return prisma.venueBooking.create({
    data: {
      eventId: event.id,
      venueId: world.venue.id,
      startsAt: sgt(day, start),
      endsAt: sgt(day, end),
      status,
      requestedBy: world.coordinator.id,
    },
    select: { id: true },
  });
}

function changeVenue(body: object) {
  return editVenue(req("PATCH", `/api/venues/${world.venue.id}`, world.venueStaff, body), params({ id: world.venue.id }));
}

async function stored(bookingId: string) {
  return prisma.venueBooking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, startsAt: true, endsAt: true, needsReview: true, reviewReason: true },
  });
}

async function notificationsAbout(event: TestEvent) {
  return prisma.notification.findMany({
    where: { eventId: event.id, recipientId: world.coordinator.id },
    select: { type: true, body: true },
  });
}

describe("changing a venue's setup or turnaround time on a real database (SPM-80)", () => {
  it(
    "[SPM-80][AC1][AC2][AC4][AC5] flags both bookings that now overlap, each naming the other, " +
      "notifies the coordinator, and changes neither booking",
    async () => {
      const morning = await createEvent(world, { title: "Integration Morning Talk", day: DAY, start: "10:00", end: "12:00" });
      const afternoon = await createEvent(world, { title: "Integration Afternoon Talk", day: DAY, start: "12:30", end: "14:00" });
      const first = await bookingFor(morning, "10:00", "12:00");
      // A pending request is re-checked too, and stays pending.
      const second = await bookingFor(afternoon, "12:30", "14:00", "pending");

      const res = await changeVenue({ teardownMinutes: 45 });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.flaggedBookings).toEqual([
        expect.objectContaining({
          bookingId: first.id,
          reasons: ["booking_clash"],
          clashesWith: [expect.objectContaining({ bookingId: second.id, eventReference: afternoon.reference })],
        }),
        expect.objectContaining({
          bookingId: second.id,
          reasons: ["booking_clash"],
          clashesWith: [expect.objectContaining({ bookingId: first.id, eventReference: morning.reference })],
        }),
      ]);

      expect(await stored(first.id)).toEqual({
        status: "approved",
        startsAt: sgt(DAY, "10:00"),
        endsAt: sgt(DAY, "12:00"),
        needsReview: true,
        reviewReason: "booking_clash",
      });
      expect(await stored(second.id)).toEqual({
        status: "pending",
        startsAt: sgt(DAY, "12:30"),
        endsAt: sgt(DAY, "14:00"),
        needsReview: true,
        reviewReason: "booking_clash",
      });

      const [told] = await notificationsAbout(morning);
      expect(told.type).toBe("booking_needs_review");
      expect(told.body).toContain("the turnaround time changed from 0 to 45 minutes");
      expect(told.body).toContain(`now overlaps the booking for ${afternoon.reference} ${afternoon.title}`);
      expect(await notificationsAbout(afternoon)).toHaveLength(1);
    }
  );

  it("[SPM-80][AC3] flags a booking whose new setup time now overlaps a recorded unavailable period", async () => {
    const talk = await createEvent(world, { title: "Integration Tea Talk", day: DAY, start: "16:30", end: "18:00" });
    const booking = await bookingFor(talk, "16:30", "18:00");
    await prisma.venueUnavailability.create({
      data: {
        venueId: world.venue.id,
        startsAt: sgt(DAY, "14:00"),
        endsAt: sgt(DAY, "16:00"),
        reason: "maintenance",
        createdBy: world.venueStaff.id,
      },
    });

    const res = await changeVenue({ setupMinutes: 45 });

    expect(res.status).toBe(200);
    expect(await stored(booking.id)).toMatchObject({ status: "approved", needsReview: true, reviewReason: "venue_unavailable" });
    const [told] = await notificationsAbout(talk);
    expect(told.body).toContain("now overlaps a period when the venue is unavailable (Maintenance");
  });

  it("[SPM-80][AC6][AC7] leaves alone bookings that do not clash under the new times, and bookings in the past", async () => {
    const morning = await createEvent(world, { title: "Integration Early Talk", day: DAY, start: "08:00", end: "09:00" });
    const evening = await createEvent(world, { title: "Integration Evening Talk", day: DAY, start: "18:00", end: "20:00" });
    const early = await bookingFor(morning, "08:00", "09:00");
    const late = await bookingFor(evening, "18:00", "20:00");
    // Two bookings last year, half an hour apart: they would clash now, but they are over.
    const pastDay = "2025-06-10";
    const old = await createEvent(world, { title: "Integration Old Talk", day: pastDay, start: "10:00", end: "12:00" });
    const older = await createEvent(world, { title: "Integration Older Talk", day: pastDay, start: "12:30", end: "14:00" });
    const pastFirst = await bookingFor(old, "10:00", "12:00", "approved", pastDay);
    const pastSecond = await bookingFor(older, "12:30", "14:00", "approved", pastDay);

    const res = await changeVenue({ setupMinutes: 30, teardownMinutes: 45 });

    expect(res.status).toBe(200);
    expect((await res.json()).flaggedBookings).toEqual([]);
    for (const id of [early.id, late.id, pastFirst.id, pastSecond.id]) {
      expect((await stored(id)).needsReview).toBe(false);
    }
    expect(await notificationsAbout(morning)).toEqual([]);
  });

  // Review of PR #74: the query must load a booking that has just ended while
  // its new turnaround still holds the room. Times are relative to now, as the
  // rule is about now.
  it("[SPM-80][AC2][AC7] flags the booking after one that has just ended, but not the ended one", async () => {
    const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    const today = DAY;
    const ended = await createEvent(world, { title: "Integration Ended Talk", day: today, start: "08:00", end: "09:00" });
    const next = await createEvent(world, { title: "Integration Next Talk", day: today, start: "10:00", end: "11:00" });
    const endedBooking = await prisma.venueBooking.create({
      data: { eventId: ended.id, venueId: world.venue.id, startsAt: minutesFromNow(-70), endsAt: minutesFromNow(-10), status: "approved", requestedBy: world.coordinator.id },
      select: { id: true },
    });
    const nextBooking = await prisma.venueBooking.create({
      data: { eventId: next.id, venueId: world.venue.id, startsAt: minutesFromNow(10), endsAt: minutesFromNow(70), status: "approved", requestedBy: world.coordinator.id },
      select: { id: true },
    });

    // 45 minutes of turnaround: the ended booking holds the room until 35 minutes from now.
    const res = await changeVenue({ teardownMinutes: 45 });

    expect(res.status).toBe(200);
    expect((await res.json()).flaggedBookings).toEqual([
      expect.objectContaining({
        bookingId: nextBooking.id,
        clashesWith: [expect.objectContaining({ bookingId: endedBooking.id, eventReference: ended.reference })],
      }),
    ]);
    expect((await stored(endedBooking.id)).needsReview).toBe(false);
    expect((await stored(nextBooking.id)).reviewReason).toBe("booking_clash");
    expect(await notificationsAbout(ended)).toEqual([]);
  });

  it("[SPM-80][AC8] checks a booking request made after the change with the new turnaround time", async () => {
    const morning = await createEvent(world, { title: "Integration Booked Talk", day: DAY, start: "10:00", end: "12:00" });
    await bookingFor(morning, "10:00", "12:00");
    const next = await createEvent(world, { title: "Integration Next Talk", day: DAY, start: "12:30", end: "14:00" });
    const ask = () =>
      requestBooking(
        req("POST", `/api/events/${next.reference}/venue-bookings`, world.coordinator, {
          venueId: world.venue.id,
          day: DAY,
          startTime: "12:30",
          endTime: "14:00",
          purpose: "Main programme",
        }),
        params({ id: next.reference })
      );

    expect((await changeVenue({ teardownMinutes: 45 })).status).toBe(200);
    const refused = await ask();

    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain(`${world.venue.name} is already booked for ${morning.reference} ${morning.title}`);

    // Back to no turnaround, the same request is accepted.
    expect((await changeVenue({ teardownMinutes: 0 })).status).toBe(200);
    expect((await ask()).status).toBe(201);
  });
});
