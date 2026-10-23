/**
 * SPM-36 (Mark Event as Completed) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm36
 *
 * Touches only the events whose seedKey starts with "spm36_": it deletes them
 * (their status history, venue bookings and equipment requests go with them -
 * every child relation of Event is onDelete: Cascade) and recreates them in
 * their starting state. Nothing else in the database is changed, so it is safe
 * to run while others are testing other stories. Marking an event completed
 * is what the test cases do, so run it before and after the cases that do
 * (docs/test-cases/SPM-36_Test_Cases.xlsx).
 *
 * One date is NOT fixed, on purpose: SPM36 Harbour Awards Night ended
 * YESTERDAY evening, counted from when this script runs. It has to be over
 * (AC1) but less than 7 days over, or the app completes it by itself (AC6)
 * before a tester can - so no fixed date stays right for more than a week.
 * The test cases say "yesterday" and quote no date for it. Every other date
 * is fixed.
 *
 * No pinned reference numbers: the cases find each event by its title.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles and dates)
 * but not their bookings, equipment or registration - run this once after a
 * full reseed.
 * Needs the base seed's users, venues and equipment catalogue.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm36_";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

/// Yesterday's date in Singapore, as YYYY-MM-DD.
function yesterdayInSingapore(): string {
  return new Date(Date.now() + 8 * HOUR - DAY).toISOString().slice(0, 10);
}

const DANIEL = "daniel.tan@connectsphere.com";

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "confirmed";
  date: string;
  startHour: number;
  endHour: number;
  bookings: { venue: string }[];
  equipment: { name: string; quantity: number }[];
  /// Attendees registered for it, by email.
  registrations?: string[];
  testCases: string;
};

const FIXTURES: Fixture[] = [
  // Ended yesterday, still Confirmed: the coordinator marks it completed (TC01),
  // after which it is locked (TC05) and the organiser reads its record (TC04).
  { key: "spm36_awards", title: "SPM36 Harbour Awards Night", status: "confirmed",
    date: yesterdayInSingapore(), startHour: 19, endHour: 22,
    bookings: [{ venue: "ORC-GAL" }],
    equipment: [{ name: "Handheld Wireless Mic", quantity: 2 }, { name: "Audio Mixing Desk", quantity: 1 }],
    testCases: "TC01 TC03 TC04 TC05" },
  // Confirmed but still ahead: not offered (TC02).
  { key: "spm36_launch", title: "SPM36 Riverside Product Launch", status: "confirmed",
    date: "2027-11-18", startHour: 9, endHour: 13,
    bookings: [{ venue: "ORC-SEM" }], equipment: [],
    testCases: "TC02" },
  // Over, but never confirmed: not offered, and never completed by itself (TC02, TC06).
  { key: "spm36_planning", title: "SPM36 Overdue Planning Forum", status: "planning",
    date: "2026-10-05", startHour: 9, endHour: 12,
    bookings: [], equipment: [],
    testCases: "TC02 TC06" },
  // Confirmed and over for more than 7 days: completed by itself on the next
  // page load (TC06). Lee Wei Ming registered for it and keeps it (TC07).
  { key: "spm36_expo", title: "SPM36 Forgotten Trade Expo", status: "confirmed",
    date: "2026-10-01", startHour: 10, endHour: 17,
    bookings: [{ venue: "MAR-AUD" }],
    equipment: [{ name: "Handheld Wireless Mic", quantity: 4 }],
    registrations: ["lee.wei.ming@example.com"],
    testCases: "TC06 TC07" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-36 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything first, so a missing row fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const lead = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const coordinatorId = await find(DANIEL);
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const attendees = new Map<string, string>();
  for (const email of FIXTURES.flatMap((f) => f.registrations ?? [])) attendees.set(email, await find(email));

  const venues = new Map<string, string>();
  const equipment = new Map<string, string>();
  for (const f of FIXTURES) {
    for (const b of f.bookings) {
      if (venues.has(b.venue)) continue;
      const v = await prisma.venue.findUnique({ where: { code: b.venue }, select: { id: true } });
      if (!v) throw new Error(`Venue ${b.venue} not found - run the base seed once first.`);
      venues.set(b.venue, v.id);
    }
    for (const e of f.equipment) {
      if (equipment.has(e.name)) continue;
      const item = await prisma.equipment.findFirst({ where: { name: e.name }, select: { id: true } });
      if (!item) throw new Error(`Equipment "${e.name}" not found - run the base seed once first.`);
      equipment.set(e.name, item.id);
    }
  }

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-36 fixture event(s).`);

  const times = (f: Fixture) => ({ startsAt: sgt(f.date, f.startHour), endsAt: sgt(f.date, f.endHour) });

  // An approved booking blocks its room (SPM-44). Stop rather than double-book
  // a room someone else's fixtures already hold.
  for (const f of FIXTURES) {
    const { startsAt, endsAt } = times(f);
    for (const b of f.bookings) {
      const clash = await prisma.venueBooking.findFirst({
        where: { venueId: venues.get(b.venue)!, status: "approved", startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { event: { select: { title: true } } },
      });
      if (clash) throw new Error(`${b.venue} is already booked by "${clash.event.title}" on ${f.date}. Nothing was recreated.`);
    }
  }

  for (const f of FIXTURES) {
    const { startsAt, endsAt } = times(f);
    const chain = CHAIN[f.status];
    // History 4 days a step, ending 10 days before the event.
    const historyStart = new Date(startsAt.getTime() - (chain.length * 4 + 10) * DAY);

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-36 mark event as completed test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 80,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? new Date(historyStart.getTime() + 16 * DAY) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? lead : coordinatorId,
            changedAt: new Date(historyStart.getTime() + i * 4 * DAY),
            reason: REASONS[to],
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    for (const b of f.bookings) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venues.get(b.venue)!,
          layoutName: "theatre",
          startsAt,
          endsAt,
          status: "approved",
          requestedBy: coordinatorId,
          requestedAt: new Date(historyStart.getTime() + 12 * DAY),
          decidedBy: venueStaff,
          decidedAt: new Date(historyStart.getTime() + 13 * DAY),
        },
      });
    }

    for (const e of f.equipment) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipment.get(e.name)!,
          quantityRequested: e.quantity,
          quantityReserved: e.quantity,
          // Two hours either side, as equipmentWindow() gives.
          startsAt: new Date(startsAt.getTime() - 2 * HOUR),
          endsAt: new Date(endsAt.getTime() + 2 * HOUR),
          status: "reserved",
          requestedBy: coordinatorId,
          requestedAt: new Date(historyStart.getTime() + 12 * DAY),
          reviewedBy: techSupport,
          reviewedAt: new Date(historyStart.getTime() + 14 * DAY),
        },
      });
    }

    for (const email of f.registrations ?? []) {
      await prisma.registration.create({
        data: { eventId: created.id, attendeeId: attendees.get(email)!, status: "registered", registeredAt: sgt("2026-09-15", 10) },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(32)} ${f.status.padEnd(10)} ${f.date}  ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-36 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
