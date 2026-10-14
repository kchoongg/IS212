/**
 * SPM-87 (Conduct Operational Safety Check) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm87
 *
 * Touches only its own rows: the events whose seedKey starts with "spm87_"
 * (their bookings, equipment requests, safety checks and history go with them)
 * and the dedicated venue SPM87-STU "SPM87 Hillside Studio" (its layout and
 * maintenance period go with it). A dedicated venue, so the maintenance period
 * AC2 needs never appears on anyone else's room.
 *
 * Re-run before each pass through docs/test-cases/SPM-87_Test_Cases.xlsx, and
 * after any case that records a decision.
 *
 * Event numbers are not pinned: the cases find each event by its title. Needs
 * the base seed's users and the Handheld Wireless Mic. prisma/seed.ts creates
 * the same events (the events only) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm87_";
const VENUE_CODE = "SPM87-STU";
const MIC = "Handheld Wireless Mic";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

type Fixture = {
  key: string;
  title: string;
  status: "safety_review" | "planning";
  date: string;
  startHour: number;
  durationHours: number;
  attendance: number;
  accessibilityNotes?: string;
  testCases: string;
};

/// In Safety review, earliest event first. They are SUBMITTED in the reverse
/// order (the latest event first), so TC01 shows the list follows the event
/// date, not the submission.
const FIXTURES: Fixture[] = [
  { key: "spm87_hillside", title: "SPM87 Hillside Workshop", status: "safety_review", date: "2027-10-08", startHour: 10,
    durationHours: 3, attendance: 50, accessibilityNotes: "Two attendees use wheelchairs; step-free route needed",
    testCases: "TC01 TC02 TC08 TC11" },
  { key: "spm87_lakeside", title: "SPM87 Lakeside Conference", status: "safety_review", date: "2027-10-12", startHour: 9,
    durationHours: 8, attendance: 60, testCases: "TC01 TC06 TC12" },
  { key: "spm87_waterfront", title: "SPM87 Waterfront Gala", status: "safety_review", date: "2027-10-18", startHour: 18,
    durationHours: 4, attendance: 60, testCases: "TC01 TC03-TC05" },
  { key: "spm87_rooftop", title: "SPM87 Rooftop Launch Party", status: "safety_review", date: "2027-10-20", startHour: 19,
    durationHours: 3, attendance: 300, testCases: "TC01 TC07" },
  { key: "spm87_twin_tab", title: "SPM87 Twin Tab Briefing", status: "safety_review", date: "2027-10-22", startHour: 9,
    durationHours: 2, attendance: 30, testCases: "TC01 TC09" },
  // Never submitted: no decision button (TC10), not on Safety Checks (TC01).
  { key: "spm87_unsubmitted", title: "SPM87 Unsubmitted Planning Day", status: "planning", date: "2027-10-26", startHour: 9,
    durationHours: 4, attendance: 40, testCases: "TC01 TC10" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  safety_review: ["submitted", "under_review", "approved", "planning", "safety_review"],
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-87 fixtures -> ${host || "(DATABASE_URL not set)"}`);

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
  const mic = await prisma.equipment.findFirst({ where: { name: MIC }, select: { id: true } });
  if (!mic) throw new Error(`Equipment "${MIC}" not found - run the base seed once first.`);

  // Events first (their bookings go with them), then anything else booked at
  // the dedicated venue, then the venue itself.
  const events = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  await prisma.venueBooking.deleteMany({ where: { venue: { code: VENUE_CODE } } });
  await prisma.venue.deleteMany({ where: { code: VENUE_CODE } });
  console.log(`Removed ${events.count} SPM-87 event(s) and the SPM87 venue.`);

  const venue = await prisma.venue.create({
    data: {
      code: VENUE_CODE,
      name: "SPM87 Hillside Studio",
      description: "SPM-87 test venue",
      building: "Hillside Block",
      maxCapacity: 60,
      opensAt: "08:00",
      closesAt: "22:00",
      layouts: { create: [{ layoutName: "theatre", capacity: 60 }] },
      // AC2's "recorded venue restriction": maintenance on the morning of the
      // Hillside Workshop, before its booking (so it was never flagged).
      unavailability: {
        create: [
          { startsAt: sgt("2027-10-08", 7), endsAt: sgt("2027-10-08", 9), reason: "maintenance", createdBy: venueStaff },
        ],
      },
    },
    select: { id: true },
  });

  const submitted = FIXTURES.filter((f) => f.status === "safety_review");
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = addDays(new Date(), -(chain.length * 4 + 2));
    // Latest event submitted first: the Hillside Workshop most recently.
    const submittedAt = addDays(new Date(), -(submitted.length - submitted.indexOf(f)));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-87 conduct operational safety check test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: "theatre",
        accessibilityNotes: f.accessibilityNotes ?? null,
        submittedAt: historyStart,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: to === "safety_review" ? submittedAt : addDays(historyStart, i * 3),
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
        ...(f.status === "safety_review"
          ? { safetyChecks: { create: [{ status: "pending", submittedBy: coordinator, submittedAt }] } }
          : {}),
      },
      select: { sequenceNumber: true },
    });

    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(32)} ${f.status.padEnd(13)} ${f.date}  ${f.testCases}`
    );
  }

  console.log(`Done: SPM87 Hillside Studio and ${FIXTURES.length} SPM-87 events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
