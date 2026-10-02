/**
 * SPM-44 (Booking Conflict Detection) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm44
 *
 * Only touches events whose seedKey starts with "spm44_" and the one venue
 * this story needs: it deletes them (their venue bookings and status history
 * go with them - every child relation of Event is onDelete: Cascade) and
 * recreates them in their starting state. It also recreates the one
 * unavailability period AC8 needs, which it recognises by its notes. Nothing
 * else in the database is read for writing or changed.
 *
 * Re-run before each pass through docs/test-cases/SPM-44_Test_Cases.xlsx, and
 * again after it: submitting a request is exactly what the cases do.
 *
 * Needs the base seed's users and venues to exist already. prisma/seed.ts
 * creates the same rows (same seed keys, titles, dates) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm44_";
const NOTE_PREFIX = "SPM44";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/**
 * A room with no setup or turnaround time, so a booking holds exactly the
 * slots it was asked for. Most conflict cases need that: at a venue with
 * preparation time, an AM request and a PM booking clash through setup, and
 * AC10 ("non-overlapping bookings are allowed") could never be shown.
 * The one case that DOES want preparation time uses Orchard Seminar Room.
 */
const PLAIN_ROOM = {
  code: "SPM44-PLN",
  name: "SPM44 Conflict Room",
  description: "SPM-44 test venue: no setup or turnaround, so slots are exact",
  building: "Orchard Hub",
  floor: "L2",
  maxCapacity: 60,
  opensAt: "07:00",
  closesAt: "24:00",
  setupMinutes: 0,
  teardownMinutes: 0,
};
const PLAIN_ROOM_LAYOUTS = [
  { layoutName: "classroom", capacity: 60 },
  { layoutName: "theatre", capacity: 60 },
];

const DANIEL = "daniel.tan@connectsphere.com";
const PRIYA = "priya.raj@connectsphere.com";

type Fixture = {
  key: string;
  title: string;
  coordinator: string;
  date: string;
  startHour: number;
  durationHours: number;
  attendance: number;
  layout: string;
  /// A booking this event already holds - the thing a later case collides with.
  booking?: { venueCode: string; status: "approved" | "pending" | "rejected" | "cancelled"; reason?: string };
  testCases: string;
};

/**
 * The holders come first in each pair, then the event whose request runs into
 * them. Dates are fixed (never "today + n") so a case can quote them.
 */
const FIXTURES: Fixture[] = [
  // AC3, AC5, AC9 - an approved booking blocks, and is named.
  { key: "spm44_holder_approved", title: "SPM44 Approved Holder", coordinator: PRIYA,
    date: "2027-04-05", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    booking: { venueCode: PLAIN_ROOM.code, status: "approved" }, testCases: "TC01 TC02" },
  { key: "spm44_clash_approved", title: "SPM44 Clash With Approved", coordinator: DANIEL,
    date: "2027-04-05", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    testCases: "TC01" },

  // AC2, AC10 - the same day, a different slot, at a room with no preparation
  // time: allowed.
  { key: "spm44_adjacent", title: "SPM44 Adjacent Slot", coordinator: DANIEL,
    date: "2027-04-05", startHour: 9, durationHours: 2, attendance: 30, layout: "classroom",
    testCases: "TC02" },

  // AC4, AC5 - one pending request already holds the slot.
  { key: "spm44_holder_pending", title: "SPM44 Pending Holder", coordinator: PRIYA,
    date: "2027-04-06", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    booking: { venueCode: PLAIN_ROOM.code, status: "pending" }, testCases: "TC03" },
  { key: "spm44_clash_pending", title: "SPM44 Clash With Pending", coordinator: DANIEL,
    date: "2027-04-06", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    testCases: "TC03" },

  // AC7 - a rejected booking holds nothing.
  { key: "spm44_holder_rejected", title: "SPM44 Rejected Holder", coordinator: PRIYA,
    date: "2027-04-07", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    booking: { venueCode: PLAIN_ROOM.code, status: "rejected", reason: "Room needed for internal works." },
    testCases: "TC04" },
  { key: "spm44_after_rejected", title: "SPM44 After Rejected", coordinator: DANIEL,
    date: "2027-04-07", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    testCases: "TC04" },

  // AC7 - the customer's "withdrawn" and "released" are both stored as cancelled.
  { key: "spm44_holder_cancelled", title: "SPM44 Cancelled Holder", coordinator: PRIYA,
    date: "2027-04-08", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    booking: { venueCode: PLAIN_ROOM.code, status: "cancelled", reason: "Released by the coordinator." },
    testCases: "TC05" },
  { key: "spm44_after_cancelled", title: "SPM44 After Cancelled", coordinator: DANIEL,
    date: "2027-04-08", startHour: 14, durationHours: 2, attendance: 30, layout: "classroom",
    testCases: "TC05" },

  // AC2's exception - at Orchard Seminar Room (setup 60, teardown 30) the PM
  // booking's setup takes the whole AM slot, so an AM request now clashes.
  { key: "spm44_setup_holder", title: "SPM44 Setup Holder", coordinator: PRIYA,
    date: "2027-04-09", startHour: 14, durationHours: 2, attendance: 40, layout: "theatre",
    booking: { venueCode: "ORC-SEM", status: "approved" }, testCases: "TC06" },
  { key: "spm44_setup_clash", title: "SPM44 Setup Clash", coordinator: DANIEL,
    date: "2027-04-09", startHour: 9, durationHours: 2, attendance: 40, layout: "theatre",
    testCases: "TC06" },

  // AC2/AC3 across midnight - a Night booking at a venue with turnaround takes
  // the NEXT day's AM (#123), so a request that morning clashes.
  { key: "spm44_midnight_holder", title: "SPM44 Midnight Holder", coordinator: PRIYA,
    date: "2027-04-12", startHour: 20, durationHours: 2, attendance: 40, layout: "theatre",
    booking: { venueCode: "ORC-SEM", status: "approved" }, testCases: "TC11" },
  { key: "spm44_midnight_clash", title: "SPM44 Midnight Clash", coordinator: DANIEL,
    date: "2027-04-13", startHour: 9, durationHours: 2, attendance: 40, layout: "theatre",
    testCases: "TC11" },

  // AC8 - the room is closed, not booked.
  { key: "spm44_blocked", title: "SPM44 Blocked Room", coordinator: DANIEL,
    date: "2027-04-20", startHour: 9, durationHours: 2, attendance: 30, layout: "classroom",
    testCases: "TC07" },
];

/// AC8's period: the room is out for two whole days.
const BLOCK = {
  from: "2027-04-20",
  to: "2027-04-22",
  reason: "maintenance",
  notes: `${NOTE_PREFIX} test block: air-handling unit replacement.`,
};

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-44 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const coordinators = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!coordinators.has(f.coordinator)) coordinators.set(f.coordinator, await find(f.coordinator));
  }

  // Reset: drop the previous run's fixtures. Cascades take their bookings,
  // including every request the test cases submitted.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-44 fixture event(s).`);

  const plain = await prisma.venue.upsert({
    where: { code: PLAIN_ROOM.code },
    create: PLAIN_ROOM,
    update: { ...PLAIN_ROOM, isActive: true },
  });
  for (const l of PLAIN_ROOM_LAYOUTS) {
    await prisma.venueLayout.upsert({
      where: { venueId_layoutName: { venueId: plain.id, layoutName: l.layoutName } },
      create: { venueId: plain.id, ...l },
      update: { capacity: l.capacity },
    });
  }
  console.log(`Venue ${PLAIN_ROOM.code} ready.`);

  // The unavailability period has no seedKey of its own, so it is recognised
  // by its notes - scoped tightly enough that nobody else's block matches.
  const clearedBlocks = await prisma.venueUnavailability.deleteMany({
    where: { venueId: plain.id, notes: { startsWith: NOTE_PREFIX } },
  });
  await prisma.venueUnavailability.create({
    data: {
      venueId: plain.id,
      startsAt: sgt(BLOCK.from, 0),
      endsAt: sgt(BLOCK.to, 0),
      reason: BLOCK.reason,
      notes: BLOCK.notes,
      createdBy: venueStaff,
    },
  });
  console.log(`Unavailability ${BLOCK.from} to ${BLOCK.to} ready (replaced ${clearedBlocks.count}).`);

  const venueIds = new Map<string, string>([[PLAIN_ROOM.code, plain.id]]);
  for (const f of FIXTURES) {
    const code = f.booking?.venueCode;
    if (!code || venueIds.has(code)) continue;
    const v = await prisma.venue.findUnique({ where: { code }, select: { id: true } });
    if (!v) throw new Error(`Venue ${code} not found - run the base seed once first.`);
    venueIds.set(code, v.id);
  }

  for (const f of FIXTURES) {
    const coordinatorId = coordinators.get(f.coordinator)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const historyStart = addDays(new Date(), -(CHAIN.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-44 booking conflict test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: "planning",
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        submittedAt: historyStart,
        statusHistory: {
          create: CHAIN.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : CHAIN[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        venueBookings: f.booking && {
          create: {
            venueId: venueIds.get(f.booking.venueCode)!,
            layoutName: f.layout,
            startsAt,
            endsAt,
            status: f.booking.status,
            requestedBy: coordinatorId,
            requestedAt: historyStart,
            ...(f.booking.status === "rejected" || f.booking.status === "cancelled"
              ? { decidedBy: venueStaff, decidedAt: addDays(historyStart, 2), decisionReason: f.booking.reason }
              : {}),
            ...(f.booking.status === "approved"
              ? { decidedBy: venueStaff, decidedAt: addDays(historyStart, 2) }
              : {}),
          },
        },
      },
      select: { sequenceNumber: true, title: true },
    });

    const held = f.booking ? `${f.booking.status} @ ${f.booking.venueCode}` : "";
    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(28)} ${f.date}  ${held.padEnd(22)} ${f.testCases}`
    );
  }

  console.log(`Done: ${FIXTURES.length} SPM-44 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
