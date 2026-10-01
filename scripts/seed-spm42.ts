/**
 * SPM-42 (Request Venue Booking) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm42
 *
 * Only touches events whose seedKey starts with "spm42_": it deletes them
 * (their venue bookings, sessions and status history go with them - every
 * child relation of Event is onDelete: Cascade) and recreates them in their
 * starting state. Also upserts the one venue the seed has no equivalent for,
 * "SPM42 Plain Room" (SPM42-PLN, no setup or turnaround). Nothing else is
 * changed.
 *
 * Re-run before each pass through docs/test-cases/SPM-42_Test_Cases.xlsx:
 * submitting a request is exactly what the cases do to these events.
 *
 * Needs the base seed's users and venues to exist already. prisma/seed.ts
 * creates the same rows (same seed keys, titles, dates) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm42_";

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

const PLAIN_ROOM = {
  code: "SPM42-PLN",
  name: "SPM42 Plain Room",
  description: "SPM-42 test venue: needs no setup or turnaround",
  building: "Orchard Hub",
  floor: "L1",
  maxCapacity: 40,
  opensAt: "07:00",
  closesAt: "23:00",
  setupMinutes: 0,
  teardownMinutes: 0,
};
const PLAIN_ROOM_LAYOUTS = [
  { layoutName: "classroom", capacity: 40 },
  { layoutName: "theatre", capacity: 40 },
];

type Fixture = {
  key: string;
  title: string;
  status: "approved" | "planning";
  coordinator: string;
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  attendance?: number;
  layout?: string;
  sessions?: { label: string; date: string; startHour: number; durationHours: number; attendance: number; layout: string }[];
  /// A decided booking the event already holds - the blockers for TC16.
  booking?: { venueCode: string; status: "cancelled" | "rejected"; reason: string };
  testCases: string;
};

const DANIEL = "daniel.tan@connectsphere.com";

const FIXTURES: Fixture[] = [
  { key: "spm42_symposium", title: "SPM42 Research Symposium", status: "planning", coordinator: DANIEL,
    date: "2027-03-04", startHour: 9, durationHours: 9, attendance: 200, layout: "theatre", testCases: "TC01 TC02" },
  { key: "spm42_morning_talk", title: "SPM42 Morning Talk", status: "planning", coordinator: DANIEL,
    date: "2027-03-05", startHour: 10, durationHours: 2, attendance: 40, layout: "theatre", testCases: "TC03" },
  { key: "spm42_town_hall", title: "SPM42 Town Hall", status: "planning", coordinator: DANIEL,
    date: "2027-03-06", startHour: 9, durationHours: 8, attendance: 100, layout: "theatre",
    testCases: "TC04 TC10 TC11 TC17" },
  { key: "spm42_refusals", title: "SPM42 Refusal Checks", status: "planning", coordinator: DANIEL,
    date: "2027-03-07", startHour: 9, durationHours: 8, attendance: 50, layout: "theatre", testCases: "TC05 TC08" },
  { key: "spm42_early_briefing", title: "SPM42 Early Briefing", status: "planning", coordinator: DANIEL,
    date: "2027-03-08", startHour: 9, durationHours: 3, attendance: 40, layout: "theatre", testCases: "TC06" },
  { key: "spm42_late_show", title: "SPM42 Late Show", status: "planning", coordinator: DANIEL,
    date: "2027-03-09", startHour: 19, durationHours: 3, attendance: 40, layout: "theatre", testCases: "TC06" },
  { key: "spm42_plain_pm", title: "SPM42 Plain Afternoon", status: "planning", coordinator: DANIEL,
    date: "2027-03-10", startHour: 14, durationHours: 3, attendance: 30, layout: "classroom", testCases: "TC07" },
  { key: "spm42_networking", title: "SPM42 Networking Evening", status: "planning", coordinator: DANIEL,
    date: "2027-03-11", startHour: 17, durationHours: 5, attendance: 120, layout: "banquet", testCases: "TC06" },
  // Event times span its sessions (1 Mar 09:00 to 3 Mar 22:00).
  { key: "spm42_three_sessions", title: "SPM42 Three-Session Forum", status: "approved", coordinator: DANIEL,
    date: "2027-03-01", startHour: 9, durationHours: 61, attendance: 80, layout: "theatre",
    sessions: [
      { label: "Day 1", date: "2027-03-01", startHour: 9, durationHours: 3, attendance: 80, layout: "theatre" },
      { label: "Day 2", date: "2027-03-02", startHour: 14, durationHours: 3, attendance: 30, layout: "classroom" },
      { label: "Day 3", date: "2027-03-03", startHour: 19, durationHours: 3, attendance: 60, layout: "banquet" },
    ],
    testCases: "TC08 TC09 TC10 TC17" },
  // Same day and time as Product Showcase's approved booking at Marina Auditorium.
  { key: "spm42_clash_check", title: "SPM42 Clash Check", status: "planning", coordinator: DANIEL,
    date: "2026-10-21", startHour: 11, durationHours: 4, testCases: "TC14" },
  { key: "spm42_cancelled_hold", title: "SPM42 Cancelled Hold", status: "planning", coordinator: "priya.raj@connectsphere.com",
    date: "2027-03-15", startHour: 9, durationHours: 8,
    booking: { venueCode: "ORC-GAL", status: "cancelled", reason: "Released by the coordinator." }, testCases: "TC16" },
  { key: "spm42_rejected_hold", title: "SPM42 Rejected Hold", status: "planning", coordinator: "priya.raj@connectsphere.com",
    date: "2027-03-16", startHour: 9, durationHours: 9,
    booking: { venueCode: "MAR-AUD", status: "rejected", reason: "Auditorium needed for internal rigging work." },
    testCases: "TC16" },
  { key: "spm42_after_cancel", title: "SPM42 After Cancellation", status: "planning", coordinator: DANIEL,
    date: "2027-03-15", startHour: 10, durationHours: 6, testCases: "TC16" },
  { key: "spm42_after_reject", title: "SPM42 After Rejection", status: "planning", coordinator: DANIEL,
    date: "2027-03-17", startHour: 10, durationHours: 6, testCases: "TC16" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-42 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');
  const coordinators = new Map<string, string>();
  for (const f of FIXTURES) if (!coordinators.has(f.coordinator)) coordinators.set(f.coordinator, await find(f.coordinator));
  const venueIds = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!f.booking || venueIds.has(f.booking.venueCode)) continue;
    const v = await prisma.venue.findUnique({ where: { code: f.booking.venueCode }, select: { id: true } });
    if (!v) throw new Error(`Venue ${f.booking.venueCode} not found - run the base seed once first.`);
    venueIds.set(f.booking.venueCode, v.id);
  }

  // Reset: drop the previous run's fixtures. Cascades take their bookings,
  // including every request the test cases submitted.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-42 fixture event(s).`);

  const plain = await prisma.venue.upsert({
    where: { code: PLAIN_ROOM.code },
    create: PLAIN_ROOM,
    update: { ...PLAIN_ROOM, isActive: true },
  });
  for (const l of PLAIN_ROOM_LAYOUTS) {
    await prisma.venueLayout.upsert({
      where: { venueId_layoutName: { venueId: plain.id, layoutName: l.layoutName } },
      create: { venueId: plain.id, ...l },
      update: { capacity: l.capacity },
    });
  }
  console.log(`Venue ${PLAIN_ROOM.code} ready.`);

  for (const f of FIXTURES) {
    const coordinatorId = coordinators.get(f.coordinator)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = addDays(new Date(), -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-42 venue booking request test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        submittedAt: historyStart,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        sessions: f.sessions && {
          create: f.sessions.map((s) => {
            const from = sgt(s.date, s.startHour);
            return {
              label: s.label,
              startsAt: from,
              endsAt: new Date(from.getTime() + s.durationHours * 3_600_000),
              expectedAttendance: s.attendance,
              preferredLayout: s.layout,
            };
          }),
        },
        venueBookings: f.booking && {
          create: {
            venueId: venueIds.get(f.booking.venueCode)!,
            layoutName: f.layout,
            startsAt,
            endsAt,
            status: f.booking.status,
            requestedBy: coordinatorId,
            requestedAt: historyStart,
            decidedBy: venueStaff,
            decidedAt: addDays(historyStart, 2),
            decisionReason: f.booking.reason,
          },
        },
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(28)} ${f.status.padEnd(9)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-42 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
