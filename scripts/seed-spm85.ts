/**
 * SPM-85 (Safety Officer Role and Access) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm85
 *
 * Creates (or refreshes) the Safety Officer account, Hana Yusof, and the
 * story's own events. Only touches the user hana.yusof@connectsphere.com and
 * events whose seedKey starts with "spm85_": it deletes those events (their
 * sessions, bookings, equipment, facility requirements, registrations, safety
 * checks and history go with them - every child relation of Event is
 * onDelete: Cascade) and recreates them. Nothing else in the database changes.
 *
 * SPM-85's cases only read, so one run before a pass through
 * docs/test-cases/SPM-85_Test_Cases.xlsx is enough.
 *
 * Event numbers are not pinned: the cases find each event by its title.
 * Needs the base seed's users, venues, facilities and equipment to exist.
 * prisma/seed.ts creates the same user and events (the events only - their
 * sessions, bookings, equipment and registrations are made here) - keep the
 * two in step.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm85_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/// The Safety Officer (AC1). Same password as every seeded account.
const SAFETY_OFFICER = {
  email: "hana.yusof@connectsphere.com",
  fullName: "Hana Yusof",
  role: "safety_officer",
  department: "Safety & Compliance",
};
const DEMO_PASSWORD = "password123";

const DANIEL = "daniel.tan@connectsphere.com";

type Session = { label: string; from: number; to: number; attendance: number; layout: string; venue: string };
type Equip = { name: string; quantity: number; session: string };

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "safety_review" | "confirmed";
  date: string;
  startHour: number;
  durationHours: number;
  attendance: number;
  layout: string;
  accessibilityNotes?: string;
  facilities?: { name: string; mandatory: boolean }[];
  sessions?: Session[];
  /// A whole-event booking, for an event without sessions.
  venue?: string;
  equipment?: Equip[];
  /// Submitted for a safety check (SPM-86) at this time, by the coordinator.
  submittedForCheck?: Date;
  registration?: { capacity: number; attendees: { email: string; dietary?: string; accessibility?: string }[] };
  testCases: string;
};

const FIXTURES: Fixture[] = [
  // AC3: everything a safety review reads, on an event waiting for its check.
  // Two sessions in two rooms on one day (Week 7 change #3).
  {
    key: "spm85_forum",
    title: "SPM85 Harbour Safety Forum",
    status: "safety_review",
    date: "2027-09-27",
    startHour: 9,
    durationHours: 8,
    attendance: 200,
    layout: "theatre",
    accessibilityNotes: "Two wheelchair users attending; keep the aisle beside row A clear.",
    facilities: [
      { name: "Step-free access", mandatory: true },
      { name: "Hearing induction loop", mandatory: false },
    ],
    sessions: [
      { label: "Main programme", from: 9, to: 12, attendance: 200, layout: "theatre", venue: "MAR-AUD" },
      { label: "Breakout workshop", from: 13, to: 17, attendance: 60, layout: "classroom", venue: "ORC-SEM" },
    ],
    equipment: [
      { name: "Handheld Wireless Mic", quantity: 4, session: "Main programme" },
      { name: "Wheelchair Access Ramp", quantity: 1, session: "Main programme" },
    ],
    submittedForCheck: sgt("2026-10-10", 10),
    testCases: "TC04 TC05 TC06 TC10 TC12 TC13",
  },
  // AC4, AC6: confirmed and open for registration, with two people registered
  // whose names and needs a Safety Officer must never see.
  {
    key: "spm85_launch",
    title: "SPM85 Riverside Product Launch",
    status: "confirmed",
    date: "2027-09-24",
    startHour: 19,
    durationHours: 3,
    attendance: 80,
    layout: "theatre",
    venue: "ORC-GAL",
    registration: {
      capacity: 80,
      attendees: [
        { email: "lee.wei.ming@example.com", dietary: "Vegetarian", accessibility: "Wheelchair user - front row please" },
        { email: "anita.devi@example.com" },
      ],
    },
    testCases: "TC07 TC08 TC11",
  },
  // Boundary: still being planned, so not on the Safety Checks list.
  {
    key: "spm85_planning",
    title: "SPM85 Marina Networking Night",
    status: "planning",
    date: "2027-09-20",
    startHour: 18,
    durationHours: 3,
    attendance: 50,
    layout: "theatre",
    testCases: "TC03 TC04 TC12",
  },
];

/// Each status's path from Draft. Confirmed is reached from Planning: an event
/// confirmed before SPM-86 never went through Safety review.
const CHAINS: Record<Fixture["status"], string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  safety_review: ["submitted", "under_review", "approved", "planning", "safety_review"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  safety_review: "Submitted for an Operational Safety Check",
  confirmed: "Arrangements complete",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-85 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const coordinator = await find(DANIEL);
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const lookup = async <T extends { id: string }>(
    what: string,
    names: string[],
    query: (name: string) => Promise<T | null>
  ) => {
    const ids = new Map<string, string>();
    for (const name of names) {
      const row = await query(name);
      if (!row) throw new Error(`${what} "${name}" not found - run the base seed once first.`);
      ids.set(name, row.id);
    }
    return ids;
  };
  const venues = await lookup(
    "Venue",
    [...new Set(FIXTURES.flatMap((f) => [...(f.sessions ?? []).map((s) => s.venue), ...(f.venue ? [f.venue] : [])]))],
    (code) => prisma.venue.findUnique({ where: { code }, select: { id: true } })
  );
  const facilities = await lookup(
    "Facility",
    [...new Set(FIXTURES.flatMap((f) => (f.facilities ?? []).map((x) => x.name)))],
    (name) => prisma.facility.findFirst({ where: { name }, select: { id: true } })
  );
  const equipment = await lookup(
    "Equipment",
    [...new Set(FIXTURES.flatMap((f) => (f.equipment ?? []).map((e) => e.name)))],
    (name) => prisma.equipment.findFirst({ where: { name }, select: { id: true } })
  );
  const attendees = await lookup(
    "Attendee",
    [...new Set(FIXTURES.flatMap((f) => (f.registration?.attendees ?? []).map((a) => a.email)))],
    (email) => prisma.user.findUnique({ where: { email }, select: { id: true } })
  );

  // AC1: the Safety Officer. Upserted, so a rerun refreshes the account
  // (role, name, active) without touching anyone else.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: SAFETY_OFFICER.email },
    create: { ...SAFETY_OFFICER, passwordHash },
    update: { ...SAFETY_OFFICER, passwordHash, isActive: true },
  });
  console.log(`Safety Officer ${SAFETY_OFFICER.fullName} <${SAFETY_OFFICER.email}> ready (password ${DEMO_PASSWORD}).`);

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-85 fixture event(s).`);

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAINS[f.status];
    const historyStart = addDays(new Date("2026-09-14T02:00:00.000Z"), 0);

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-85 Safety Officer role and access test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        accessibilityNotes: f.accessibilityNotes,
        submittedAt: historyStart,
        registrationEnabled: Boolean(f.registration),
        registrationCapacity: f.registration?.capacity,
        registrationOpensAt: f.registration ? sgt("2026-10-01", 9) : undefined,
        registrationClosesAt: f.registration ? sgt("2027-09-17", 23) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        facilityRequirements: f.facilities && {
          create: f.facilities.map((x) => ({ facilityId: facilities.get(x.name)!, isMandatory: x.mandatory })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    // Sessions, each with its own approved room (AC3).
    const sessionIds = new Map<string, string>();
    for (const s of f.sessions ?? []) {
      const session = await prisma.eventSession.create({
        data: {
          eventId: created.id,
          label: s.label,
          startsAt: sgt(f.date, s.from),
          endsAt: sgt(f.date, s.to),
          expectedAttendance: s.attendance,
          preferredLayout: s.layout,
        },
        select: { id: true },
      });
      sessionIds.set(s.label, session.id);
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          sessionId: session.id,
          venueId: venues.get(s.venue)!,
          layoutName: s.layout,
          startsAt: sgt(f.date, s.from),
          endsAt: sgt(f.date, s.to),
          status: "approved",
          requestedBy: coordinator,
          requestedAt: addDays(historyStart, 16),
          decidedBy: venueStaff,
          decidedAt: addDays(historyStart, 17),
        },
      });
    }

    // A whole-event room, for an event without sessions.
    let wholeEventBooking: string | null = null;
    if (f.venue) {
      const booking = await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venues.get(f.venue)!,
          layoutName: f.layout,
          startsAt,
          endsAt,
          status: "approved",
          requestedBy: coordinator,
          requestedAt: addDays(historyStart, 16),
          decidedBy: venueStaff,
          decidedAt: addDays(historyStart, 17),
        },
        select: { id: true },
      });
      wholeEventBooking = booking.id;
    }
    // SPM-64: registration capacity is measured against the booked room.
    if (f.registration && wholeEventBooking) {
      await prisma.event.update({ where: { id: created.id }, data: { registrationVenueBookingId: wholeEventBooking } });
    }

    // Equipment, reserved in full by Technical Support (AC3).
    for (const e of f.equipment ?? []) {
      const session = f.sessions!.find((s) => s.label === e.session)!;
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          sessionId: sessionIds.get(e.session),
          equipmentId: equipment.get(e.name)!,
          quantityRequested: e.quantity,
          quantityReserved: e.quantity,
          startsAt: sgt(f.date, session.from),
          endsAt: sgt(f.date, session.to),
          status: "reserved",
          requestedBy: coordinator,
          requestedAt: addDays(historyStart, 16),
          reviewedBy: techSupport,
          reviewedAt: addDays(historyStart, 18),
        },
      });
    }

    // SPM-86: the submission the Safety Officer's list is built from.
    if (f.submittedForCheck) {
      await prisma.safetyCheck.create({
        data: { eventId: created.id, status: "pending", submittedBy: coordinator, submittedAt: f.submittedForCheck },
      });
    }

    // AC6: people registered, whose details a Safety Officer must not see.
    for (const a of f.registration?.attendees ?? []) {
      await prisma.registration.create({
        data: {
          eventId: created.id,
          attendeeId: attendees.get(a.email)!,
          status: "registered",
          registeredAt: sgt("2026-10-05", 12),
          dietaryRequirements: a.dietary,
          accessibilityRequirements: a.accessibility,
        },
      });
    }

    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(32)} ${f.status.padEnd(14)} ${f.testCases}`
    );
  }

  console.log(`Done: ${FIXTURES.length} SPM-85 fixture events ready. Log in as ${SAFETY_OFFICER.email}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
