/**
 * SPM-67 (Withdraw or Release Venue Booking) — QA fixtures, WITHOUT
 * reseeding.
 *
 *   npm run fixtures:spm67
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm67_": it deletes them (their status
 *     history and venue bookings go with them - every child relation of Event
 *     is onDelete: Cascade) and recreates them in their starting state;
 *   - its three test venues, SPM67 Hall (SPM67-HAL, 30 min setup and
 *     turnaround), SPM67 Studio (SPM67-STU) and SPM67 Annex (SPM67-ANX), which
 *     it upserts and puts back to their starting values with no bookings and
 *     no unavailable periods. Every booking in the cases is at one of these
 *     rooms, so nobody else's bookings can get in the way, and a request a
 *     case sends (SPM-67-TC04 to TC06) is removed on the next run.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Withdrawing, releasing and requesting are exactly what the test cases do,
 * so run it again after each case that does
 * (docs/test-cases/SPM-67_Test_Cases.xlsx says which).
 *
 * Dates are in November 2027 on purpose: the app writes September as "Sept",
 * and every other month as its three-letter form, so dates quoted in the
 * cases read the same as on screen.
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same venues and events (the events only - their
 * bookings are made here) after its last existing block - keep the two in
 * step.
 *
 * Needs the base seed's users, and the SPM-67 migration
 * (20261011120000_add_venue_booking_withdrawal), to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm67_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const VENUES = [
  { code: "SPM67-HAL", name: "SPM67 Hall", setupMinutes: 30, teardownMinutes: 30,
    description: "SPM-67 test venue: 30 min setup and turnaround" },
  { code: "SPM67-STU", name: "SPM67 Studio", setupMinutes: 0, teardownMinutes: 0,
    description: "SPM-67 test venue: no setup or turnaround" },
  { code: "SPM67-ANX", name: "SPM67 Annex", setupMinutes: 0, teardownMinutes: 0,
    description: "SPM-67 test venue: no setup or turnaround" },
] as const;
const VENUE_FIELDS = { building: "Orchard Hub", floor: "L4", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00", isActive: true };
const LAYOUTS = [
  { layoutName: "theatre", capacity: 60 },
  { layoutName: "classroom", capacity: 40 },
];

type Booking = {
  venueCode: string;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "released";
  /** Venue Staff's reason on a rejection; the Coordinator's on a withdrawal or release. */
  reason?: string;
};

type Fixture = {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD, Singapore
  from: string; // HH:MM
  to: string;
  bookings?: Booking[];
  testCases: string;
};

/** Every event is Planning, 30 attendees, theatre, Rachel Ng's and Daniel Tan's. */
const FIXTURES: Fixture[] = [
  { key: "spm67_pending_pair", title: "SPM67 Pending Pair", date: "2027-11-02", from: "09:00", to: "12:00",
    bookings: [
      { venueCode: "SPM67-HAL", status: "pending" },
      { venueCode: "SPM67-STU", status: "pending" },
      { venueCode: "SPM67-ANX", status: "approved" },
    ],
    testCases: "TC01 TC02" },
  { key: "spm67_release_pair", title: "SPM67 Release Pair", date: "2027-11-04", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM67-HAL", status: "approved" }, { venueCode: "SPM67-STU", status: "approved" }],
    testCases: "TC03" },
  // The Hall is in use 09:30-12:30 and 14:30-16:30; the Briefing would need it
  // 11:45-14:45, so it meets each only through setup or turnaround.
  { key: "spm67_held_hall", title: "SPM67 Held Hall", date: "2027-11-09", from: "10:00", to: "12:00",
    bookings: [{ venueCode: "SPM67-HAL", status: "pending" }], testCases: "TC04" },
  { key: "spm67_booked_hall", title: "SPM67 Booked Hall", date: "2027-11-09", from: "15:00", to: "16:00",
    bookings: [{ venueCode: "SPM67-HAL", status: "approved" }], testCases: "TC04" },
  { key: "spm67_afternoon_briefing", title: "SPM67 Afternoon Briefing", date: "2027-11-09", from: "12:15", to: "14:15",
    testCases: "TC04" },
  { key: "spm67_only_room", title: "SPM67 Only Room", date: "2027-11-16", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM67-HAL", status: "approved" }], testCases: "TC05" },
  { key: "spm67_fresh_start", title: "SPM67 Fresh Start", date: "2027-11-18", from: "09:00", to: "12:00",
    bookings: [{ venueCode: "SPM67-HAL", status: "pending" }], testCases: "TC06" },
  { key: "spm67_status_mix", title: "SPM67 Status Mix", date: "2027-11-23", from: "09:00", to: "12:00",
    bookings: [
      { venueCode: "SPM67-HAL", status: "pending" },
      { venueCode: "SPM67-STU", status: "approved" },
      { venueCode: "SPM67-ANX", status: "rejected", reason: "The Annex is closed for a private function that morning." },
      { venueCode: "SPM67-HAL", status: "withdrawn", reason: "Requested the wrong room by mistake." },
      { venueCode: "SPM67-STU", status: "released", reason: "Workshop merged into the main session." },
    ],
    testCases: "TC07-TC10 (read only)" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-67 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  console.log(`Removed ${removed.count} existing SPM-67 fixture event(s).`);

  // The test venues, back in their starting state. Any booking left at one by
  // a test pass went with its event above; one made for another story's
  // event is removed too.
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
  console.log(`Venues ${VENUES.map((v) => v.code).join(", ")} ready.`);

  const now = new Date();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.from);
    const endsAt = sgt(f.date, f.to);
    const historyStart = addDays(now, -(CHAIN.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-67 withdraw or release venue booking test event",
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
      },
      select: { id: true, sequenceNumber: true },
    });

    // One minute apart, so the Venue tab (newest request first) lists them in
    // the same order on every run.
    for (const [i, b] of (f.bookings ?? []).entries()) {
      const requestedAt = new Date(addDays(now, -3).getTime() + i * 60_000);
      // Venue Staff decided every booking that is not pending - a released one
      // was approved first, a withdrawn one never was.
      const decided = b.status === "approved" || b.status === "rejected" || b.status === "released";
      const takenBack = b.status === "withdrawn" || b.status === "released";
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venueIds.get(b.venueCode)!,
          layoutName: "theatre",
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinator,
          requestedAt,
          decidedBy: decided ? venueStaff : undefined,
          decidedAt: decided ? addDays(now, -2) : undefined,
          decisionReason: b.status === "rejected" ? b.reason : undefined,
          cancelledBy: takenBack ? coordinator : undefined,
          cancelledAt: takenBack ? addDays(now, -1) : undefined,
          cancellationReason: takenBack ? b.reason : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    const held = (f.bookings ?? []).map((b) => `${b.venueCode.slice(-3)}:${b.status}`).join(" ");
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${held.padEnd(60)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-67 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
