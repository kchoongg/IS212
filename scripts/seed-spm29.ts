/**
 * SPM-29 (Request Event Clarification) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm29
 *
 * Touches only its own rows: the events whose seedKey starts with "spm29_"
 * (their status history and clarifications go with them - every child
 * relation of Event is onDelete: Cascade).
 *
 * Re-run before each pass through docs/test-cases/SPM-29_Test_Cases.xlsx, and
 * before and after SPM-29-TC02, which sends a clarification request.
 *
 * Event numbers are not pinned: the cases find each event by its title. The
 * open clarification's date is fixed, since SPM-29-TC03 and TC04 quote it.
 * Needs the base seed's users. prisma/seed.ts creates the same events (the
 * events only) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm29_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

type Fixture = {
  key: string;
  title: string;
  date: string;
  /// The clarification Daniel Tan opened on it, if any.
  clarification?: { fields: string; message: string; requested: [string, number] };
  testCases: string;
};

const FIXTURES: Fixture[] = [
  { key: "spm29_summit", title: "SPM29 Meridian Clarity Summit", date: "2028-04-06", testCases: "TC01 TC02 TC03" },
  {
    key: "spm29_forum", title: "SPM29 Meridian Open Question Forum", date: "2028-04-13", testCases: "TC03 TC04 TC05",
    clarification: {
      fields: "purpose,when",
      message: "Is this a dinner or a conference? Which day do you need?",
      requested: ["2026-10-12", 10],
    },
  },
];

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-29 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  console.log(`Removed ${removed.count} SPM-29 event(s).`);

  const submitted = sgt("2026-10-08", 14);
  const assigned = sgt("2026-10-09", 10);
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, 9);
    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "Client update for Meridian's wealth advisory team",
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
        clarifications: f.clarification
          ? {
              create: {
                requestedBy: coordinator,
                requestedAt: sgt(...f.clarification.requested),
                message: f.clarification.message,
                fields: f.clarification.fields,
              },
            }
          : undefined,
      },
      select: { sequenceNumber: true },
    });
    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(36)} ${f.clarification ? "clarification open" : "no clarification".padEnd(18)}  ${f.testCases}`);
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
