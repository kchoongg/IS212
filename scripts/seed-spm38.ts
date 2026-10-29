/**
 * SPM-38 (Postpone Event) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm38
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm38_": it deletes them (their status
 *     history, venue bookings, equipment lines, safety checks, change requests
 *     and registrations go with them - every child relation of Event is
 *     onDelete: Cascade) and recreates them in their starting state;
 *   - its two test rooms, SPM38 Hall (SPM38-HAL) and SPM38 Studio (SPM38-STU),
 *     and its two test items, SPM38 Projector and SPM38 Lectern Mic, which it
 *     upserts and puts back to their starting values with no other bookings or
 *     requests. Every arrangement in the cases uses one of these, so nobody
 *     else's can get in the way, and a request a case sends (SPM-38-TC03,
 *     TC13) is removed on the next run.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Postponing is exactly what the test cases do, so run it again after each
 * case that postpones (docs/test-cases/SPM-38_Test_Cases.xlsx says which).
 *
 * Dates avoid September on purpose: the app writes it as "Sept", and every
 * other month as its three-letter form, so dates quoted in the cases read the
 * same as on screen. SPM38 Open Workshop's registration closes on 1 Feb 2028,
 * so SPM-38-TC07 must be re-dated after that.
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same events (the events only - everything they
 * hold is made here) after its last existing block - keep the two in step.
 *
 * Needs the base seed's users (Daniel Tan, Grace Lim, Marcus Wong, Vikram Nair,
 * Hana Yusof, Rachel Ng, Lee Wei Ming) to exist.
 */

import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm38_";

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, clock: string): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const VENUES = [
  { code: "SPM38-HAL", name: "SPM38 Hall" },
  { code: "SPM38-STU", name: "SPM38 Studio" },
] as const;
const VENUE_FIELDS = {
  description: "SPM-38 test venue: no setup or turnaround",
  building: "Orchard Hub", floor: "L4", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
  setupMinutes: 0, teardownMinutes: 0, isActive: true,
};
const LAYOUTS = [
  { layoutName: "theatre", capacity: 60 },
  { layoutName: "classroom", capacity: 40 },
];

const EQUIPMENT = [
  { name: "SPM38 Projector", description: "SPM-38 test item: 2 in total" },
  { name: "SPM38 Lectern Mic", description: "SPM-38 test item: 2 in total" },
] as const;
const EQUIPMENT_FIELDS = {
  category: "AV", totalQuantity: 2, quantityInMaintenance: 0, outOfServiceReason: null, outOfServiceType: null,
  isActive: true, locationVenueId: null,
};

type Booking = { venueCode: string; status: "pending" | "approved" | "released"; reason?: string };
type Line = { item: string; quantity: number; status: "requested" | "reserved" | "cancelled" };

type Fixture = {
  key: string;
  title: string;
  status: string;
  date: string; // YYYY-MM-DD, Singapore; every event runs 09:00-12:00
  bookings?: Booking[];
  equipment?: Line[];
  safetyCheck?: "pending" | "approved";
  /** TC06: a pending Postponement and a pending Change of details, from the organiser. */
  clientRequests?: boolean;
  registration?: boolean;
  /** The reason on the move to Postponed (shown as "This event is postponed"). */
  postponementReason?: string;
  cancellationReason?: string;
  testCases: string;
};

const ON_HOLD_REASON = "Waiting on the client's revised budget.";

/** Every event is Rachel Ng's and Daniel Tan's, 30 attendees, theatre. */
const FIXTURES: Fixture[] = [
  { key: "spm38_lantern_gala", title: "SPM38 Lantern Gala", status: "planning", date: "2028-01-12",
    bookings: [{ venueCode: "SPM38-HAL", status: "approved" }, { venueCode: "SPM38-STU", status: "pending" }],
    equipment: [{ item: "SPM38 Projector", quantity: 2, status: "reserved" }, { item: "SPM38 Lectern Mic", quantity: 1, status: "requested" }],
    testCases: "TC01 TC02" },
  { key: "spm38_riverside_expo", title: "SPM38 Riverside Expo", status: "planning", date: "2028-01-19",
    bookings: [{ venueCode: "SPM38-HAL", status: "approved" }],
    equipment: [{ item: "SPM38 Projector", quantity: 2, status: "reserved" }],
    testCases: "TC03" },
  { key: "spm38_rival_seminar", title: "SPM38 Rival Seminar", status: "planning", date: "2028-01-19",
    equipment: [{ item: "SPM38 Projector", quantity: 2, status: "requested" }],
    testCases: "TC03" },
  { key: "spm38_safety_pending", title: "SPM38 Safety Pending", status: "safety_review", date: "2028-01-21",
    bookings: [{ venueCode: "SPM38-HAL", status: "approved" }], safetyCheck: "pending",
    testCases: "TC04" },
  { key: "spm38_safety_cleared", title: "SPM38 Safety Cleared", status: "safety_cleared", date: "2028-01-26",
    bookings: [{ venueCode: "SPM38-HAL", status: "approved" }], safetyCheck: "approved",
    testCases: "TC05" },
  { key: "spm38_client_asks", title: "SPM38 Client Asks", status: "confirmed", date: "2028-01-28",
    clientRequests: true, testCases: "TC06" },
  { key: "spm38_open_workshop", title: "SPM38 Open Workshop", status: "confirmed", date: "2028-02-02",
    registration: true, testCases: "TC07" },
  { key: "spm38_quiet_approval", title: "SPM38 Quiet Approval", status: "approved", date: "2028-02-04",
    testCases: "TC08" },
  { key: "spm38_guarded_forum", title: "SPM38 Guarded Forum", status: "planning", date: "2028-02-09",
    bookings: [{ venueCode: "SPM38-STU", status: "pending" }], testCases: "TC02 TC11 (read only)" },
  { key: "spm38_early_review", title: "SPM38 Early Review", status: "under_review", date: "2028-02-11",
    testCases: "TC09 (read only)" },
  { key: "spm38_called_off", title: "SPM38 Called Off", status: "cancelled", date: "2028-02-14",
    cancellationReason: "The client has called off the event.", testCases: "TC09 (read only)" },
  { key: "spm38_on_hold", title: "SPM38 On Hold", status: "postponed", date: "2028-02-16",
    bookings: [{ venueCode: "SPM38-HAL", status: "released", reason: `Event postponed: ${ON_HOLD_REASON}` }],
    equipment: [{ item: "SPM38 Projector", quantity: 1, status: "cancelled" }],
    postponementReason: ON_HOLD_REASON, testCases: "TC10 (read only)" },
  { key: "spm38_new_date_wanted", title: "SPM38 New Date Wanted", status: "postponed", date: "2028-02-23",
    postponementReason: "Venue renovation at the client's office.", testCases: "TC12 TC13" },
  { key: "spm38_wrapped_up", title: "SPM38 Wrapped Up", status: "completed", date: "2026-10-06",
    testCases: "TC09 (read only)" },
];

/** The status history each starting status was reached by, as prisma/seed.ts's CHAIN. */
const CHAIN: Record<string, string[]> = {
  under_review: ["submitted", "under_review"],
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  safety_review: ["submitted", "under_review", "approved", "planning", "safety_review"],
  safety_cleared: ["submitted", "under_review", "approved", "planning", "safety_review", "safety_cleared"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  postponed: ["submitted", "under_review", "approved", "planning", "postponed"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
  cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  safety_review: "Submitted for an Operational Safety Check",
  safety_cleared: "Safety check approved",
  confirmed: "Essential arrangements complete",
  completed: "Event took place",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-38 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("vikram.nair@connectsphere.com");
  const safetyOfficer = await find("hana.yusof@connectsphere.com");
  const coordinator = await find("daniel.tan@connectsphere.com");
  const attendee = await find("lee.wei.ming@example.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // Reset: drop the previous run's events. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-38 fixture event(s).`);

  // The test rooms and items, back in their starting state. Anything left at
  // one by a test pass went with its event above; one made for another
  // story's event is removed too.
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
    const startsAt = sgt(f.date, "09:00");
    const endsAt = sgt(f.date, "12:00");
    const chain = CHAIN[f.status];
    const historyStart = addDays(now, -(chain.length * 5 + 2));
    const reasonFor = (to: string) =>
      to === "postponed" ? f.postponementReason : to === "cancelled" ? f.cancellationReason : REASONS[to];

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-38 postpone event test event",
        category: "meeting",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: 30,
        preferredLayout: "theatre",
        submittedAt: historyStart,
        confirmedAt: ["confirmed", "completed"].includes(f.status) ? addDays(now, -3) : undefined,
        cancellationReason: f.cancellationReason,
        ...(f.registration
          ? {
              registrationEnabled: true,
              registrationCapacity: 40,
              registrationOpensAt: sgt("2026-10-01", "09:00"),
              registrationClosesAt: sgt("2028-02-01", "17:00"),
            }
          : {}),
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy:
              to === "submitted" ? organiser.id
              : to === "under_review" ? opsManager
              : to === "safety_cleared" ? safetyOfficer
              : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: reasonFor(to),
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    // One minute apart, so the Venue tab (newest request first) lists them in
    // the same order on every run.
    for (const [i, b] of (f.bookings ?? []).entries()) {
      const decided = b.status !== "pending";
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venueIds.get(b.venueCode)!,
          layoutName: "theatre",
          expectedAttendance: 30,
          startsAt,
          endsAt,
          status: b.status,
          requestedBy: coordinator,
          requestedAt: new Date(addDays(now, -4).getTime() + i * 60_000),
          decidedBy: decided ? venueStaff : undefined,
          decidedAt: decided ? addDays(now, -3) : undefined,
          cancelledBy: b.status === "released" ? coordinator : undefined,
          cancelledAt: b.status === "released" ? addDays(now, -1) : undefined,
          cancellationReason: b.reason,
        },
      });
    }

    for (const [i, line] of (f.equipment ?? []).entries()) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipmentIds.get(line.item)!,
          quantityRequested: line.quantity,
          quantityReserved: line.status === "requested" ? null : line.quantity,
          startsAt,
          endsAt,
          status: line.status,
          requestedBy: coordinator,
          requestedAt: new Date(addDays(now, -4).getTime() + i * 60_000),
          reviewedBy: line.status === "requested" ? undefined : techSupport,
          reviewedAt: line.status === "requested" ? undefined : addDays(now, -3),
        },
      });
    }

    if (f.safetyCheck) {
      const approved = f.safetyCheck === "approved";
      await prisma.safetyCheck.create({
        data: {
          eventId: created.id,
          status: f.safetyCheck,
          submittedBy: coordinator,
          submittedAt: addDays(now, -2),
          decidedBy: approved ? safetyOfficer : undefined,
          decidedAt: approved ? addDays(now, -1) : undefined,
        },
      });
    }

    // In SPM-35's shape. The Postponement first, so it is the older of the two.
    if (f.clientRequests) {
      const requests: Prisma.EventChangeRequestUncheckedCreateInput[] = [
        {
          eventId: created.id,
          requestedBy: organiser.id,
          requestedAt: addDays(now, -2),
          kind: "postpone",
          reason: "Our keynote speaker has withdrawn; we will confirm a new date once we have a replacement.",
          changes: [],
          isSignificant: false,
          status: "pending",
        },
        {
          eventId: created.id,
          requestedBy: organiser.id,
          requestedAt: addDays(now, -1),
          kind: "change",
          reason: "Registrations are ahead of forecast.",
          changes: [{ field: "expectedAttendance", current: 30, proposed: 45 }],
          isSignificant: true,
          status: "pending",
        },
      ];
      for (const data of requests) await prisma.eventChangeRequest.create({ data });
    }

    if (f.registration) {
      await prisma.registration.create({
        data: { eventId: created.id, attendeeId: attendee, status: "registered", registeredAt: addDays(now, -2) },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${f.status.padEnd(14)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-38 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
