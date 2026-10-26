/**
 * SPM-69 (Release or Adjust Equipment Reservation) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm69
 *
 * Only touches events whose seedKey starts with "spm69_": it deletes them
 * (their equipment requests and status history go with them - every child
 * relation of Event is onDelete: Cascade) and recreates them in their starting
 * state. Nothing else is changed. The notifications the cases create (AC6)
 * go with their event too.
 *
 * Re-run before and after each case that changes data in
 * docs/test-cases/SPM-69_Test_Cases.xlsx: releasing and adjusting
 * reservations is exactly what the cases do to these lines.
 *
 * Events come in pairs on the same day, sharing one equipment item, so a case
 * can watch units freed by one event become available to the other (AC4).
 * Dates are in June-July 2028, where no other fixture holds these items.
 *
 * Needs the base seed's users and the SPM-49 equipment items to exist already
 * (Wireless Presenter x4, Confidence Monitor x4, Mobile Charging Cart x1).
 * prisma/seed.ts creates the same rows (same seed keys, titles, dates) - keep
 * the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm69_";

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

type Line = {
  equipment: string;
  requested: number;
  reserved?: number;
  status: string;
  requirements?: string;
};

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "confirmed";
  organiser: string;
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  line: Line;
  testCases: string;
};

const DANIEL = "daniel.tan@connectsphere.com";
const KENJI = "kenji.sato@connectsphere.com";
const GRACE = "grace.lim@connectsphere.com";

const FIXTURES: Fixture[] = [
  { key: "spm69_release", title: "SPM69 Release Rehearsal", status: "planning", organiser: "Rachel Ng",
    date: "2028-06-13", startHour: 9, durationHours: 4,
    line: { equipment: "Wireless Presenter", requested: 3, reserved: 3, status: "reserved" },
    testCases: "TC01 TC02 TC03 TC10 TC11" },
  { key: "spm69_overlap", title: "SPM69 Overlap Seminar", status: "planning", organiser: "James Koh",
    date: "2028-06-13", startHour: 14, durationHours: 3,
    line: { equipment: "Wireless Presenter", requested: 3, status: "requested" },
    testCases: "TC01 TC10" },
  { key: "spm69_reduce", title: "SPM69 Reduce Workshop", status: "planning", organiser: "Melissa Yap",
    date: "2028-06-20", startHour: 9, durationHours: 4,
    line: { equipment: "Confidence Monitor", requested: 4, reserved: 4, status: "reserved" },
    testCases: "TC04" },
  { key: "spm69_neighbour", title: "SPM69 Neighbour Briefing", status: "planning", organiser: "Kelvin Loh",
    date: "2028-06-20", startHour: 14, durationHours: 2,
    line: { equipment: "Confidence Monitor", requested: 2, status: "requested" },
    testCases: "TC04" },
  { key: "spm69_increase", title: "SPM69 Increase Forum", status: "planning", organiser: "Evelyn Chen",
    date: "2028-06-27", startHour: 9, durationHours: 4,
    line: { equipment: "Wireless Presenter", requested: 4, reserved: 2, status: "partially_fulfilled" },
    testCases: "TC05 TC06 TC07" },
  { key: "spm69_rival", title: "SPM69 Rival Launch", status: "planning", organiser: "Samuel Ong",
    date: "2028-06-27", startHour: 14, durationHours: 2,
    line: { equipment: "Wireless Presenter", requested: 1, reserved: 1, status: "reserved" },
    testCases: "TC05 TC06 TC07" },
  { key: "spm69_change", title: "SPM69 Coordinator Change Expo", status: "planning", organiser: "Faridah Aziz",
    date: "2028-07-04", startHour: 9, durationHours: 6,
    line: { equipment: "Confidence Monitor", requested: 2, reserved: 2, status: "reserved", requirements: "HDMI from the lectern" },
    testCases: "TC08 TC09" },
  { key: "spm69_confirmed", title: "SPM69 Confirmed Gala", status: "confirmed", organiser: "Budi Santoso",
    date: "2028-07-11", startHour: 18, durationHours: 4,
    line: { equipment: "Mobile Charging Cart", requested: 1, reserved: 1, status: "reserved" },
    testCases: "TC10" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Equipment planning started",
  confirmed: "Essential arrangements complete",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-69 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const users = new Map<string, string>();
  for (const email of [DANIEL, KENJI, GRACE]) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    users.set(email, u.id);
  }
  const organisers = new Map<string, { id: string; organisationId: string | null }>();
  for (const f of FIXTURES) {
    if (organisers.has(f.organiser)) continue;
    const o = await prisma.user.findFirst({
      where: { fullName: f.organiser, role: "organiser" },
      select: { id: true, organisationId: true },
    });
    if (!o) throw new Error(`Organiser "${f.organiser}" not found - run the base seed once first.`);
    organisers.set(f.organiser, o);
  }
  const equipment = new Map<string, string>();
  for (const f of FIXTURES) {
    if (equipment.has(f.line.equipment)) continue;
    const e = await prisma.equipment.findUnique({ where: { name: f.line.equipment }, select: { id: true } });
    if (!e) throw new Error(`Equipment "${f.line.equipment}" not found - run the base seed once first.`);
    equipment.set(f.line.equipment, e.id);
  }

  // Reset: drop the previous run's fixtures. Cascades take their equipment
  // requests and the notifications the cases sent about them.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-69 fixture event(s).`);

  const coordinatorId = users.get(DANIEL)!;
  const opsManager = users.get(GRACE)!;

  for (const f of FIXTURES) {
    const organiser = organisers.get(f.organiser)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = addDays(new Date(), -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-69 release or adjust equipment reservation test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, chain.length * 5) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        equipmentRequests: {
          create: {
            equipmentId: equipment.get(f.line.equipment)!,
            quantityRequested: f.line.requested,
            quantityReserved: f.line.reserved,
            technicalRequirements: f.line.requirements,
            // Kit leaves the store early and comes back late (same as prisma/seed.ts).
            startsAt: new Date(startsAt.getTime() - 3 * 3_600_000),
            endsAt: new Date(endsAt.getTime() + 2 * 3_600_000),
            status: f.line.status,
            requestedBy: coordinatorId,
            requestedAt: historyStart,
            reviewedBy: f.line.reserved ? users.get(KENJI) : undefined,
            reviewedAt: f.line.reserved ? addDays(historyStart, 2) : undefined,
          },
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(30)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-69 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
