/**
 * SPM-81 (Request More Than One Venue for an Event) — QA fixtures, WITHOUT
 * reseeding.
 *
 *   npm run fixtures:spm81
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm81_": it deletes them (their status
 *     history, sessions and venue bookings go with them - every child relation
 *     of Event is onDelete: Cascade) and recreates them in their starting
 *     state;
 *   - its three test venues, SPM81 Auditorium (SPM81-AUD), SPM81 Breakout Room
 *     A (SPM81-BRA) and SPM81 Breakout Room B (SPM81-BRB), which it upserts and
 *     puts back to their starting values, with only Breakout Room B's one
 *     maintenance period. Every booking in the cases is at one of these rooms,
 *     so nobody else's bookings can get in the way.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Sending, approving and rejecting requests is exactly what the test cases do,
 * so run it again after each case that does
 * (docs/test-cases/SPM-81_Test_Cases.xlsx says which).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same venues and events (the events only - their
 * bookings, sessions and the maintenance period are made here) after its last
 * existing block - keep the two in step.
 *
 * Needs the base seed's users to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm81_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** A main room with setup and turnaround, and two breakout rooms with neither. */
const VENUES = [
  { code: "SPM81-AUD", name: "SPM81 Auditorium", setupMinutes: 30, teardownMinutes: 30,
    description: "SPM-81 test venue: the main room, 30 min setup and turnaround" },
  { code: "SPM81-BRA", name: "SPM81 Breakout Room A", setupMinutes: 0, teardownMinutes: 0,
    description: "SPM-81 test venue: breakout room, no setup or turnaround" },
  { code: "SPM81-BRB", name: "SPM81 Breakout Room B", setupMinutes: 0, teardownMinutes: 0,
    description: "SPM-81 test venue: breakout room, unavailable on 10 Aug 2027 (SPM-81-TC03)" },
] as const;
const VENUE_FIELDS = { building: "Orchard Hub", floor: "L3", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00", isActive: true };
const LAYOUTS = [
  { layoutName: "theatre", capacity: 60 },
  { layoutName: "classroom", capacity: 40 },
];
/** Breakout Room B's one unavailable period (SPM-81-TC03). */
const MAINTENANCE = { venueCode: "SPM81-BRB", date: "2027-08-10", from: "08:00", to: "13:00", reason: "maintenance", notes: "SPM-81 fixture: carpet replacement" };

type Booking = {
  venueCode: string;
  status: "approved" | "pending" | "rejected";
  /** Venue Staff's reason, on a rejected request. */
  reason?: string;
  /** The requested times, when they are wider than the event's own. */
  from?: string;
  to?: string;
  /** The session it is for, by label - then its times are that session's. */
  session?: string;
};

type Fixture = {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD, Singapore
  from: string; // HH:MM
  to: string;
  sessions?: { label: string; date: string; from: string; to: string }[];
  bookings?: Booking[];
  testCases: string;
};

/** Every event is Planning, 30 attendees, theatre, and Daniel Tan's. */
const FIXTURES: Fixture[] = [
  { key: "spm81_summit", title: "SPM81 Leadership Summit", date: "2027-08-03", from: "09:00", to: "17:00", testCases: "TC01" },
  { key: "spm81_conference", title: "SPM81 Two-Track Conference", date: "2027-08-05", from: "09:00", to: "12:00",
    sessions: [
      { label: "Day 1", date: "2027-08-05", from: "09:00", to: "12:00" },
      { label: "Day 2", date: "2027-08-06", from: "09:00", to: "12:00" },
    ],
    testCases: "TC02" },
  { key: "spm81_rival", title: "SPM81 Rival Booking", date: "2027-08-10", from: "10:00", to: "12:00",
    bookings: [{ venueCode: "SPM81-AUD", status: "approved" }], testCases: "TC03 (in use 09:30-12:30)" },
  { key: "spm81_kickoff", title: "SPM81 Sales Kickoff", date: "2027-08-10", from: "10:00", to: "12:00", testCases: "TC03" },
  { key: "spm81_repeat", title: "SPM81 Repeat Request", date: "2027-08-12", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM81-AUD", status: "pending" }, { venueCode: "SPM81-BRA", status: "approved" }],
    testCases: "TC04" },
  { key: "spm81_partner_day", title: "SPM81 Partner Day", date: "2027-08-17", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM81-AUD", status: "pending" }, { venueCode: "SPM81-BRA", status: "pending" }],
    testCases: "TC05 TC06" },
  { key: "spm81_showcase", title: "SPM81 Showcase Day", date: "2027-08-19", from: "09:00", to: "17:00",
    bookings: [
      { venueCode: "SPM81-AUD", status: "approved" },
      { venueCode: "SPM81-BRA", status: "approved", from: "08:30", to: "17:30" },
      { venueCode: "SPM81-BRB", status: "pending" },
    ],
    testCases: "TC07" },
  { key: "spm81_solo", title: "SPM81 Solo Workshop", date: "2027-08-26", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM81-AUD", status: "approved" }], testCases: "TC08" },
  // Workshop overlaps the Morning plenary; the Afternoon plenary only meets it.
  { key: "spm81_parallel", title: "SPM81 Parallel Tracks", date: "2027-08-24", from: "09:00", to: "15:00",
    sessions: [
      { label: "Morning plenary", date: "2027-08-24", from: "09:00", to: "12:00" },
      { label: "Workshop", date: "2027-08-24", from: "10:00", to: "12:00" },
      { label: "Afternoon plenary", date: "2027-08-24", from: "12:00", to: "15:00" },
    ],
    bookings: [{ venueCode: "SPM81-AUD", status: "pending", session: "Morning plenary" }],
    testCases: "TC09" },
  { key: "spm81_second_attempt", title: "SPM81 Second Attempt", date: "2027-08-31", from: "09:00", to: "12:00",
    bookings: [
      { venueCode: "SPM81-AUD", status: "rejected", reason: "Stage lighting is being serviced that morning." },
      { venueCode: "SPM81-BRA", status: "approved" },
    ],
    testCases: "TC10" },
  { key: "spm81_twin_rooms", title: "SPM81 Twin Rooms", date: "2027-09-02", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM81-AUD", status: "pending" }, { venueCode: "SPM81-BRA", status: "pending" }],
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
  console.log(`SPM-81 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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

  // Reset: drop the previous run's events. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-81 fixture event(s).`);

  // The test venues, back in their starting state with only the one
  // maintenance period. Any booking left at one by a test pass went with its
  // event above; one made for another story's event is removed too.
  const venueIds = new Map<string, string>();
  for (const v of VENUES) {
    const venue = await prisma.venue.upsert({
      where: { code: v.code },
      create: { ...VENUE_FIELDS, ...v },
      update: { ...VENUE_FIELDS, ...v },
    });
    await prisma.venueLayout.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueLayout.createMany({ data: LAYOUTS.map((l) => ({ venueId: venue.id, ...l })) });
    await prisma.venueFacility.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueBooking.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  await prisma.venueUnavailability.create({
    data: {
      venueId: venueIds.get(MAINTENANCE.venueCode)!,
      startsAt: sgt(MAINTENANCE.date, MAINTENANCE.from),
      endsAt: sgt(MAINTENANCE.date, MAINTENANCE.to),
      reason: MAINTENANCE.reason,
      notes: MAINTENANCE.notes,
      createdBy: venueStaff,
    },
  });
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
        purpose: "SPM-81 more than one venue for an event test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: "planning",
        startsAt,
        endsAt,
        expectedAttendance: 30,
        preferredLayout: "theatre",
        submittedAt: historyStart,
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
            expectedAttendance: 30,
            preferredLayout: "theatre",
          })),
        },
      },
      select: { id: true, sequenceNumber: true, sessions: { select: { id: true, label: true, startsAt: true, endsAt: true } } },
    });

    // After the event, so a session's booking can point at its session.
    for (const b of f.bookings ?? []) {
      const session = b.session ? created.sessions.find((s) => s.label === b.session) : undefined;
      if (b.session && !session) throw new Error(`${f.key}: no session "${b.session}" for its booking.`);
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          sessionId: session?.id,
          venueId: venueIds.get(b.venueCode)!,
          layoutName: "theatre",
          startsAt: session?.startsAt ?? (b.from ? sgt(f.date, b.from) : startsAt),
          endsAt: session?.endsAt ?? (b.to ? sgt(f.date, b.to) : endsAt),
          status: b.status,
          requestedBy: coordinator,
          requestedAt: addDays(now, -3),
          decidedBy: b.status === "pending" ? undefined : venueStaff,
          decidedAt: b.status === "pending" ? undefined : addDays(now, -2),
          decisionReason: b.reason,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    const held = (f.bookings ?? []).map((b) => `${b.venueCode.slice(-3)}:${b.status}`).join(" ");
    console.log(`  ${ref}  ${f.title.padEnd(28)} ${held.padEnd(36)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-81 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
