/**
 * SPM-28 (Review Event Request) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm28
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm28_": it deletes them (their status history,
 * facility and equipment requirements and notifications go with them - every child relation of Event is onDelete: Cascade) and
 * recreates them in their starting state. Nothing else in the database is
 * changed, so it is safe to run while others are testing other stories.
 *
 * Approving or rejecting is exactly what the test cases do to these events,
 * so run it again to put them back before the next tester runs the same case
 * (docs/test-cases/SPM-28_Test_Cases.xlsx says which cases need it).
 *
 * Needs the base seed's users, facilities and equipment catalogue (named
 * below) to exist already.
 *
 * SEQUENCE NUMBERS: each event is recreated at a FIXED reference,
 * EVT-000124 to EVT-000130 - the numbers a full `npx prisma db seed` gives
 * them (they are events 124-130 in its creation order, and it restarts the
 * sequence at 1). So a test case can quote the address, e.g.
 * /events/EVT-000124/review, and it stays right across reloads and reseeds.
 * If an event is ever added to prisma/seed.ts BEFORE the SPM-28 block, these
 * shift - update both this file and docs/test-cases/SPM-28_test_cases.json.
 *
 * prisma/seed.ts creates the same 7 events (same seed keys, titles, dates,
 * coordinators, facilities and equipment), so a full reseed
 * and this script agree - keep the two in step. The one difference: this
 * script dates the submission and status history just before today, so the
 * Review Queue's "Waiting" column reads sensibly; seed.ts dates it 40 days
 * before the event, like every other seeded event.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm28_";

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
  coordinator: string; // email of a seeded coordinator
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  category: string;
  purpose: string;
  description?: string;
  attendance: number;
  layout: string;
  accessibilityNotes?: string;
  specialRequirements?: string;
  facilities?: [name: string, mandatory: boolean][];
  equipment?: [name: string, quantity: number][];
  rejectionReason?: string;
  /** Fixed reference number (EVT-000124 ...) - see SEQUENCE NUMBERS above. */
  seq: number;
  testCases: string; // which SPM-28 cases use it - for whoever reads the output
};

const FIXTURES: Fixture[] = [
  // Daniel Tan's request to read, flag and practise the decision form on.
  // Only TC08's approval would change it, and that uses its own event below.
  { key: "spm28_launch", seq: 124, title: "SPM28 Nusantara Product Launch", status: "under_review",
    organiser: "Sari Widodo", coordinator: "daniel.tan@connectsphere.com",
    date: "2027-03-17", startHour: 15, durationHours: 4,
    category: "exhibition", purpose: "Regional product launch and press event",
    description: "Press event with livestream and product demonstration area.",
    attendance: 200, layout: "theatre",
    facilities: [["High-density WiFi", true], ["Raised stage", true], ["Livestream capability", true], ["Green room", false]],
    equipment: [["LED Video Wall Panel", 4], ["Streaming Encoder", 1]],
    testCases: "TC01 TC03 TC05 TC07 TC09 TC12 TC13 TC14" },

  // Approved by TC08 - reset afterwards.
  { key: "spm28_approve", seq: 125, title: "SPM28 Harbourline Client Seminar", status: "under_review",
    organiser: "Preeti Sharma", coordinator: "daniel.tan@connectsphere.com",
    date: "2027-03-24", startHour: 9, durationHours: 4,
    category: "seminar", purpose: "Client briefing on the 2027 policy changes",
    description: "Morning seminar with a Q&A panel.",
    attendance: 80, layout: "theatre",
    accessibilityNotes: "Step-free access to the room.", specialRequirements: "Reserved front row for panellists.",
    facilities: [["Built-in PA system", true], ["Fixed ceiling projector", true]],
    equipment: [["Handheld Wireless Mic", 2]],
    testCases: "TC08" },

  // Rejected by TC10, then read by the organiser in TC11 - reset after TC11.
  { key: "spm28_reject", seq: 126, title: "SPM28 Kirana Regional Offsite", status: "under_review",
    organiser: "Faridah Aziz", coordinator: "priya.raj@connectsphere.com",
    date: "2027-03-10", startHour: 9, durationHours: 8,
    category: "meeting", purpose: "Half-year strategy alignment",
    description: "Asked for a large room but has not confirmed headcount.",
    attendance: 45, layout: "u_shape",
    testCases: "TC01 TC10 TC11" },

  // Joel Fernandez's sparse request - most fields left empty (AC3).
  { key: "spm28_sparse", seq: 127, title: "SPM28 Straits Journal Club", status: "under_review",
    organiser: "Raj Kumar", coordinator: "joel.fernandez@connectsphere.com",
    date: "2027-02-25", startHour: 12, durationHours: 2,
    category: "seminar", purpose: "Monthly journal club",
    attendance: 30, layout: "boardroom",
    testCases: "TC01 TC06" },

  // Daniel's events that are past review - must not be in his queue.
  { key: "spm28_planning", seq: 128, title: "SPM28 Straits Research Symposium", status: "planning",
    organiser: "Evelyn Chen", coordinator: "daniel.tan@connectsphere.com",
    date: "2027-04-07", startHour: 9, durationHours: 9,
    category: "seminar", purpose: "Present findings from the 2026 cohort study",
    attendance: 200, layout: "theatre",
    testCases: "TC02" },
  { key: "spm28_approved", seq: 129, title: "SPM28 Meridian Wealth Forum", status: "approved",
    organiser: "James Koh", coordinator: "daniel.tan@connectsphere.com",
    date: "2027-04-14", startHour: 13, durationHours: 5,
    category: "conference", purpose: "Client-facing forum on the 2027 market outlook",
    attendance: 150, layout: "theatre",
    testCases: "TC02" },

  // Priya Raj's already-rejected request.
  { key: "spm28_rejected", seq: 130, title: "SPM28 Overnight Hackathon", status: "rejected",
    organiser: "Budi Santoso", coordinator: "priya.raj@connectsphere.com",
    date: "2027-02-18", startHour: 20, durationHours: 24,
    category: "workshop", purpose: "24-hour continuous hackathon",
    attendance: 90, layout: "exhibition",
    rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy.",
    testCases: "TC15" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
  under_review: ["submitted", "under_review"],
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  rejected: ["submitted", "under_review", "rejected"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  rejected: "Overnight occupancy not licensed",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-28 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const opsManager = await prisma.user.findUnique({ where: { email: "grace.lim@connectsphere.com" } });
  if (!opsManager) throw new Error("Base seed user grace.lim@connectsphere.com not found - run the base seed once first.");

  const organisers = new Map<string, { id: string; organisationId: string | null }>();
  const coordinators = new Map<string, string>();
  const facilities = new Map<string, string>();
  const equipment = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!organisers.has(f.organiser)) {
      const u = await prisma.user.findFirst({
        where: { fullName: f.organiser, role: "organiser" },
        select: { id: true, organisationId: true },
      });
      if (!u) throw new Error(`Organiser "${f.organiser}" not found - run the base seed once first.`);
      organisers.set(f.organiser, u);
    }
    if (!coordinators.has(f.coordinator)) {
      const u = await prisma.user.findUnique({ where: { email: f.coordinator }, select: { id: true, role: true } });
      if (!u || u.role !== "coordinator") throw new Error(`Coordinator ${f.coordinator} not found.`);
      coordinators.set(f.coordinator, u.id);
    }
    for (const [name] of f.facilities ?? []) {
      if (facilities.has(name)) continue;
      const row = await prisma.facility.findFirst({ where: { name }, select: { id: true } });
      if (!row) throw new Error(`Facility "${name}" not found - run the base seed once first.`);
      facilities.set(name, row.id);
    }
    for (const [name] of f.equipment ?? []) {
      if (equipment.has(name)) continue;
      const row = await prisma.equipment.findFirst({ where: { name }, select: { id: true } });
      if (!row) throw new Error(`Equipment "${name}" not found - run the base seed once first.`);
      equipment.set(name, row.id);
    }
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });

  // The fixed reference numbers must be free now that our own events are gone.
  // Anything else holding one is left alone - stop rather than renumber it.
  const taken = await prisma.event.findMany({
    where: { sequenceNumber: { in: FIXTURES.map((f) => f.seq) } },
    select: { sequenceNumber: true, title: true },
  });
  if (taken.length > 0) {
    throw new Error(
      "Reference number(s) needed by the SPM-28 fixtures are used by other events: " +
        taken.map((e) => `EVT-${String(e.sequenceNumber).padStart(6, "0")} "${e.title}"`).join(", ") +
        ". Nothing was recreated - ask whoever owns those events, or reseed."
    );
  }
  console.log(`Removed ${removed.count} existing SPM-28 fixture event(s).`);

  const now = new Date();
  for (const f of FIXTURES) {
    const organiser = organisers.get(f.organiser)!;
    const coordinatorId = coordinators.get(f.coordinator)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past, so the queue's "Waiting"
    // column reads sensibly.
    const historyStart = addDays(now, -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        sequenceNumber: f.seq,
        title: f.title,
        purpose: f.purpose,
        description: f.description,
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        accessibilityNotes: f.accessibilityNotes,
        specialRequirements: f.specialRequirements,
        submittedAt: historyStart,
        rejectionReason: f.rejectionReason,
        facilityRequirements: f.facilities
          ? {
              create: f.facilities.map(([name, isMandatory]) => ({
                facilityId: facilities.get(name)!,
                isMandatory,
              })),
            }
          : undefined,
        // "requested" never counts against stock (only reserved and
        // partially_fulfilled do), so these cannot change any other story's
        // equipment availability results.
        equipmentRequests: f.equipment
          ? {
              create: f.equipment.map(([name, quantity]) => ({
                equipmentId: equipment.get(name)!,
                quantityRequested: quantity,
                // Same window and requester as prisma/seed.ts's equipment requests.
                startsAt: new Date(startsAt.getTime() - 3 * 3_600_000),
                endsAt: new Date(endsAt.getTime() + 2 * 3_600_000),
                status: "requested",
                requestedBy: coordinatorId,
              })),
            }
          : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager.id : coordinatorId,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(34)} ${f.status.padEnd(12)} ${f.coordinator.padEnd(32)} ${f.testCases}`);
  }

  // Explicit numbers don't move the Postgres sequence. Keep it at or past the
  // highest number in use, or a new event could later be handed EVT-000124.
  await prisma.$executeRawUnsafe(
    `SELECT setval('events_sequence_number_seq', GREATEST((SELECT MAX(sequence_number) FROM events), (SELECT last_value FROM events_sequence_number_seq)))`
  );

  console.log(`Done: ${FIXTURES.length} SPM-28 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
