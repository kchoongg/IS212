/**
 * SPM-80 (Re-check Bookings When Setup or Turnaround Time Changes) — QA
 * fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm80
 *
 * Only touches the four "SPM80" test venues and the events whose seedKey
 * starts with "spm80_". The first run creates them; every later run puts them
 * back to their starting state, which is the full revert after a test pass:
 * every room back to NO setup and NO turnaround time, its bookings unflagged,
 * and the coordinator's notifications about these events gone.
 *   - "SPM80 Turnaround Room" (SPM80-TRN): two approved bookings on
 *     3 Aug 2027 half an hour apart (10:00–12:00 and 12:30–14:00), one that
 *     evening (18:00–20:00), and two finished ones on 1 Sep 2026, also half an
 *     hour apart. SPM-80-TC01 to TC04 change its turnaround time.
 *   - "SPM80 Setup Room" (SPM80-SET): an approved booking and a PENDING
 *     request on 4 Aug 2027, half an hour apart. SPM-80-TC05 changes its
 *     setup time.
 *   - "SPM80 Maintenance Room" (SPM80-MNT): an approved booking on 5 Aug 2027,
 *     12:00–13:30, and maintenance from 14:00 to 16:00 that day. SPM-80-TC06
 *     and TC07.
 *   - "SPM80 Request Room" (SPM80-REQ): an approved booking on 6 Aug 2027,
 *     10:00–12:00, and an event at 12:15–14:00 with no booking yet, which
 *     SPM-80-TC08 and TC09 request.
 * The rooms are dedicated, so changing their times flags nobody else's
 * bookings. Every run drops the events' bookings and notifications and
 * recreates them; an event row is kept (reset in place), so its EVT- reference
 * never changes. The same rooms and events are at the end of prisma/seed.ts -
 * keep the two in step.
 *
 * Needs the base seed's users to exist already.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm80_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/** A fixed calendar date at a Singapore wall-clock time, "HH:MM". */
function sgt(isoDate: string, time: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const TEST_VENUE = {
  building: "Orchard Hub",
  floor: "L6",
  maxCapacity: 40,
  opensAt: "07:00",
  closesAt: "23:00",
  // Every room starts with none, so a case can say exactly which minutes the
  // change it makes adds.
  setupMinutes: 0,
  teardownMinutes: 0,
};
const TEST_VENUES = [
  { code: "SPM80-TRN", name: "SPM80 Turnaround Room", description: "SPM-80 test venue: bookings half an hour apart on 3 Aug 2027" },
  { code: "SPM80-SET", name: "SPM80 Setup Room", description: "SPM-80 test venue: an approved booking and a pending request on 4 Aug 2027" },
  { code: "SPM80-MNT", name: "SPM80 Maintenance Room", description: "SPM-80 test venue: maintenance on 5 Aug 2027, 14:00-16:00" },
  { code: "SPM80-REQ", name: "SPM80 Request Room", description: "SPM-80 test venue: an approved booking on 6 Aug 2027, 10:00-12:00" },
];
const TEST_VENUE_LAYOUTS = [
  { layoutName: "classroom", capacity: 40 },
  { layoutName: "theatre", capacity: 40 },
];

const PERIODS = [
  { venueCode: "SPM80-MNT", date: "2027-08-05", from: "14:00", until: "16:00", reason: "maintenance" },
];

type EventStatus = "planning" | "completed";

type Fixture = {
  key: string;
  title: string;
  venueCode: string;
  date: string; // YYYY-MM-DD, Singapore
  /// The event's times and its booking's: the same, on the 15-minute grid.
  from: string; // HH:MM
  to: string; // HH:MM
  /// The event's status; "planning" unless the event is over.
  eventStatus?: EventStatus;
  /// The booking's status: "approved" unless it is still a request; "none"
  /// for an event a case requests a booking for.
  bookingStatus?: "pending" | "none";
  /// What the booking is there to show.
  purpose: string;
};

/** All with coordinator Daniel Tan. */
const FIXTURES: Fixture[] = [
  { key: "spm80_morning", title: "SPM80 Morning Seminar", venueCode: "SPM80-TRN", date: "2027-08-03", from: "10:00", to: "12:00",
    purpose: "clashes with the Lunch Forum once turnaround passes 30 min" },
  { key: "spm80_lunch", title: "SPM80 Lunch Forum", venueCode: "SPM80-TRN", date: "2027-08-03", from: "12:30", to: "14:00",
    purpose: "clashes with the Morning Seminar once turnaround passes 30 min" },
  { key: "spm80_evening", title: "SPM80 Evening Workshop", venueCode: "SPM80-TRN", date: "2027-08-03", from: "18:00", to: "20:00",
    purpose: "hours away from the others - never flagged" },
  { key: "spm80_past_first", title: "SPM80 Past Briefing", venueCode: "SPM80-TRN", date: "2026-09-01", from: "10:00", to: "12:00",
    eventStatus: "completed", purpose: "finished - not re-checked" },
  { key: "spm80_past_second", title: "SPM80 Past Review", venueCode: "SPM80-TRN", date: "2026-09-01", from: "12:30", to: "14:00",
    eventStatus: "completed", purpose: "finished - not re-checked" },
  { key: "spm80_demo", title: "SPM80 Product Demo", venueCode: "SPM80-SET", date: "2027-08-04", from: "10:00", to: "12:00",
    purpose: "approved; clashes with the Partner Meetup once setup passes 30 min" },
  { key: "spm80_meetup", title: "SPM80 Partner Meetup", venueCode: "SPM80-SET", date: "2027-08-04", from: "12:30", to: "14:00",
    bookingStatus: "pending", purpose: "a pending request; clashes with the Product Demo once setup passes 30 min" },
  { key: "spm80_talk", title: "SPM80 Afternoon Talk", venueCode: "SPM80-MNT", date: "2027-08-05", from: "12:00", to: "13:30",
    purpose: "runs into the 14:00 maintenance once turnaround passes 30 min" },
  { key: "spm80_booked", title: "SPM80 Booked Seminar", venueCode: "SPM80-REQ", date: "2027-08-06", from: "10:00", to: "12:00",
    purpose: "approved; in the way of the Follow-on Workshop once turnaround passes 15 min" },
  { key: "spm80_followon", title: "SPM80 Follow-on Workshop", venueCode: "SPM80-REQ", date: "2027-08-06", from: "12:15", to: "14:00",
    bookingStatus: "none", purpose: "no booking - the cases request one" },
];

const CHAIN: Record<EventStatus, string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "All arrangements in place",
  completed: "Event took place",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-80 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const coordinatorId = await find("daniel.tan@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // Only a fixture this script no longer defines is deleted. The events it
  // does define are reset IN PLACE further down.
  const removed = await prisma.event.deleteMany({
    where: { seedKey: { startsWith: KEY_PREFIX, notIn: FIXTURES.map((f) => f.key) } },
  });
  if (removed.count > 0) console.log(`Removed ${removed.count} SPM-80 fixture event(s) no longer defined.`);

  // The test venues, back in their starting state: active, no setup or
  // turnaround, only the periods listed above.
  const venueIds = new Map<string, string>();
  for (const v of TEST_VENUES) {
    const fields = { ...TEST_VENUE, ...v };
    const venue = await prisma.venue.upsert({
      where: { code: v.code },
      create: fields,
      update: { ...fields, isActive: true },
    });
    for (const l of TEST_VENUE_LAYOUTS) {
      await prisma.venueLayout.upsert({
        where: { venueId_layoutName: { venueId: venue.id, layoutName: l.layoutName } },
        create: { venueId: venue.id, ...l },
        update: { capacity: l.capacity },
      });
    }
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  for (const p of PERIODS) {
    await prisma.venueUnavailability.create({
      data: {
        venueId: venueIds.get(p.venueCode)!,
        startsAt: sgt(p.date, p.from),
        endsAt: sgt(p.date, p.until),
        reason: p.reason,
        createdBy: venueStaff,
      },
    });
  }
  console.log(`Venues ${TEST_VENUES.map((v) => v.code).join(", ")} ready.`);

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.from);
    const endsAt = sgt(f.date, f.to);
    const eventStatus = f.eventStatus ?? "planning";
    const chain = CHAIN[eventStatus];
    const historyStart = addDays(new Date(), -(chain.length * 5 + 2));

    const fields = {
      title: f.title,
      purpose: "SPM-80 setup and turnaround re-check test event",
      category: "meeting",
      organiserId: organiser.id,
      organisationId: organiser.organisationId,
      coordinatorId,
      status: eventStatus,
      startsAt,
      endsAt,
      expectedAttendance: 30,
      preferredLayout: "classroom",
    };
    // Reset in place, never deleted: a new row would get a new EVT- reference
    // on every run. The booking and its notifications carry what a test pass
    // changed (the review flag, the coordinator's notification), so those are
    // dropped and recreated instead.
    const existing = await prisma.event.findUnique({ where: { seedKey: f.key }, select: { id: true } });
    if (existing) {
      await prisma.venueBooking.deleteMany({ where: { eventId: existing.id } });
      await prisma.notification.deleteMany({ where: { eventId: existing.id } });
    }
    const select = { id: true, sequenceNumber: true } as const;
    const created = existing
      ? await prisma.event.update({ where: { id: existing.id }, data: fields, select })
      : await prisma.event.create({
          data: {
            ...fields,
            seedKey: f.key,
            submittedAt: historyStart,
            statusHistory: {
              create: chain.map((to, i) => ({
                fromStatus: i === 0 ? "draft" : chain[i - 1],
                toStatus: to,
                changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
                changedAt: addDays(historyStart, i * 5),
                reason: REASONS[to],
              })),
            },
          },
          select,
        });

    if (f.bookingStatus !== "none") {
      const approved = f.bookingStatus !== "pending";
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venueIds.get(f.venueCode)!,
          layoutName: "classroom",
          startsAt,
          endsAt,
          status: approved ? "approved" : "pending",
          requestedBy: coordinatorId,
          requestedAt: addDays(new Date(), -3),
          decidedBy: approved ? venueStaff : undefined,
          decidedAt: approved ? addDays(new Date(), -2) : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${f.purpose}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-80 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
