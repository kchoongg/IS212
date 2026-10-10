/**
 * SPM-33 (Track Outstanding Arrangements) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm33
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm33_": it deletes them (their status history,
 * sessions, venue bookings and equipment requests go with them - every child
 * relation of Event is onDelete: Cascade) and recreates them in their starting
 * state. Nothing else in the database is changed, so it is safe to run while
 * others are testing other stories.
 *
 * Marking an arrangement as not required, and confirming an event, is what
 * the test cases do to these events, so run it again to put them back
 * (docs/test-cases/SPM-33_Test_Cases.xlsx says which cases need it).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles, dates and
 * registration settings) but not their sessions, bookings or equipment - run
 * this once after a full reseed, as for SPM-34 and SPM-62.
 *
 * Needs the base seed's users, venues and equipment catalogue to exist, and
 * the migration 20261010100000_add_arrangement_not_required to be applied.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm33_";

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

const HOUR = 3_600_000;

const DANIEL = "daniel.tan@connectsphere.com";
const PRIYA = "priya.raj@connectsphere.com";

/** Why SPM-62 flags an arrangement when the event's date moves. */
const DATE_CHANGED = "event_schedule_changed";

type Booking = {
  venue: string; // venue code
  status: "approved" | "pending";
  session?: string;
  flagged?: boolean;
};
type Equip = {
  name: string;
  status: "requested" | "reserved" | "partially_fulfilled" | "unavailable";
  flagged?: boolean;
  /// Marked as not required by the event's coordinator, at this moment.
  notRequiredAt?: Date;
};

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "confirmed";
  coordinator: string;
  date: string; // YYYY-MM-DD, Singapore
  durationHours: number;
  /// Labels only; each session runs 3 hours from the event's start, a day apart.
  sessions?: string[];
  bookings?: Booking[];
  equipment?: Equip[];
  /// Registration switched on with an opening and closing date but no capacity.
  registrationWithoutCapacity?: boolean;
  testCases: string; // which SPM-33 cases use it - for whoever reads the output
};

/** Every event starts at 09:00, has 30 expected attendees, and is raised by Rachel Ng. */
const FIXTURES: Fixture[] = [
  // Read-only: two rooms and two equipment lines, one of each outstanding.
  { key: "spm33_two_room", title: "SPM33 Two Room Conference", status: "planning", coordinator: DANIEL,
    date: "2027-07-12", durationHours: 4,
    bookings: [{ venue: "MAR-AUD", status: "approved" }, { venue: "ORC-STU", status: "pending" }],
    equipment: [{ name: "Handheld Wireless Mic", status: "reserved" }, { name: "Audio Mixing Desk", status: "requested" }],
    testCases: "TC01 TC13 TC14" },

  // Nothing arranged at all, and registration off.
  { key: "spm33_nothing", title: "SPM33 Nothing Booked", status: "planning", coordinator: DANIEL,
    date: "2027-07-13", durationHours: 4,
    testCases: "TC02" },

  // Multi-session: Day 1 has its room, Day 2 does not.
  { key: "spm33_sessions", title: "SPM33 Two Day Forum", status: "planning", coordinator: DANIEL,
    date: "2027-07-14", durationHours: 27, sessions: ["Day 1", "Day 2"],
    bookings: [{ venue: "ORC-SEM", status: "approved", session: "Day 1" }],
    testCases: "TC03" },

  // Approved and reserved, but both flagged when the event's date moved (SPM-62).
  { key: "spm33_date_changed", title: "SPM33 Date Changed", status: "planning", coordinator: DANIEL,
    date: "2027-07-16", durationHours: 4,
    bookings: [{ venue: "ORC-SEM", status: "approved", flagged: true }],
    equipment: [{ name: "Handheld Wireless Mic", status: "reserved", flagged: true }],
    testCases: "TC04" },

  // TC05 marks the stage as not required; TC06 reverses it.
  { key: "spm33_stage", title: "SPM33 Stage Unavailable", status: "planning", coordinator: DANIEL,
    date: "2027-07-19", durationHours: 4,
    bookings: [{ venue: "ORC-GAL", status: "approved" }],
    equipment: [{ name: "Handheld Wireless Mic", status: "reserved" }, { name: "Portable Stage", status: "unavailable" }],
    testCases: "TC05 TC06" },

  // TC07 marks the pending room as not required; the approved one must not change.
  { key: "spm33_breakout", title: "SPM33 Breakout Not Needed", status: "planning", coordinator: DANIEL,
    date: "2027-07-20", durationHours: 4,
    bookings: [{ venue: "MAR-AUD", status: "approved" }, { venue: "ORC-STU", status: "pending" }],
    testCases: "TC07" },

  // TC08 marks its only room as not required: it still has no venue.
  { key: "spm33_single_pending", title: "SPM33 Single Pending Room", status: "planning", coordinator: DANIEL,
    date: "2027-07-21", durationHours: 4,
    bookings: [{ venue: "ORC-STU", status: "pending" }],
    testCases: "TC08" },

  // TC09: registration is on but has no capacity.
  { key: "spm33_registration", title: "SPM33 Registration Not Needed", status: "planning", coordinator: DANIEL,
    date: "2027-07-22", durationHours: 4, registrationWithoutCapacity: true,
    bookings: [{ venue: "ORC-GAL", status: "approved" }],
    testCases: "TC09" },

  // TC10: the desk is partly reserved (held); the stage cannot be provided.
  // Confirm is refused on the stage alone, then succeeds once it is waived.
  { key: "spm33_waive_confirm", title: "SPM33 Waive Then Confirm", status: "planning", coordinator: DANIEL,
    date: "2027-07-23", durationHours: 4,
    bookings: [{ venue: "ORC-GAL", status: "approved" }],
    equipment: [{ name: "Audio Mixing Desk", status: "partially_fulfilled" }, { name: "Portable Stage", status: "unavailable" }],
    testCases: "TC10" },

  // TC11: assigned to someone else, so Daniel can look but not mark.
  { key: "spm33_other_coordinator", title: "SPM33 Another Coordinator", status: "planning", coordinator: PRIYA,
    date: "2027-07-26", durationHours: 4,
    bookings: [{ venue: "ORC-STU", status: "pending" }],
    equipment: [{ name: "Portable Stage", status: "unavailable" }],
    testCases: "TC11" },

  // TC12: confirmed with a line waived beforehand. Read-only from here on.
  { key: "spm33_confirmed", title: "SPM33 Confirmed With Waiver", status: "confirmed", coordinator: DANIEL,
    date: "2027-07-27", durationHours: 4,
    bookings: [{ venue: "ORC-GAL", status: "approved" }],
    equipment: [{ name: "Portable Stage", status: "unavailable", notRequiredAt: sgt("2026-10-01", 10) }],
    testCases: "TC12" },
];

/** Same status chains and reasons as prisma/seed.ts. */
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
  console.log(`SPM-33 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const coordinators = new Map<string, string>();
  const venues = new Map<string, string>();
  const equipment = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!coordinators.has(f.coordinator)) coordinators.set(f.coordinator, await find(f.coordinator));
    for (const b of f.bookings ?? []) {
      if (venues.has(b.venue)) continue;
      const v = await prisma.venue.findUnique({ where: { code: b.venue }, select: { id: true } });
      if (!v) throw new Error(`Venue ${b.venue} not found - run the base seed once first.`);
      venues.set(b.venue, v.id);
    }
    for (const e of f.equipment ?? []) {
      if (equipment.has(e.name)) continue;
      const item = await prisma.equipment.findFirst({ where: { name: e.name }, select: { id: true } });
      if (!item) throw new Error(`Equipment "${e.name}" not found - run the base seed once first.`);
      equipment.set(e.name, item.id);
    }
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-33 fixture event(s).`);

  /// When a booking of this fixture runs: the session's three hours, or the event's own times.
  const times = (f: Fixture, session?: string) => {
    const eventStart = sgt(f.date, 9);
    if (!session) return { startsAt: eventStart, endsAt: new Date(eventStart.getTime() + f.durationHours * HOUR) };
    const startsAt = addDays(eventStart, f.sessions!.indexOf(session));
    return { startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR) };
  };

  // An approved booking blocks its room (SPM-44). Stop rather than double-book
  // a room someone else's fixtures already hold.
  for (const f of FIXTURES) {
    for (const b of (f.bookings ?? []).filter((x) => x.status === "approved")) {
      const { startsAt, endsAt } = times(f, b.session);
      const clash = await prisma.venueBooking.findFirst({
        where: { venueId: venues.get(b.venue)!, status: "approved", startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { event: { select: { title: true } } },
      });
      if (clash) {
        throw new Error(`${b.venue} is already booked by "${clash.event.title}" on ${f.date}. Nothing was recreated.`);
      }
    }
  }

  const now = new Date();
  for (const f of FIXTURES) {
    const coordinatorId = coordinators.get(f.coordinator)!;
    const { startsAt, endsAt } = times(f);
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past.
    const historyStart = addDays(now, -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-33 track outstanding arrangements test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 30,
        preferredLayout: "theatre",
        // Opens 30 days and closes 2 days before the event, as in seed.ts.
        registrationEnabled: f.registrationWithoutCapacity ?? false,
        registrationOpensAt: f.registrationWithoutCapacity ? addDays(startsAt, -30) : undefined,
        registrationClosesAt: f.registrationWithoutCapacity ? addDays(startsAt, -2) : undefined,
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, 20) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        sessions: f.sessions && {
          create: f.sessions.map((label) => ({
            label,
            ...times(f, label),
            expectedAttendance: 30,
            preferredLayout: "theatre",
          })),
        },
      },
      select: { id: true, sequenceNumber: true, sessions: { select: { id: true, label: true } } },
    });

    const sessionId = (label?: string) =>
      label ? (created.sessions.find((s) => s.label === label)?.id ?? null) : null;

    for (const b of f.bookings ?? []) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          sessionId: sessionId(b.session),
          venueId: venues.get(b.venue)!,
          layoutName: "theatre",
          ...times(f, b.session),
          status: b.status,
          requestedBy: coordinatorId,
          requestedAt: addDays(historyStart, 15),
          ...(b.status === "approved" ? { decidedBy: venueStaff, decidedAt: addDays(historyStart, 16) } : {}),
          ...(b.flagged ? { needsReview: true, reviewReason: DATE_CHANGED, flaggedAt: addDays(now, -1) } : {}),
        },
      });
    }

    for (const e of f.equipment ?? []) {
      const reviewed = e.status !== "requested";
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipment.get(e.name)!,
          quantityRequested: 2,
          quantityReserved: e.status === "reserved" ? 2 : e.status === "partially_fulfilled" ? 1 : undefined,
          // Two hours either side, as equipmentWindow() gives.
          startsAt: new Date(startsAt.getTime() - 2 * HOUR),
          endsAt: new Date(endsAt.getTime() + 2 * HOUR),
          status: e.status,
          requestedBy: coordinatorId,
          requestedAt: addDays(historyStart, 15),
          ...(reviewed ? { reviewedBy: techSupport, reviewedAt: addDays(historyStart, 17) } : {}),
          // Marking a line "Cannot be provided" needs a reason (SPM-50).
          ...(e.status === "unavailable" ? { staffNotes: "Every unit is committed elsewhere that week." } : {}),
          ...(e.flagged ? { needsReview: true, reviewReason: DATE_CHANGED, flaggedAt: addDays(now, -1) } : {}),
          ...(e.notRequiredAt
            ? { notRequired: true, notRequiredBy: coordinatorId, notRequiredAt: e.notRequiredAt }
            : {}),
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(30)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-33 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
