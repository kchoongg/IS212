/**
 * SPM-53 (Receive Event Notifications) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm53
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm53_": it deletes them (their status
 *     history, bookings, equipment lines, change requests, registrations and
 *     notifications go with them - every child relation of Event is
 *     onDelete: Cascade) and recreates them in their starting state. So every
 *     notification a case raised is gone after the next run;
 *   - its two test rooms, SPM53 Hall (SPM53-HAL) and SPM53 Studio (SPM53-STU),
 *     and its three test items, SPM53 Projector (4), SPM53 Lectern Mic (2) and
 *     SPM53 Speaker (2), which it upserts and puts back to their starting
 *     values with no other bookings or requests, so nobody else's can get in
 *     the way.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Every case raises notifications, so run it again after each case
 * (docs/test-cases/SPM-53_Test_Cases.xlsx says which).
 *
 * Dates avoid September on purpose: the app writes it as "Sept", and every
 * other month as its three-letter form. SPM53 Harbour Finished Dinner is the
 * one exception: it ended yesterday, whenever the script is run, so it can be
 * marked completed (SPM-36 allows that once an event has ended, and completes
 * it on its own 7 days later).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same events (the events only - everything they
 * hold is made here) after its last existing block - keep the two in step.
 *
 * Needs the base seed's users (Rachel Ng, Daniel Tan, Grace Lim, Marcus Wong,
 * Vikram Nair, Lee Wei Ming, Anita Devi) to exist.
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm53_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Yesterday's date in Singapore, as YYYY-MM-DD. */
function yesterdayInSingapore(): string {
  return new Date(Date.now() + 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
}

const VENUES = [
  { code: "SPM53-HAL", name: "SPM53 Hall" },
  { code: "SPM53-STU", name: "SPM53 Studio" },
] as const;
const VENUE_FIELDS = {
  description: "SPM-53 test venue: no setup or turnaround",
  building: "Orchard Hub", floor: "L5", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
  setupMinutes: 0, teardownMinutes: 0, isActive: true,
};
const LAYOUTS = [
  { layoutName: "theatre", capacity: 60 },
  { layoutName: "classroom", capacity: 40 },
];

const EQUIPMENT = [
  { name: "SPM53 Projector", description: "SPM-53 test item: 4 in total", totalQuantity: 4 },
  { name: "SPM53 Lectern Mic", description: "SPM-53 test item: 2 in total", totalQuantity: 2 },
  { name: "SPM53 Speaker", description: "SPM-53 test item: 2 in total", totalQuantity: 2 },
] as const;
const EQUIPMENT_FIELDS = {
  category: "AV", quantityInMaintenance: 0, outOfServiceReason: null, outOfServiceType: null,
  isActive: true, locationVenueId: null,
};

type Booking = { venueCode: string; status: "pending" | "approved" };
type Line = { item: string; quantity: number; status: "requested" | "reserved" };
type Attendee = { email: string; status: "registered" | "withdrawn" | "waitlisted" };

type Fixture = {
  key: string;
  title: string;
  status: string;
  date: string; // YYYY-MM-DD, Singapore
  start?: string; // default 09:00
  end?: string; // default 12:00
  /** Default Daniel Tan; null for an event not yet assigned. */
  coordinator?: string | null;
  description?: string;
  bookings?: Booking[];
  equipment?: Line[];
  /** TC13: a pending change of details from the organiser. */
  changeRequest?: boolean;
  /** Registration enabled, with these attendees. */
  registration?: { closes: string; attendees: Attendee[] };
  testCases: string;
};

const DANIEL = "daniel.tan@connectsphere.com";
const LEE = "lee.wei.ming@example.com";
const ANITA = "anita.devi@example.com";

/** Every event is Rachel Ng's, 30 attendees, theatre. */
const FIXTURES: Fixture[] = [
  { key: "spm53_draft", title: "SPM53 Harbour Draft Summit", status: "draft", date: "2028-03-02",
    coordinator: null, testCases: "TC01" },
  { key: "spm53_clarify", title: "SPM53 Harbour Clarity Forum", status: "under_review", date: "2028-03-07",
    description: "A morning forum for wealth clients.", testCases: "TC02 TC03" },
  { key: "spm53_approve", title: "SPM53 Harbour Approval Day", status: "under_review", date: "2028-03-09",
    testCases: "TC04" },
  { key: "spm53_reject", title: "SPM53 Harbour Rejected Brief", status: "under_review", date: "2028-03-14",
    testCases: "TC05" },
  { key: "spm53_assign", title: "SPM53 Harbour Assign Expo", status: "submitted", date: "2028-03-16",
    coordinator: null, testCases: "TC06 TC07" },
  { key: "spm53_venue", title: "SPM53 Harbour Venue Day", status: "planning", date: "2028-03-21",
    testCases: "TC08" },
  { key: "spm53_booking_review", title: "SPM53 Harbour Booking Review", status: "planning", date: "2028-03-23",
    bookings: [{ venueCode: "SPM53-HAL", status: "pending" }, { venueCode: "SPM53-STU", status: "pending" }],
    testCases: "TC09" },
  { key: "spm53_equipment", title: "SPM53 Harbour Equipment Fair", status: "planning", date: "2028-03-28",
    equipment: [{ item: "SPM53 Projector", quantity: 2, status: "requested" }, { item: "SPM53 Lectern Mic", quantity: 1, status: "requested" }],
    testCases: "TC10" },
  { key: "spm53_fulfilment", title: "SPM53 Harbour Fulfilment Gala", status: "planning", date: "2028-03-30",
    equipment: [
      { item: "SPM53 Projector", quantity: 2, status: "requested" },
      { item: "SPM53 Lectern Mic", quantity: 3, status: "requested" },
      { item: "SPM53 Speaker", quantity: 1, status: "requested" },
    ],
    testCases: "TC11" },
  { key: "spm53_change_talk", title: "SPM53 Harbour Change Talk", status: "approved", date: "2028-04-04",
    description: "A talk on regional markets.", testCases: "TC12" },
  { key: "spm53_change_review", title: "SPM53 Harbour Change Review", status: "planning", date: "2028-04-06",
    description: "Quarterly briefing.", changeRequest: true, testCases: "TC13" },
  { key: "spm53_edit", title: "SPM53 Harbour Edit Forum", status: "approved", date: "2028-04-11",
    testCases: "TC14" },
  { key: "spm53_ordinary_edit", title: "SPM53 Harbour Ordinary Edit", status: "approved", date: "2028-04-13",
    description: "Morning session.", testCases: "TC15" },
  { key: "spm53_confirmed_gala", title: "SPM53 Harbour Confirmed Gala", status: "confirmed", date: "2028-04-18",
    bookings: [{ venueCode: "SPM53-HAL", status: "approved" }],
    equipment: [{ item: "SPM53 Projector", quantity: 1, status: "reserved" }],
    registration: { closes: "2028-04-10", attendees: [{ email: LEE, status: "registered" }, { email: ANITA, status: "withdrawn" }] },
    testCases: "TC16" },
  { key: "spm53_open_day", title: "SPM53 Harbour Open Day", status: "confirmed", date: "2028-04-20",
    registration: { closes: "2028-04-15", attendees: [] }, testCases: "TC17" },
  { key: "spm53_ready", title: "SPM53 Harbour Ready Launch", status: "planning", date: "2028-04-27",
    bookings: [{ venueCode: "SPM53-STU", status: "approved" }],
    equipment: [{ item: "SPM53 Projector", quantity: 1, status: "reserved" }],
    testCases: "TC18" },
  { key: "spm53_finished", title: "SPM53 Harbour Finished Dinner", status: "confirmed", date: yesterdayInSingapore(),
    start: "19:00", end: "22:00", testCases: "TC19" },
  { key: "spm53_postpone", title: "SPM53 Harbour Postponed Fair", status: "confirmed", date: "2028-05-04",
    registration: { closes: "2028-05-01", attendees: [{ email: LEE, status: "registered" }, { email: ANITA, status: "withdrawn" }] },
    testCases: "TC20" },
  { key: "spm53_cancel", title: "SPM53 Harbour Cancelled Summit", status: "confirmed", date: "2028-05-09",
    registration: { closes: "2028-05-05", attendees: [{ email: LEE, status: "registered" }, { email: ANITA, status: "waitlisted" }] },
    testCases: "TC21" },
];

/** The status history each starting status was reached by, as prisma/seed.ts's CHAIN. */
const CHAIN: Record<string, string[]> = {
  draft: [],
  submitted: ["submitted"],
  under_review: ["submitted", "under_review"],
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-53 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("vikram.nair@connectsphere.com");
  const users = new Map<string, string>();
  for (const email of [DANIEL, LEE, ANITA]) users.set(email, await find(email));
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // Reset: drop the previous run's events. Cascades take their children,
  // notifications included.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-53 fixture event(s).`);

  const venueIds = new Map<string, string>();
  for (const v of VENUES) {
    const venue = await prisma.venue.upsert({
      where: { code: v.code },
      create: { ...VENUE_FIELDS, ...v },
      update: { ...VENUE_FIELDS, ...v },
    });
    await prisma.venueLayout.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueLayout.createMany({ data: LAYOUTS.map((l) => ({ venueId: venue.id, ...l })) });
    await prisma.venueFacility.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueBooking.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  const equipmentIds = new Map<string, string>();
  for (const e of EQUIPMENT) {
    const item = await prisma.equipment.upsert({
      where: { name: e.name },
      create: { ...EQUIPMENT_FIELDS, ...e },
      update: { ...EQUIPMENT_FIELDS, ...e },
    });
    await prisma.equipmentRequest.deleteMany({ where: { equipmentId: item.id } });
    equipmentIds.set(e.name, item.id);
  }
  console.log(`Venues ${VENUES.map((v) => v.code).join(", ")} and ${EQUIPMENT.map((e) => e.name).join(", ")} ready.`);

  const now = new Date();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.start ?? "09:00");
    const endsAt = sgt(f.date, f.end ?? "12:00");
    const coordinator = f.coordinator === null ? null : users.get(f.coordinator ?? DANIEL)!;
    const chain = CHAIN[f.status];
    const historyStart = addDays(now, -(chain.length * 5 + 2));

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-53 receive event notifications test event",
        description: f.description,
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 30,
        preferredLayout: "theatre",
        submittedAt: f.status === "draft" ? undefined : historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(now, -3) : undefined,
        ...(f.registration
          ? {
              registrationEnabled: true,
              registrationCapacity: 40,
              registrationOpensAt: sgt("2026-10-01", "09:00"),
              registrationClosesAt: sgt(f.registration.closes, "17:00"),
            }
          : {}),
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    // One minute apart, so the lists show them in the same order on every run.
    for (const [i, b] of (f.bookings ?? []).entries()) {
      const approved = b.status === "approved";
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venueIds.get(b.venueCode)!,
          layoutName: "theatre",
          expectedAttendance: 30,
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinator!,
          requestedAt: new Date(addDays(now, -4).getTime() + i * 60_000),
          decidedBy: approved ? venueStaff : undefined,
          decidedAt: approved ? addDays(now, -3) : undefined,
        },
      });
    }

    for (const [i, line] of (f.equipment ?? []).entries()) {
      const reserved = line.status === "reserved";
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipmentIds.get(line.item)!,
          quantityRequested: line.quantity,
          quantityReserved: reserved ? line.quantity : null,
          startsAt,
          endsAt,
          status: line.status,
          requestedBy: coordinator!,
          requestedAt: new Date(addDays(now, -4).getTime() + i * 60_000),
          reviewedBy: reserved ? techSupport : undefined,
          reviewedAt: reserved ? addDays(now, -3) : undefined,
        },
      });
    }

    // In SPM-35's shape, as scripts/seed-spm32.ts's SPM32 Harbour Briefing.
    if (f.changeRequest) {
      const request: Prisma.EventChangeRequestUncheckedCreateInput = {
        eventId: created.id,
        requestedBy: organiser.id,
        requestedAt: addDays(now, -1),
        kind: "change",
        reason: "More clients have confirmed and we are adding lunch.",
        changes: [
          { field: "title", current: f.title, proposed: `${f.title} and Lunch` },
          { field: "description", current: f.description, proposed: "Quarterly briefing with lunch." },
          { field: "expectedAttendance", current: 30, proposed: 45 },
        ],
        isSignificant: true,
        status: "pending",
      };
      await prisma.eventChangeRequest.create({ data: request });
    }

    for (const a of f.registration?.attendees ?? []) {
      await prisma.registration.create({
        data: {
          eventId: created.id,
          attendeeId: users.get(a.email)!,
          status: a.status,
          registeredAt: addDays(now, -5),
          waitlistedAt: a.status === "waitlisted" ? addDays(now, -2) : undefined,
          withdrawnAt: a.status === "withdrawn" ? addDays(now, -2) : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(32)} ${f.status.padEnd(13)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-53 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
