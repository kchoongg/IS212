/**
 * SPM-45 (Record Venue Unavailability) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm45
 *
 * Only touches the six "SPM45" test venues and the events whose seedKey
 * starts with "spm45_". The first run creates them; every later run puts them
 * back to their starting state, which is the full revert after a test pass:
 *   - "SPM45 Dates Room" (SPM45-DAT): no unavailable period, no bookings.
 *     The cases that only record periods use it (SPM-45-TC01 to TC07, TC17).
 *   - "SPM45 Period Room" (SPM45-PER): no unavailable period, and four
 *     approved, unflagged bookings - one either side of each edge of the
 *     period SPM-45-TC08 records (10 Jun 2027 PM to 15 Jun 2027 PM).
 *   - "SPM45 Setup Room" (SPM45-SET): the only one with setup and turnaround
 *     time, and three approved bookings - one whose turnaround slot and one
 *     whose setup slot fall in SPM-45-TC12's period, and one clear of it.
 *   - "SPM45 Status Room" (SPM45-STA): an approved, a pending and a finished
 *     booking, for SPM-45-TC13 (only the approved, upcoming one is flagged).
 *   - "SPM45 Closure Room" (SPM45-NOW): one period that is under way
 *     (1 Oct 2026 AM to 1 Dec 2028 AM), read by SPM-45-TC14 and ended early
 *     by SPM-45-TC15.
 *   - "SPM45 Reopened Room" (SPM45-BAK): one period that has passed
 *     (1 Sep 2026 AM to 1 Oct 2026 AM), which SPM-45-TC16 only reads.
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

/** A fixed calendar date at a Singapore wall-clock hour. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** The customer's slots (#50), as [start hour, end hour]. */
const SLOT_HOURS = { AM: [7, 12], PM: [13, 18], Night: [19, 24] } as const;
type SlotName = keyof typeof SLOT_HOURS;

const TEST_VENUE = {
  building: "Orchard Hub",
  floor: "L1",
  maxCapacity: 40,
  opensAt: "07:00",
  closesAt: "23:00",
};
/** Setup and turnaround are none except at SPM45-SET, so everywhere else a
 *  booking holds only its own slots and a case can name the exact slot either
 *  side of a period's edge. */
const TEST_VENUES = [
  { code: "SPM45-DAT", name: "SPM45 Dates Room", minutes: 0, description: "SPM-45 test venue: no unavailable period, no bookings" },
  { code: "SPM45-PER", name: "SPM45 Period Room", minutes: 0, description: "SPM-45 test venue: four bookings around 10-15 Jun 2027" },
  { code: "SPM45-SET", name: "SPM45 Setup Room", minutes: 60, description: "SPM-45 test venue: needs a setup and a turnaround slot" },
  { code: "SPM45-STA", name: "SPM45 Status Room", minutes: 0, description: "SPM-45 test venue: an approved, a pending and a finished booking" },
  { code: "SPM45-NOW", name: "SPM45 Closure Room", minutes: 0, description: "SPM-45 test venue: unavailable from 1 Oct 2026 to 1 Dec 2028" },
  { code: "SPM45-BAK", name: "SPM45 Reopened Room", minutes: 0, description: "SPM-45 test venue: was unavailable 1 Sep to 1 Oct 2026" },
];
const TEST_VENUE_LAYOUTS = [
  { layoutName: "classroom", capacity: 40 },
  { layoutName: "theatre", capacity: 40 },
];

/** A period runs from the start of its first unavailable slot to the start of
 *  its first available slot - here always AM to AM. */
const PERIODS = [
  { venueCode: "SPM45-NOW", from: "2026-10-01", until: "2028-12-01", reason: "renovation" },
  { venueCode: "SPM45-BAK", from: "2026-09-01", until: "2026-10-01", reason: "maintenance" },
];

type EventStatus = "planning" | "completed";

type Fixture = {
  key: string;
  title: string;
  venueCode: string;
  date: string; // YYYY-MM-DD, Singapore
  slot: SlotName;
  startHour: number;
  durationHours: number;
  /// The event's status; "planning" unless the event is over.
  eventStatus?: EventStatus;
  /// The booking's status; "approved" unless it is still a request.
  bookingStatus?: "pending";
  /// What the booking is there to show.
  purpose: string;
};

/** All with coordinator Daniel Tan. */
const FIXTURES: Fixture[] = [
  // SPM45-PER: against the period 10 Jun 2027 PM to 15 Jun 2027 PM.
  { key: "spm45_before", title: "SPM45 Morning Briefing", venueCode: "SPM45-PER", date: "2027-06-10", slot: "AM", startHour: 9, durationHours: 2,
    purpose: "slot before the period starts - not flagged" },
  { key: "spm45_first", title: "SPM45 Afternoon Workshop", venueCode: "SPM45-PER", date: "2027-06-10", slot: "PM", startHour: 14, durationHours: 3,
    purpose: "first slot of the period - flagged" },
  { key: "spm45_last", title: "SPM45 Closing Seminar", venueCode: "SPM45-PER", date: "2027-06-15", slot: "AM", startHour: 9, durationHours: 3,
    purpose: "last slot of the period - flagged" },
  { key: "spm45_after", title: "SPM45 Return Forum", venueCode: "SPM45-PER", date: "2027-06-15", slot: "PM", startHour: 14, durationHours: 3,
    purpose: "slot the venue is available again - not flagged" },
  // SPM45-SET: against the period 21 Jun 2027 AM to 22 Jun 2027 PM. The room
  // needs the slot before each booking for setup and the slot after for
  // turnaround (#123).
  { key: "spm45_turnaround", title: "SPM45 Evening Talk", venueCode: "SPM45-SET", date: "2027-06-20", slot: "Night", startHour: 19, durationHours: 3,
    purpose: "its turnaround slot (21 Jun AM) is in the period - flagged" },
  { key: "spm45_setup", title: "SPM45 Afternoon Talk", venueCode: "SPM45-SET", date: "2027-06-22", slot: "PM", startHour: 14, durationHours: 3,
    purpose: "its setup slot (22 Jun AM) is in the period - flagged" },
  { key: "spm45_clear", title: "SPM45 Later Talk", venueCode: "SPM45-SET", date: "2027-06-23", slot: "PM", startHour: 14, durationHours: 3,
    purpose: "setup slot (23 Jun AM) is after the period - not flagged" },
  // SPM45-STA: against the period 1 Sep 2026 AM to 7 Jul 2027 AM.
  { key: "spm45_approved", title: "SPM45 Approved Review", venueCode: "SPM45-STA", date: "2027-07-05", slot: "AM", startHour: 9, durationHours: 3,
    purpose: "approved and still to come - flagged" },
  { key: "spm45_pending", title: "SPM45 Pending Request", venueCode: "SPM45-STA", date: "2027-07-05", slot: "PM", startHour: 14, durationHours: 3,
    bookingStatus: "pending",
    purpose: "a request, not yet a commitment - not flagged" },
  { key: "spm45_finished", title: "SPM45 Finished Meeting", venueCode: "SPM45-STA", date: "2026-09-15", slot: "AM", startHour: 9, durationHours: 3,
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
  for (const { minutes, ...v } of TEST_VENUES) {
    const fields = { ...TEST_VENUE, ...v, setupMinutes: minutes, teardownMinutes: minutes };
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
        startsAt: sgt(p.from, SLOT_HOURS.AM[0]),
        endsAt: sgt(p.until, SLOT_HOURS.AM[0]),
        reason: p.reason,
        createdBy: venueStaff,
      },
    });
  }
  console.log(`Venues ${TEST_VENUES.map((v) => v.code).join(", ")} ready.`);

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
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
        startsAt: sgt(f.date, SLOT_HOURS[f.slot][0]),
        endsAt: sgt(f.date, SLOT_HOURS[f.slot][1]),
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
