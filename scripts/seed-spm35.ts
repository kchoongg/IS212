/**
 * SPM-35 (Request Event Change) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm35
 *
 * Deletes and recreates only the events whose seedKey starts with "spm35_",
 * which takes their change requests, bookings and equipment with them
 * (onDelete: Cascade). Nothing else changes. Event numbers are not pinned: the
 * cases find each event by its title.
 *
 * Every event is organised by Rachel Ng (Meridian Financial Group) and assigned
 * to Daniel Tan. James Koh, Rachel's colleague, can see them but owns none.
 * SPM35 Requests Showcase also gets five pending change requests, one for each
 * kind of change the coordinator's list must mark (TC06).
 *
 * Run it before and after any case that sends a change request
 * (docs/test-cases/SPM-35_Test_Cases.xlsx). prisma/seed.ts creates the same
 * events (without their bookings, equipment and change requests) - keep the
 * two in step.
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const KEY_PREFIX = "spm35_";
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number, minute = 0): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS, minute));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

const TO_APPROVED = ["submitted", "under_review", "approved"];
const TO_PLANNING = [...TO_APPROVED, "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "All arrangements in place",
  postponed: "Client asked to hold the date",
  cancelled: "Client cancelled",
};

type Fixture = {
  key: string;
  title: string;
  status: string;
  chain: string[];
  date: string;
  startHour: number;
  durationHours: number;
  attendance: number;
  purpose: string;
  description: string;
  facilities?: string[];
  booking?: { venueCode: string };
  equipment?: { name: string; quantity: number };
  cancellationReason?: string;
  testCases: string;
};

const FIXTURES: Fixture[] = [
  { key: "spm35_townhall", title: "SPM35 Harbour Townhall", status: "approved", chain: TO_APPROVED,
    date: "2027-04-12", startHour: 9, durationHours: 3, attendance: 80,
    purpose: "Quarterly all-hands", description: "Leadership update and Q&A.", facilities: ["Raised stage"],
    testCases: "TC01 TC02 TC03 TC05" },
  { key: "spm35_roadshow", title: "SPM35 Riverside Roadshow", status: "planning", chain: TO_PLANNING,
    date: "2027-04-19", startHour: 10, durationHours: 6, attendance: 100,
    purpose: "Client roadshow", description: "Product briefings for wealth clients.",
    booking: { venueCode: "ORC-SEM" }, equipment: { name: "4K Portable Projector", quantity: 2 }, testCases: "TC09" },
  { key: "spm35_forum", title: "SPM35 Marina Client Forum", status: "confirmed", chain: [...TO_PLANNING, "confirmed"],
    date: "2027-04-26", startHour: 14, durationHours: 3, attendance: 50,
    purpose: "Client forum", description: "Market outlook for key clients.", testCases: "TC08" },
  { key: "spm35_postponed", title: "SPM35 Postponed Product Showcase", status: "postponed", chain: [...TO_PLANNING, "postponed"],
    date: "2027-05-03", startHour: 9, durationHours: 4, attendance: 60,
    purpose: "Product showcase", description: "New savings products on show.", testCases: "TC07" },
  { key: "spm35_under_review", title: "SPM35 Under Review Workshop", status: "under_review", chain: ["submitted", "under_review"],
    date: "2027-05-24", startHour: 9, durationHours: 3, attendance: 30,
    purpose: "Advisers' workshop", description: "Hands-on session for advisers.", testCases: "TC04" },
  { key: "spm35_cancelled", title: "SPM35 Cancelled Gala Dinner", status: "cancelled", chain: [...TO_APPROVED, "cancelled"],
    date: "2027-05-31", startHour: 19, durationHours: 3, attendance: 120,
    purpose: "Year-end gala", description: "Dinner for staff and partners.", cancellationReason: "Client cancelled the gala.",
    testCases: "TC04" },
  { key: "spm35_requests", title: "SPM35 Requests Showcase", status: "confirmed", chain: [...TO_PLANNING, "confirmed"],
    date: "2027-05-10", startHour: 9, durationHours: 8, attendance: 100,
    purpose: "Client showcase", description: "A day of client presentations.", testCases: "TC06" },
];

/// TC06: one pending request per kind of change, oldest first. Shaped as
/// POST /api/events/[id]/change-requests stores them (src/lib/eventChangeRequest.ts).
function showcaseRequests(event: { startsAt: Date; endsAt: Date }) {
  const iso = (d: Date) => d.toISOString();
  return [
    { reason: "Adding the year so clients can tell it apart from last year's.", isSignificant: false,
      changes: [{ field: "title", current: "SPM35 Requests Showcase", proposed: "SPM35 Requests Showcase 2027" }] },
    { reason: "Our CEO is travelling that week.", isSignificant: true,
      changes: [
        { field: "startsAt", current: iso(event.startsAt), proposed: iso(addDays(event.startsAt, 7)) },
        { field: "endsAt", current: iso(event.endsAt), proposed: iso(addDays(event.endsAt, 7)) },
      ] },
    { reason: "Registrations are ahead of forecast.", isSignificant: true,
      changes: [{ field: "expectedAttendance", current: 100, proposed: 150 }] },
    { reason: "We are adding a seated lunch.", isSignificant: true,
      changes: [{ field: "preferredLayout", current: "theatre", proposed: "banquet" }] },
    { reason: "The panel has grown to four speakers.", isSignificant: true, changes: [],
      equipmentChanges: "Two more handheld wireless microphones for the panel." },
  ];
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-35 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const coordinator = await find("daniel.tan@connectsphere.com");
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const facilityIds = new Map(
    (await prisma.facility.findMany({ select: { id: true, name: true } })).map((f) => [f.name, f.id])
  );
  const venue = await prisma.venue.findUnique({ where: { code: "ORC-SEM" }, select: { id: true } });
  const projector = await prisma.equipment.findFirst({ where: { name: "4K Portable Projector" }, select: { id: true } });
  if (!venue || !projector) throw new Error("ORC-SEM or 4K Portable Projector not found - run the base seed once first.");

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-35 fixture event(s) and their change requests.`);

  const historyStart = new Date("2026-09-14T02:00:00.000Z");
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: f.purpose,
        description: f.description,
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, 12) : undefined,
        cancellationReason: f.cancellationReason,
        facilityRequirements: f.facilities
          ? { create: f.facilities.map((name) => ({ facilityId: facilityIds.get(name)!, isMandatory: true })) }
          : undefined,
        statusHistory: {
          create: f.chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : f.chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 3),
            reason: REASONS[to],
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    if (f.booking) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venue.id,
          layoutName: "theatre",
          expectedAttendance: f.attendance,
          startsAt,
          endsAt,
          status: "approved",
          requestedBy: coordinator,
          requestedAt: addDays(historyStart, 9),
          decidedBy: venueStaff,
          decidedAt: addDays(historyStart, 10),
        },
      });
    }
    if (f.equipment) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: projector.id,
          quantityRequested: f.equipment.quantity,
          quantityReserved: f.equipment.quantity,
          status: "reserved",
          reviewedBy: techSupport,
          reviewedAt: addDays(historyStart, 11),
          requestedBy: coordinator,
          requestedAt: addDays(historyStart, 9),
          startsAt,
          endsAt,
        },
      });
    }
    if (f.key === "spm35_requests") {
      for (const [i, r] of showcaseRequests({ startsAt, endsAt }).entries()) {
        await prisma.eventChangeRequest.create({
          data: {
            eventId: created.id,
            requestedBy: organiser.id,
            requestedAt: new Date(addDays(historyStart, 20).getTime() + i * 3_600_000),
            kind: "change",
            reason: r.reason,
            changes: r.changes as unknown as Prisma.InputJsonValue,
            equipmentChanges: r.equipmentChanges ?? null,
            isSignificant: r.isSignificant,
            status: "pending",
          },
        });
      }
    }
    console.log(`  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(34)} ${f.status.padEnd(13)} ${f.testCases}`);
  }
  console.log(`Done: ${FIXTURES.length} SPM-35 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
