/**
 * SPM-51 (Register for Event) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm51
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm51_": it deletes them (their status history
 * and registrations go with them - every child relation of Event is
 * onDelete: Cascade) and recreates them in their starting state. Nothing else
 * in the database is changed, so it is safe to run while others are testing
 * other stories.
 *
 * Registering for an event is exactly what the test cases do, so run it again
 * to put the events back (docs/test-cases/SPM-51_Test_Cases.xlsx says which
 * cases need it).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares. The "open" events'
 * registration runs from 1 Sept 2026 to 31 Dec 2027, so the cases hold until
 * then.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles, dates and
 * organiser) but not their exact registration settings or registrations -
 * run this once after a full reseed, as for SPM-62 and SPM-64.
 *
 * Needs the base seed's users to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm51_";

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

/** Registration opens 1 Sept 2026, 09:00 and closes 31 Dec 2027, 17:00. */
const OPEN_PERIOD = { opens: ["2026-09-01", 9], closes: ["2027-12-31", 17] } as const;

type Fixture = {
  key: string;
  title: string;
  status: string;
  date: string; // YYYY-MM-DD, Singapore; every event runs 09:00-17:00
  registration: {
    enabled: boolean;
    capacity?: number;
    opens?: readonly [date: string, hour: number];
    closes?: readonly [date: string, hour: number];
  };
  /** Attendees by email, with their registration status. */
  registrations?: [email: string, status: string][];
  testCases: string; // which SPM-51 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's and Evelyn Chen's, as for SPM-64. */
const COORDINATOR = "daniel.tan@connectsphere.com";
const ORGANISER = "Evelyn Chen";

const FIXTURES: Fixture[] = [
  { key: "spm51_harbour", title: "SPM51 Harbour Open House", status: "confirmed", date: "2028-01-15",
    registration: { enabled: true, capacity: 50, ...OPEN_PERIOD },
    testCases: "TC01-TC03 TC12" },
  // 3 seats: 2 taken, and a withdrawn attendee who doesn't hold one. TC04 takes the last.
  { key: "spm51_lastseat", title: "SPM51 Last Seat Masterclass", status: "confirmed", date: "2028-01-22",
    registration: { enabled: true, capacity: 3, ...OPEN_PERIOD },
    registrations: [
      ["jocelyn.pang@example.com", "registered"],
      ["ravi.subramaniam@example.com", "registered"],
      ["bryan.chua@example.com", "withdrawn"],
    ],
    testCases: "TC01 TC04 TC05 TC11" },
  { key: "spm51_soldout", title: "SPM51 Sold Out Summit", status: "confirmed", date: "2028-01-29",
    registration: { enabled: true, capacity: 3, ...OPEN_PERIOD },
    registrations: [
      ["kavitha.menon@example.com", "registered"],
      ["daniel.lim@example.com", "registered"],
      ["amirah.rashid@example.com", "registered"],
      ["jocelyn.pang@example.com", "waitlisted"],
      ["wong.kai.xin@example.com", "withdrawn"],
    ],
    testCases: "TC01 TC11" },
  { key: "spm51_earlybird", title: "SPM51 Early Bird Seminar", status: "confirmed", date: "2028-01-20",
    registration: { enabled: true, capacity: 50, opens: ["2027-11-01", 9], closes: ["2027-12-31", 17] },
    testCases: "TC01 TC06" },
  { key: "spm51_closed", title: "SPM51 Closed Doors Workshop", status: "confirmed", date: "2027-12-10",
    registration: { enabled: true, capacity: 50, opens: ["2026-08-01", 9], closes: ["2026-09-30", 17] },
    testCases: "TC01 TC07" },
  { key: "spm51_undated", title: "SPM51 Undated Talk", status: "confirmed", date: "2028-02-05",
    registration: { enabled: true, capacity: 50 },
    testCases: "TC01 TC08" },
  { key: "spm51_private", title: "SPM51 Private Board Dinner", status: "confirmed", date: "2028-02-12",
    registration: { enabled: false },
    testCases: "TC01 TC10" },
  { key: "spm51_planning", title: "SPM51 Planning Stage Forum", status: "planning", date: "2028-02-19",
    registration: { enabled: true, capacity: 50, ...OPEN_PERIOD },
    testCases: "TC01 TC09" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-51 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const coordinator = await find(COORDINATOR);
  const organiser = await prisma.user.findFirst({
    where: { fullName: ORGANISER, role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error(`Organiser "${ORGANISER}" not found - run the base seed once first.`);
  const attendees = new Map<string, string>();
  for (const [email] of FIXTURES.flatMap((f) => f.registrations ?? [])) {
    if (!attendees.has(email)) attendees.set(email, await find(email));
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-51 fixture event(s).`);

  const now = new Date();
  for (const f of FIXTURES) {
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past.
    const historyStart = addDays(now, -(chain.length * 5 + 2));
    const reg = f.registration;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-51 register for event test event",
        category: "seminar",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt: sgt(f.date, 9),
        endsAt: sgt(f.date, 17),
        expectedAttendance: reg.capacity ?? 30,
        preferredLayout: "classroom",
        registrationEnabled: reg.enabled,
        registrationCapacity: reg.capacity,
        registrationOpensAt: reg.opens && sgt(...reg.opens),
        registrationClosesAt: reg.closes && sgt(...reg.closes),
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, 20) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        registrations: f.registrations && {
          create: f.registrations.map(([email, status], i) => {
            const registeredAt = addDays(historyStart, 21 + (i % 3));
            return {
              attendeeId: attendees.get(email)!,
              status,
              registeredAt,
              withdrawnAt: status === "withdrawn" ? addDays(registeredAt, 2) : undefined,
            };
          }),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(32)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-51 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
