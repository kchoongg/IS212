/**
 * SPM-30 (Assign Event Coordinator) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm30
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm30_": it deletes them (their status history,
 * equipment requests, notifications etc. go with them - every child relation
 * of Event is onDelete: Cascade) and recreates them in their starting state.
 * Nothing else in the database is read for writing or changed.
 *
 * Safe to re-run, and meant to be: assigning a coordinator is exactly what
 * the test cases do to these events, so run it again to reset them before a
 * fresh pass through docs/test-cases/SPM-30_Test_Cases.xlsx.
 *
 * Also puts the two base-seed events that start in the Assignments queue back
 * to Submitted with no coordinator - needed after SPM-30-TC20, which assigns
 * everything in the queue to reach its empty state. Automatic when they were
 * only assigned; if another story moved one further, it is left alone unless
 * forced with:
 *
 *   npm run fixtures:spm30 -- --restore-queue
 *
 * See restoreQueue().
 *
 * Needs the base seed's users (grace.lim@connectsphere.com, the coordinators
 * and the organisers named below) to exist already.
 *
 * prisma/seed.ts creates the same 12 events (same seed keys, titles, dates and
 * coordinators), so a full reseed and this script agree - keep the two in
 * step. The one difference: this script dates the submission and status
 * history in the past, so the Assignments screen's "Waiting" column reads
 * sensibly; seed.ts dates it 40 days before the event, like every other
 * seeded event.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm30_";

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

type Fixture = {
  key: string;
  title: string;
  status: string;
  organiser: string; // full name of a seeded organiser
  coordinator?: string; // email of a seeded coordinator
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  category: string;
  purpose: string;
  attendance: number;
  layout: string;
  regCapacity?: number; // set => registration enabled
  rejectionReason?: string;
  cancellationReason?: string;
  testCases: string; // which SPM-30 cases use it - for whoever reads the output
};

const FIXTURES: Fixture[] = [
  // Awaiting assignment - submitted, no coordinator.
  { key: "spm30_unassigned_nusantara", title: "SPM30 Nusantara Developer Meetup", status: "submitted",
    organiser: "Budi Santoso", date: "2027-01-22", startHour: 9, durationHours: 6,
    category: "conference", purpose: "Community developer meetup", attendance: 120, layout: "theatre",
    testCases: "TC01 TC02 TC08 TC09 TC10" },
  { key: "spm30_unassigned_meridian", title: "SPM30 Meridian Graduate Evening", status: "submitted",
    organiser: "James Koh", date: "2027-02-09", startHour: 18, durationHours: 3,
    category: "networking", purpose: "Campus recruitment networking evening", attendance: 100, layout: "exhibition",
    testCases: "TC01 TC02 TC04 TC05 TC06 TC07" },

  // Must NOT appear on the Assignments page.
  { key: "spm30_draft", title: "SPM30 Draft Investor Update", status: "draft",
    organiser: "Rachel Ng", date: "2027-03-01", startHour: 9, durationHours: 2,
    category: "meeting", purpose: "Still checking dates", attendance: 20, layout: "boardroom",
    testCases: "TC01" },

  // Already assigned - reassignment.
  { key: "spm30_reassign_kirana", title: "SPM30 Kirana Regional Offsite", status: "under_review",
    organiser: "Faridah Aziz", coordinator: "priya.raj@connectsphere.com",
    date: "2027-02-15", startHour: 9, durationHours: 8,
    category: "meeting", purpose: "Half-year strategy alignment", attendance: 45, layout: "u_shape",
    testCases: "TC01 TC02 TC13 TC14" },
  { key: "spm30_same_coordinator", title: "SPM30 Straits Journal Club", status: "under_review",
    organiser: "Raj Kumar", coordinator: "joel.fernandez@connectsphere.com",
    date: "2027-01-28", startHour: 12, durationHours: 2,
    category: "seminar", purpose: "Monthly journal club", attendance: 30, layout: "boardroom",
    testCases: "TC18 TC19" },
  { key: "spm30_reassign_queue", title: "SPM30 Nusantara Product Launch", status: "under_review",
    organiser: "Sari Widodo", coordinator: "daniel.tan@connectsphere.com",
    date: "2027-03-03", startHour: 15, durationHours: 4,
    category: "exhibition", purpose: "Regional product launch", attendance: 200, layout: "theatre",
    testCases: "TC15" },
  { key: "spm30_confirmed", title: "SPM30 Anchorpoint Partner Briefing", status: "confirmed",
    organiser: "Melissa Yap", coordinator: "joel.fernandez@connectsphere.com",
    date: "2027-01-19", startHour: 9, durationHours: 4,
    category: "seminar", purpose: "Quarterly partner briefing", attendance: 90, layout: "theatre",
    testCases: "TC16" },
  { key: "spm30_postponed", title: "SPM30 Civic Trust Workshop", status: "postponed",
    organiser: "Grace Abdullah", coordinator: "arif.mansor@connectsphere.com",
    date: "2027-03-10", startHour: 9, durationHours: 5,
    category: "workshop", purpose: "Teachers' curriculum workshop", attendance: 40, layout: "classroom",
    testCases: "TC16" },

  // Closed statuses - cannot be reassigned.
  { key: "spm30_completed", title: "SPM30 Harbourline Claims Training", status: "completed",
    organiser: "Preeti Sharma", coordinator: "priya.raj@connectsphere.com",
    date: "2026-08-20", startHour: 9, durationHours: 4,
    category: "training", purpose: "Claims systems training", attendance: 35, layout: "classroom",
    testCases: "TC17" },
  { key: "spm30_cancelled", title: "SPM30 Pearl Delta Supplier Forum", status: "cancelled",
    organiser: "Samuel Ong", coordinator: "joel.fernandez@connectsphere.com",
    date: "2027-01-12", startHour: 9, durationHours: 5,
    category: "meeting", purpose: "Supplier engagement forum", attendance: 60, layout: "u_shape",
    cancellationReason: "Client cancelled after a change in the procurement schedule.",
    testCases: "TC17" },
  { key: "spm30_rejected", title: "SPM30 Selaras Overnight Field Day", status: "rejected",
    organiser: "Nurul Izzah", coordinator: "priya.raj@connectsphere.com",
    date: "2027-01-15", startHour: 20, durationHours: 24,
    category: "workshop", purpose: "Overnight field demonstration", attendance: 80, layout: "exhibition",
    rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy.",
    testCases: "TC17" },

  // Attendee view - confirmed with registration open.
  { key: "spm30_attendee_forum", title: "SPM30 Meridian Client Forum", status: "confirmed",
    organiser: "James Koh", coordinator: "daniel.tan@connectsphere.com",
    date: "2027-02-24", startHour: 13, durationHours: 5,
    category: "conference", purpose: "Client-facing market outlook forum", attendance: 150, layout: "theatre",
    regCapacity: 150,
    testCases: "TC11 TC12" },
];

/** Same status chains and reasons as prisma/seed.ts, plus postponed. */
const CHAIN: Record<string, string[]> = {
  draft: [],
  submitted: ["submitted"],
  under_review: ["submitted", "under_review"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
  rejected: ["submitted", "under_review", "rejected"],
  cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
  postponed: ["submitted", "under_review", "approved", "planning", "postponed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  completed: "Event took place",
  rejected: "Overnight occupancy not licensed",
  cancelled: "Client withdrew the request",
  postponed: "Client requested a later date",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-30 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded user first, so a missing one fails before any write.
  const opsManager = await prisma.user.findUnique({ where: { email: "grace.lim@connectsphere.com" } });
  if (!opsManager) throw new Error("Base seed user grace.lim@connectsphere.com not found - run the base seed once first.");

  const organisers = new Map<string, { id: string; organisationId: string | null }>();
  const coordinators = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!organisers.has(f.organiser)) {
      const u = await prisma.user.findFirst({
        where: { fullName: f.organiser, role: "organiser" },
        select: { id: true, organisationId: true },
      });
      if (!u) throw new Error(`Organiser "${f.organiser}" not found - run the base seed once first.`);
      organisers.set(f.organiser, u);
    }
    if (f.coordinator && !coordinators.has(f.coordinator)) {
      const u = await prisma.user.findUnique({ where: { email: f.coordinator }, select: { id: true, role: true } });
      if (!u || u.role !== "coordinator") throw new Error(`Coordinator ${f.coordinator} not found.`);
      coordinators.set(f.coordinator, u.id);
    }
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-30 fixture event(s).`);

  for (const f of FIXTURES) {
    const organiser = organisers.get(f.organiser)!;
    const coordinatorId = f.coordinator ? coordinators.get(f.coordinator)! : null;
    const isDraft = f.status === "draft";
    const startsAt = isDraft ? null : sgt(f.date, f.startHour);
    const endsAt = startsAt ? new Date(startsAt.getTime() + f.durationHours * 3_600_000) : null;
    const chain = CHAIN[f.status];
    // Status history runs 5 days a step and must end in the past, whatever the
    // event date: 40 days before the event, or earlier if that would still be
    // in the future. Also gives the Assignments screen a real "Waiting" figure.
    const now = new Date();
    const latestStart = addDays(now, -(chain.length * 5 + 2));
    const historyStart =
      startsAt && addDays(startsAt, -40) < latestStart ? addDays(startsAt, -40) : latestStart;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: f.purpose,
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        registrationEnabled: f.regCapacity !== undefined,
        registrationCapacity: f.regCapacity,
        registrationOpensAt: f.regCapacity !== undefined && startsAt ? addDays(startsAt, -30) : undefined,
        registrationClosesAt: f.regCapacity !== undefined && startsAt ? addDays(startsAt, -2) : undefined,
        submittedAt: isDraft ? undefined : historyStart,
        confirmedAt: ["confirmed", "completed"].includes(f.status) && startsAt ? addDays(startsAt, -12) : undefined,
        rejectionReason: f.rejectionReason,
        cancellationReason: f.cancellationReason,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id
              : to === "under_review" ? opsManager.id
              : coordinatorId ?? opsManager.id,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(
      `  ${ref}  ${f.title.padEnd(36)} ${f.status.padEnd(12)} ${(f.coordinator ?? "(no coordinator)").padEnd(34)} ${f.testCases}`
    );
  }

  console.log(`Done: ${FIXTURES.length} SPM-30 fixture events ready.`);

  await restoreQueue(process.argv.includes("--restore-queue"));
}

/// The base-seed events that start in the Assignments queue (prisma/seed.ts:
/// status submitted, no coordinator). SPM-30-TC20 has the tester assign them
/// to reach the empty queue; other stories' test cases expect them unassigned
/// (e.g. SPM-31 on "Meridian Graduate Recruitment Evening").
const QUEUE_SEED_KEYS = ["submitted", "submitted_recruit"];

/// Puts those events back as the base seed left them - Submitted, no
/// coordinator - removing only what assigning them added: status history
/// after submission and the coordinator assigned/unassigned notifications.
/// Nothing else about them is touched, and no other base-seed event is.
///
/// Runs on every `npm run fixtures:spm30`, but on its own only undoes a plain
/// SPM-30 assignment (Under review, nothing further). An event another story
/// has moved on - approved, planning and so on - is left alone with a warning,
/// since undoing that could break someone else's test run.
/// `-- --restore-queue` restores it anyway.
async function restoreQueue(force: boolean) {
  console.log(`\nBase-seed Assignments queue${force ? " (--restore-queue: forced)" : ""}:`);
  for (const seedKey of QUEUE_SEED_KEYS) {
    const event = await prisma.event.findUnique({
      where: { seedKey },
      select: {
        id: true, title: true, status: true, coordinatorId: true,
        statusHistory: { select: { toStatus: true } },
      },
    });
    if (!event) {
      console.log(`  ${seedKey}: not found - skipped (was the base seed changed?)`);
      continue;
    }
    if (event.status === "submitted" && event.coordinatorId === null) {
      console.log(`  ${event.title}: already Submitted with no coordinator`);
      continue;
    }
    const onlyAssigned =
      event.status === "under_review" &&
      event.statusHistory.every((h) => h.toStatus === "submitted" || h.toStatus === "under_review");
    if (!onlyAssigned && !force) {
      console.log(
        `  ${event.title}: NOT restored - it is ${event.status}, moved on past assignment ` +
          `(another story's testing?). Run \`npm run fixtures:spm30 -- --restore-queue\` to restore it anyway.`
      );
      continue;
    }
    await prisma.$transaction([
      prisma.event.update({
        where: { id: event.id },
        data: { status: "submitted", coordinatorId: null },
      }),
      // The base seed gives these events a single draft -> submitted row.
      prisma.eventStatusHistory.deleteMany({
        where: { eventId: event.id, toStatus: { not: "submitted" } },
      }),
      prisma.notification.deleteMany({
        where: { eventId: event.id, type: { in: ["coordinator_assigned", "coordinator_unassigned"] } },
      }),
    ]);
    console.log(`  ${event.title}: was ${event.status}, restored to Submitted with no coordinator`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
