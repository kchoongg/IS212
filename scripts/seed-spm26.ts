/**
 * SPM-26 (Respond to Clarification Request) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm26
 *
 * Touches only its own rows: the events whose seedKey starts with "spm26_"
 * (their status history and clarifications go with them - every child
 * relation of Event is onDelete: Cascade).
 *
 * Re-run before each pass through docs/test-cases/SPM-26_Test_Cases.xlsx,
 * before SPM-26-TC02 and after TC03, and before and after TC05 - TC02 and
 * TC05 resubmit the Advisory Briefing.
 *
 * Event numbers are not pinned: the cases find each event by its title. The
 * clarifications' dates are fixed, since SPM-26-TC01 and TC07 quote them.
 * Needs the base seed's users. prisma/seed.ts creates the same events (the
 * events only) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm26_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

type Fixture = {
  key: string;
  title: string;
  date: string;
  /// The clarification Daniel Tan opened on it; `answered` when the organiser already responded.
  clarification: { fields: string; message: string; requested: [string, number]; answered?: [string, number] };
  testCases: string;
};

const FIXTURES: Fixture[] = [
  {
    key: "spm26_briefing", title: "SPM26 Meridian Advisory Briefing", date: "2028-05-04", testCases: "TC01-TC06",
    clarification: {
      fields: "description,expectedAttendance",
      message: "How many advisers will attend, and is there a networking session after the briefing?",
      requested: ["2026-10-20", 10],
    },
  },
  {
    key: "spm26_answered", title: "SPM26 Meridian Answered Workshop", date: "2028-05-11", testCases: "TC07",
    clarification: {
      fields: "when",
      message: "Can the workshop start at 9am instead?",
      requested: ["2026-10-14", 11],
      answered: ["2026-10-16", 15],
    },
  },
];

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-26 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  console.log(`Removed ${removed.count} SPM-26 event(s).`);

  const submitted = sgt("2026-10-12", 14);
  const assigned = sgt("2026-10-13", 10);
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, 9);
    const c = f.clarification;
    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "Quarterly briefing for Meridian's wealth advisers",
        description: "Half-day session followed by networking.",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: "under_review",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        expectedAttendance: 80,
        preferredLayout: "theatre",
        submittedAt: submitted,
        statusHistory: {
          create: [
            { fromStatus: "draft", toStatus: "submitted", changedBy: organiser.id, changedAt: submitted, reason: "Submitted for review" },
            { fromStatus: "submitted", toStatus: "under_review", changedBy: opsManager, changedAt: assigned, reason: "Coordinator assigned" },
          ],
        },
        clarifications: {
          create: {
            requestedBy: coordinator,
            requestedAt: sgt(...c.requested),
            message: c.message,
            fields: c.fields,
            ...(c.answered ? { status: "answered", respondedAt: sgt(...c.answered) } : {}),
          },
        },
      },
      select: { sequenceNumber: true },
    });
    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(34)} ${c.answered ? "clarification answered" : "clarification open".padEnd(22)}  ${f.testCases}`);
  }
  console.log("Done. Organiser Rachel Ng, coordinator Daniel Tan, both Under review.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
