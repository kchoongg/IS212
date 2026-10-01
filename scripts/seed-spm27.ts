/**
 * SPM-27 (View Event Status) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm27
 *
 * Only touches events whose seedKey starts with "spm27_": it deletes them
 * (their status history and notifications go with them - every child
 * relation of Event is onDelete: Cascade) and recreates them in their
 * starting state. Nothing else in the database is changed.
 *
 * Re-run before each pass through docs/test-cases/SPM-27_Test_Cases.xlsx:
 * withdrawing and assigning are exactly what the cases do to these events.
 *
 * One event per status for one organiser, Hakim Zulkifli (Bayu Energy
 * Partners), coordinated by Hui Shan Neo from Under review onwards. Needs the
 * base seed's users to exist already. prisma/seed.ts creates the same events
 * (same seed keys, titles and dates) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm27_";

/** Same anchor as prisma/seed.ts, so dates match a fresh seed. */
const SEED_ANCHOR = "2026-09-26";
const SGT_OFFSET_HOURS = 8;

/** n days from the anchor, at a Singapore wall-clock hour. */
function day(n: number, hour = 9): Date {
  const [year, month, date] = SEED_ANCHOR.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + n, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const ORGANISER = "Hakim Zulkifli";
const COORDINATOR = "huishan.neo@connectsphere.com";

type Fixture = {
  key: string;
  title: string;
  status: string;
  /// Status history, oldest first. Withdrawn needs it: it can come from
  /// Submitted or Under review.
  chain: string[];
  days: number; // from SEED_ANCHOR
  startHour: number;
  durationHours: number;
  category: string;
  attendance: number;
  layout: string;
  rejectionReason?: string;
  cancellationReason?: string;
  testCases: string;
};

const TO_REVIEW = ["submitted", "under_review"];
const TO_PLANNING = [...TO_REVIEW, "approved", "planning"];

const SPM27_FIXTURES: Fixture[] = [
  { key: "spm27_safety_briefing", title: "SPM27 Bayu Safety Briefing", status: "submitted",
    chain: ["submitted"], days: 70, startHour: 9, durationHours: 3,
    category: "training", attendance: 40, layout: "classroom", testCases: "TC01 TC03 TC04" },
  { key: "spm27_grid_workshop", title: "SPM27 Bayu Grid Workshop", status: "under_review",
    chain: TO_REVIEW, days: 72, startHour: 9, durationHours: 6,
    category: "workshop", attendance: 30, layout: "u_shape", testCases: "TC01 TC04" },
  { key: "spm27_investor_day", title: "SPM27 Bayu Investor Day", status: "submitted",
    chain: ["submitted"], days: 74, startHour: 10, durationHours: 5,
    category: "conference", attendance: 120, layout: "theatre", testCases: "TC02" },
  { key: "spm27_town_hall", title: "SPM27 Bayu Town Hall", status: "submitted",
    chain: ["submitted"], days: 76, startHour: 15, durationHours: 2,
    category: "meeting", attendance: 150, layout: "theatre", testCases: "TC06 TC07" },
  { key: "spm27_contractor_briefing", title: "SPM27 Bayu Contractor Briefing", status: "under_review",
    chain: TO_REVIEW, days: 78, startHour: 9, durationHours: 3,
    category: "seminar", attendance: 50, layout: "theatre", testCases: "TC06" },
  { key: "spm27_supplier_day", title: "SPM27 Bayu Supplier Day", status: "approved",
    chain: [...TO_REVIEW, "approved"], days: 80, startHour: 9, durationHours: 7,
    category: "exhibition", attendance: 90, layout: "exhibition", testCases: "TC01 TC05" },
  { key: "spm27_leadership_retreat", title: "SPM27 Bayu Leadership Retreat", status: "planning",
    chain: TO_PLANNING, days: 82, startHour: 9, durationHours: 8,
    category: "meeting", attendance: 25, layout: "boardroom", testCases: "TC01 TC05" },
  { key: "spm27_annual_conference", title: "SPM27 Bayu Annual Conference", status: "confirmed",
    chain: [...TO_PLANNING, "confirmed"], days: 84, startHour: 9, durationHours: 9,
    category: "conference", attendance: 200, layout: "theatre", testCases: "TC01 TC05" },
  { key: "spm27_graduate_induction", title: "SPM27 Bayu Graduate Induction", status: "completed",
    chain: [...TO_PLANNING, "confirmed", "completed"], days: -20, startHour: 9, durationHours: 6,
    category: "training", attendance: 35, layout: "classroom", testCases: "TC01 TC05" },
  { key: "spm27_overnight_site_visit", title: "SPM27 Bayu Overnight Site Visit", status: "rejected",
    chain: [...TO_REVIEW, "rejected"], days: 86, startHour: 20, durationHours: 14,
    category: "workshop", attendance: 60, layout: "exhibition",
    rejectionReason: "No ConnectSphere venue is licensed for overnight occupancy.", testCases: "TC01 TC05" },
  { key: "spm27_community_fair", title: "SPM27 Bayu Community Fair", status: "postponed",
    chain: [...TO_PLANNING, "postponed"], days: 88, startHour: 10, durationHours: 6,
    category: "exhibition", attendance: 300, layout: "exhibition", testCases: "TC01 TC05" },
  { key: "spm27_partner_lunch", title: "SPM27 Bayu Partner Lunch", status: "withdrawn",
    chain: ["submitted", "withdrawn"], days: 90, startHour: 12, durationHours: 2,
    category: "networking", attendance: 40, layout: "banquet", testCases: "TC01 TC05 TC08" },
  { key: "spm27_wind_farm_tour", title: "SPM27 Bayu Wind Farm Tour", status: "withdrawn",
    chain: [...TO_REVIEW, "withdrawn"], days: 92, startHour: 9, durationHours: 4,
    category: "seminar", attendance: 30, layout: "theatre", testCases: "TC08" },
  { key: "spm27_product_showcase", title: "SPM27 Bayu Product Showcase", status: "cancelled",
    chain: [...TO_PLANNING, "cancelled"], days: 94, startHour: 14, durationHours: 4,
    category: "exhibition", attendance: 150, layout: "exhibition",
    cancellationReason: "Product launch moved to next financial year.", testCases: "TC01 TC05" },
];

const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  completed: "Event took place",
  rejected: "Overnight occupancy not licensed",
  cancelled: "Product launch moved",
  postponed: "Client requested a later date",
  withdrawn: "Organiser withdrew the request",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-27 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded user first, so a missing one fails before any write.
  const organiser = await prisma.user.findFirst({
    where: { fullName: ORGANISER, role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error(`Organiser "${ORGANISER}" not found - run the base seed once first.`);
  const coordinator = await prisma.user.findUnique({ where: { email: COORDINATOR }, select: { id: true, role: true } });
  if (!coordinator || coordinator.role !== "coordinator") throw new Error(`Coordinator ${COORDINATOR} not found.`);
  const opsManager = await prisma.user.findUnique({ where: { email: "grace.lim@connectsphere.com" } });
  if (!opsManager) throw new Error("Base seed user grace.lim@connectsphere.com not found - run the base seed once first.");

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-27 fixture event(s).`);

  for (const f of SPM27_FIXTURES) {
    const startsAt = day(f.days, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    // A coordinator once the event has been under review.
    const coordinatorId = f.chain.includes("under_review") ? coordinator.id : null;
    // History runs 5 days a step and must end in the past, whatever the event date.
    const historyStart = addDays(new Date(), -(f.chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-27 event status test event",
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        submittedAt: historyStart,
        confirmedAt: f.chain.includes("confirmed") ? addDays(historyStart, f.chain.indexOf("confirmed") * 5) : undefined,
        rejectionReason: f.rejectionReason,
        cancellationReason: f.cancellationReason,
        statusHistory: {
          create: f.chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : f.chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" || to === "withdrawn" ? organiser.id
              : to === "under_review" ? opsManager.id
              : coordinator.id,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(34)} ${f.status.padEnd(12)} ${f.testCases}`);
  }

  console.log(`Done: ${SPM27_FIXTURES.length} SPM-27 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
