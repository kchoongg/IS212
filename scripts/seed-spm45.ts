/**
 * SPM-45 (Record Venue Unavailability) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm45
 *
 * Only touches the six "SPM45" test venues and the events whose seedKey
 * starts with "spm45_". The first run creates them; every later run puts them
 * back to their starting state, which is the full revert after a test pass:
 *   - "SPM45 Dates Room" (SPM45-DAT): no unavailable period, no bookings.
 *     The cases that only record periods use it (SPM-45-TC01 to TC08, TC18).
 *   - "SPM45 Period Room" (SPM45-PER): no unavailable period, and four
 *     approved, unflagged bookings - each meeting an edge of the period
 *     SPM-45-TC09 records (10 Jun 2027, 13:00 to 15 Jun 2027, 13:00), two from
 *     outside it and two from inside.
 *   - "SPM45 Setup Room" (SPM45-SET): the only one with setup (30 min) and
 *     turnaround (45 min) time, and two approved bookings - one whose
 *     turnaround runs 15 minutes into SPM-45-TC13's period, and one whose
 *     setup starts exactly as it ends.
 *   - "SPM45 Status Room" (SPM45-STA): an approved, a pending and a finished
 *     booking, for SPM-45-TC14 (only the approved, upcoming one is flagged).
 *   - "SPM45 Closure Room" (SPM45-NOW): one period that is under way
 *     (1 Oct 2026, 00:00 to 1 Dec 2028, 09:00), read by SPM-45-TC15 and ended
 *     early by SPM-45-TC16.
 *   - "SPM45 Reopened Room" (SPM45-BAK): one period that has passed
 *     (1 Sep 2026, 00:00 to 1 Oct 2026, 12:00), which SPM-45-TC17 only reads.
 * The rooms are dedicated, so marking them unavailable flags nobody else's
 * bookings. Every run drops the rooms' unavailable periods and the events'
 * bookings and notifications and recreates them, which is what clears the
 * periods and review flags a test pass left behind. An event row is kept
 * (reset in place), so its EVT- reference never changes.
 *
 * Needs the base seed's users to exist already.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm45_";

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
  floor: "L1",
  maxCapacity: 40,
  opensAt: "07:00",
  closesAt: "23:00",
};
/** Setup and turnaround are none except at SPM45-SET, so everywhere else a
 *  booking occupies the room for its own times only and a case can name the
 *  exact time at a period's edge. SPM45-SET has the Week 7 example's 30 min
 *  of setup and 45 min of turnaround. */
const TEST_VENUES = [
  { code: "SPM45-DAT", name: "SPM45 Dates Room", setup: 0, turnaround: 0, description: "SPM-45 test venue: no unavailable period, no bookings" },
  { code: "SPM45-PER", name: "SPM45 Period Room", setup: 0, turnaround: 0, description: "SPM-45 test venue: four bookings around 10-15 Jun 2027" },
  { code: "SPM45-SET", name: "SPM45 Setup Room", setup: 30, turnaround: 45, description: "SPM-45 test venue: 30 min setup, 45 min turnaround" },
  { code: "SPM45-STA", name: "SPM45 Status Room", setup: 0, turnaround: 0, description: "SPM-45 test venue: an approved, a pending and a finished booking" },
  { code: "SPM45-NOW", name: "SPM45 Closure Room", setup: 0, turnaround: 0, description: "SPM-45 test venue: unavailable from 1 Oct 2026 to 1 Dec 2028, 09:00" },
  { code: "SPM45-BAK", name: "SPM45 Reopened Room", setup: 0, turnaround: 0, description: "SPM-45 test venue: was unavailable 1 Sep to 1 Oct 2026, 12:00" },
];
const TEST_VENUE_LAYOUTS = [
  { layoutName: "classroom", capacity: 40 },
  { layoutName: "theatre", capacity: 40 },
];

/** A period runs from the time the venue becomes unavailable to the time it
 *  is available again. */
const PERIODS = [
  { venueCode: "SPM45-NOW", from: "2026-10-01", fromTime: "00:00", until: "2028-12-01", untilTime: "09:00", reason: "renovation" },
  { venueCode: "SPM45-BAK", from: "2026-09-01", fromTime: "00:00", until: "2026-10-01", untilTime: "12:00", reason: "maintenance" },
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
  /// The booking's status; "approved" unless it is still a request.
  bookingStatus?: "pending";
  /// What the booking is there to show.
  purpose: string;
};

/** All with coordinator Daniel Tan. */
const FIXTURES: Fixture[] = [
  // SPM45-PER: against the period 10 Jun 2027, 13:00 to 15 Jun 2027, 13:00.
  { key: "spm45_before", title: "SPM45 Morning Briefing", venueCode: "SPM45-PER", date: "2027-06-10", from: "11:00", to: "13:00",
    purpose: "ends as the period starts - not flagged" },
  { key: "spm45_first", title: "SPM45 Afternoon Workshop", venueCode: "SPM45-PER", date: "2027-06-10", from: "13:00", to: "15:00",
    purpose: "starts as the period starts - flagged" },
  { key: "spm45_last", title: "SPM45 Closing Seminar", venueCode: "SPM45-PER", date: "2027-06-15", from: "10:00", to: "13:00",
    purpose: "ends as the period ends - flagged" },
  { key: "spm45_after", title: "SPM45 Return Forum", venueCode: "SPM45-PER", date: "2027-06-15", from: "13:00", to: "15:00",
    purpose: "starts as the venue is available again - not flagged" },
  // SPM45-SET (setup 30 min, turnaround 45 min): against the period
  // 21 Jun 2027, 09:00 to 22 Jun 2027, 13:00.
  { key: "spm45_turnaround", title: "SPM45 Early Talk", venueCode: "SPM45-SET", date: "2027-06-21", from: "07:30", to: "08:30",
    purpose: "its turnaround (to 09:15) runs into the period - flagged" },
  { key: "spm45_setup", title: "SPM45 Later Talk", venueCode: "SPM45-SET", date: "2027-06-22", from: "13:30", to: "14:30",
    purpose: "its setup (from 13:00) starts as the period ends - not flagged" },
  // SPM45-STA: against the period 1 Sep 2026, 00:00 to 7 Jul 2027, 00:00.
  { key: "spm45_approved", title: "SPM45 Approved Review", venueCode: "SPM45-STA", date: "2027-07-05", from: "09:00", to: "12:00",
    purpose: "approved and still to come - flagged" },
  { key: "spm45_pending", title: "SPM45 Pending Request", venueCode: "SPM45-STA", date: "2027-07-05", from: "14:00", to: "17:00",
    bookingStatus: "pending",
    purpose: "a request, not yet a commitment - not flagged" },
  { key: "spm45_finished", title: "SPM45 Finished Meeting", venueCode: "SPM45-STA", date: "2026-09-15", from: "09:00", to: "12:00",
    eventStatus: "completed",
    purpose: "already taken place - not flagged" },
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
  console.log(`SPM-45 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  if (removed.count > 0) console.log(`Removed ${removed.count} SPM-45 fixture event(s) no longer defined.`);

  // The test venues, back in their starting state: active, with only the
  // periods listed above - whatever a test pass recorded, changed or ended.
  const venueIds = new Map<string, string>();
  for (const { setup, turnaround, ...v } of TEST_VENUES) {
    const fields = { ...TEST_VENUE, ...v, setupMinutes: setup, teardownMinutes: turnaround };
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
        startsAt: sgt(p.from, p.fromTime),
        endsAt: sgt(p.until, p.untilTime),
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
      purpose: "SPM-45 venue unavailability test event",
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

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${f.purpose}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-45 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
