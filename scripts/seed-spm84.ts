/**
 * SPM-84 (Event Coordinator Lead: Rename Role and View Assignments) — QA
 * fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm84
 *
 * Creates (or refreshes) four coordinator accounts of SPM-84's own and
 * recreates the story's events. The coordinators' counts on the Lead's
 * Coordinators tab are only ever checked for these accounts: other stories'
 * fixtures keep changing the base coordinators' events.
 *
 * Touches only its own rows: the four accounts below, and the events whose
 * seedKey starts with "spm84_" (their status history goes with them). Run it
 * before and after any case that assigns or reassigns
 * (docs/test-cases/SPM-84_Test_Cases.xlsx).
 *
 * Event numbers are not pinned: the cases find each event by its title.
 * prisma/seed.ts creates the same accounts and events - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm84_";
const DEMO_PASSWORD = "password123";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/// SPM-84's own coordinators. Dennis Ho's account is deactivated but still
/// holds an active event (the 'Account inactive' row).
const ACCOUNTS = {
  aisha: { email: "aisha.karim@connectsphere.com", fullName: "Aisha Karim", isActive: true },
  benjamin: { email: "benjamin.lau@connectsphere.com", fullName: "Benjamin Lau", isActive: true },
  clara: { email: "clara.tay@connectsphere.com", fullName: "Clara Tay", isActive: true },
  dennis: { email: "dennis.ho@connectsphere.com", fullName: "Dennis Ho", isActive: false },
} as const;
type Who = keyof typeof ACCOUNTS;

type Status =
  | "submitted" | "under_review" | "planning" | "confirmed" | "postponed"
  | "completed" | "cancelled" | "rejected" | "withdrawn";

/// How each status was reached, for the status history.
const CHAIN: Record<Status, string[]> = {
  submitted: ["submitted"],
  under_review: ["submitted", "under_review"],
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  postponed: ["submitted", "under_review", "approved", "planning", "postponed"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
  cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
  rejected: ["submitted", "under_review", "rejected"],
  withdrawn: ["submitted", "under_review", "withdrawn"],
};

type Fixture = { key: string; title: string; status: Status; coordinator: Who | null; date: string; testCases: string };

/// Aisha: three active, four not. Benjamin: one. Clara: none active.
/// Dennis (deactivated): one. And one request nobody has been assigned yet.
const FIXTURES: Fixture[] = [
  { key: "spm84_harbour_gala", title: "SPM84 Harbour Gala", status: "planning", coordinator: "aisha", date: "2027-11-09", testCases: "TC02-TC05 TC09" },
  { key: "spm84_orchard_forum", title: "SPM84 Orchard Forum", status: "under_review", coordinator: "aisha", date: "2027-11-11", testCases: "TC02 TC03 TC05" },
  { key: "spm84_postponed_retreat", title: "SPM84 Postponed Retreat", status: "postponed", coordinator: "aisha", date: "2027-11-16", testCases: "TC02 TC03" },
  { key: "spm84_closed_showcase", title: "SPM84 Closed Showcase", status: "completed", coordinator: "aisha", date: "2026-09-08", testCases: "TC02 TC03" },
  { key: "spm84_called_off_expo", title: "SPM84 Called Off Expo", status: "cancelled", coordinator: "aisha", date: "2027-11-18", testCases: "TC02 TC03" },
  { key: "spm84_rejected_request", title: "SPM84 Rejected Request", status: "rejected", coordinator: "aisha", date: "2027-11-23", testCases: "TC02 TC03" },
  { key: "spm84_withdrawn_request", title: "SPM84 Withdrawn Request", status: "withdrawn", coordinator: "aisha", date: "2027-11-25", testCases: "TC02 TC03" },
  { key: "spm84_riverside_launch", title: "SPM84 Riverside Launch", status: "confirmed", coordinator: "benjamin", date: "2027-11-30", testCases: "TC02 TC04 TC09" },
  { key: "spm84_past_seminar", title: "SPM84 Past Seminar", status: "completed", coordinator: "clara", date: "2026-09-10", testCases: "TC02 TC06 TC08" },
  { key: "spm84_inherited_workshop", title: "SPM84 Inherited Workshop", status: "planning", coordinator: "dennis", date: "2027-12-02", testCases: "TC02" },
  { key: "spm84_unassigned_request", title: "SPM84 Unassigned Request", status: "submitted", coordinator: null, date: "2027-12-07", testCases: "TC04 TC08" },
];

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-84 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const lead = await find("grace.lim@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // The four accounts, upserted so a rerun refreshes them in place.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {} as Record<Who, string>;
  for (const [who, account] of Object.entries(ACCOUNTS) as [Who, (typeof ACCOUNTS)[Who]][]) {
    const data = { ...account, role: "coordinator", department: "Event Management", passwordHash };
    const u = await prisma.user.upsert({ where: { email: account.email }, create: data, update: data, select: { id: true } });
    ids[who] = u.id;
  }
  console.log(`Accounts ready (password ${DEMO_PASSWORD}): ${Object.values(ACCOUNTS).map((a) => a.email).join(", ")}`);

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  // An event of another story reassigned to one of the four would change
  // their counts. Say so rather than touch another story's data.
  const stray = await prisma.event.count({ where: { coordinatorId: { in: Object.values(ids) } } });
  if (stray > 0) console.log(`Note: ${stray} other event(s) are assigned to the SPM-84 coordinators; their counts include them.`);
  console.log(`Removed ${removed.count} SPM-84 event(s).`);

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, 9);
    const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = sgt("2026-09-01", 9);
    const coordinatorId = f.coordinator ? ids[f.coordinator] : null;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-84 event coordinator lead test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 60,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        confirmedAt: ["confirmed", "completed"].includes(f.status) ? addDays(historyStart, 12) : null,
        rejectionReason: f.status === "rejected" ? "Overnight occupancy not licensed" : null,
        cancellationReason: f.status === "cancelled" ? "Client withdrew the request" : null,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? lead : (coordinatorId ?? lead),
            changedAt: addDays(historyStart, i * 3),
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(26)} ${f.status.padEnd(12)} ${(f.coordinator ?? "-").padEnd(9)} ${f.testCases}`
    );
  }

  console.log(`Done: 4 SPM-84 coordinators and ${FIXTURES.length} SPM-84 events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
