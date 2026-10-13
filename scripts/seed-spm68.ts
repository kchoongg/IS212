/**
 * SPM-68 (Review Flagged Arrangements) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm68
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm68_": it deletes them (their status
 *     history, venue bookings, equipment requests and registrations go with
 *     them - every child relation of Event is onDelete: Cascade) and recreates
 *     them in their starting state;
 *   - its five test venues (SPM68 Hall, Annex, Spare Room, Closed Room and
 *     Retired Room), which it upserts and puts back to their starting values:
 *     their layouts and facilities, the Closed Room's one unavailable period,
 *     the Retired Room retired, and no bookings but the ones made here. Every
 *     booking in the cases is at one of these rooms, so nobody else's bookings
 *     can get in the way, and a replacement a case requests (SPM-68-TC13) is
 *     removed on the next run;
 *   - its two test equipment items (SPM68 Projector, SPM68 Speaker), which it
 *     upserts back to their starting stock.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * The flags are written straight onto the arrangements here, as though the
 * change that raises each one had already happened (an event's date or
 * attendance moved - SPM-62; registration settings - SPM-64; a venue retired
 * or marked unavailable - SPM-39, SPM-45; equipment out of service - SPM-55).
 * What the Flagged Arrangements page then shows for each is worked out live,
 * from the rooms, stock and event details set up below.
 *
 * Keeping, reviewing, requesting, releasing and confirming are exactly what
 * the test cases do, so run it again after each case that does
 * (docs/test-cases/SPM-68_Test_Cases.xlsx says which).
 *
 * Dates are in October 2027 on purpose: the app writes September as "Sept",
 * and every other month as its three-letter form, so dates quoted in the
 * cases read the same as on screen.
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same venues and events (the events only - their
 * bookings, equipment, registrations and flags are made here, as is the
 * Closed Room's unavailable period and the Retired Room's retirement) after
 * its last existing block - keep the two in step, and run this once after a
 * full reseed.
 *
 * Needs the base seed's users, facilities and attendees to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm68_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Every event runs 09:00-17:00 on its day. */
const FROM = "09:00";
const TO = "17:00";

/** What Outgrown Room requires, and every test venue has. */
const FACILITIES = ["Fixed ceiling projector", "Step-free access"];

type VenueFixture = {
  code: string;
  name: string;
  description: string;
  /** Theatre capacity; classroom is always 40. */
  theatre: number;
  isActive?: boolean;
};

const VENUES: VenueFixture[] = [
  { code: "SPM68-HAL", name: "SPM68 Hall", theatre: 100, description: "SPM-68 test venue: seats 100 in theatre layout" },
  { code: "SPM68-ANX", name: "SPM68 Annex", theatre: 60, description: "SPM-68 test venue: seats 60 in theatre layout" },
  { code: "SPM68-SPR", name: "SPM68 Spare Room", theatre: 200,
    description: "SPM-68 test venue: the replacement, seats 200 in theatre layout" },
  { code: "SPM68-CLS", name: "SPM68 Closed Room", theatre: 60,
    description: "SPM-68 test venue: unavailable for maintenance on 9 Oct 2027, 08:00-18:00" },
  { code: "SPM68-RET", name: "SPM68 Retired Room", theatre: 60, isActive: false,
    description: "SPM-68 test venue: retired" },
];
const VENUE_FIELDS = {
  building: "Orchard Hub", floor: "L5", opensAt: "07:00", closesAt: "22:00", setupMinutes: 0, teardownMinutes: 0,
};

/** The Closed Room's one unavailable period (SPM-68-TC07). */
const CLOSURE = { venueCode: "SPM68-CLS", date: "2027-10-09", from: "08:00", to: "18:00", reason: "maintenance" };

const ITEMS = [
  { name: "SPM68 Projector", totalQuantity: 4, out: 0, description: "SPM-68 test item: 4 in stock" },
  // SPM-68-TC10: 2 reserved, 1 left to give.
  { name: "SPM68 Speaker", totalQuantity: 2, out: 1, description: "SPM-68 test item: 2 in stock, 1 out of service" },
];

type Booking = {
  venueCode: string;
  status: "pending" | "approved";
  /** Reason codes, comma-separated; omitted for a booking that is not flagged. */
  flagged?: string;
  /** The booking's own date, when it is not the event's (SPM-68-TC08). */
  date?: string;
};

type Fixture = {
  key: string;
  title: string;
  date: string; // YYYY-MM-DD, Singapore
  attendance: number;
  status?: "planning";
  coordinator?: string;
  facilities?: string[];
  bookings?: Booking[];
  /** Reserved in full by Technical Support, and flagged. */
  equipment?: { name: string; quantity: number; flagged: string };
  registration?: {
    enabled: boolean;
    capacity: number;
    registered: number;
    waitlisted?: number;
    flagged: string;
  };
  testCases: string;
};

const DANIEL = "daniel.tan@connectsphere.com";
const PRIYA = "priya.raj@connectsphere.com";

/** Every event is Planning, theatre, and Rachel Ng's; Daniel Tan's unless it says otherwise. */
const FIXTURES: Fixture[] = [
  // Read-only: one of everything, and a second booking that is NOT flagged (AC3).
  { key: "spm68_listing", title: "SPM68 Listing Summit", date: "2027-10-07", attendance: 50,
    bookings: [
      { venueCode: "SPM68-HAL", status: "approved", flagged: "event_schedule_changed,event_requirements_changed" },
      { venueCode: "SPM68-ANX", status: "approved" },
    ],
    equipment: { name: "SPM68 Projector", quantity: 2, flagged: "event_schedule_changed" },
    registration: { enabled: true, capacity: 60, registered: 12, waitlisted: 3, flagged: "event_schedule_changed" },
    testCases: "TC01 TC02 TC04" },
  // Still fits (80 in a room for 100): TC05 keeps it.
  { key: "spm68_attendance", title: "SPM68 Attendance Review", date: "2027-10-06", attendance: 80,
    bookings: [{ venueCode: "SPM68-HAL", status: "approved", flagged: "event_attendance_changed" }],
    testCases: "TC05" },
  // No longer fits (150 in a room for 100): refused, then replaced and released.
  { key: "spm68_outgrown", title: "SPM68 Outgrown Room", date: "2027-10-08", attendance: 150, facilities: FACILITIES,
    bookings: [{ venueCode: "SPM68-HAL", status: "approved", flagged: "event_attendance_changed" }],
    testCases: "TC06 TC13 TC14" },
  { key: "spm68_trouble", title: "SPM68 Venue Trouble Day", date: "2027-10-09", attendance: 40,
    bookings: [
      { venueCode: "SPM68-CLS", status: "approved", flagged: "venue_unavailable" },
      { venueCode: "SPM68-RET", status: "approved", flagged: "venue_retired" },
    ],
    testCases: "TC07" },
  // The event moved to the 14th; its booking is still for the 13th.
  { key: "spm68_moved", title: "SPM68 Moved Date", date: "2027-10-14", attendance: 40,
    bookings: [{ venueCode: "SPM68-ANX", status: "approved", flagged: "event_schedule_changed", date: "2027-10-13" }],
    testCases: "TC08" },
  { key: "spm68_kit", title: "SPM68 Kit Recheck", date: "2027-10-15", attendance: 40,
    equipment: { name: "SPM68 Projector", quantity: 2, flagged: "event_schedule_changed" },
    testCases: "TC09" },
  { key: "spm68_short", title: "SPM68 Short Kit", date: "2027-10-16", attendance: 40,
    equipment: { name: "SPM68 Speaker", quantity: 2, flagged: "equipment_unavailable" },
    testCases: "TC10" },
  { key: "spm68_capacity", title: "SPM68 Capacity Cut", date: "2027-10-17", attendance: 40,
    registration: { enabled: true, capacity: 10, registered: 12, waitlisted: 3, flagged: "registration_capacity_lowered" },
    testCases: "TC11" },
  { key: "spm68_off", title: "SPM68 Registration Off", date: "2027-10-18", attendance: 40,
    registration: { enabled: false, capacity: 30, registered: 5, flagged: "registration_disabled" },
    testCases: "TC11" },
  // Everything in place but for the flag on its registrations: TC12 confirms it.
  { key: "spm68_ready", title: "SPM68 Ready To Confirm", date: "2027-10-20", attendance: 40,
    bookings: [{ venueCode: "SPM68-ANX", status: "approved" }],
    registration: { enabled: true, capacity: 30, registered: 8, flagged: "event_schedule_changed" },
    testCases: "TC12" },
  { key: "spm68_partner", title: "SPM68 Partner Briefing", date: "2027-10-21", attendance: 40, coordinator: PRIYA,
    bookings: [{ venueCode: "SPM68-ANX", status: "approved", flagged: "event_attendance_changed" }],
    testCases: "TC02" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning"];
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-68 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const coordinators = new Map([
    [DANIEL, await find(DANIEL)],
    [PRIYA, await find(PRIYA)],
  ]);
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  const facilityIds = new Map<string, string>();
  for (const name of FACILITIES) {
    const row = await prisma.facility.findFirst({ where: { name }, select: { id: true } });
    if (!row) throw new Error(`Facility "${name}" not found - run the base seed once first.`);
    facilityIds.set(name, row.id);
  }

  const holding = (f: Fixture) => (f.registration ? f.registration.registered + (f.registration.waitlisted ?? 0) : 0);
  const needed = Math.max(...FIXTURES.map(holding));
  const attendees = await prisma.user.findMany({
    where: { role: "attendee", isActive: true },
    orderBy: { email: "asc" },
    select: { id: true },
    take: needed,
  });
  if (attendees.length < needed) {
    throw new Error(`The cases need ${needed} attendees and the base seed has ${attendees.length}.`);
  }

  // Reset: drop the previous run's events. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-68 fixture event(s).`);

  // The test venues, back in their starting state. Any booking left at one by
  // a test pass went with its event above; one made for another story's
  // event is removed too.
  const venueIds = new Map<string, string>();
  for (const { theatre, isActive = true, ...v } of VENUES) {
    const fields = { ...VENUE_FIELDS, ...v, maxCapacity: theatre, isActive };
    const venue = await prisma.venue.upsert({ where: { code: v.code }, create: fields, update: fields });
    await prisma.venueLayout.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueLayout.createMany({
      data: [
        { venueId: venue.id, layoutName: "theatre", capacity: theatre },
        { venueId: venue.id, layoutName: "classroom", capacity: 40 },
      ],
    });
    await prisma.venueFacility.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueFacility.createMany({
      data: FACILITIES.map((name) => ({ venueId: venue.id, facilityId: facilityIds.get(name)! })),
    });
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueBooking.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  await prisma.venueUnavailability.create({
    data: {
      venueId: venueIds.get(CLOSURE.venueCode)!,
      startsAt: sgt(CLOSURE.date, CLOSURE.from),
      endsAt: sgt(CLOSURE.date, CLOSURE.to),
      reason: CLOSURE.reason,
      createdBy: venueStaff,
    },
  });
  console.log(`Venues ${VENUES.map((v) => v.code).join(", ")} ready.`);

  // The test equipment, back to its starting stock. Requests for it went with
  // their events above.
  const itemIds = new Map<string, string>();
  for (const item of ITEMS) {
    const fields = {
      category: "AV",
      description: item.description,
      totalQuantity: item.totalQuantity,
      quantityInMaintenance: item.out,
      outOfServiceType: item.out > 0 ? "under_maintenance" : null,
      outOfServiceReason: item.out > 0 ? "Driver replacement" : null,
      isActive: true,
      locationVenueId: null,
    };
    const row = await prisma.equipment.upsert({
      where: { name: item.name },
      create: { name: item.name, ...fields },
      update: fields,
    });
    await prisma.equipmentRequest.deleteMany({ where: { equipmentId: row.id } });
    itemIds.set(item.name, row.id);
  }
  console.log(`Equipment ${ITEMS.map((i) => i.name).join(", ")} ready.`);

  const now = new Date();
  const flaggedAt = addDays(now, -1);
  for (const f of FIXTURES) {
    const coordinator = coordinators.get(f.coordinator ?? DANIEL)!;
    const startsAt = sgt(f.date, FROM);
    const endsAt = sgt(f.date, TO);
    const historyStart = addDays(now, -(CHAIN.length * 5 + 2));
    const reg = f.registration;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-68 review flagged arrangements test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: "planning",
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        // Complete settings wherever registration is on, so only the flag is
        // left to review (and Ready To Confirm can be confirmed).
        registrationEnabled: reg?.enabled ?? false,
        registrationCapacity: reg?.capacity,
        registrationOpensAt: reg ? addDays(now, -10) : undefined,
        registrationClosesAt: reg ? addDays(startsAt, -2) : undefined,
        registrationReviewReason: reg?.flagged,
        facilityRequirements: f.facilities && {
          create: f.facilities.map((name) => ({ facilityId: facilityIds.get(name)!, isMandatory: true })),
        },
        statusHistory: {
          create: CHAIN.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : CHAIN[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        equipmentRequests: f.equipment && {
          create: {
            equipmentId: itemIds.get(f.equipment.name)!,
            quantityRequested: f.equipment.quantity,
            quantityReserved: f.equipment.quantity,
            // Two hours either side, as equipmentWindow() gives.
            startsAt: new Date(startsAt.getTime() - 2 * 3_600_000),
            endsAt: new Date(endsAt.getTime() + 2 * 3_600_000),
            status: "reserved",
            requestedBy: coordinator,
            requestedAt: addDays(now, -4),
            reviewedBy: techSupport,
            reviewedAt: addDays(now, -3),
            needsReview: true,
            reviewReason: f.equipment.flagged,
            flaggedAt,
          },
        },
        registrations: reg && {
          create: attendees.slice(0, holding(f)).map((a, i) => ({
            attendeeId: a.id,
            status: i < reg.registered ? "registered" : "waitlisted",
            registeredAt: addDays(now, -8 + (i % 3)),
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    // One minute apart, so the Venue tab (newest request first) lists them in
    // the same order on every run.
    for (const [i, b] of (f.bookings ?? []).entries()) {
      const approved = b.status === "approved";
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venueIds.get(b.venueCode)!,
          layoutName: "theatre",
          startsAt: sgt(b.date ?? f.date, FROM),
          endsAt: sgt(b.date ?? f.date, TO),
          status: b.status,
          requestedBy: coordinator,
          requestedAt: new Date(addDays(now, -4).getTime() + i * 60_000),
          decidedBy: approved ? venueStaff : undefined,
          decidedAt: approved ? addDays(now, -3) : undefined,
          needsReview: b.flagged !== undefined,
          reviewReason: b.flagged,
          // A minute apart again: the page lists the most recently flagged first.
          flaggedAt: b.flagged ? new Date(flaggedAt.getTime() + i * 60_000) : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    const held = [
      ...(f.bookings ?? []).map((b) => `${b.venueCode.slice(-3)}:${b.status}${b.flagged ? "*" : ""}`),
      ...(f.equipment ? [`${f.equipment.name.slice(6)}*`] : []),
      ...(reg ? [`reg ${reg.registered}+${reg.waitlisted ?? 0}*`] : []),
    ].join(" ");
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${held.padEnd(44)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-68 fixture events ready (* = flagged for review).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
