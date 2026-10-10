/**
 * SPM-86 (Submit Event for Operational Safety Check) — QA fixtures, WITHOUT
 * reseeding.
 *
 *   npm run fixtures:spm86
 *
 * Only touches events whose seedKey starts with "spm86_": it deletes them
 * (their venue bookings, equipment requests, safety checks and history go with
 * them - every child relation of Event is onDelete: Cascade) and recreates
 * them in their starting state. Nothing else in the database is changed.
 *
 * Re-run before each pass through docs/test-cases/SPM-86_Test_Cases.xlsx, and
 * after any case that submits an event.
 *
 * Event numbers are not pinned: the cases find each event by its title.
 * Needs the base seed's users, venues and equipment to exist already.
 * prisma/seed.ts creates the same events (the events only - their bookings and
 * equipment are made here) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm86_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const DANIEL = "daniel.tan@connectsphere.com";
const PRIYA = "priya.raj@connectsphere.com";
const VENUE = "ORC-SEM";
/// The reason SPM-62 stores when an event's date or time changes.
const SCHEDULE_CHANGED = "event_schedule_changed";

type Booking = { status: "approved" | "pending"; flagged?: boolean };
type Equip = { name: string; status: "requested" | "reserved" | "partially_fulfilled"; flagged?: boolean };

type Fixture = {
  key: string;
  title: string;
  status: "approved" | "planning";
  coordinator: string;
  date: string;
  bookings?: Booking[];
  equipment?: Equip[];
  testCases: string;
};

const MIC = "Handheld Wireless Mic";

/** One event per state the submission rule can be in. */
const FIXTURES: Fixture[] = [
  // Everything held: submitted in TC01, then read by TC02-TC04.
  { key: "spm86_ready", title: "SPM86 Harbour Safety Ready", status: "planning", coordinator: DANIEL,
    date: "2027-07-19", bookings: [{ status: "approved" }], equipment: [{ name: MIC, status: "reserved" }],
    testCases: "TC01-TC04" },

  // Boundary: Technical Support reserved 1 of the 2 mics.
  { key: "spm86_partial", title: "SPM86 Partly Reserved Kit", status: "planning", coordinator: DANIEL,
    date: "2027-07-20", bookings: [{ status: "approved" }], equipment: [{ name: MIC, status: "partially_fulfilled" }],
    testCases: "TC05" },

  // Venue still pending, one item reserved and one not: the refusal names the
  // venue and the Audio Mixing Desk only.
  { key: "spm86_outstanding", title: "SPM86 Arrangements Outstanding", status: "planning", coordinator: DANIEL,
    date: "2027-07-21", bookings: [{ status: "pending" }],
    equipment: [{ name: MIC, status: "reserved" }, { name: "Audio Mixing Desk", status: "requested" }],
    testCases: "TC06" },

  // Approved booking, but flagged for review.
  { key: "spm86_flagged_venue", title: "SPM86 Flagged Venue Booking", status: "planning", coordinator: DANIEL,
    date: "2027-07-22", bookings: [{ status: "approved", flagged: true }], equipment: [{ name: MIC, status: "reserved" }],
    testCases: "TC07" },

  // Reserved equipment, but flagged for review.
  { key: "spm86_flagged_equipment", title: "SPM86 Flagged Equipment", status: "planning", coordinator: DANIEL,
    date: "2027-07-23", bookings: [{ status: "approved" }], equipment: [{ name: MIC, status: "reserved", flagged: true }],
    testCases: "TC08" },

  // Ready: submitted from two tabs.
  { key: "spm86_two_tabs", title: "SPM86 Two Tabs Submit", status: "planning", coordinator: DANIEL,
    date: "2027-07-26", bookings: [{ status: "approved" }], equipment: [{ name: MIC, status: "reserved" }],
    testCases: "TC09" },

  // Ready, but assigned to Priya: Daniel must not be offered the submission.
  { key: "spm86_other_coordinator", title: "SPM86 Another Coordinator", status: "planning", coordinator: PRIYA,
    date: "2027-07-27", bookings: [{ status: "approved" }], equipment: [{ name: MIC, status: "reserved" }],
    testCases: "TC10" },

  // Approved, planning not begun - so nothing is arranged yet.
  { key: "spm86_approved", title: "SPM86 Not Yet Planning", status: "approved", coordinator: DANIEL,
    date: "2027-07-28", testCases: "TC11" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-86 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  for (const f of FIXTURES) {
    if (!coordinators.has(f.coordinator)) coordinators.set(f.coordinator, await find(f.coordinator));
  }

  const venue = await prisma.venue.findUnique({ where: { code: VENUE }, select: { id: true } });
  if (!venue) throw new Error(`Venue ${VENUE} not found - run the base seed once first.`);

  const equipmentIds = new Map<string, string>();
  for (const f of FIXTURES) {
    for (const e of f.equipment ?? []) {
      if (equipmentIds.has(e.name)) continue;
      const item = await prisma.equipment.findFirst({ where: { name: e.name }, select: { id: true } });
      if (!item) throw new Error(`Equipment "${e.name}" not found - run the base seed once first.`);
      equipmentIds.set(e.name, item.id);
    }
  }

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-86 fixture event(s).`);

  for (const f of FIXTURES) {
    const coordinatorId = coordinators.get(f.coordinator)!;
    const startsAt = sgt(f.date, 9);
    const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000);
    const chain = CHAIN.slice(0, CHAIN.indexOf(f.status) + 1);
    const historyStart = addDays(new Date(), -(chain.length * 5 + 2));
    const flaggedAt = addDays(historyStart, 4);

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-86 submit for safety check test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 40,
        preferredLayout: "theatre",
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
      select: { id: true, sequenceNumber: true },
    });

    for (const b of f.bookings ?? []) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venue.id,
          layoutName: "theatre",
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinatorId,
          requestedAt: historyStart,
          ...(b.status === "approved" ? { decidedBy: venueStaff, decidedAt: addDays(historyStart, 2) } : {}),
          ...(b.flagged ? { needsReview: true, reviewReason: SCHEDULE_CHANGED, flaggedAt } : {}),
        },
      });
    }

    for (const e of f.equipment ?? []) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipmentIds.get(e.name)!,
          quantityRequested: 2,
          ...(e.status !== "requested"
            ? { quantityReserved: e.status === "reserved" ? 2 : 1, reviewedBy: techSupport, reviewedAt: addDays(historyStart, 3) }
            : {}),
          status: e.status,
          requestedBy: coordinatorId,
          requestedAt: historyStart,
          startsAt,
          endsAt,
          ...(e.flagged ? { needsReview: true, reviewReason: SCHEDULE_CHANGED, flaggedAt } : {}),
        },
      });
    }

    const held = [
      ...(f.bookings ?? []).map((b) => `${VENUE}:${b.status}${b.flagged ? "(flagged)" : ""}`),
      ...(f.equipment ?? []).map((e) => `${e.name.split(" ")[0]}:${e.status}${e.flagged ? "(flagged)" : ""}`),
    ].join(" ");
    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(32)} ${f.status.padEnd(9)} ${held.padEnd(52)} ${f.testCases}`
    );
  }

  console.log(`Done: ${FIXTURES.length} SPM-86 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
