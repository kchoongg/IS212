/**
 * SPM-32 (Process Event Change Request) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm32
 *
 * Deletes and recreates only the events whose seedKey starts with "spm32_",
 * which takes their change requests, bookings and status history with them
 * (onDelete: Cascade). Nothing else changes. Event numbers are not pinned: the
 * cases find each event by its title.
 *
 * Every event is organised by Rachel Ng (Meridian Financial Group) and, except
 * SPM32 Other Coordinator Forum (Priya Raj), assigned to Daniel Tan. Each has
 * one change request from Rachel Ng, pending except on SPM32 Processed Seminar,
 * shaped as Request Event Change (SPM-35) stores them.
 *
 * Run it before and after any case that saves a decision or cancels an event
 * (docs/test-cases/SPM-32_Test_Cases.xlsx). prisma/seed.ts creates the same
 * events (without their requests and bookings) - keep the two in step.
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const KEY_PREFIX = "spm32_";
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const iso = (d: Date) => d.toISOString();

const TO_APPROVED = ["submitted", "under_review", "approved"];
const TO_PLANNING = [...TO_APPROVED, "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  postponed: "Client requested a later date",
};

type Request = {
  kind: "change" | "postpone" | "cancel";
  reason: string;
  changes?: { field: string; current: unknown; proposed: unknown }[];
  isSignificant?: boolean;
  processed?: { status: string; decisions: Record<string, { outcome: string; reason: string | null }> };
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
  layout: string;
  description: string;
  coordinator?: "priya";
  booking?: boolean;
  request: (startsAt: Date, endsAt: Date) => Request;
  testCases: string;
};

const FIXTURES: Fixture[] = [
  { key: "spm32_partial", title: "SPM32 Harbour Briefing", status: "planning", chain: TO_PLANNING,
    date: "2027-07-05", startHour: 9, durationHours: 3, attendance: 80, layout: "theatre",
    description: "Quarterly briefing for wealth clients.", testCases: "TC01 TC02 TC03 TC04",
    request: () => ({
      kind: "change", reason: "More clients have confirmed and we are adding lunch.", isSignificant: true,
      changes: [
        { field: "title", current: "SPM32 Harbour Briefing", proposed: "SPM32 Harbour Briefing and Lunch" },
        { field: "description", current: "Quarterly briefing for wealth clients.", proposed: "Quarterly briefing with a networking lunch." },
        { field: "expectedAttendance", current: 80, proposed: 110 },
      ].sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field)),
    }) },
  { key: "spm32_confirmed", title: "SPM32 Confirmed Client Gala", status: "confirmed", chain: [...TO_PLANNING, "confirmed"],
    date: "2027-07-12", startHour: 18, durationHours: 4, attendance: 100, layout: "theatre", booking: true,
    description: "Annual gala for key clients.", testCases: "TC01 TC07",
    request: (s, e) => ({
      kind: "change", reason: "The client's CEO is overseas that week.", isSignificant: true,
      changes: [
        { field: "startsAt", current: iso(s), proposed: iso(addDays(s, 7)) },
        { field: "endsAt", current: iso(e), proposed: iso(addDays(e, 7)) },
      ],
    }) },
  { key: "spm32_postponed", title: "SPM32 Postponed Product Expo", status: "postponed", chain: [...TO_PLANNING, "postponed"],
    date: "2027-07-26", startHour: 10, durationHours: 6, attendance: 200, layout: "theatre",
    description: "Showcase of new savings products.", testCases: "TC01 TC08 TC09",
    request: (s, e) => ({
      kind: "change", reason: "The new product line is ready in August.", isSignificant: true,
      changes: [
        { field: "startsAt", current: iso(s), proposed: iso(addDays(s, 28)) },
        { field: "endsAt", current: iso(e), proposed: iso(addDays(e, 28)) },
      ],
    }) },
  { key: "spm32_workshop", title: "SPM32 Advisers Workshop", status: "approved", chain: TO_APPROVED,
    date: "2027-08-02", startHour: 9, durationHours: 3, attendance: 40, layout: "classroom",
    description: "Hands-on session for advisers.", testCases: "TC01 TC05 TC06",
    request: () => ({
      kind: "change", reason: "We want group discussions.", isSignificant: true,
      changes: [
        { field: "preferredLayout", current: "classroom", proposed: "u_shape" },
        { field: "specialRequirements", current: null, proposed: "A whiteboard for each table." },
      ],
    }) },
  { key: "spm32_processed", title: "SPM32 Processed Seminar", status: "planning", chain: TO_PLANNING,
    date: "2027-08-09", startHour: 14, durationHours: 3, attendance: 75, layout: "theatre",
    description: "Market outlook seminar.", testCases: "TC01",
    request: () => ({
      kind: "change", reason: "Registrations are ahead of forecast.", isSignificant: true,
      changes: [
        { field: "title", current: "SPM32 Processed Seminar", proposed: "SPM32 Processed Seminar 2027" },
        { field: "expectedAttendance", current: 60, proposed: 75 },
      ],
      processed: {
        status: "partially_approved",
        decisions: {
          title: { outcome: "rejected", reason: "The name is already on the invitations." },
          expectedAttendance: { outcome: "approved", reason: null },
        },
      },
    }) },
  { key: "spm32_cancel_reject", title: "SPM32 Cancellation Request Forum", status: "planning", chain: TO_PLANNING,
    date: "2027-08-16", startHour: 9, durationHours: 4, attendance: 50, layout: "theatre",
    description: "Regional client forum.", testCases: "TC01 TC10",
    request: () => ({ kind: "cancel", reason: "The client has withdrawn its budget." }) },
  { key: "spm32_cancel_approve", title: "SPM32 Called Off Dinner", status: "planning", chain: TO_PLANNING,
    date: "2027-08-30", startHour: 19, durationHours: 3, attendance: 30, layout: "theatre",
    description: "Dinner for the client's board.", testCases: "TC01 TC11",
    request: () => ({ kind: "cancel", reason: "The client has called off the dinner." }) },
  { key: "spm32_postpone", title: "SPM32 Postponement Request Talk", status: "planning", chain: TO_PLANNING,
    date: "2027-09-06", startHour: 15, durationHours: 2, attendance: 45, layout: "theatre",
    description: "A talk on retirement planning.", testCases: "TC01 TC12",
    request: () => ({ kind: "postpone", reason: "Our speaker is unwell; we will set a new date later." }) },
  { key: "spm32_other", title: "SPM32 Other Coordinator Forum", status: "planning", chain: TO_PLANNING,
    date: "2027-09-13", startHour: 9, durationHours: 3, attendance: 60, layout: "theatre", coordinator: "priya",
    description: "Partner forum.", testCases: "TC01 TC02",
    request: () => ({
      kind: "change", reason: "The partners asked for a clearer name.", isSignificant: false,
      changes: [{ field: "title", current: "SPM32 Other Coordinator Forum", proposed: "SPM32 Partner Forum" }],
    }) },
];

/// REQUESTABLE_FIELDS' order (src/lib/eventChangeRequest.ts), as SPM-35 stores fields.
const ORDER = ["title", "category", "purpose", "description", "startsAt", "endsAt", "expectedAttendance", "preferredLayout", "facilityIds", "accessibilityNotes", "specialRequirements"];

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-32 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const daniel = await find("daniel.tan@connectsphere.com");
  const priya = await find("priya.raj@connectsphere.com");
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');
  const venue = await prisma.venue.findUnique({ where: { code: "ORC-SEM" }, select: { id: true } });
  if (!venue) throw new Error("Venue ORC-SEM not found - run the base seed once first.");

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-32 fixture event(s) and their change requests.`);

  const historyStart = new Date("2026-09-21T02:00:00.000Z");
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const coordinator = f.coordinator === "priya" ? priya : daniel;
    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-32 process event change request test event",
        description: f.description,
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, 12) : undefined,
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
          layoutName: f.layout,
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

    const r = f.request(startsAt, endsAt);
    await prisma.eventChangeRequest.create({
      data: {
        eventId: created.id,
        requestedBy: organiser.id,
        requestedAt: addDays(historyStart, 25),
        kind: r.kind,
        reason: r.reason,
        changes: r.changes ? (r.changes as unknown as Prisma.InputJsonValue) : undefined,
        isSignificant: r.isSignificant ?? false,
        status: r.processed?.status ?? "pending",
        decisions: r.processed ? (r.processed.decisions as unknown as Prisma.InputJsonValue) : undefined,
        reviewedBy: r.processed ? coordinator : undefined,
        reviewedAt: r.processed ? addDays(historyStart, 27) : undefined,
      },
    });
    console.log(`  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(34)} ${f.status.padEnd(10)} ${r.kind.padEnd(8)} ${f.testCases}`);
  }
  console.log(`Done: ${FIXTURES.length} SPM-32 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
