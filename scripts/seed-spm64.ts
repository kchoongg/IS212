/**
 * SPM-64 (Configure Event Registration) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm64
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm64_": it deletes them (their status history,
 * venue bookings and registrations go with them - every child relation of
 * Event is onDelete: Cascade) and recreates them in their starting state.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Changing an event's registration settings, flagging its registrations or
 * confirming it is exactly what the test cases do to these events, so run it
 * again to put them back (docs/test-cases/SPM-64_Test_Cases.xlsx says which
 * cases need it).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles, dates and
 * organiser) but not their bookings, registrations or exact registration
 * settings - run this once after a full reseed, as for SPM-62.
 *
 * Needs the base seed's users and venues to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm64_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/** A fixed calendar date at a Singapore wall-clock hour (hours past 24 run into the next day). */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

type Booking = {
  venue: string; // Venue.code
  /** Null: booked with no layout, so its capacity is unknown (TC08). */
  layout: string | null;
  status: "approved" | "pending" | "rejected";
};

type Fixture = {
  key: string;
  title: string;
  status: string;
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  /** Hours past 24 run into the next day. */
  endHour: number;
  category: string;
  attendance: number;
  layout: string | null;
  bookings?: Booking[];
  registration?: {
    enabled: boolean;
    capacity?: number;
    /** Index into `bookings` of the one the capacity is measured against. */
    measured?: number;
    opens?: [date: string, hour: number];
    closes?: [date: string, hour: number];
  };
  /** Attendees by email, then how many more to register / waitlist / withdraw. */
  named?: [email: string, status: string][];
  registered?: number;
  waitlisted?: number;
  withdrawn?: number;
  testCases: string; // which SPM-64 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's (the story is about the ASSIGNED coordinator) and Evelyn Chen's. */
const COORDINATOR = "daniel.tan@connectsphere.com";
const ORGANISER = "Evelyn Chen";

const FIXTURES: Fixture[] = [
  // One approved booking: Orchard Seminar Room as a classroom (70; 120 as a theatre).
  { key: "spm64_orchard", title: "SPM64 Orchard Data Forum", status: "planning",
    date: "2027-03-18", startHour: 9, endHour: 17, category: "conference", attendance: 60, layout: "classroom",
    bookings: [{ venue: "ORC-SEM", layout: "classroom", status: "approved" }],
    testCases: "TC01 TC04-TC06 TC11-TC13" },
  // Two active bookings and a rejected one.
  { key: "spm64_twin", title: "SPM64 Twin Room Workshop", status: "planning",
    date: "2027-03-24", startHour: 9, endHour: 17, category: "workshop", attendance: 60, layout: "classroom",
    bookings: [
      { venue: "ORC-SEM", layout: "classroom", status: "approved" },
      { venue: "ORC-STU", layout: "classroom", status: "pending" },
      { venue: "MAR-GH", layout: "classroom", status: "rejected" },
    ],
    testCases: "TC09 TC10 TC23 TC24" },
  { key: "spm64_unbooked", title: "SPM64 Unbooked Strategy Day", status: "approved",
    date: "2027-03-31", startHour: 9, endHour: 17, category: "meeting", attendance: 30, layout: "classroom",
    testCases: "TC07" },
  { key: "spm64_layoutfree", title: "SPM64 Layout-Free Networking Night", status: "planning",
    date: "2027-04-07", startHour: 18, endHour: 22, category: "networking", attendance: 50, layout: null,
    bookings: [{ venue: "ORC-SEM", layout: null, status: "approved" }],
    testCases: "TC08" },
  // Confirmed; its registration period closed on 30 Sept 2026.
  { key: "spm64_closed", title: "SPM64 Closed Registration Seminar", status: "confirmed",
    date: "2027-03-10", startHour: 9, endHour: 17, category: "seminar", attendance: 50, layout: "classroom",
    bookings: [{ venue: "ORC-SEM", layout: "classroom", status: "approved" }],
    registration: { enabled: true, capacity: 50, measured: 0, opens: ["2026-08-01", 9], closes: ["2026-09-30", 17] },
    testCases: "TC02 TC14 TC23 TC24" },
  // Already started (1 Oct 2026, 09:00), still Confirmed.
  { key: "spm64_started", title: "SPM64 Started Showcase", status: "confirmed",
    date: "2026-10-01", startHour: 9, endHour: 24 + 17, category: "exhibition", attendance: 40, layout: "classroom",
    bookings: [{ venue: "ORC-STU", layout: "classroom", status: "approved" }],
    registration: { enabled: true, capacity: 40, measured: 0, opens: ["2026-09-01", 9], closes: ["2026-10-01", 9] },
    testCases: "TC15" },
  // 12 registered + 3 waitlisted hold a place; 2 withdrawn don't.
  { key: "spm64_fullhouse", title: "SPM64 Full House Masterclass", status: "planning",
    date: "2027-04-14", startHour: 9, endHour: 17, category: "training", attendance: 20, layout: "classroom",
    bookings: [{ venue: "ORC-SEM", layout: "classroom", status: "approved" }],
    registration: { enabled: true, capacity: 20, measured: 0, opens: ["2027-01-01", 9], closes: ["2027-04-13", 17] },
    registered: 12, waitlisted: 3, withdrawn: 2,
    testCases: "TC19 TC20" },
  { key: "spm64_waitlist", title: "SPM64 Waitlist Only Briefing", status: "planning",
    date: "2027-04-21", startHour: 9, endHour: 12, category: "seminar", attendance: 10, layout: "classroom",
    bookings: [{ venue: "ORC-STU", layout: "classroom", status: "approved" }],
    registration: { enabled: true, capacity: 10, measured: 0, opens: ["2027-01-01", 9], closes: ["2027-04-20", 17] },
    waitlisted: 4,
    testCases: "TC21" },
  // Everything else arranged; registration on with nothing set. TC16 confirms it.
  { key: "spm64_incomplete", title: "SPM64 Incomplete Setup Gala", status: "planning",
    date: "2027-04-28", startHour: 18, endHour: 22, category: "networking", attendance: 60, layout: "classroom",
    bookings: [{ venue: "ORC-SEM", layout: "classroom", status: "approved" }],
    registration: { enabled: true },
    testCases: "TC16 TC17" },
  // Measured against a booking that was then rejected; one active booking remains.
  { key: "spm64_lost", title: "SPM64 Lost Booking Expo", status: "planning",
    date: "2027-05-05", startHour: 9, endHour: 17, category: "exhibition", attendance: 40, layout: "classroom",
    bookings: [
      { venue: "ORC-STU", layout: "classroom", status: "approved" },
      { venue: "ORC-SEM", layout: "classroom", status: "rejected" },
    ],
    registration: { enabled: true, capacity: 40, measured: 1, opens: ["2027-02-01", 9], closes: ["2027-05-04", 17] },
    testCases: "TC18" },
  { key: "spm64_openday", title: "SPM64 Attendee Open Day", status: "confirmed",
    date: "2027-05-13", startHour: 9, endHour: 17, category: "seminar", attendance: 60, layout: "classroom",
    bookings: [{ venue: "ORC-SEM", layout: "classroom", status: "approved" }],
    registration: { enabled: true, capacity: 60, measured: 0, opens: ["2027-02-01", 9], closes: ["2027-05-12", 17] },
    named: [["lee.wei.ming@example.com", "registered"], ["anita.devi@example.com", "withdrawn"]],
    testCases: "TC22 TC25" },
  { key: "spm64_postponed", title: "SPM64 Postponed Product Talk", status: "postponed",
    date: "2027-05-19", startHour: 9, endHour: 12, category: "seminar", attendance: 30, layout: "classroom",
    testCases: "TC03" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  postponed: ["submitted", "under_review", "approved", "planning", "postponed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  postponed: "Client requested a later date",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-64 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const coordinator = await find(COORDINATOR);
  const organiser = await prisma.user.findFirst({
    where: { fullName: ORGANISER, role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error(`Organiser "${ORGANISER}" not found - run the base seed once first.`);

  const venues = new Map<string, string>();
  for (const code of new Set(FIXTURES.flatMap((f) => (f.bookings ?? []).map((b) => b.venue)))) {
    const v = await prisma.venue.findUnique({ where: { code }, select: { id: true } });
    if (!v) throw new Error(`Venue ${code} not found - run the base seed once first.`);
    venues.set(code, v.id);
  }

  const named = new Map<string, string>();
  for (const [email] of FIXTURES.flatMap((f) => f.named ?? [])) named.set(email, await find(email));
  // The rest are anonymous: the first attendees by email, skipping the named ones.
  const needed = Math.max(...FIXTURES.map((f) => (f.registered ?? 0) + (f.waitlisted ?? 0) + (f.withdrawn ?? 0)));
  const others = (
    await prisma.user.findMany({
      where: { role: "attendee", isActive: true, email: { notIn: [...named.keys()] } },
      orderBy: { email: "asc" },
      select: { id: true },
      take: needed,
    })
  ).map((a) => a.id);
  if (others.length < needed) throw new Error(`Only ${others.length} attendees found; ${needed} needed.`);

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-64 fixture event(s).`);

  // A pending or approved booking holds its room (SPM-44). Stop rather than
  // double-book a room someone else's fixtures already hold.
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = sgt(f.date, f.endHour);
    for (const b of (f.bookings ?? []).filter((x) => x.status !== "rejected")) {
      const clash = await prisma.venueBooking.findFirst({
        where: {
          venueId: venues.get(b.venue)!,
          status: { in: ["pending", "approved"] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { event: { select: { title: true } } },
      });
      if (clash) {
        throw new Error(`${b.venue} is already held by "${clash.event.title}" on ${f.date}. Nothing was recreated.`);
      }
    }
  }

  const now = new Date();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = sgt(f.date, f.endHour);
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past.
    const historyStart = addDays(now, -(chain.length * 5 + 2));
    const reg = f.registration;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-64 configure event registration test event",
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        registrationEnabled: reg?.enabled ?? false,
        registrationCapacity: reg?.capacity,
        registrationOpensAt: reg?.opens && sgt(...reg.opens),
        registrationClosesAt: reg?.closes && sgt(...reg.closes),
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, 20) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    // Bookings one at a time, so the measured one's id is known.
    const bookingIds: string[] = [];
    for (const b of f.bookings ?? []) {
      const decided = b.status !== "pending";
      const row = await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venues.get(b.venue)!,
          layoutName: b.layout,
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinator,
          requestedAt: addDays(historyStart, 15),
          decidedBy: decided ? venueStaff : undefined,
          decidedAt: decided ? addDays(historyStart, 16) : undefined,
          decisionReason: b.status === "rejected" ? "The room is being refitted that week." : undefined,
        },
        select: { id: true },
      });
      bookingIds.push(row.id);
    }
    if (reg?.measured !== undefined) {
      await prisma.event.update({
        where: { id: created.id },
        data: { registrationVenueBookingId: bookingIds[reg.measured] },
      });
    }

    const registrations: [attendeeId: string, status: string][] = [
      ...(f.named ?? []).map(([email, status]): [string, string] => [named.get(email)!, status]),
    ];
    let next = 0;
    for (const [count, status] of [
      [f.registered ?? 0, "registered"],
      [f.waitlisted ?? 0, "waitlisted"],
      [f.withdrawn ?? 0, "withdrawn"],
    ] as const) {
      for (let i = 0; i < count; i++) registrations.push([others[next++], status]);
    }
    for (const [i, [attendeeId, status]] of registrations.entries()) {
      const registeredAt = addDays(historyStart, 21 + (i % 3));
      await prisma.registration.create({
        data: {
          eventId: created.id,
          attendeeId,
          status,
          registeredAt,
          withdrawnAt: status === "withdrawn" ? addDays(registeredAt, 2) : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(36)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-64 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
