/**
 * SPM-82 (Expire Tentative Venue Hold) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm82
 *
 * Creates (or resets) SPM-82's test room, SPM82 Hold Room (SPM82-HOLD, 60
 * minutes of setup and of turnaround), and recreates the story's events with
 * their venue bookings. Only touches that venue and events whose seedKey starts
 * with "spm82_": deleting the events takes their bookings and the
 * notifications about them too (onDelete: Cascade). Nothing else changes.
 *
 * Holds that are already past their expiry are created as PENDING, exactly as
 * a real one would be: the next time anyone reads bookings, the app marks them
 * Expired and notifies Daniel Tan (src/lib/holdExpiryService.ts).
 *
 * Most dates are fixed. Three things are relative to when this is run, because
 * they are about time passing: SPM82 Short Notice Meetup starts 3 days later
 * (TC02), and SPM82 Closing Soon Forum's hold expires 12 hours later (TC07).
 * The script prints both.
 *
 * Run it before and after any case that changes data
 * (docs/test-cases/SPM-82_Test_Cases.xlsx). Event numbers are not pinned: the
 * cases find each event by its title. prisma/seed.ts creates the same venue
 * and events (the events only - their bookings are made here) - keep the two
 * in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm82_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number, minute = 0): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/// "2026-10-18": a date in Singapore, n days from now.
function sgtDateFromNow(days: number): string {
  const shifted = new Date(Date.now() + days * 86_400_000 + SGT_OFFSET_HOURS * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

const DANIEL = "daniel.tan@connectsphere.com";
const HOLD_ROOM = {
  code: "SPM82-HOLD",
  name: "SPM82 Hold Room",
  description: "SPM-82 test venue: 60 minutes of setup and of turnaround",
  building: "Orchard Hub",
  floor: "L3",
  maxCapacity: 80,
  opensAt: "07:00",
  closesAt: "23:00",
  setupMinutes: 60,
  teardownMinutes: 60,
};
const HOLD_ROOM_LAYOUTS = [
  { layoutName: "theatre", capacity: 80 },
  { layoutName: "classroom", capacity: 40 },
];

/// A hold that ran out before anyone looks: the app expires it on first read.
const LAPSED = sgt("2026-10-01", 9);

type Booking = {
  venueCode: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  holdExpiresAt: Date | null;
};

type Fixture = {
  key: string;
  title: string;
  date: string;
  startHour: number;
  durationHours: number;
  bookings: Booking[];
  testCases: string;
};

function fixtures(): Fixture[] {
  return [
    // AC1, AC3: a pending hold, with a fixed expiry, for Venue Staff to see and move.
    { key: "spm82_briefing", title: "SPM82 Harbour Product Briefing", date: "2027-02-08", startHour: 9, durationHours: 3,
      bookings: [{ venueCode: HOLD_ROOM.code, status: "pending", holdExpiresAt: sgt("2027-01-15", 9) }],
      testCases: "TC03 TC04 TC07 TC10 TC11" },
    // AC3, AC4: Venue Staff bring this one's expiry forward and watch it expire.
    { key: "spm82_countdown", title: "SPM82 Countdown Clinic", date: "2027-02-15", startHour: 9, durationHours: 3,
      bookings: [{ venueCode: HOLD_ROOM.code, status: "pending", holdExpiresAt: sgt("2027-01-20", 9) }],
      testCases: "TC05" },
    // AC4, AC8, AC11: every kind of booking side by side. The Hold Room hold
    // lapsed; the Orchard Seminar Room booking was approved before its own hold
    // deadline passed, so it stays approved.
    { key: "spm82_lapsed", title: "SPM82 Lapsed Workshop", date: "2027-02-22", startHour: 14, durationHours: 3,
      bookings: [
        { venueCode: HOLD_ROOM.code, status: "pending", holdExpiresAt: LAPSED },
        { venueCode: "ORC-SEM", status: "approved", holdExpiresAt: LAPSED },
        { venueCode: "MAR-AUD", status: "rejected", holdExpiresAt: LAPSED },
        { venueCode: "ORC-GAL", status: "withdrawn", holdExpiresAt: LAPSED },
        { venueCode: "ONE-SEM", status: "pending", holdExpiresAt: sgt("2027-02-20", 9) },
      ],
      testCases: "TC03 TC06 TC07 TC10 TC11" },
    // AC9: a hold that expires within the warning period.
    { key: "spm82_warn", title: "SPM82 Closing Soon Forum", date: "2027-03-01", startHour: 9, durationHours: 3,
      bookings: [{ venueCode: HOLD_ROOM.code, status: "pending", holdExpiresAt: new Date(Date.now() + 12 * 3_600_000) }],
      testCases: "TC07" },
    // AC5, AC10: the event's only booking was a hold that lapsed.
    { key: "spm82_expired_only", title: "SPM82 Expired Only Talk", date: "2027-03-01", startHour: 14, durationHours: 2,
      bookings: [{ venueCode: HOLD_ROOM.code, status: "pending", holdExpiresAt: LAPSED }],
      testCases: "TC08 TC09" },
    // AC6: wants the room just after the lapsed workshop, overlapping its turnaround.
    { key: "spm82_rival", title: "SPM82 Rival Seminar", date: "2027-02-22", startHour: 17, durationHours: 2,
      bookings: [], testCases: "TC10" },
    // AC2: no booking yet - the tester makes the first request.
    { key: "spm82_fresh", title: "SPM82 Fresh Request Expo", date: "2027-03-08", startHour: 9, durationHours: 3,
      bookings: [], testCases: "TC01" },
    // AC2 boundary: starts in 3 days, sooner than a hold's 7.
    { key: "spm82_short", title: "SPM82 Short Notice Meetup", date: sgtDateFromNow(3), startHour: 10, durationHours: 2,
      bookings: [], testCases: "TC02" },
  ];
}

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-82 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const coordinator = await find(DANIEL);
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const list = fixtures();
  const venues = new Map<string, string>();
  for (const code of new Set(list.flatMap((f) => f.bookings.map((b) => b.venueCode)).filter((c) => c !== HOLD_ROOM.code))) {
    const v = await prisma.venue.findUnique({ where: { code }, select: { id: true } });
    if (!v) throw new Error(`Venue ${code} not found - run the base seed once first.`);
    venues.set(code, v.id);
  }

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-82 fixture event(s) and their bookings.`);

  const room = await prisma.venue.upsert({
    where: { code: HOLD_ROOM.code },
    create: HOLD_ROOM,
    update: { ...HOLD_ROOM, isActive: true },
  });
  for (const l of HOLD_ROOM_LAYOUTS) {
    await prisma.venueLayout.upsert({
      where: { venueId_layoutName: { venueId: room.id, layoutName: l.layoutName } },
      create: { venueId: room.id, ...l },
      update: { capacity: l.capacity },
    });
  }
  venues.set(HOLD_ROOM.code, room.id);
  console.log(`Venue ${HOLD_ROOM.code} ready (setup and turnaround 60 minutes).`);

  const historyStart = new Date("2026-09-10T02:00:00.000Z");
  for (const f of list) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-82 expire tentative venue hold test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: "planning",
        startsAt,
        endsAt,
        expectedAttendance: 30,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        statusHistory: {
          create: CHAIN.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : CHAIN[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 3),
            reason: REASONS[to],
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    // Oldest request first, a minute apart, so "a newer request" (AC10) has
    // a meaning for these too.
    for (const [i, b] of f.bookings.entries()) {
      const decided = b.status === "approved" || b.status === "rejected";
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venues.get(b.venueCode)!,
          layoutName: "theatre",
          expectedAttendance: 30,
          startsAt,
          endsAt,
          status: b.status,
          holdExpiresAt: b.holdExpiresAt,
          requestedBy: coordinator,
          requestedAt: new Date(addDays(historyStart, 12).getTime() + i * 60_000),
          decidedBy: decided ? venueStaff : undefined,
          decidedAt: decided ? addDays(historyStart, 14) : undefined,
          decisionReason: b.status === "rejected" ? "Auditorium closed for rigging that week." : undefined,
          cancelledBy: b.status === "withdrawn" ? coordinator : undefined,
          cancelledAt: b.status === "withdrawn" ? addDays(historyStart, 13) : undefined,
          cancellationReason: b.status === "withdrawn" ? "Found a better room." : undefined,
        },
      });
    }
    const held = f.bookings.map((b) => `${b.venueCode}:${b.status}`).join(", ") || "no booking";
    console.log(`  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(32)} ${f.date}  ${held}  ${f.testCases}`);
  }

  const warn = list.find((f) => f.key === "spm82_warn")!.bookings[0].holdExpiresAt!;
  console.log(`SPM82 Short Notice Meetup starts ${sgtDateFromNow(3)} 10:00; SPM82 Closing Soon Forum's hold expires ${warn.toISOString()}.`);
  console.log(`Done: ${list.length} SPM-82 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
