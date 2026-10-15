/**
 * SPM-52 (Withdraw from Event) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm52
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm52_": it deletes them (their status history
 * and registrations go with them - every child relation of Event is
 * onDelete: Cascade) and recreates them in their starting state. Nothing else
 * in the database is changed, so it is safe to run while others are testing
 * other stories.
 *
 * Withdrawing is exactly what the test cases do, so run it again to put the
 * registrations back (docs/test-cases/SPM-52_Test_Cases.xlsx says which cases
 * need it).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares. The open events'
 * registration runs from 1 Sept 2026 to 31 Dec 2027, so the cases hold until
 * then.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles, dates and
 * organiser) but not their exact registration settings or registrations -
 * run this once after a full reseed, as for SPM-51.
 *
 * Needs the base seed's users to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm52_";

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
  registrations: [email: string, status: string][];
  testCases: string; // which SPM-52 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's and Evelyn Chen's, as for SPM-51. */
const COORDINATOR = "daniel.tan@connectsphere.com";
const ORGANISER = "Evelyn Chen";

/** The attendee the cases log in as. */
const MARCUS = "marcus.yeo@example.com";

const FIXTURES: Fixture[] = [
  // 10 places: 4 taken (Marcus and three others), and one attendee who withdrew earlier.
  { key: "spm52_riverside", title: "SPM52 Riverside Forum", status: "confirmed", date: "2028-03-04",
    registration: { enabled: true, capacity: 10, ...OPEN_PERIOD },
    registrations: [
      [MARCUS, "registered"],
      ["anita.devi@example.com", "registered"],
      ["tom.harris@example.com", "registered"],
      ["farhan.ismail@example.com", "registered"],
      ["siti.nurhaliza@example.com", "withdrawn"],
    ],
    testCases: "TC01-TC04 TC06 TC09 TC10" },
  // 2 places, both taken: full until Marcus withdraws (TC05).
  { key: "spm52_lastplace", title: "SPM52 Last Place Clinic", status: "confirmed", date: "2028-03-11",
    registration: { enabled: true, capacity: 2, ...OPEN_PERIOD },
    registrations: [
      [MARCUS, "registered"],
      ["anita.devi@example.com", "registered"],
    ],
    testCases: "TC05" },
  // Full, with Marcus on the waiting list - leaving it is SPM-66.
  { key: "spm52_waitlist", title: "SPM52 Waiting List Workshop", status: "confirmed", date: "2028-03-18",
    registration: { enabled: true, capacity: 1, ...OPEN_PERIOD },
    registrations: [
      ["tom.harris@example.com", "registered"],
      [MARCUS, "waitlisted"],
    ],
    testCases: "TC07" },
  { key: "spm52_dropped", title: "SPM52 Dropped Plans Seminar", status: "confirmed", date: "2028-03-25",
    registration: { enabled: true, capacity: 20, ...OPEN_PERIOD },
    registrations: [[MARCUS, "withdrawn"]],
    testCases: "TC07" },
  // Already happened, and Marcus attended.
  { key: "spm52_past", title: "SPM52 Past Wellness Clinic", status: "completed", date: "2026-09-15",
    registration: { enabled: true, capacity: 20, opens: ["2026-08-01", 9], closes: ["2026-09-10", 17] },
    registrations: [[MARCUS, "attended"]],
    testCases: "TC07" },
  // Registration was turned off after Marcus registered: he keeps seeing it only while he holds his place.
  { key: "spm52_gala", title: "SPM52 Members Gala", status: "confirmed", date: "2028-04-01",
    registration: { enabled: false, capacity: 20, ...OPEN_PERIOD },
    registrations: [[MARCUS, "registered"]],
    testCases: "TC08" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  completed: "Event delivered",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-52 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  for (const [email] of FIXTURES.flatMap((f) => f.registrations)) {
    if (!attendees.has(email)) attendees.set(email, await find(email));
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-52 fixture event(s).`);

  for (const f of FIXTURES) {
    const chain = CHAIN[f.status];
    // History 5 days a step, ending before the earlier of today and the event.
    const end = new Date(Math.min(Date.now(), sgt(f.date, 9).getTime()));
    const historyStart = addDays(end, -(chain.length * 5 + 2));
    const reg = f.registration;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-52 withdraw from event test event",
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
        confirmedAt: addDays(historyStart, 20),
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
        registrations: {
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
    console.log(`  ${ref}  ${f.title.padEnd(30)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-52 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
