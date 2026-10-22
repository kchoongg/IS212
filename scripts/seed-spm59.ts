/**
 * SPM-59 (Record Request Withdrawal) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm59
 *
 * Deletes and recreates only the events whose seedKey starts with "spm59_"
 * (their status history goes with them, onDelete: Cascade). Nothing else
 * changes. Event numbers are not pinned: the cases find each event by its title.
 *
 * Every event is organised by Rachel Ng (Meridian Financial Group). Those past
 * Submitted are assigned to Daniel Tan; SPM59 Submitted Briefing waits for the
 * Ops Manager to assign one, and SPM59 Draft Offsite was never submitted. One of
 * each status a request can have before planning starts, so the withdrawn one
 * can be compared with the others (AC3).
 *
 * Run it before SPM-59-TC01, and after SPM-59-TC02
 * (docs/test-cases/SPM-59_Test_Cases.xlsx). prisma/seed.ts creates the same
 * events - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const KEY_PREFIX = "spm59_";
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  rejected: "Budget for the gala was not confirmed.",
  withdrawn: "Organiser asked to withdraw the request",
};

type Fixture = {
  key: string;
  title: string;
  status: string;
  chain: string[];
  date: string;
  assigned: boolean;
  rejectionReason?: string;
  testCases: string;
};

const FIXTURES: Fixture[] = [
  { key: "spm59_strategy_day", title: "SPM59 Harbour Strategy Day", status: "under_review", chain: ["submitted", "under_review"],
    date: "2027-06-07", assigned: true, testCases: "TC01 TC02 TC04" },
  { key: "spm59_withdrawn", title: "SPM59 Withdrawn Product Launch", status: "withdrawn", chain: ["submitted", "under_review", "withdrawn"],
    date: "2027-06-14", assigned: true, testCases: "TC03 TC05 TC06" },
  { key: "spm59_draft", title: "SPM59 Draft Offsite", status: "draft", chain: [],
    date: "2027-06-21", assigned: false, testCases: "TC05" },
  { key: "spm59_submitted", title: "SPM59 Submitted Briefing", status: "submitted", chain: ["submitted"],
    date: "2027-06-28", assigned: false, testCases: "TC03 TC05" },
  { key: "spm59_approved", title: "SPM59 Approved Seminar", status: "approved", chain: ["submitted", "under_review", "approved"],
    date: "2027-07-05", assigned: true, testCases: "TC03 TC05" },
  { key: "spm59_rejected", title: "SPM59 Rejected Gala", status: "rejected", chain: ["submitted", "under_review", "rejected"],
    date: "2027-07-12", assigned: true, rejectionReason: "Budget for the gala was not confirmed.", testCases: "TC03 TC05" },
];

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-59 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const coordinator = await find("daniel.tan@connectsphere.com");
  const opsManager = await find("grace.lim@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-59 fixture event(s).`);

  const historyStart = new Date("2026-09-21T02:00:00.000Z");
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, 9);
    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-59 record request withdrawal test event",
        description: "A request for Meridian's client team.",
        category: "seminar",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: f.assigned ? coordinator : null,
        status: f.status,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        expectedAttendance: 60,
        preferredLayout: "theatre",
        submittedAt: f.status === "draft" ? undefined : historyStart,
        rejectionReason: f.rejectionReason,
        statusHistory: {
          create: f.chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : f.chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 2),
            reason: REASONS[to],
          })),
        },
      },
      select: { sequenceNumber: true },
    });
    console.log(`  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(32)} ${f.status.padEnd(13)} ${f.testCases}`);
  }
  console.log(`Done: ${FIXTURES.length} SPM-59 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
