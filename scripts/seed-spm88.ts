/**
 * SPM-88 (Resolve Safety Check Outcome) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm88
 *
 * Touches only its own rows: the events whose seedKey starts with "spm88_"
 * (their bookings, equipment requests, safety checks and history go with them)
 * and the dedicated venue SPM88-STU "SPM88 Harbour Studio" (its layout goes
 * with it), so no other story's room is booked on these dates.
 *
 * Re-run before each pass through docs/test-cases/SPM-88_Test_Cases.xlsx, and
 * after any case that changes an event.
 *
 * Event numbers are not pinned: the cases find each event by its title. The
 * safety checks' dates are fixed, since SPM-88-TC01 quotes them. Needs the
 * base seed's users and the Handheld Wireless Mic. prisma/seed.ts creates the
 * same events (the events only) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm88_";
const VENUE_CODE = "SPM88-STU";
const MIC = "Handheld Wireless Mic";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

type Status = "planning" | "safety_review" | "safety_cleared" | "confirmed";

/// One SafetyCheck: when it was submitted and, if decided, when and why.
type Check = {
  status: "pending" | "approved" | "changes_requested" | "rejected";
  submitted: [string, number];
  decided?: [string, number];
  note?: string;
};

type Fixture = {
  key: string;
  title: string;
  status: Status;
  date: string;
  startHour: number;
  durationHours: number;
  attendance: number;
  /// Oldest first.
  checks: Check[];
  testCases: string;
};

const pending = (day: string): Check => ({ status: "pending", submitted: [day, 14] });
const approved = (day: string, decided: string): Check => ({ status: "approved", submitted: [day, 14], decided: [decided, 10] });

const FIXTURES: Fixture[] = [
  {
    key: "spm88_returned", title: "SPM88 Harbour Returned Forum", status: "planning", date: "2027-11-02",
    startHour: 9, durationHours: 4, attendance: 60, testCases: "TC01-TC05",
    checks: [
      { status: "rejected", submitted: ["2026-10-05", 14], decided: ["2026-10-06", 10], note: "Fire exits are blocked by the stage set." },
      { status: "changes_requested", submitted: ["2026-10-08", 14], decided: ["2026-10-09", 10], note: "Add a second fire marshal at the east exit." },
    ],
  },
  { key: "spm88_riverside", title: "SPM88 Riverside Review", status: "safety_review", date: "2027-11-04",
    startHour: 9, durationHours: 4, attendance: 200, checks: [pending("2026-10-12")], testCases: "TC06" },
  { key: "spm88_gala", title: "SPM88 Approved Gala", status: "safety_cleared", date: "2027-11-09",
    startHour: 18, durationHours: 4, attendance: 60, checks: [approved("2026-10-10", "2026-10-12")], testCases: "TC07 TC08" },
  { key: "spm88_seminar", title: "SPM88 Approved Seminar", status: "safety_cleared", date: "2027-11-11",
    startHour: 9, durationHours: 4, attendance: 40, checks: [approved("2026-10-10", "2026-10-12")], testCases: "TC05 TC09" },
  { key: "spm88_showcase", title: "SPM88 Pending Showcase", status: "safety_review", date: "2027-11-12",
    startHour: 9, durationHours: 4, attendance: 50, checks: [pending("2026-10-13")], testCases: "TC10" },
  { key: "spm88_workshop", title: "SPM88 Pending Workshop", status: "safety_review", date: "2027-11-16",
    startHour: 9, durationHours: 4, attendance: 30, checks: [pending("2026-10-13")], testCases: "TC11" },
  { key: "spm88_expo", title: "SPM88 Confirmed Expo", status: "confirmed", date: "2027-11-18",
    startHour: 9, durationHours: 8, attendance: 120, checks: [approved("2026-10-07", "2026-10-08")], testCases: "TC12" },
  { key: "spm88_unchecked", title: "SPM88 Unchecked Launch", status: "planning", date: "2027-11-23",
    startHour: 9, durationHours: 4, attendance: 40, checks: [], testCases: "TC13" },
];

const BEFORE_SAFETY = ["submitted", "under_review", "approved", "planning"];
const CHAIN: Record<Status, string[]> = {
  planning: BEFORE_SAFETY,
  safety_review: [...BEFORE_SAFETY, "safety_review"],
  safety_cleared: [...BEFORE_SAFETY, "safety_review", "safety_cleared"],
  confirmed: [...BEFORE_SAFETY, "safety_review", "safety_cleared", "confirmed"],
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-88 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const coordinator = await find("daniel.tan@connectsphere.com");
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const safetyOfficer = await find("hana.yusof@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');
  const mic = await prisma.equipment.findFirst({ where: { name: MIC }, select: { id: true } });
  if (!mic) throw new Error(`Equipment "${MIC}" not found - run the base seed once first.`);

  // Events first (their bookings go with them), then anything else booked at
  // the dedicated venue, then the venue itself.
  const events = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  await prisma.venueBooking.deleteMany({ where: { venue: { code: VENUE_CODE } } });
  await prisma.venue.deleteMany({ where: { code: VENUE_CODE } });
  console.log(`Removed ${events.count} SPM-88 event(s) and the SPM88 venue.`);

  const venue = await prisma.venue.create({
    data: {
      code: VENUE_CODE,
      name: "SPM88 Harbour Studio",
      description: "SPM-88 test venue",
      building: "Harbour Block",
      maxCapacity: 250,
      opensAt: "08:00",
      closesAt: "23:00",
      layouts: { create: [{ layoutName: "theatre", capacity: 250 }] },
    },
    select: { id: true },
  });

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    // Arranged a month before the first submission (5 Oct 2026).
    const historyStart = sgt("2026-09-01", 9);
    const latest = f.checks.at(-1);

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-88 resolve safety check outcome test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? sgt("2026-10-09", 9) : null,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy:
              to === "submitted" ? organiser.id
              : to === "under_review" ? opsManager
              : to === "safety_cleared" ? safetyOfficer
              : coordinator,
            changedAt:
              to === "safety_review" && latest ? sgt(...latest.submitted)
              : to === "safety_cleared" && latest?.decided ? sgt(...latest.decided)
              : to === "confirmed" ? sgt("2026-10-09", 9)
              : addDays(historyStart, i * 3),
          })),
        },
        venueBookings: {
          create: [
            {
              venueId: venue.id,
              layoutName: "theatre",
              startsAt,
              endsAt,
              status: "approved",
              requestedBy: coordinator,
              requestedAt: historyStart,
              decidedBy: venueStaff,
              decidedAt: addDays(historyStart, 2),
            },
          ],
        },
        equipmentRequests: {
          create: [
            {
              equipmentId: mic.id,
              quantityRequested: 2,
              quantityReserved: 2,
              status: "reserved",
              reviewedBy: techSupport,
              reviewedAt: addDays(historyStart, 3),
              requestedBy: coordinator,
              requestedAt: historyStart,
              startsAt,
              endsAt,
            },
          ],
        },
        safetyChecks: {
          create: f.checks.map((c) => ({
            status: c.status,
            submittedBy: coordinator,
            submittedAt: sgt(...c.submitted),
            ...(c.decided
              ? { decidedBy: safetyOfficer, decidedAt: sgt(...c.decided), decisionNote: c.note ?? null }
              : {}),
          })),
        },
      },
      select: { sequenceNumber: true },
    });

    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(30)} ${f.status.padEnd(14)} ${f.date}  ${f.testCases}`
    );
  }

  console.log(`Done: SPM88 Harbour Studio and ${FIXTURES.length} SPM-88 events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
