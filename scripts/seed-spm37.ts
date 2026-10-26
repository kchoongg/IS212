/**
 * SPM-37 (Cancel Event) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm37
 *
 * `npx prisma db seed` wipes every table. This script only touches:
 *   - events whose seedKey starts with "spm37_": it deletes them (their status
 *     history, venue bookings, equipment lines, safety checks, change requests
 *     and registrations go with them - every child relation of Event is
 *     onDelete: Cascade) and recreates them in their starting state;
 *   - its two test rooms, SPM37 Hall (SPM37-HAL) and SPM37 Studio (SPM37-STU),
 *     and its two test items, SPM37 Projector and SPM37 Lectern Mic, which it
 *     upserts and puts back to their starting values with no other bookings or
 *     requests. Every arrangement in the cases uses one of these, so nobody
 *     else's can get in the way, and a request a case sends (SPM-37-TC03) is
 *     removed on the next run.
 * Nothing else in the database is changed, so it is safe to run while others
 * are testing other stories.
 *
 * Cancelling is exactly what the test cases do, so run it again after each
 * case that cancels (docs/test-cases/SPM-37_Test_Cases.xlsx says which).
 *
 * Dates avoid September on purpose: the app writes it as "Sept", and every
 * other month as its three-letter form, so dates quoted in the cases read the
 * same as on screen. SPM37 Open Workshop's registration closes on 24 Nov 2027,
 * so SPM-37-TC06 must be re-dated after that.
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same events (the events only - everything they
 * hold is made here) after its last existing block - keep the two in step.
 *
 * Needs the base seed's users (Daniel Tan, Grace Lim, Marcus Wong, Vikram Nair,
 * Rachel Ng, Lee Wei Ming) to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm37_";

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
  { code: "SPM37-HAL", name: "SPM37 Hall" },
  { code: "SPM37-STU", name: "SPM37 Studio" },
] as const;
const VENUE_FIELDS = {
  description: "SPM-37 test venue: no setup or turnaround",
  building: "Orchard Hub", floor: "L4", maxCapacity: 60, opensAt: "07:00", closesAt: "22:00",
  setupMinutes: 0, teardownMinutes: 0, isActive: true,
};
const LAYOUTS = [
  { layoutName: "theatre", capacity: 60 },
  { layoutName: "classroom", capacity: 40 },
];

const EQUIPMENT = [
  { name: "SPM37 Projector", description: "SPM-37 test item: 2 in total" },
  { name: "SPM37 Lectern Mic", description: "SPM-37 test item: 2 in total" },
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
  safetyCheckPending?: boolean;
  /** A pending change request from the organiser, proposing this date instead. */
  changeRequestTo?: string;
  registration?: boolean;
  rejectionReason?: string;
  cancellationReason?: string;
  testCases: string;
};

const CANCELLED_REASON = "The client's product launch was called off.";

/** Every event is Rachel Ng's and Daniel Tan's, 30 attendees, theatre. */
const FIXTURES: Fixture[] = [
  { key: "spm37_harbour_summit", title: "SPM37 Harbour Summit", status: "planning", date: "2027-11-02",
    bookings: [{ venueCode: "SPM37-HAL", status: "approved" }, { venueCode: "SPM37-STU", status: "pending" }],
    equipment: [{ item: "SPM37 Projector", quantity: 2, status: "reserved" }, { item: "SPM37 Lectern Mic", quantity: 1, status: "requested" }],
    testCases: "TC01 TC02" },
  { key: "spm37_blocking_expo", title: "SPM37 Blocking Expo", status: "planning", date: "2027-11-16",
    bookings: [{ venueCode: "SPM37-HAL", status: "approved" }],
    equipment: [{ item: "SPM37 Projector", quantity: 2, status: "reserved" }],
    testCases: "TC03" },
  { key: "spm37_rival_forum", title: "SPM37 Rival Forum", status: "planning", date: "2027-11-16",
    equipment: [{ item: "SPM37 Projector", quantity: 2, status: "requested" }],
    testCases: "TC03" },
  { key: "spm37_safety_pending", title: "SPM37 Safety Pending", status: "safety_review", date: "2027-11-18",
    bookings: [{ venueCode: "SPM37-HAL", status: "approved" }], safetyCheckPending: true,
    testCases: "TC04" },
  { key: "spm37_change_pending", title: "SPM37 Change Pending", status: "confirmed", date: "2027-11-23",
    changeRequestTo: "2027-11-30", testCases: "TC05" },
  { key: "spm37_open_workshop", title: "SPM37 Open Workshop", status: "confirmed", date: "2027-11-25",
    registration: true, testCases: "TC06" },
  { key: "spm37_quiet_approval", title: "SPM37 Quiet Approval", status: "approved", date: "2027-11-30",
    testCases: "TC07" },
  { key: "spm37_early_call", title: "SPM37 Early Call", status: "under_review", date: "2027-12-02",
    testCases: "TC08" },
  { key: "spm37_on_hold", title: "SPM37 On Hold", status: "postponed", date: "2027-12-07",
    testCases: "TC08" },
  { key: "spm37_turned_down", title: "SPM37 Turned Down", status: "rejected", date: "2027-12-09",
    rejectionReason: "The client's budget does not cover a venue of this size.", testCases: "TC09 (read only)" },
  { key: "spm37_wrapped_up", title: "SPM37 Wrapped Up", status: "completed", date: "2026-10-05",
    testCases: "TC09 (read only)" },
  { key: "spm37_guarded_event", title: "SPM37 Guarded Event", status: "planning", date: "2027-12-14",
    bookings: [{ venueCode: "SPM37-STU", status: "pending" }], testCases: "TC02 TC10 (read only)" },
  { key: "spm37_already_cancelled", title: "SPM37 Already Cancelled", status: "cancelled", date: "2027-12-16",
    bookings: [{ venueCode: "SPM37-HAL", status: "released", reason: `Event cancelled: ${CANCELLED_REASON}` }],
    equipment: [{ item: "SPM37 Projector", quantity: 1, status: "cancelled" }],
    cancellationReason: CANCELLED_REASON, testCases: "TC11 (read only)" },
  { key: "spm37_change_closed", title: "SPM37 Change Closed", status: "planning", date: "2027-12-21",
    changeRequestTo: "2027-12-28", testCases: "TC12" },
];

/** The status history each starting status was reached by, as prisma/seed.ts's CHAIN. */
const CHAIN: Record<string, string[]> = {
  under_review: ["submitted", "under_review"],
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  safety_review: ["submitted", "under_review", "approved", "planning", "safety_review"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  postponed: ["submitted", "under_review", "approved", "planning", "postponed"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
  rejected: ["submitted", "under_review", "rejected"],
  cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  safety_review: "Submitted for an Operational Safety Check",
  confirmed: "Essential arrangements complete",
  postponed: "Client requested a later date",
  completed: "Event took place",
  rejected: "The client's budget does not cover a venue of this size.",
  cancelled: CANCELLED_REASON,
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-37 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("vikram.nair@connectsphere.com");
  const coordinator = await find("daniel.tan@connectsphere.com");
  const attendee = await find("lee.wei.ming@example.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // Reset: drop the previous run's events. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-37 fixture event(s).`);

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

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-37 cancel event test event",
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
        rejectionReason: f.rejectionReason,
        cancellationReason: f.cancellationReason,
        ...(f.registration
          ? {
              registrationEnabled: true,
              registrationCapacity: 40,
              registrationOpensAt: sgt("2026-10-01", "09:00"),
              registrationClosesAt: sgt("2027-11-24", "17:00"),
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

    if (f.safetyCheckPending) {
      await prisma.safetyCheck.create({
        data: { eventId: created.id, status: "pending", submittedBy: coordinator, submittedAt: addDays(now, -1) },
      });
    }

    // In SPM-35's shape: the fields it changes, with their values then and now.
    if (f.changeRequestTo) {
      await prisma.eventChangeRequest.create({
        data: {
          eventId: created.id,
          requestedBy: organiser.id,
          requestedAt: addDays(now, -1),
          reason: "Our keynote speaker can only come a week later.",
          kind: "change",
          changes: [
            { field: "startsAt", current: startsAt.toISOString(), proposed: sgt(f.changeRequestTo, "09:00").toISOString() },
            { field: "endsAt", current: endsAt.toISOString(), proposed: sgt(f.changeRequestTo, "12:00").toISOString() },
          ],
          isSignificant: true,
          status: "pending",
        },
      });
    }

    if (f.registration) {
      await prisma.registration.create({
        data: { eventId: created.id, attendeeId: attendee, status: "registered", registeredAt: addDays(now, -2) },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${f.status.padEnd(14)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-37 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
