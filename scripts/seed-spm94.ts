/**
 * SPM-94 (Limit Who Sees a Request's Review Outcome) — QA fixtures, WITHOUT
 * reseeding.
 *
 *   npm run fixtures:spm94
 *
 * Touches only its own rows: the events whose seedKey starts with "spm94_"
 * (their status history goes with them). All belong to Rachel Ng (Meridian
 * Financial Group), so James Koh is the "other organiser in the same client"
 * (AC4); Daniel Tan is the assigned coordinator and Priya Raj the unassigned
 * one (AC3).
 *
 * Re-run before each pass through docs/test-cases/SPM-94_Test_Cases.xlsx, and
 * after SPM-94-TC10, which approves the Approval Flow Briefing.
 *
 * Event numbers are not pinned: the cases find each event by its title. Needs
 * the base seed's users. prisma/seed.ts creates the same events - keep the two
 * in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm94_";
const REJECTION_REASON = "The requested ballroom is closed for renovation in November 2027.";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

type Status = "submitted" | "under_review" | "rejected" | "withdrawn" | "approved" | "confirmed";

type Fixture = {
  key: string;
  title: string;
  status: Status;
  date: string;
  testCases: string;
};

/// One event per status the story turns on. Only the Approval Flow Briefing
/// is changed by a case (TC10); every other one is read-only.
const FIXTURES: Fixture[] = [
  { key: "spm94_rejected", title: "SPM94 Meridian Rejected Gala", status: "rejected", date: "2027-11-03",
    testCases: "TC01-TC09" },
  { key: "spm94_submitted", title: "SPM94 Meridian Submitted Townhall", status: "submitted", date: "2027-11-04",
    testCases: "TC06-TC08" },
  { key: "spm94_under_review", title: "SPM94 Meridian Review Seminar", status: "under_review", date: "2027-11-05",
    testCases: "TC06-TC08" },
  { key: "spm94_withdrawn", title: "SPM94 Meridian Withdrawn Workshop", status: "withdrawn", date: "2027-11-08",
    testCases: "TC06-TC08" },
  { key: "spm94_approved", title: "SPM94 Meridian Approved Launch", status: "approved", date: "2027-11-09",
    testCases: "TC06-TC08" },
  { key: "spm94_confirmed", title: "SPM94 Meridian Open Forum", status: "confirmed", date: "2027-11-10",
    testCases: "TC06-TC09" },
  { key: "spm94_approval_flow", title: "SPM94 Meridian Approval Flow Briefing", status: "under_review", date: "2027-11-11",
    testCases: "TC10" },
];

const CHAIN: Record<Status, string[]> = {
  submitted: ["submitted"],
  under_review: ["submitted", "under_review"],
  rejected: ["submitted", "under_review", "rejected"],
  withdrawn: ["submitted", "under_review", "withdrawn"],
  approved: ["submitted", "under_review", "approved"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-94 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  console.log(`Removed ${removed.count} SPM-94 event(s).`);

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, 9);
    const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = addDays(startsAt, -40);
    const confirmed = f.status === "confirmed";

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-94 review outcome visibility test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        // Submitted means no coordinator yet - that is what separates it from Under review.
        coordinatorId: f.status === "submitted" ? null : coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 80,
        preferredLayout: "theatre",
        rejectionReason: f.status === "rejected" ? REJECTION_REASON : null,
        // The Open Forum is what an Attendee may see (AC7).
        registrationEnabled: confirmed,
        registrationCapacity: confirmed ? 100 : null,
        registrationOpensAt: confirmed ? addDays(startsAt, -30) : null,
        registrationClosesAt: confirmed ? addDays(startsAt, -2) : null,
        submittedAt: historyStart,
        confirmedAt: confirmed ? addDays(startsAt, -12) : null,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: to === "rejected" ? REJECTION_REASON : null,
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(40)} ${f.status.padEnd(13)} ${f.date}  ${f.testCases}`
    );
  }

  console.log(`Done: ${FIXTURES.length} SPM-94 events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
