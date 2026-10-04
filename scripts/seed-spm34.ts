/**
 * SPM-34 (Confirm Event) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm34
 *
 * Only touches events whose seedKey starts with "spm34_": it deletes them
 * (their venue bookings, equipment requests and sessions go with them - every
 * child relation of Event is onDelete: Cascade) and recreates them in their
 * starting state. Nothing else in the database is read for writing or changed.
 *
 * Re-run before each pass through docs/test-cases/SPM-34_Test_Cases.xlsx, and
 * again after it: confirming an event is exactly what the cases do.
 *
 * Needs the base seed's users, venues and equipment to exist already.
 * prisma/seed.ts creates the same events - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm34_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const DANIEL = "daniel.tan@connectsphere.com";
const PRIYA = "priya.raj@connectsphere.com";

type Booking = { venueCode: string; status: "approved" | "pending" | "rejected"; session?: string };
type Equip = { name: string; status: "requested" | "reserved" | "partially_fulfilled"; session?: string };

type Fixture = {
  key: string;
  title: string;
  coordinator: string;
  date: string;
  startHour: number;
  durationHours: number;
  /// Labels only; each session runs 3 hours from the event's start, a day apart.
  sessions?: string[];
  bookings?: Booking[];
  equipment?: Equip[];
  testCases: string;
};

/**
 * One event per state the confirmation rule can be in. Every one sits in
 * Planning, which is the only status Confirm is reachable from.
 */
const FIXTURES: Fixture[] = [
  // Ready: approved venue, every requirement reserved.
  { key: "spm34_ready", title: "SPM34 Ready To Confirm", coordinator: DANIEL,
    date: "2027-05-10", startHour: 9, durationHours: 6,
    bookings: [{ venueCode: "ORC-SEM", status: "approved" }],
    equipment: [{ name: "Handheld Wireless Mic", status: "reserved" }],
    testCases: "TC01 TC08 TC09" },

  // AC2 derived: no equipment was ever recorded, so none is required.
  { key: "spm34_venue_only", title: "SPM34 Venue Only", coordinator: DANIEL,
    date: "2027-05-11", startHour: 9, durationHours: 4,
    bookings: [{ venueCode: "ORC-SEM", status: "approved" }],
    testCases: "TC02" },

  // Boundary: Technical Support committed what they could.
  { key: "spm34_partial", title: "SPM34 Partially Fulfilled", coordinator: DANIEL,
    date: "2027-05-12", startHour: 9, durationHours: 4,
    bookings: [{ venueCode: "ORC-SEM", status: "approved" }],
    equipment: [{ name: "Handheld Wireless Mic", status: "partially_fulfilled" }],
    testCases: "TC03" },

  // No venue at all.
  { key: "spm34_no_venue", title: "SPM34 No Venue", coordinator: DANIEL,
    date: "2027-05-13", startHour: 9, durationHours: 4,
    equipment: [{ name: "Handheld Wireless Mic", status: "reserved" }],
    testCases: "TC04" },

  // Boundary: the request exists but Venue Staff have not answered it.
  { key: "spm34_pending_venue", title: "SPM34 Pending Venue", coordinator: DANIEL,
    date: "2027-05-14", startHour: 9, durationHours: 4,
    bookings: [{ venueCode: "ORC-SEM", status: "pending" }],
    testCases: "TC05" },

  // One item reserved, one not: the refusal must name only the second.
  { key: "spm34_equipment_short", title: "SPM34 Equipment Short", coordinator: DANIEL,
    date: "2027-05-15", startHour: 9, durationHours: 4,
    bookings: [{ venueCode: "ORC-SEM", status: "approved" }],
    equipment: [
      { name: "Handheld Wireless Mic", status: "reserved" },
      { name: "Audio Mixing Desk", status: "requested" },
    ],
    testCases: "TC06" },

  // Multi-session: Day 1 has its room, Day 2 does not.
  { key: "spm34_sessions", title: "SPM34 Two Day Forum", coordinator: DANIEL,
    date: "2027-05-17", startHour: 9, durationHours: 27,
    sessions: ["Day 1", "Day 2"],
    bookings: [{ venueCode: "ORC-SEM", status: "approved", session: "Day 1" }],
    testCases: "TC07" },

  // AC4: assigned to someone else, so Daniel must not be able to confirm it.
  { key: "spm34_other_coordinator", title: "SPM34 Another Coordinator", coordinator: PRIYA,
    date: "2027-05-18", startHour: 9, durationHours: 4,
    bookings: [{ venueCode: "ORC-SEM", status: "approved" }],
    testCases: "TC09" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-34 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const coordinators = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!coordinators.has(f.coordinator)) coordinators.set(f.coordinator, await find(f.coordinator));
  }

  const venueIds = new Map<string, string>();
  const equipmentIds = new Map<string, string>();
  for (const f of FIXTURES) {
    for (const b of f.bookings ?? []) {
      if (venueIds.has(b.venueCode)) continue;
      const v = await prisma.venue.findUnique({ where: { code: b.venueCode }, select: { id: true } });
      if (!v) throw new Error(`Venue ${b.venueCode} not found - run the base seed once first.`);
      venueIds.set(b.venueCode, v.id);
    }
    for (const e of f.equipment ?? []) {
      if (equipmentIds.has(e.name)) continue;
      const item = await prisma.equipment.findFirst({ where: { name: e.name }, select: { id: true } });
      if (!item) throw new Error(`Equipment "${e.name}" not found - run the base seed once first.`);
      equipmentIds.set(e.name, item.id);
    }
  }

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-34 fixture event(s).`);

  for (const f of FIXTURES) {
    const coordinatorId = coordinators.get(f.coordinator)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const historyStart = addDays(new Date(), -(CHAIN.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-34 confirm event test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: "planning",
        startsAt,
        endsAt,
        expectedAttendance: 40,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        statusHistory: {
          create: CHAIN.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : CHAIN[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        sessions: f.sessions && {
          create: f.sessions.map((label, i) => ({
            label,
            startsAt: addDays(startsAt, i),
            endsAt: new Date(addDays(startsAt, i).getTime() + 3 * 3_600_000),
            expectedAttendance: 40,
            preferredLayout: "theatre",
          })),
        },
      },
      select: { id: true, sequenceNumber: true, sessions: { select: { id: true, label: true } } },
    });

    const sessionId = (label?: string) =>
      label ? (created.sessions.find((s) => s.label === label)?.id ?? null) : null;

    for (const b of f.bookings ?? []) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          sessionId: sessionId(b.session),
          venueId: venueIds.get(b.venueCode)!,
          layoutName: "theatre",
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinatorId,
          requestedAt: historyStart,
          ...(b.status === "approved" || b.status === "rejected"
            ? { decidedBy: venueStaff, decidedAt: addDays(historyStart, 2) }
            : {}),
          ...(b.status === "rejected" ? { decisionReason: "Room unavailable for this period." } : {}),
        },
      });
    }

    for (const e of f.equipment ?? []) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          sessionId: sessionId(e.session),
          equipmentId: equipmentIds.get(e.name)!,
          quantityRequested: 2,
          ...(e.status !== "requested"
            ? { quantityReserved: e.status === "reserved" ? 2 : 1, reviewedBy: techSupport, reviewedAt: addDays(historyStart, 3) }
            : {}),
          status: e.status,
          requestedBy: coordinatorId,
          requestedAt: historyStart,
          startsAt: addDays(startsAt, 0),
          endsAt,
        },
      });
    }

    const held = [
      ...(f.bookings ?? []).map((b) => `${b.venueCode}:${b.status}`),
      ...(f.equipment ?? []).map((e) => `${e.name.split(" ")[0]}:${e.status}`),
    ].join(" ");
    console.log(
      `  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(28)} ${held.padEnd(46)} ${f.testCases}`
    );
  }

  console.log(`Done: ${FIXTURES.length} SPM-34 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
