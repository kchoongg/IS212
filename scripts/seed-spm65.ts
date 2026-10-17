/**
 * SPM-65 (View Registration List) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm65
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm65_": it deletes them (their status history
 * and registrations go with them - every child relation of Event is
 * onDelete: Cascade) and recreates them in their starting state. Nothing else
 * in the database is changed, so it is safe to run while others are testing
 * other stories.
 *
 * SPM-65-TC04 registers and withdraws on "SPM65 Live Update Workshop", so run
 * this again after it (docs/test-cases/SPM-65_Test_Cases.xlsx says which cases
 * need it). Every other case only reads.
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares. Registration dates
 * are fixed, so the dates the cases quote never go stale. The open events'
 * registration runs from 1 Sept 2026 to 31 Dec 2027.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles, dates and
 * organiser) but not their exact registration settings or registrations -
 * run this once after a full reseed, as for SPM-51 and SPM-52.
 *
 * Needs the base seed's users to exist, and the SPM-65 migration
 * (registrations.added_by_id).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm65_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/** A fixed calendar date at a Singapore wall-clock time. */
function sgt(isoDate: string, hour: number, minute = 0): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Registration opens 1 Sept 2026, 09:00 and closes 31 Dec 2027, 17:00. */
const OPEN_PERIOD = { opens: ["2026-09-01", 9], closes: ["2027-12-31", 17] } as const;

type Registration = {
  email: string;
  status: string;
  /** Singapore date and time, "YYYY-MM-DD HH:MM". */
  registeredAt: string;
  withdrawnAt?: string;
  /** Added on the organiser's behalf (AC4): by the event's organiser. */
  addedByOrganiser?: boolean;
};

type Fixture = {
  key: string;
  title: string;
  status: string;
  date: string; // YYYY-MM-DD, Singapore; every event runs 09:00-17:00
  registration: {
    enabled: boolean;
    capacity: number | null;
    opens?: readonly [date: string, hour: number];
    closes?: readonly [date: string, hour: number];
  };
  registrations: Registration[];
  testCases: string; // which SPM-65 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's and Evelyn Chen's, as for SPM-51 and SPM-52. */
const COORDINATOR = "daniel.tan@connectsphere.com";
const ORGANISER = "Evelyn Chen";

const FIXTURES: Fixture[] = [
  // Full: 3 places, 3 registered (one added by Evelyn Chen), one on the waiting
  // list and one who withdrew.
  { key: "spm65_harbour", title: "SPM65 Harbourfront Seminar", status: "confirmed", date: "2028-05-04",
    registration: { enabled: true, capacity: 3, ...OPEN_PERIOD },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-01 10:00" },
      { email: "anita.devi@example.com", status: "registered", registeredAt: "2026-10-02 14:30", addedByOrganiser: true },
      { email: "tom.harris@example.com", status: "registered", registeredAt: "2026-10-03 09:15" },
      { email: "siti.nurhaliza@example.com", status: "waitlisted", registeredAt: "2026-10-05 11:00" },
      { email: "farhan.ismail@example.com", status: "withdrawn", registeredAt: "2026-10-01 16:00",
        withdrawnAt: "2026-10-06 12:00" },
    ],
    testCases: "TC01 TC07-TC12" },
  // Already happened: two checked in, one did not come, one withdrew.
  { key: "spm65_past", title: "SPM65 Past Health Talk", status: "completed", date: "2026-09-20",
    registration: { enabled: true, capacity: 10, opens: ["2026-08-01", 9], closes: ["2026-09-15", 17] },
    registrations: [
      { email: "lee.wei.ming@example.com", status: "attended", registeredAt: "2026-08-03 10:00" },
      { email: "chua.mei.ling@example.com", status: "attended", registeredAt: "2026-08-04 10:00" },
      { email: "jocelyn.pang@example.com", status: "registered", registeredAt: "2026-08-05 10:00" },
      { email: "ravi.subramaniam@example.com", status: "withdrawn", registeredAt: "2026-08-06 10:00",
        withdrawnAt: "2026-09-01 10:00" },
    ],
    testCases: "TC02" },
  // Open, nobody registered yet. TC04 registers and withdraws here.
  { key: "spm65_live", title: "SPM65 Live Update Workshop", status: "confirmed", date: "2028-05-11",
    registration: { enabled: true, capacity: 5, ...OPEN_PERIOD },
    registrations: [],
    testCases: "TC04" },
  // No capacity limit.
  { key: "spm65_open", title: "SPM65 Open Lecture", status: "confirmed", date: "2028-05-18",
    registration: { enabled: true, capacity: null, ...OPEN_PERIOD },
    registrations: [
      { email: "anita.devi@example.com", status: "registered", registeredAt: "2026-10-04 10:00" },
      { email: "tom.harris@example.com", status: "registered", registeredAt: "2026-10-04 11:00" },
    ],
    testCases: "TC03" },
  // Registration never turned on.
  { key: "spm65_closed", title: "SPM65 Closed Doors Gala", status: "confirmed", date: "2028-05-25",
    registration: { enabled: false, capacity: null },
    registrations: [],
    testCases: "TC05" },
  // Registration turned off after one attendee registered.
  { key: "spm65_paused", title: "SPM65 Paused Forum", status: "confirmed", date: "2028-06-01",
    registration: { enabled: false, capacity: 20, ...OPEN_PERIOD },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-02 10:00" },
    ],
    testCases: "TC06" },
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

/** "YYYY-MM-DD HH:MM" in Singapore time. */
function at(when: string): Date {
  const [date, time] = when.split(" ");
  const [hour, minute] = time.split(":").map(Number);
  return sgt(date, hour, minute);
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-65 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  for (const { email } of FIXTURES.flatMap((f) => f.registrations)) {
    if (!attendees.has(email)) attendees.set(email, await find(email));
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-65 fixture event(s).`);

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
        purpose: "SPM-65 view registration list test event",
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
          create: f.registrations.map((r) => ({
            attendeeId: attendees.get(r.email)!,
            status: r.status,
            registeredAt: at(r.registeredAt),
            withdrawnAt: r.withdrawnAt ? at(r.withdrawnAt) : undefined,
            addedById: r.addedByOrganiser ? organiser.id : undefined,
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(30)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-65 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
