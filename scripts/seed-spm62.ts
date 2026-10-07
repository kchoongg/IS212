/**
 * SPM-62 (Update Event Information) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm62
 *
 * `npx prisma db seed` wipes every table. This script only touches events
 * whose seedKey starts with "spm62_": it deletes them (their status history,
 * venue bookings, equipment requests and registrations go with them - every
 * child relation of Event is onDelete: Cascade) and recreates them in their
 * starting state. Nothing else in the database is changed, so it is safe to
 * run while others are testing other stories.
 *
 * Changing an event's date, attendance or requirements - and so flagging its
 * arrangements, or moving a Confirmed event back to Planning - is exactly
 * what the test cases do to these events, so run it again to put them back
 * (docs/test-cases/SPM-62_Test_Cases.xlsx says which cases need it).
 *
 * No pinned reference numbers: the database numbers each event, and the test
 * cases find them by title, which no other event shares.
 *
 * prisma/seed.ts creates the same events (same seed keys, titles, dates,
 * organisers and registration settings) but not their bookings, equipment or
 * registrations - run this once after a full reseed, as for SPM-34.
 *
 * Needs the base seed's users, venues and equipment catalogue to exist.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm62_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/** A fixed calendar date at a Singapore wall-clock hour. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

const HOUR = 3_600_000;

type Fixture = {
  key: string;
  title: string;
  status: string;
  organiser: string; // full name of a seeded organiser
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  category: string;
  purpose: string;
  attendance: number;
  layout: string;
  facilities?: string[];
  /** Registration capacity; registration is on when set. It closes two days before the event, as in seed.ts. */
  regCapacity?: number;
  /** An approved booking for the event's own times. */
  venue?: string;
  /** Reserved in full by Technical Support. */
  equipment?: [name: string, quantity: number];
  registered?: number;
  testCases: string; // which SPM-62 cases use it - for whoever reads the output
};

/** Every fixture is Daniel Tan's: the story is about the ASSIGNED coordinator. */
const COORDINATOR = "daniel.tan@connectsphere.com";

const FIXTURES: Fixture[] = [
  // Read-only cases, then TC05 moves its date - reset after TC05/TC06.
  { key: "spm62_harbour", title: "SPM62 Harbour Leadership Summit", status: "planning",
    organiser: "Evelyn Chen", date: "2027-03-17", startHour: 9, durationHours: 8,
    category: "conference", purpose: "Leadership summit for regional directors",
    attendance: 80, layout: "theatre", facilities: ["Fixed ceiling projector"],
    regCapacity: 100, venue: "ORC-SEM", equipment: ["4K Portable Projector", 2], registered: 12,
    testCases: "TC01 TC02 TC05 TC06 TC14-TC16 TC18-TC20" },
  // TC07 changes its attendance and requirements.
  { key: "spm62_kirana", title: "SPM62 Kirana Supplier Day", status: "planning",
    organiser: "Faridah Aziz", date: "2027-04-21", startHour: 10, durationHours: 6,
    category: "conference", purpose: "Annual supplier day",
    attendance: 60, layout: "theatre",
    regCapacity: 50, venue: "CBP-CONF", equipment: ["Handheld Wireless Mic", 4], registered: 8,
    testCases: "TC07" },
  // No arrangements at all.
  { key: "spm62_bayu", title: "SPM62 Bayu Energy Outlook", status: "approved",
    organiser: "Hakim Zulkifli", date: "2027-05-12", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Regional energy briefing",
    attendance: 40, layout: "theatre",
    testCases: "TC03" },
  { key: "spm62_anchorpoint", title: "SPM62 Anchorpoint Logistics Forum", status: "approved",
    organiser: "Melissa Yap", date: "2027-05-18", startHour: 9, durationHours: 3,
    category: "seminar", purpose: "Logistics partners forum",
    attendance: 50, layout: "theatre",
    testCases: "TC04" },
  // Confirmed, with everything arranged. TC09 moves it back to Planning.
  { key: "spm62_pharmacy", title: "SPM62 Straits Pharmacy Forum", status: "confirmed",
    organiser: "Evelyn Chen", date: "2027-06-09", startHour: 9, durationHours: 8,
    category: "conference", purpose: "Pharmacy practice forum",
    attendance: 120, layout: "theatre",
    regCapacity: 150, venue: "MAR-AUD", equipment: ["Powered Speaker", 2], registered: 20,
    testCases: "TC08 TC09" },
  // Confirmed. Ordinary edits only - it should stay Confirmed.
  { key: "spm62_meridian", title: "SPM62 Meridian Quarterly Review", status: "confirmed",
    organiser: "James Koh", date: "2027-06-16", startHour: 14, durationHours: 3,
    category: "meeting", purpose: "Quarterly results review",
    attendance: 30, layout: "boardroom", venue: "MAR-BR1",
    testCases: "TC10 TC11 TC12" },
  // Confirmed with a venue and no equipment. TC13 adds equipment.
  { key: "spm62_sundara", title: "SPM62 Sundara Hospitality Showcase", status: "confirmed",
    organiser: "Dewi Kartika", date: "2027-06-23", startHour: 10, durationHours: 8,
    category: "exhibition", purpose: "Hospitality partners showcase",
    attendance: 70, layout: "exhibition", venue: "ORC-GAL",
    testCases: "TC13" },
  // Not editable: still a request, and finished.
  { key: "spm62_civic", title: "SPM62 Civic Learning Day", status: "under_review",
    organiser: "Grace Abdullah", date: "2027-07-07", startHour: 9, durationHours: 6,
    category: "training", purpose: "Teacher development day",
    attendance: 60, layout: "classroom",
    testCases: "TC17" },
  { key: "spm62_pearl", title: "SPM62 Pearl Delta Plant Tour", status: "completed",
    organiser: "Samuel Ong", date: "2026-09-10", startHour: 9, durationHours: 4,
    category: "networking", purpose: "Plant tour for key customers",
    attendance: 25, layout: "theatre",
    testCases: "TC17" },
];

/** Same status chains and reasons as prisma/seed.ts. */
const CHAIN: Record<string, string[]> = {
  under_review: ["submitted", "under_review"],
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  confirmed: ["submitted", "under_review", "approved", "planning", "confirmed"],
  completed: ["submitted", "under_review", "approved", "planning", "confirmed", "completed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Essential arrangements complete",
  completed: "Event held",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-62 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve everything the fixtures refer to first, so a missing row fails
  // before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const techSupport = await find("kenji.sato@connectsphere.com");
  const coordinator = await find(COORDINATOR);

  const organisers = new Map<string, { id: string; organisationId: string | null }>();
  const venues = new Map<string, string>();
  const equipment = new Map<string, string>();
  const facilities = new Map<string, string>();
  for (const f of FIXTURES) {
    if (!organisers.has(f.organiser)) {
      const u = await prisma.user.findFirst({
        where: { fullName: f.organiser, role: "organiser" },
        select: { id: true, organisationId: true },
      });
      if (!u) throw new Error(`Organiser "${f.organiser}" not found - run the base seed once first.`);
      organisers.set(f.organiser, u);
    }
    if (f.venue && !venues.has(f.venue)) {
      const v = await prisma.venue.findUnique({ where: { code: f.venue }, select: { id: true } });
      if (!v) throw new Error(`Venue ${f.venue} not found - run the base seed once first.`);
      venues.set(f.venue, v.id);
    }
    if (f.equipment && !equipment.has(f.equipment[0])) {
      const item = await prisma.equipment.findFirst({ where: { name: f.equipment[0] }, select: { id: true } });
      if (!item) throw new Error(`Equipment "${f.equipment[0]}" not found - run the base seed once first.`);
      equipment.set(f.equipment[0], item.id);
    }
    for (const name of f.facilities ?? []) {
      if (facilities.has(name)) continue;
      const row = await prisma.facility.findFirst({ where: { name }, select: { id: true } });
      if (!row) throw new Error(`Facility "${name}" not found - run the base seed once first.`);
      facilities.set(name, row.id);
    }
  }
  const attendees = await prisma.user.findMany({
    where: { role: "attendee", isActive: true },
    orderBy: { email: "asc" },
    select: { id: true },
    take: Math.max(...FIXTURES.map((f) => f.registered ?? 0)),
  });

  // Reset: drop the previous run's fixtures. Cascades take their children.
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} existing SPM-62 fixture event(s).`);

  // An approved booking blocks its room (SPM-44). Stop rather than double-book
  // a room someone else's fixtures already hold.
  for (const f of FIXTURES.filter((x) => x.venue)) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * HOUR);
    const clash = await prisma.venueBooking.findFirst({
      where: { venueId: venues.get(f.venue!)!, status: "approved", startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { event: { select: { title: true } } },
    });
    if (clash) {
      throw new Error(`${f.venue} is already booked by "${clash.event.title}" on ${f.date}. Nothing was recreated.`);
    }
  }

  const now = new Date();
  for (const f of FIXTURES) {
    const organiser = organisers.get(f.organiser)!;
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * HOUR);
    const chain = CHAIN[f.status];
    // History 5 days a step, ending in the past.
    const historyStart = addDays(now, -(chain.length * 5 + 2));
    const regEnabled = f.regCapacity !== undefined;

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: f.purpose,
        category: f.category,
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId: coordinator,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        registrationEnabled: regEnabled,
        registrationCapacity: f.regCapacity,
        registrationClosesAt: regEnabled ? sgt(f.date, 9 - 48) : undefined,
        submittedAt: historyStart,
        confirmedAt: ["confirmed", "completed"].includes(f.status) ? addDays(historyStart, 20) : undefined,
        facilityRequirements: f.facilities && {
          create: f.facilities.map((name) => ({ facilityId: facilities.get(name)!, isMandatory: true })),
        },
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
        venueBookings: f.venue
          ? {
              create: {
                venueId: venues.get(f.venue)!,
                layoutName: f.layout,
                startsAt,
                endsAt,
                status: "approved",
                requestedBy: coordinator,
                requestedAt: addDays(historyStart, 15),
                decidedBy: venueStaff,
                decidedAt: addDays(historyStart, 16),
              },
            }
          : undefined,
        equipmentRequests: f.equipment
          ? {
              create: {
                equipmentId: equipment.get(f.equipment[0])!,
                quantityRequested: f.equipment[1],
                quantityReserved: f.equipment[1],
                // Two hours either side, as equipmentWindow() gives.
                startsAt: new Date(startsAt.getTime() - 2 * HOUR),
                endsAt: new Date(endsAt.getTime() + 2 * HOUR),
                status: "reserved",
                requestedBy: coordinator,
                requestedAt: addDays(historyStart, 15),
                reviewedBy: techSupport,
                reviewedAt: addDays(historyStart, 17),
              },
            }
          : undefined,
        registrations: f.registered
          ? {
              create: attendees.slice(0, f.registered).map((a, i) => ({
                attendeeId: a.id,
                status: "registered",
                registeredAt: addDays(historyStart, 21 + (i % 3)),
              })),
            }
          : undefined,
      },
      select: { sequenceNumber: true },
    });

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(36)} ${f.status.padEnd(12)} ${f.testCases}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-62 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
