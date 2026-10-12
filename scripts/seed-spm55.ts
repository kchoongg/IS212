/**
 * SPM-55 (Record Equipment Unavailability) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm55
 *
 * Touches only its own rows: the equipment items named "SPM55 …" (their
 * requests first, so no other event's request is left pointing at them) and
 * the events whose seedKey starts with "spm55_". It deletes them and recreates
 * them in their starting state. No other story's equipment changes, so
 * marking units out of service here never shortens anyone else's reservation.
 *
 * Re-run before each pass through docs/test-cases/SPM-55_Test_Cases.xlsx, and
 * after any case that records or returns units.
 *
 * Event numbers are not pinned: the cases find each event by its title.
 * Needs the base seed's users to exist already. prisma/seed.ts creates the
 * same events (the events only - the items and reservations are made here).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm55_";
const ITEM_PREFIX = "SPM55 ";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const DANIEL = "daniel.tan@connectsphere.com";

type Item = {
  name: string;
  totalQuantity: number;
  out?: { quantity: number; type: "unavailable" | "damaged" | "under_maintenance"; reason: string | null };
};

/** Dedicated items, so recording units out of service here affects only these cases. */
const ITEMS: Item[] = [
  { name: "SPM55 Laser Projector", totalQuantity: 4 },
  { name: "SPM55 Wireless Presenter", totalQuantity: 6 },
  { name: "SPM55 Stage Monitor", totalQuantity: 6 },
  { name: "SPM55 Spare Microphone Kit", totalQuantity: 5, out: { quantity: 3, type: "under_maintenance", reason: "Cable fault" } },
];

type Line = { item: string; quantity: number; reserved: number | null };

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "completed";
  date: string;
  startHour: number;
  durationHours: number;
  lines: Line[];
  testCases: string;
};

const FIXTURES: Fixture[] = [
  // Requests 4 projectors, not reserved: TC02 sees 2 available and reserves 2.
  { key: "spm55_availability_check", title: "SPM55 Availability Check Forum", status: "planning",
    date: "2027-08-09", startHour: 9, durationHours: 4,
    lines: [{ item: "SPM55 Laser Projector", quantity: 4, reserved: null }], testCases: "TC02" },
  // The same request two weeks later: TC03 sees all 4 again once returned.
  { key: "spm55_return_check", title: "SPM55 Return Check Seminar", status: "planning",
    date: "2027-08-23", startHour: 9, durationHours: 4,
    lines: [{ item: "SPM55 Laser Projector", quantity: 4, reserved: null }], testCases: "TC03" },
  // 4 of 6 presenters held: short once 3 are out (TC06), exactly covered with 2 out (TC07).
  { key: "spm55_harbour_launch", title: "SPM55 Harbour Product Launch", status: "planning",
    date: "2027-08-10", startHour: 9, durationHours: 6,
    lines: [{ item: "SPM55 Wireless Presenter", quantity: 4, reserved: 4 }], testCases: "TC06 TC07" },
  // 2 presenters on another day: still covered with 3 out (TC06).
  { key: "spm55_quiet_board", title: "SPM55 Quiet Board Meeting", status: "planning",
    date: "2027-08-24", startHour: 14, durationHours: 2,
    lines: [{ item: "SPM55 Wireless Presenter", quantity: 2, reserved: 2 }], testCases: "TC06" },
  // Already over: never flagged (TC06).
  { key: "spm55_past_roadshow", title: "SPM55 Past Roadshow", status: "completed",
    date: "2026-09-01", startHour: 9, durationHours: 6,
    lines: [{ item: "SPM55 Wireless Presenter", quantity: 6, reserved: 6 }], testCases: "TC06" },
  // 3 + 3 of 6 monitors on one day: both short once 1 is out (TC08).
  { key: "spm55_morning_showcase", title: "SPM55 Morning Showcase", status: "planning",
    date: "2027-08-17", startHour: 9, durationHours: 3,
    lines: [{ item: "SPM55 Stage Monitor", quantity: 3, reserved: 3 }], testCases: "TC08" },
  { key: "spm55_evening_showcase", title: "SPM55 Evening Showcase", status: "planning",
    date: "2027-08-17", startHour: 18, durationHours: 3,
    lines: [{ item: "SPM55 Stage Monitor", quantity: 3, reserved: 3 }], testCases: "TC08" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-55 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const coordinator = await find(DANIEL);
  const opsManager = await find("grace.lim@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // Requests for these items (whichever event made them), then the events, then the items.
  const requests = await prisma.equipmentRequest.deleteMany({ where: { equipment: { name: { startsWith: ITEM_PREFIX } } } });
  const events = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  const items = await prisma.equipment.deleteMany({ where: { name: { startsWith: ITEM_PREFIX } } });
  console.log(`Removed ${items.count} item(s), ${events.count} event(s), ${requests.count} request(s).`);

  const itemIds = new Map<string, string>();
  for (const item of ITEMS) {
    const created = await prisma.equipment.create({
      data: {
        name: item.name,
        category: "AV",
        description: "SPM-55 test item",
        totalQuantity: item.totalQuantity,
        quantityInMaintenance: item.out?.quantity ?? 0,
        outOfServiceType: item.out?.type ?? null,
        outOfServiceReason: item.out?.reason ?? null,
      },
      select: { id: true },
    });
    itemIds.set(item.name, created.id);
    console.log(`  ${item.name.padEnd(28)} ${item.totalQuantity} units, ${item.out?.quantity ?? 0} out of service`);
  }

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = f.status === "completed" ? addDays(startsAt, -(chain.length * 5 + 2)) : addDays(new Date(), -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-55 record equipment unavailability test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 40,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        ...(f.status === "completed" ? { confirmedAt: addDays(startsAt, -3) } : {}),
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 4),
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    for (const line of f.lines) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: itemIds.get(line.item)!,
          quantityRequested: line.quantity,
          ...(line.reserved !== null
            ? { quantityReserved: line.reserved, status: "reserved", reviewedBy: techSupport, reviewedAt: addDays(historyStart, 3) }
            : { status: "requested" }),
          requestedBy: coordinator,
          requestedAt: historyStart,
          startsAt,
          endsAt,
        },
      });
    }

    const held = f.lines.map((l) => `${l.item.replace(ITEM_PREFIX, "")} ${l.reserved ?? 0}/${l.quantity}`).join(", ");
    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(32)} ${f.status.padEnd(10)} ${held.padEnd(28)} ${f.testCases}`
    );
  }

  console.log(`Done: ${ITEMS.length} SPM-55 items and ${FIXTURES.length} events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
