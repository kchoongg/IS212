/**
 * SPM-54 (Begin Event Planning) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm54
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm54_": it deletes them (their status history,
 * venue bookings and equipment requirements go with them - every child
 * relation of Event is onDelete: Cascade) and recreates them in their
 * starting state. Nothing else in the database is changed, so it is safe to
 * run while others are testing other stories.
 *
 * Moving an event to Planning, by searching for, requesting a venue for or
 * recording equipment for one, is exactly what the test cases do to these events, so run it again
 * to put them back before the next tester runs the same case
 * (docs/test-cases/SPM-54_Test_Cases.xlsx says which cases need it).
 *
 * Needs the base seed's users and equipment catalogue (named below) to exist
 * already.
 *
 * SEQUENCE NUMBERS: each event is recreated at a FIXED reference,
 * EVT-000145 to EVT-000154 - the numbers a full `npx prisma db seed` gives
 * them (they are events 145-154 in its creation order, and it restarts the
 * sequence at 1). So a test case can quote the address, e.g.
 * /venues/search?event=EVT-000146, and it stays right across reloads and
 * reseeds. If an event is ever added to prisma/seed.ts BEFORE the SPM-54
 * block, these shift - update both this file and
 * docs/test-cases/SPM-54_test_cases.json.
 *
 * prisma/seed.ts creates the same 10 events (same seed keys, titles, dates,
 * coordinator and equipment), so a full reseed and this script agree - keep the two in
 * step. The one difference: this script dates the submission and status
 * history just before today; seed.ts dates it 40 days before the event, like
 * every other seeded event.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm54_";

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
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  category: string;
  purpose: string;
  attendance: number;
  layout: string;
  equipment?: [name: string, quantity: number][];
  rejectionReason?: string;
  /** Fixed reference number (EVT-000145 ...) - see SEQUENCE NUMBERS above. */
  seq: number;
  testCases: string; // which SPM-54 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's: the story is about the ASSIGNED coordinator. */
const COORDINATOR = "daniel.tan@connectsphere.com";

const FIXTURES: Fixture[] = [
  // Moved to Planning by TC01, then read by its organiser in TC02 - reset after TC02.
  { key: "spm54_begin", seq: 145, title: "SPM54 Straits Clinical Forum", status: "approved",
    organiser: "Evelyn Chen", date: "2027-08-04", startHour: 9, durationHours: 4,
    category: "seminar", purpose: "Share the 2027 clinical audit results",
    attendance: 120, layout: "theatre",
    testCases: "TC01 TC02" },

  // Stays Approved: these cases only look at it, or act as someone who is
  // not its coordinator.
  { key: "spm54_approved", seq: 146, title: "SPM54 Meridian Budget Briefing", status: "approved",
    organiser: "James Koh", date: "2027-08-05", startHour: 14, durationHours: 3,
    category: "meeting", purpose: "Brief department heads on the 2028 budget",
    attendance: 20, layout: "boardroom",
    testCases: "TC03 TC08 TC09 TC10" },

  // Not Approved - a venue search must leave each where it is.
  { key: "spm54_under_review", seq: 147, title: "SPM54 Harbourline Agents Seminar", status: "under_review",
    organiser: "Preeti Sharma", date: "2027-08-10", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Product update for insurance agents",
    attendance: 60, layout: "theatre",
    testCases: "TC11 TC12" },
  { key: "spm54_confirmed", seq: 148, title: "SPM54 Anchorpoint Fleet Briefing", status: "confirmed",
    organiser: "Melissa Yap", date: "2027-08-11", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Annual fleet safety briefing",
    attendance: 90, layout: "theatre",
    testCases: "TC13" },
  { key: "spm54_rejected", seq: 149, title: "SPM54 Nusantara Overnight Sprint", status: "rejected",
    organiser: "Budi Santoso", date: "2027-08-12", startHour: 20, durationHours: 24,
    category: "workshop", purpose: "Overnight product sprint",
    attendance: 70, layout: "exhibition",
    rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy.",
    testCases: "TC13" },

  // Already in Planning. TC14 requests a venue and records equipment for it -
  // reset afterwards.
  { key: "spm54_planning", seq: 150, title: "SPM54 Kirana Store Managers Workshop", status: "planning",
    organiser: "Faridah Aziz", date: "2027-08-18", startHour: 9, durationHours: 3,
    category: "workshop", purpose: "Store operations workshop",
    attendance: 40, layout: "classroom",
    testCases: "TC11 TC14" },

  // Moved to Planning by the first venue or equipment action - reset afterwards.
  { key: "spm54_begin_booking", seq: 151, title: "SPM54 Pearl Delta Supplier Briefing", status: "approved",
    organiser: "Samuel Ong", date: "2027-08-25", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Brief suppliers on the 2028 sourcing plan",
    attendance: 50, layout: "theatre",
    testCases: "TC04" },
  { key: "spm54_begin_equipment", seq: 152, title: "SPM54 Sundara Service Workshop", status: "approved",
    organiser: "Dewi Kartika", date: "2027-08-26", startHour: 14, durationHours: 3,
    category: "workshop", purpose: "Front-of-house service workshop",
    attendance: 30, layout: "classroom",
    testCases: "TC05" },
  // Has one equipment item the organiser requested, for TC06 to change.
  { key: "spm54_begin_save", seq: 153, title: "SPM54 Tanjong Legal Seminar", status: "approved",
    organiser: "Aaron Sim", date: "2027-08-27", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Client seminar on the 2027 employment law changes",
    attendance: 45, layout: "theatre",
    equipment: [["Handheld Wireless Mic", 2]],
    testCases: "TC06" },
  // Has one equipment item the organiser requested, for TC07 to remove.
  { key: "spm54_begin_remove", seq: 154, title: "SPM54 Civic Trust Teachers Briefing", status: "approved",
    organiser: "Grace Abdullah", date: "2027-08-31", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Briefing for teachers on the 2028 curriculum",
    attendance: 35, layout: "classroom",
    equipment: [["Handheld Wireless Mic", 1]],
    testCases: "TC07" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
  under_review: ["submitted", "under_review"],
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  rejected: ["submitted", "under_review", "rejected"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  rejected: "Overnight occupancy not licensed",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-54 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const opsManager = await prisma.user.findUnique({ where: { email: "grace.lim@connectsphere.com" } });
  if (!opsManager) throw new Error("Base seed user grace.lim@connectsphere.com not found - run the base seed once first.");

  const coordinator = await prisma.user.findUnique({ where: { email: COORDINATOR }, select: { id: true, role: true } });
  if (!coordinator || coordinator.role !== "coordinator") throw new Error(`Coordinator ${COORDINATOR} not found.`);

  const organisers = new Map<string, { id: string; organisationId: string | null }>();
  for (const f of FIXTURES) {
    if (organisers.has(f.organiser)) continue;
    const u = await prisma.user.findFirst({
      where: { fullName: f.organiser, role: "organiser" },
      select: { id: true, organisationId: true },
    });
    if (!u) throw new Error(`Organiser "${f.organiser}" not found - run the base seed once first.`);
    organisers.set(f.organiser, u);
  }
  const equipment = new Map<string, string>();
  for (const f of FIXTURES) {
    for (const [name] of f.equipment ?? []) {
      if (equipment.has(name)) continue;
      const row = await prisma.equipment.findFirst({ where: { name }, select: { id: true } });
      if (!row) throw new Error(`Equipment "${name}" not found - run the base seed once first.`);
      equipment.set(name, row.id);
    }
  }

  // Reset: drop the previous run's fixtures. Cascades take their children,
  // including the booking requests and equipment the cases added.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });

  // The fixed reference numbers must be free now that our own events are gone.
  // Anything else holding one is left alone - stop rather than renumber it.
  const taken = await prisma.event.findMany({
    where: { sequenceNumber: { in: FIXTURES.map((f) => f.seq) } },
    select: { sequenceNumber: true, title: true },
  });
  if (taken.length > 0) {
    throw new Error(
      "Reference number(s) needed by the SPM-54 fixtures are used by other events: " +
        taken.map((e) => `EVT-${String(e.sequenceNumber).padStart(6, "0")} "${e.title}"`).join(", ") +
        ". Nothing was recreated - ask whoever owns those events, or reseed."
    );
  }
  console.log(`Removed ${removed.count} existing SPM-54 fixture event(s).`);

  const now = new Date();
  for (const f of FIXTURES) {
    const organiser = organisers.get(f.organiser)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past.
    const historyStart = addDays(now, -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        sequenceNumber: f.seq,
        title: f.title,
        purpose: f.purpose,
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator.id,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, (chain.length - 1) * 5) : undefined,
        rejectionReason: f.rejectionReason,
        // "requested" never counts against stock (only reserved and
        // partially_fulfilled do), so this cannot change any other story's
        // equipment availability results.
        equipmentRequests: f.equipment
          ? {
              create: f.equipment.map(([name, quantity]) => ({
                equipmentId: equipment.get(name)!,
                quantityRequested: quantity,
                // Same window as prisma/seed.ts's equipment requests.
                startsAt: new Date(startsAt.getTime() - 3 * 3_600_000),
                endsAt: new Date(endsAt.getTime() + 2 * 3_600_000),
                status: "requested",
                // What the organiser asked for on the request form. On an
                // Approved event the coordinator cannot have recorded anything
                // yet - their first equipment action begins planning.
                requestedBy: organiser.id,
              })),
            }
          : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager.id : coordinator.id,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(38)} ${f.status.padEnd(12)} ${f.testCases}`);
  }

  // Explicit numbers don't move the Postgres sequence. Keep it at or past the
  // highest number in use, or a new event could later be handed EVT-000145.
  await prisma.$executeRawUnsafe(
    `SELECT setval('events_sequence_number_seq', GREATEST((SELECT MAX(sequence_number) FROM events), (SELECT last_value FROM events_sequence_number_seq)))`
  );

  console.log(`Done: ${FIXTURES.length} SPM-54 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
