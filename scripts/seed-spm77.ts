/**
 * SPM-77 (Suggest Alternative Equipment) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm77
 *
 * Only touches events whose seedKey starts with "spm77_": it deletes them
 * (their equipment requests, the suggestions on those requests and their
 * status history go with them - every child relation is onDelete: Cascade)
 * and recreates them in their starting state. Nothing else is changed. The
 * notifications the cases create (AC4) go with their event too.
 *
 * Re-run before and after each case that changes data in
 * docs/test-cases/SPM-77_Test_Cases.xlsx.
 *
 * Dates are in August-September 2028, where no other fixture holds these
 * items. Needs the base seed's users and the SPM-49 equipment items to exist
 * already (Ring Light x2, Podium Light x4, Portable Stage x6). prisma/seed.ts
 * creates the same rows (same seed keys, titles, dates) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm77_";

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

type Suggestion = { equipment: string; quantity: number; note: string };

type Line = {
  equipment: string;
  requested: number;
  reserved?: number;
  status: string;
  notes?: string;
  /// A suggestion already waiting for the Coordinator's decision.
  suggestion?: Suggestion;
};

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "confirmed";
  organiser: string;
  date: string; // YYYY-MM-DD, Singapore
  lines: Line[];
  testCases: string;
};

const DANIEL = "daniel.tan@connectsphere.com";
const VIKRAM = "vikram.nair@connectsphere.com";
const GRACE = "grace.lim@connectsphere.com";

const RING_LIGHT_SHORT = "Only 2 ring lights are in stock.";

const FIXTURES: Fixture[] = [
  { key: "spm77_record", title: "SPM77 Ring Light Showcase", status: "planning", organiser: "James Koh", date: "2028-08-01",
    lines: [{ equipment: "Ring Light", requested: 4, status: "unavailable", notes: RING_LIGHT_SHORT }],
    testCases: "TC01 TC02" },
  { key: "spm77_short", title: "SPM77 Stage Shortfall Talk", status: "planning", organiser: "Melissa Yap", date: "2028-08-08",
    lines: [{ equipment: "Ring Light", requested: 3, status: "unavailable", notes: RING_LIGHT_SHORT }],
    testCases: "TC03" },
  // Holds 4 of the 6 Portable Stages on the same day, so only 2 are free for
  // SPM77 Stage Shortfall Talk (AC2).
  { key: "spm77_rival", title: "SPM77 Stage Rival Fair", status: "planning", organiser: "Kelvin Loh", date: "2028-08-08",
    lines: [{ equipment: "Portable Stage", requested: 4, reserved: 4, status: "reserved" }],
    testCases: "TC03" },
  { key: "spm77_accept", title: "SPM77 Accept Gala", status: "planning", organiser: "Rachel Ng", date: "2028-08-15",
    lines: [{ equipment: "Ring Light", requested: 4, status: "unavailable", notes: RING_LIGHT_SHORT,
      suggestion: { equipment: "Podium Light", quantity: 3, note: "Three podium lights light the stage as evenly." } }],
    testCases: "TC04 TC08 TC09" },
  { key: "spm77_partial", title: "SPM77 Partial Forum", status: "planning", organiser: "Evelyn Chen", date: "2028-08-22",
    lines: [{ equipment: "Ring Light", requested: 3, reserved: 2, status: "partially_fulfilled",
      suggestion: { equipment: "Podium Light", quantity: 1, note: "One podium light makes up the third ring light." } }],
    testCases: "TC05 TC11 TC12" },
  { key: "spm77_decline", title: "SPM77 Decline Seminar", status: "planning", organiser: "Samuel Ong", date: "2028-08-29",
    lines: [{ equipment: "Ring Light", requested: 4, status: "unavailable", notes: RING_LIGHT_SHORT,
      suggestion: { equipment: "Portable Stage", quantity: 2, note: "Raise the speakers instead of lighting them." } }],
    testCases: "TC06" },
  { key: "spm77_keep", title: "SPM77 Keep Reserved Expo", status: "planning", organiser: "Faridah Aziz", date: "2028-09-05",
    lines: [
      { equipment: "Ring Light", requested: 3, reserved: 2, status: "partially_fulfilled" },
      { equipment: "Podium Light", requested: 2, status: "requested" },
    ],
    testCases: "TC07" },
  { key: "spm77_confirmed", title: "SPM77 Confirmed Dinner", status: "confirmed", organiser: "Budi Santoso", date: "2028-09-12",
    lines: [
      { equipment: "Ring Light", requested: 4, status: "unavailable", notes: RING_LIGHT_SHORT },
      { equipment: "Podium Light", requested: 6, status: "unavailable", notes: "Only 4 podium lights are in stock.",
        suggestion: { equipment: "Portable Stage", quantity: 2, note: "Two stages for the head table instead." } },
    ],
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
  console.log(`SPM-77 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const users = new Map<string, string>();
  for (const email of [DANIEL, VIKRAM, GRACE]) {
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
  const names = FIXTURES.flatMap((f) => f.lines.flatMap((l) => [l.equipment, ...(l.suggestion ? [l.suggestion.equipment] : [])]));
  for (const name of new Set(names)) {
    const e = await prisma.equipment.findUnique({ where: { name }, select: { id: true } });
    if (!e) throw new Error(`Equipment "${name}" not found - run the base seed once first.`);
    equipment.set(name, e.id);
  }

  // Reset: drop the previous run's fixtures. Cascades take their equipment
  // requests, the suggestions on them, and the notifications the cases sent.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-77 fixture event(s).`);

  const coordinatorId = users.get(DANIEL)!;
  const techSupportId = users.get(VIKRAM)!;
  const opsManager = users.get(GRACE)!;

  for (const f of FIXTURES) {
    const organiser = organisers.get(f.organiser)!;
    const startsAt = sgt(f.date, 9);
    const endsAt = sgt(f.date, 13);
    const chain = CHAIN[f.status];
    const historyStart = addDays(new Date(), -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-77 suggest alternative equipment test event",
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
      },
      select: { id: true, sequenceNumber: true },
    });

    for (const line of f.lines) {
      const reviewed = line.status !== "requested";
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipment.get(line.equipment)!,
          quantityRequested: line.requested,
          quantityReserved: line.reserved,
          staffNotes: line.notes,
          // Kit leaves the store early and comes back late (same as prisma/seed.ts).
          startsAt: new Date(startsAt.getTime() - 3 * 3_600_000),
          endsAt: new Date(endsAt.getTime() + 2 * 3_600_000),
          status: line.status,
          requestedBy: coordinatorId,
          requestedAt: historyStart,
          reviewedBy: reviewed ? techSupportId : undefined,
          reviewedAt: reviewed ? addDays(historyStart, 2) : undefined,
          suggestions: line.suggestion
            ? {
                create: {
                  equipmentId: equipment.get(line.suggestion.equipment)!,
                  quantity: line.suggestion.quantity,
                  note: line.suggestion.note,
                  status: "pending",
                  suggestedBy: techSupportId,
                  suggestedAt: addDays(historyStart, 3),
                },
              }
            : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(28)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-77 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
