/**
 * SPM-90 (Check Each Venue Against Its Own Requirements) — QA fixtures,
 * WITHOUT reseeding.
 *
 *   npm run fixtures:spm90
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm90_": it deletes them (their status
 *     history, sessions, facility requirements and venue bookings go with them
 *     - every child relation of Event is onDelete: Cascade) and recreates them
 *     in their starting state;
 *   - its three test venues, SPM90 Main Hall (SPM90-HALL), SPM90 Breakout Room
 *     (SPM90-BRK) and SPM90 Annexe (SPM90-ANX), which it upserts and puts back
 *     to their starting values. Every booking in the cases is at one of these
 *     rooms, so nobody else's bookings can get in the way.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Sending and approving requests and confirming events is exactly what the
 * test cases do, so run it again after each case that does
 * (docs/test-cases/SPM-90_Test_Cases.xlsx says which).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same venues and events (the events and their
 * facility requirement only - their bookings and sessions are made here) after
 * its last existing block - keep the two in step.
 *
 * Needs the base seed's users and its "Step-free access" facility to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm90_";
/** Mandatory for every SPM90 event - and so for every space of it. */
const REQUIRED_FACILITY = "Step-free access";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/**
 * A hall that seats the whole event, a breakout room that only suits a smaller
 * space, and an annexe without the step-free access every event here requires.
 */
const VENUES = [
  { code: "SPM90-HALL", name: "SPM90 Main Hall", maxCapacity: 200, stepFree: true,
    layouts: [{ layoutName: "theatre", capacity: 200 }, { layoutName: "classroom", capacity: 120 }],
    description: "SPM-90 test venue: seats the whole event" },
  { code: "SPM90-BRK", name: "SPM90 Breakout Room", maxCapacity: 30, stepFree: true,
    layouts: [{ layoutName: "theatre", capacity: 30 }, { layoutName: "classroom", capacity: 20 }],
    description: "SPM-90 test venue: suits a breakout space, not the whole event" },
  { code: "SPM90-ANX", name: "SPM90 Annexe", maxCapacity: 30, stepFree: false,
    layouts: [{ layoutName: "theatre", capacity: 30 }, { layoutName: "classroom", capacity: 20 }],
    description: "SPM-90 test venue: no step-free access" },
] as const;
const VENUE_FIELDS = { building: "Orchard Hub", floor: "L5", opensAt: "07:00", closesAt: "22:00", setupMinutes: 0, teardownMinutes: 0, isActive: true };

/** The whole event's own attendance and layout. */
const EVENT_ATTENDANCE = 150;
const EVENT_LAYOUT = "theatre";

type Space = { purpose: string | null; attendance: number; layout: string };
/** The two spaces the cases use. */
const MAIN: Space = { purpose: "Main programme", attendance: EVENT_ATTENDANCE, layout: EVENT_LAYOUT };
const BREAKOUT: Space = { purpose: "Breakout room", attendance: 20, layout: "classroom" };
/** A booking made before SPM-90: its attendance was backfilled, nobody said what it was for. */
const UNNAMED: Space = { ...MAIN, purpose: null };

type Booking = { venueCode: string; status: "approved" | "pending"; space: Space };

type Fixture = {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD, Singapore
  from: string; // HH:MM
  to: string;
  sessions?: { label: string; date: string; from: string; to: string; attendance: number; layout: string }[];
  bookings?: Booking[];
  testCases: string;
};

/** Every event is Planning, 150 attendees, theatre, and Daniel Tan's. */
const FIXTURES: Fixture[] = [
  { key: "spm90_conference", title: "SPM90 Annual Conference", date: "2027-09-07", from: "09:00", to: "17:00", testCases: "TC01 TC02" },
  { key: "spm90_training", title: "SPM90 Training Day", date: "2027-09-09", from: "09:00", to: "17:00",
    bookings: [{ venueCode: "SPM90-HALL", status: "approved", space: MAIN }], testCases: "TC03 TC04 TC05" },
  { key: "spm90_expo", title: "SPM90 Product Expo", date: "2027-09-14", from: "09:00", to: "17:00",
    bookings: [
      { venueCode: "SPM90-HALL", status: "pending", space: MAIN },
      { venueCode: "SPM90-BRK", status: "pending", space: BREAKOUT },
    ],
    testCases: "TC06" },
  { key: "spm90_awards", title: "SPM90 Awards Night", date: "2027-09-16", from: "09:00", to: "17:00",
    bookings: [
      { venueCode: "SPM90-HALL", status: "approved", space: MAIN },
      { venueCode: "SPM90-BRK", status: "pending", space: BREAKOUT },
    ],
    testCases: "TC07 TC08 TC09" },
  { key: "spm90_solo", title: "SPM90 Solo Seminar", date: "2027-09-21", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM90-HALL", status: "approved", space: UNNAMED }], testCases: "TC10" },
  { key: "spm90_forum", title: "SPM90 Two-Day Forum", date: "2027-09-23", from: "09:00", to: "12:00",
    sessions: [
      { label: "Day 1", date: "2027-09-23", from: "09:00", to: "12:00", attendance: 150, layout: "theatre" },
      { label: "Day 2", date: "2027-09-24", from: "09:00", to: "12:00", attendance: 20, layout: "classroom" },
    ],
    testCases: "TC11" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-90 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const coordinator = await find("daniel.tan@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');
  const stepFree = await prisma.facility.findFirst({ where: { name: REQUIRED_FACILITY }, select: { id: true } });
  if (!stepFree) throw new Error(`Facility "${REQUIRED_FACILITY}" not found - run the base seed once first.`);

  // Reset: drop the previous run's events. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-90 fixture event(s).`);

  // The test venues, back in their starting state. Any booking left at one by
  // a test pass went with its event above; one made for another story's event
  // is removed too.
  const venueIds = new Map<string, string>();
  for (const { layouts, stepFree: hasStepFree, ...v } of VENUES) {
    const venue = await prisma.venue.upsert({
      where: { code: v.code },
      create: { ...VENUE_FIELDS, ...v },
      update: { ...VENUE_FIELDS, ...v },
    });
    await prisma.venueLayout.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueLayout.createMany({ data: layouts.map((l) => ({ venueId: venue.id, ...l })) });
    await prisma.venueFacility.deleteMany({ where: { venueId: venue.id } });
    if (hasStepFree) {
      await prisma.venueFacility.create({ data: { venueId: venue.id, facilityId: stepFree.id } });
    }
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueBooking.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  console.log(`Venues ${VENUES.map((v) => v.code).join(", ")} ready.`);

  const now = new Date();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.from);
    const endsAt = f.sessions ? sgt(f.sessions[f.sessions.length - 1].date, f.sessions[f.sessions.length - 1].to) : sgt(f.date, f.to);
    const historyStart = addDays(now, -(CHAIN.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-90 check each venue against its own requirements test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: "planning",
        startsAt,
        endsAt,
        expectedAttendance: EVENT_ATTENDANCE,
        preferredLayout: EVENT_LAYOUT,
        submittedAt: historyStart,
        // The event's, and so asked of every space it books (decided 2026-10-13).
        facilityRequirements: { create: [{ facilityId: stepFree.id, isMandatory: true }] },
        statusHistory: {
          create: CHAIN.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : CHAIN[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        sessions: f.sessions && {
          create: f.sessions.map((s) => ({
            label: s.label,
            startsAt: sgt(s.date, s.from),
            endsAt: sgt(s.date, s.to),
            expectedAttendance: s.attendance,
            preferredLayout: s.layout,
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    for (const b of f.bookings ?? []) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venueIds.get(b.venueCode)!,
          purpose: b.space.purpose,
          expectedAttendance: b.space.attendance,
          layoutName: b.space.layout,
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinator,
          requestedAt: addDays(now, -3),
          decidedBy: b.status === "pending" ? undefined : venueStaff,
          decidedAt: b.status === "pending" ? undefined : addDays(now, -2),
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    const held = (f.bookings ?? []).map((b) => `${b.venueCode.slice(6)}:${b.status}`).join(" ");
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${held.padEnd(28)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-90 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
