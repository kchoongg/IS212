/**
 * SPM-93 (Book Venues in 15-Minute Units) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm93
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm93_": it deletes them (their status
 *     history, sessions and venue bookings go with them - every child relation
 *     of Event is onDelete: Cascade) and recreates them in their starting
 *     state;
 *   - its three test venues, SPM93 Studio (SPM93-STU), SPM93 Quick Room
 *     (SPM93-QCK) and SPM93 Settings Room (SPM93-SET), which it upserts and
 *     puts back to their starting values - undoing SPM-93-TC07's edit - with
 *     only SPM93 Studio's one maintenance period. Every booking in the cases is
 *     at one of these rooms, so nobody else's bookings can get in the way.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Sending, approving and rejecting requests is exactly what the test cases do,
 * so run it again after each case that does
 * (docs/test-cases/SPM-93_Test_Cases.xlsx says which).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same venues and events, bookings included, after
 * its last existing block - keep the two in step.
 *
 * Needs the base seed's users to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm93_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** The three test venues. SPM93 Studio is the Week 7 example: 30 min setup, 45 min turnaround. */
const VENUES = [
  { code: "SPM93-STU", name: "SPM93 Studio", setupMinutes: 30, teardownMinutes: 45,
    description: "SPM-93 test venue: 30 min setup, 45 min turnaround" },
  { code: "SPM93-QCK", name: "SPM93 Quick Room", setupMinutes: 0, teardownMinutes: 0,
    description: "SPM-93 test venue: no setup or turnaround" },
  { code: "SPM93-SET", name: "SPM93 Settings Room", setupMinutes: 30, teardownMinutes: 45,
    description: "SPM-93 test venue: setup and turnaround edited by SPM-93-TC07" },
] as const;
const VENUE_FIELDS = { building: "Orchard Hub", floor: "L2", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00", isActive: true };
const LAYOUTS = [
  { layoutName: "theatre", capacity: 60 },
  { layoutName: "classroom", capacity: 40 },
];
/** SPM93 Studio's one unavailable period (SPM-93-TC12, TC16). */
const MAINTENANCE = { venueCode: "SPM93-STU", date: "2027-06-16", from: "14:00", to: "18:00", reason: "maintenance", notes: "SPM-93 fixture: lighting rig repair" };

type Fixture = {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD, Singapore
  from: string; // HH:MM
  to: string;
  sessions?: { label: string; date: string; from: string; to: string }[];
  /** A booking for the event's own times. */
  booking?: { venueCode: string; status: "approved" | "pending" };
  testCases: string;
};

/** Every event is Planning, 30 attendees, theatre, and Daniel Tan's. */
const FIXTURES: Fixture[] = [
  { key: "spm93_masterclass", title: "SPM93 Morning Masterclass", date: "2027-06-08", from: "10:00", to: "12:00",
    booking: { venueCode: "SPM93-STU", status: "approved" }, testCases: "TC09 TC10 TC15 TC17 (in use 09:30-12:45)" },
  { key: "spm93_quick_demo", title: "SPM93 Quick Demo", date: "2027-06-08", from: "10:00", to: "12:00",
    booking: { venueCode: "SPM93-QCK", status: "approved" }, testCases: "TC08 TC16" },
  { key: "spm93_early_huddle", title: "SPM93 Early Huddle", date: "2027-06-08", from: "08:15", to: "08:45", testCases: "TC09" },
  { key: "spm93_afternoon_review", title: "SPM93 Afternoon Review", date: "2027-06-08", from: "13:15", to: "14:00", testCases: "TC10" },
  { key: "spm93_follow_on", title: "SPM93 Follow-on Session", date: "2027-06-08", from: "12:00", to: "13:00", testCases: "TC08" },
  { key: "spm93_product_clinic", title: "SPM93 Product Clinic", date: "2027-06-09", from: "14:10", to: "15:50", testCases: "TC01" },
  { key: "spm93_partner_lunch", title: "SPM93 Partner Lunch", date: "2027-06-10", from: "12:00", to: "13:00",
    booking: { venueCode: "SPM93-STU", status: "pending" }, testCases: "TC11 TC13 TC15 (held 11:30-13:45)" },
  { key: "spm93_team_sync", title: "SPM93 Team Sync", date: "2027-06-10", from: "14:15", to: "15:00", testCases: "TC11" },
  { key: "spm93_validation", title: "SPM93 Validation Workshop", date: "2027-06-11", from: "10:00", to: "12:00", testCases: "TC03 TC04" },
  { key: "spm93_breakfast", title: "SPM93 Breakfast Briefing", date: "2027-06-13", from: "07:30", to: "09:00", testCases: "TC06" },
  { key: "spm93_evening_forum", title: "SPM93 Evening Forum", date: "2027-06-13", from: "20:00", to: "21:15", testCases: "TC06" },
  { key: "spm93_lunch_and_learn", title: "SPM93 Lunch and Learn", date: "2027-06-14", from: "12:00", to: "13:00", testCases: "TC05" },
  { key: "spm93_sunset_talk", title: "SPM93 Sunset Talk", date: "2027-06-14", from: "18:00", to: "19:00", testCases: "TC05" },
  { key: "spm93_supplier_day", title: "SPM93 Supplier Day", date: "2027-06-15", from: "10:00", to: "12:00",
    booking: { venueCode: "SPM93-STU", status: "pending" }, testCases: "TC14" },
  { key: "spm93_vendor_qa", title: "SPM93 Vendor Q&A", date: "2027-06-15", from: "13:00", to: "14:00",
    booking: { venueCode: "SPM93-STU", status: "pending" }, testCases: "TC14" },
  { key: "spm93_buyer_briefing", title: "SPM93 Buyer Briefing", date: "2027-06-15", from: "13:15", to: "14:00",
    booking: { venueCode: "SPM93-STU", status: "pending" }, testCases: "TC14" },
  { key: "spm93_twilight_workshop", title: "SPM93 Twilight Workshop", date: "2027-06-16", from: "18:30", to: "20:00", testCases: "TC12" },
  { key: "spm93_two_day_forum", title: "SPM93 Two-Day Forum", date: "2027-06-17", from: "09:05", to: "17:30",
    sessions: [
      { label: "Day 1", date: "2027-06-17", from: "09:05", to: "11:50" },
      { label: "Day 2", date: "2027-06-18", from: "14:00", to: "17:30" },
    ],
    testCases: "TC02" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-93 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  console.log(`Removed ${removed.count} existing SPM-93 fixture event(s).`);

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
        purpose: "SPM-93 venue booking in 15-minute units test event",
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
        venueBookings: f.booking && {
          create: {
            venueId: venueIds.get(f.booking.venueCode)!,
            layoutName: "theatre",
            startsAt,
            endsAt,
            status: f.booking.status,
            requestedBy: coordinator,
            requestedAt: addDays(now, -3),
            decidedBy: f.booking.status === "approved" ? venueStaff : undefined,
            decidedAt: f.booking.status === "approved" ? addDays(now, -2) : undefined,
          },
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(28)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-93 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
