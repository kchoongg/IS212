/**
 * SPM-50 (Review and Update Equipment Request) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm50
 *
 * Only touches events whose seedKey starts with "spm50_": it deletes them
 * (their equipment requests and status history go with them - every child
 * relation of Event is onDelete: Cascade) and recreates them in their starting
 * state. Nothing else is changed.
 *
 * Re-run before each pass through docs/test-cases/SPM-50_Test_Cases.xlsx:
 * updating fulfilment status and technical notes is exactly what the cases do
 * to these lines.
 *
 * Needs the base seed's users and the SPM-49 equipment items to exist already.
 * prisma/seed.ts creates the same rows (same seed keys, titles, dates) - keep
 * the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm50_";

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
  staffNotes?: string;
  /// Fixed, not rotated, so the names the cases see are stable.
  reviewer?: string;
};

type Fixture = {
  key: string;
  title: string;
  status: "under_review" | "planning" | "cancelled";
  organiser: string;
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  lines: Line[];
  testCases: string;
};

const DANIEL = "daniel.tan@connectsphere.com";
const AISHA = "aisha.omar@connectsphere.com";
const KENJI = "kenji.sato@connectsphere.com";

const FIXTURES: Fixture[] = [
  { key: "spm50_robotics_expo", title: "Robotics Expo", status: "planning", organiser: "Rachel Ng",
    date: "2027-08-02", startHour: 9, durationHours: 6,
    lines: [
      { equipment: "Wireless Presenter", requested: 2, status: "requested",
        requirements: "Must pair with the stage laptop over USB-C" },
      { equipment: "Confidence Monitor", requested: 3, status: "requested",
        requirements: "Floor wedges facing the speaker, HDMI from the lectern" },
    ],
    testCases: "TC01-TC03 TC05 TC06 TC08-TC10 TC12" },
  { key: "spm50_design_week", title: "Design Week", status: "planning", organiser: "Melissa Yap",
    date: "2027-08-16", startHour: 9, durationHours: 6,
    lines: [
      { equipment: "Ring Light", requested: 2, status: "unavailable", staffNotes: "Both units out for repair", reviewer: AISHA },
      { equipment: "Confidence Monitor", requested: 1, status: "requested" },
    ],
    testCases: "TC04 TC11" },
  { key: "spm50_charity_briefing", title: "Charity Briefing", status: "planning", organiser: "Evelyn Chen",
    date: "2027-08-23", startHour: 9, durationHours: 3,
    lines: [{ equipment: "Mobile Charging Cart", requested: 1, reserved: 1, status: "reserved", reviewer: KENJI }],
    testCases: "TC03 TC07" },
  { key: "spm50_charity_gala", title: "Charity Gala", status: "planning", organiser: "Hakim Zulkifli",
    date: "2027-08-23", startHour: 10, durationHours: 4,
    lines: [{ equipment: "Mobile Charging Cart", requested: 1, status: "requested" }],
    testCases: "TC07" },
  { key: "spm50_cancelled_hackathon", title: "Cancelled Hackathon", status: "cancelled", organiser: "Budi Santoso",
    date: "2027-08-30", startHour: 9, durationHours: 6,
    lines: [{ equipment: "Wireless Presenter", requested: 2, status: "requested" }],
    testCases: "TC13" },
  { key: "spm50_pending_showcase", title: "Pending Showcase", status: "under_review", organiser: "Samuel Ong",
    date: "2027-09-06", startHour: 9, durationHours: 6,
    lines: [{ equipment: "Wireless Presenter", requested: 1, status: "requested" }],
    testCases: "TC14" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  under_review: ["submitted", "under_review"],
  planning: ["submitted", "under_review", "approved", "planning"],
  cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Equipment planning started",
  cancelled: "Client withdrew the request.",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-50 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const users = new Map<string, string>();
  for (const email of [DANIEL, AISHA, KENJI, "grace.lim@connectsphere.com"]) {
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
    for (const l of f.lines) {
      if (equipment.has(l.equipment)) continue;
      const e = await prisma.equipment.findUnique({ where: { name: l.equipment }, select: { id: true } });
      if (!e) throw new Error(`Equipment "${l.equipment}" not found - run the base seed once first.`);
      equipment.set(l.equipment, e.id);
    }
  }

  // Reset: drop the previous run's fixtures. Cascades take their equipment
  // requests, including every update the test cases saved.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-50 fixture event(s).`);

  const coordinatorId = users.get(DANIEL)!;
  const opsManager = users.get("grace.lim@connectsphere.com")!;

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
        purpose: "SPM-50 equipment review test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        submittedAt: historyStart,
        cancellationReason: f.status === "cancelled" ? REASONS.cancelled : undefined,
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
          create: f.lines.map((l) => ({
            equipmentId: equipment.get(l.equipment)!,
            quantityRequested: l.requested,
            quantityReserved: l.reserved,
            technicalRequirements: l.requirements,
            // Kit leaves the store early and comes back late (same as prisma/seed.ts).
            startsAt: new Date(startsAt.getTime() - 3 * 3_600_000),
            endsAt: new Date(endsAt.getTime() + 2 * 3_600_000),
            status: l.status,
            requestedBy: coordinatorId,
            requestedAt: historyStart,
            reviewedBy: l.reviewer ? users.get(l.reviewer) : undefined,
            reviewedAt: l.reviewer ? addDays(historyStart, 2) : undefined,
            staffNotes: l.staffNotes,
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(22)} ${f.status.padEnd(12)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-50 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
