/**
 * SPM-57 (Manually Add Attendee) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm57
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm57_" and the two SPM57 test rooms: it deletes
 * the events (their status history, venue bookings and registrations go with
 * them - every child relation of Event is onDelete: Cascade), puts the rooms
 * back as below, and recreates the events in their starting state. Nothing
 * else in the database is changed, so it is safe to run while others are
 * testing other stories.
 *
 * Adding attendees is exactly what the test cases do to these events, so run
 * it again to put them back (docs/test-cases/SPM-57_Test_Cases.xlsx says which
 * cases need it).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares. Registration dates
 * are fixed, so the dates the cases quote never go stale - except the place on
 * offer at SPM57 Held Place Recital (TC10), which SPM-66 lets stand for 3
 * days, so it is offered when the script runs. SPM57 Opening Exhibition (TC11)
 * has started and runs to 31 Dec 2027, so it stays Confirmed until then.
 *
 * prisma/seed.ts creates the same rooms and events (same codes, seed keys,
 * titles, dates and people) but not their bookings, registrations or exact
 * registration settings - run this once after a full reseed, as for SPM-64.
 *
 * Needs the base seed's users to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm57_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/** A fixed calendar date at a Singapore wall-clock time. */
function sgt(isoDate: string, hour: number, minute = 0): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS, minute));
}

/** "YYYY-MM-DD HH:MM" in Singapore time. */
function at(when: string): Date {
  const [date, time] = when.split(" ");
  const [hour, minute] = time.split(":").map(Number);
  return sgt(date, hour, minute);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/**
 * Dedicated rooms, so no one else's booking takes them: a hall that seats 60
 * and a salon that seats 4 - small enough to fill by hand (SPM-57-TC07).
 * prisma/seed.ts has the same two in venueData - keep them in step.
 */
const VENUES = [
  { code: "SPM57-HAL", name: "SPM57 Hall", maxCapacity: 60,
    layouts: [{ layoutName: "theatre", capacity: 60 }, { layoutName: "classroom", capacity: 40 }],
    description: "SPM-57 test venue: seats 60 in theatre layout" },
  { code: "SPM57-SAL", name: "SPM57 Salon", maxCapacity: 4,
    layouts: [{ layoutName: "theatre", capacity: 4 }, { layoutName: "classroom", capacity: 3 }],
    description: "SPM-57 test venue: seats 4 in theatre layout" },
] as const;
const VENUE_FIELDS = { building: "Orchard Hub", floor: "L7", opensAt: "07:00", closesAt: "23:00", setupMinutes: 0, teardownMinutes: 0, isActive: true };

type Registration = {
  email: string;
  status: string;
  /** Singapore date and time, "YYYY-MM-DD HH:MM". */
  registeredAt: string;
  withdrawnAt?: string;
  /** Added by the coordinator on the organiser's behalf (SPM-57), with the requirements recorded. */
  added?: { dietary: string; accessibility: string };
  /** Requirements the attendee gave when they registered themselves. */
  requirements?: { dietary: string; accessibility: string };
  /** A waiting attendee with a place on offer (SPM-66), standing for 3 days from now. */
  offered?: true;
};

type Fixture = {
  key: string;
  title: string;
  status: "confirmed" | "planning";
  date: string; // YYYY-MM-DD, Singapore
  /** The last day, when it isn't `date`. */
  endDate?: string;
  startHour: number;
  endHour: number;
  category: string;
  venue: (typeof VENUES)[number]["code"];
  /** A second room, booked for the same time. */
  alsoBooked?: (typeof VENUES)[number]["code"];
  /** false: no booking is chosen to measure registration against (SPM-64). */
  measured?: false;
  registration: { enabled: boolean; capacity?: number; opens?: string; closes?: string };
  registrations: Registration[];
  testCases: string; // which SPM-57 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's and Evelyn Chen's, as for SPM-64 and SPM-65. */
const COORDINATOR = "daniel.tan@connectsphere.com";
const ORGANISER = "Evelyn Chen";

/** Open now: from 1 Sept 2026, 09:00 to 1 Mar 2028, 17:00 - before every event. */
const OPEN = { opens: "2026-09-01 09:00", closes: "2028-03-01 17:00" };

const FIXTURES: Fixture[] = [
  // Self-service full: capacity 3, 3 registered. The hall seats 60.
  { key: "spm57_gala", title: "SPM57 VIP Gala Dinner", status: "confirmed",
    date: "2028-03-07", startHour: 18, endHour: 22, category: "networking", venue: "SPM57-HAL",
    registration: { enabled: true, capacity: 3, ...OPEN },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-01 10:00" },
      { email: "anita.devi@example.com", status: "withdrawn", registeredAt: "2026-10-01 16:00",
        withdrawnAt: "2026-10-06 12:00" },
      { email: "tom.harris@example.com", status: "registered", registeredAt: "2026-10-02 10:00" },
      { email: "chua.mei.ling@example.com", status: "registered", registeredAt: "2026-10-03 10:00" },
      { email: "siti.nurhaliza@example.com", status: "waitlisted", registeredAt: "2026-10-05 11:00" },
    ],
    testCases: "TC01-TC05 TC09" },
  // The salon seats 4: 3 registered (one added by Daniel Tan) and one waiting,
  // who does not count. TC07 adds the 4th and is refused a 5th.
  { key: "spm57_salon", title: "SPM57 Salon Briefing", status: "confirmed",
    date: "2028-03-14", startHour: 9, endHour: 12, category: "seminar", venue: "SPM57-SAL",
    registration: { enabled: true, capacity: 2, ...OPEN },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-01 10:00" },
      { email: "tom.harris@example.com", status: "registered", registeredAt: "2026-10-02 10:00" },
      { email: "jocelyn.pang@example.com", status: "registered", registeredAt: "2026-10-03 15:00",
        added: { dietary: "Halal", accessibility: "Hearing loop" } },
      { email: "siti.nurhaliza@example.com", status: "waitlisted", registeredAt: "2026-10-04 11:00" },
    ],
    testCases: "TC06 TC07" },
  // Not Confirmed yet, registration on.
  { key: "spm57_planning", title: "SPM57 Planning Workshop", status: "planning",
    date: "2028-03-21", startHour: 9, endHour: 17, category: "workshop", venue: "SPM57-HAL",
    registration: { enabled: true, capacity: 40, opens: "2027-01-01 09:00", closes: "2028-03-20 17:00" },
    registrations: [],
    testCases: "TC08" },
  // Confirmed, registration never turned on.
  { key: "spm57_lunch", title: "SPM57 Invitation Only Lunch", status: "confirmed",
    date: "2028-03-28", startHour: 12, endHour: 14, category: "meeting", venue: "SPM57-HAL",
    registration: { enabled: false },
    registrations: [],
    testCases: "TC08" },
  // The salon seats 4: 3 registered and the 4th place on offer to Kavitha
  // Menon from the waiting list (SPM-66), so it is held. TC10 is refused,
  // she declines, and the place can then be given to a VIP.
  { key: "spm57_offer", title: "SPM57 Held Place Recital", status: "confirmed",
    date: "2028-04-04", startHour: 18, endHour: 21, category: "networking", venue: "SPM57-SAL",
    registration: { enabled: true, capacity: 4, opens: "2026-09-01 09:00", closes: "2028-04-03 17:00" },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-01 10:00" },
      { email: "tom.harris@example.com", status: "registered", registeredAt: "2026-10-02 10:00" },
      { email: "jocelyn.pang@example.com", status: "registered", registeredAt: "2026-10-03 10:00" },
      { email: "kavitha.menon@example.com", status: "waitlisted", registeredAt: "2026-10-04 10:00", offered: true },
    ],
    testCases: "TC10" },
  // Confirmed, and started on 26 Oct 2026: nobody can be added any more.
  { key: "spm57_started", title: "SPM57 Opening Exhibition", status: "confirmed",
    date: "2026-10-26", endDate: "2027-12-31", startHour: 10, endHour: 18, category: "exhibition", venue: "SPM57-HAL",
    registration: { enabled: true, capacity: 40, opens: "2026-09-01 09:00", closes: "2026-10-26 10:00" },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-01 10:00" },
    ],
    testCases: "TC11" },
  // Booked in both rooms with neither chosen, so the venue capacity isn't
  // known until the coordinator chooses one in the Registration settings.
  { key: "spm57_two_rooms", title: "SPM57 Two Room Forum", status: "confirmed",
    date: "2028-04-11", startHour: 9, endHour: 17, category: "conference", venue: "SPM57-HAL", alsoBooked: "SPM57-SAL",
    measured: false,
    registration: { enabled: true, capacity: 20, opens: "2026-09-01 09:00", closes: "2028-04-10 17:00" },
    registrations: [],
    testCases: "TC12" },
  // Bryan Chua registered with his requirements and withdrew. TC13 adds him
  // back with the requirements left blank.
  { key: "spm57_brunch", title: "SPM57 Returning Guest Brunch", status: "confirmed",
    date: "2028-04-18", startHour: 10, endHour: 13, category: "networking", venue: "SPM57-HAL",
    registration: { enabled: true, capacity: 10, opens: "2026-09-01 09:00", closes: "2028-04-17 17:00" },
    registrations: [
      { email: "marcus.yeo@example.com", status: "registered", registeredAt: "2026-10-01 10:00" },
      { email: "bryan.chua@example.com", status: "withdrawn", registeredAt: "2026-10-02 10:00",
        withdrawnAt: "2026-10-09 15:00", requirements: { dietary: "Vegetarian", accessibility: "Step-free access" } },
    ],
    testCases: "TC13" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
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
  console.log(`SPM-57 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const coordinator = await find(COORDINATOR);
  const organiser = await prisma.user.findFirst({
    where: { fullName: ORGANISER, role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error(`Organiser "${ORGANISER}" not found - run the base seed once first.`);
  const attendees = new Map<string, string>();
  for (const { email } of FIXTURES.flatMap((f) => f.registrations)) {
    if (!attendees.has(email)) attendees.set(email, await find(email));
  }

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-57 fixture event(s).`);

  // The test rooms, back in their starting state. Any booking left at one by a
  // test pass went with its event above; one made for another story's event is
  // removed too.
  const venueIds = new Map<string, string>();
  for (const { layouts, ...v } of VENUES) {
    const venue = await prisma.venue.upsert({
      where: { code: v.code },
      create: { ...VENUE_FIELDS, ...v },
      update: { ...VENUE_FIELDS, ...v },
    });
    await prisma.venueLayout.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueLayout.createMany({ data: layouts.map((l) => ({ venueId: venue.id, ...l })) });
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    await prisma.venueBooking.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  console.log(`Venues ${VENUES.map((v) => v.code).join(", ")} ready.`);

  const now = new Date();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = sgt(f.endDate ?? f.date, f.endHour);
    // SPM-66: 3 days to accept, or until the event starts if sooner.
    const offerExpiresAt = new Date(Math.min(now.getTime() + 3 * 86_400_000, startsAt.getTime()));
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past.
    const historyStart = addDays(now, -(chain.length * 5 + 2));
    const reg = f.registration;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-57 manually add attendee test event",
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: reg.capacity ?? 20,
        preferredLayout: "theatre",
        registrationEnabled: reg.enabled,
        registrationCapacity: reg.capacity,
        registrationOpensAt: reg.opens && at(reg.opens),
        registrationClosesAt: reg.closes && at(reg.closes),
        submittedAt: historyStart,
        confirmedAt: f.status === "confirmed" ? addDays(historyStart, 20) : undefined,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            // Assignment (-> under_review) is the Ops Manager's; later steps the coordinator's.
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinator,
            changedAt: addDays(historyStart, i * 5),
            reason: REASONS[to],
          })),
        },
        venueBookings: {
          create: [f.venue, ...(f.alsoBooked ? [f.alsoBooked] : [])].map((code) => ({
            venueId: venueIds.get(code)!,
            layoutName: "theatre",
            startsAt,
            endsAt,
            status: "approved",
            requestedBy: coordinator,
            requestedAt: addDays(historyStart, 15),
            decidedBy: venueStaff,
            decidedAt: addDays(historyStart, 16),
          })),
        },
        registrations: {
          create: f.registrations.map((r) => ({
            attendeeId: attendees.get(r.email)!,
            status: r.status,
            registeredAt: at(r.registeredAt),
            withdrawnAt: r.withdrawnAt ? at(r.withdrawnAt) : undefined,
            addedById: r.added ? coordinator : undefined,
            dietaryRequirements: (r.added ?? r.requirements)?.dietary,
            accessibilityRequirements: (r.added ?? r.requirements)?.accessibility,
            ...(r.offered && { waitlistedAt: at(r.registeredAt), offeredAt: now, offerExpiresAt }),
          })),
        },
      },
      select: { id: true, sequenceNumber: true, venueBookings: { select: { id: true } } },
    });
    // Registration is measured against the event's one booking (SPM-64).
    if (reg.capacity !== undefined && f.measured !== false) {
      await prisma.event.update({
        where: { id: created.id },
        data: { registrationVenueBookingId: created.venueBookings[0].id },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(30)} ${f.status.padEnd(10)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-57 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
