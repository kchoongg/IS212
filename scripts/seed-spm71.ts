/**
 * SPM-71 (View Notifications) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm71
 *
 * Creates (or refreshes) four test accounts of SPM-71's own, resets every
 * notification they hold, and recreates the story's events. The accounts are
 * its own because the cases quote unread counts: a shared account such as
 * Daniel Tan picks up notifications from everyone else's testing.
 *
 * Only touches those four users (their notifications are deleted and
 * recreated) and events whose seedKey starts with "spm71_" (deleted and
 * recreated with their bookings, equipment and registration - every child of
 * Event is onDelete: Cascade). Nothing else in the database changes.
 *
 * Run it before and after any case that marks or opens a notification
 * (docs/test-cases/SPM-71_Test_Cases.xlsx).
 *
 * Event numbers are not pinned: the cases find each event by its title.
 * prisma/seed.ts creates the same accounts and events (the events only - their
 * arrangements and the notifications are made here) - keep the two in step.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm71_";
const DEMO_PASSWORD = "password123";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

function sgt(isoDate: string, hour: number, minute = 0): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS, minute));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/// SPM-71's own accounts. Owen Teo has no notifications at all (AC8).
const ACCOUNTS = {
  leon: { email: "leon.koh@connectsphere.com", fullName: "Leon Koh", role: "coordinator", department: "Event Management" },
  ivy: { email: "ivy.lim@connectsphere.com", fullName: "Ivy Lim", role: "coordinator", department: "Event Management" },
  owen: { email: "owen.teo@connectsphere.com", fullName: "Owen Teo", role: "venue_staff", department: "Venue Operations" },
  zara: { email: "zara.ong@example.com", fullName: "Zara Ong", role: "attendee", department: null },
} as const;
type Who = keyof typeof ACCOUNTS;

type Fixture = {
  key: string;
  title: string;
  status: "planning" | "postponed";
  coordinator: Who;
  date: string;
  startHour: number;
  durationHours: number;
  attendance: number;
  layout: string;
  booking?: { venueCode: string };
  equipment?: { name: string; quantity: number };
  registered?: Who;
  /// SPM-38: the registration was withdrawn, on this date.
  withdrewOn?: string;
};

const FIXTURES: Fixture[] = [
  // AC5: assigned to Leon; its booking is what "Booking needs review" is about.
  { key: "spm71_gala", title: "SPM71 Harbour Lights Gala", status: "planning", coordinator: "leon",
    date: "2027-11-08", startHour: 18, durationHours: 4, attendance: 120, layout: "theatre",
    booking: { venueCode: "ORC-SEM" } },
  // AC5: Leon's equipment notification opens this event's Equipment tab.
  { key: "spm71_fair", title: "SPM71 Riverside Tech Fair", status: "planning", coordinator: "leon",
    date: "2027-11-15", startHour: 9, durationHours: 8, attendance: 60, layout: "classroom",
    equipment: { name: "Powered Speaker", quantity: 2 } },
  // AC6, AC7: Leon was notified about its equipment, then it was reassigned to
  // Ivy - so its equipment is no longer his to see.
  { key: "spm71_showcase", title: "SPM71 Reassigned Showcase", status: "planning", coordinator: "ivy",
    date: "2027-11-22", startHour: 10, durationHours: 6, attendance: 80, layout: "theatre",
    equipment: { name: "Stage Riser Section", quantity: 4 } },
  // AC6: Zara registered while it was Confirmed; it is now Postponed, and she
  // has since withdrawn, so she cannot see it. (Since SPM-38 an attendee who
  // still holds a place can open a postponed event.)
  { key: "spm71_supper", title: "SPM71 Postponed Supper Club", status: "postponed", coordinator: "leon",
    date: "2027-11-29", startHour: 19, durationHours: 3, attendance: 40, layout: "banquet",
    registered: "zara", withdrewOn: "2026-10-08" },
];

type Note = { to: Who; type: string; title: string; body: string; event: string; at: Date; read?: boolean };

/// Newest first, as the Notifications page lists them. Titles and messages
/// follow what the app itself writes for each type (src/app/api/**).
const NOTES: Note[] = [
  { to: "leon", type: "coordinator_assigned", title: "You have been assigned an event",
    body: 'You are now the coordinator for "SPM71 Harbour Lights Gala".', event: "spm71_gala", at: sgt("2026-10-12", 9) },
  { to: "leon", type: "booking_needs_review", title: "Booking needs review",
    body: "Orchard Seminar Room (ORC-SEM) was updated, so the booking for SPM71 Harbour Lights Gala on 8 Nov 2027 needs your review.",
    event: "spm71_gala", at: sgt("2026-10-11", 15, 30) },
  { to: "leon", type: "equipment_unavailable", title: "Equipment out of service - reservation needs review",
    body: "Powered Speaker units went out of service, so the reservation for SPM71 Riverside Tech Fair on 15 Nov 2027 needs your review.",
    event: "spm71_fair", at: sgt("2026-10-10", 11), read: true },
  { to: "leon", type: "coordinator_unassigned", title: "An event has been reassigned",
    body: '"SPM71 Reassigned Showcase" has been reassigned to Ivy Lim. You are no longer its coordinator.',
    event: "spm71_showcase", at: sgt("2026-10-09", 17), read: true },
  { to: "leon", type: "equipment_unavailable", title: "Equipment out of service - reservation needs review",
    body: "Stage Riser Section units went out of service, so the reservation for SPM71 Reassigned Showcase on 22 Nov 2027 needs your review.",
    event: "spm71_showcase", at: sgt("2026-10-08", 16, 45) },
  { to: "ivy", type: "coordinator_assigned", title: "You have been assigned an event",
    body: 'You are now the coordinator for "SPM71 Reassigned Showcase".', event: "spm71_showcase", at: sgt("2026-10-09", 17) },
  { to: "zara", type: "event_postponed", title: "Event postponed",
    body: "SPM71 Postponed Supper Club has been postponed. You will hear from us once a new date is set.",
    event: "spm71_supper", at: sgt("2026-10-07", 12) },
];

const CHAINS: Record<Fixture["status"], string[]> = {
  planning: ["submitted", "under_review", "approved", "planning"],
  postponed: ["submitted", "under_review", "approved", "planning", "confirmed", "postponed"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  confirmed: "Arrangements complete",
  postponed: "Client requested a later date",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-71 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
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
  const venues = new Map<string, string>();
  for (const code of new Set(FIXTURES.flatMap((f) => (f.booking ? [f.booking.venueCode] : [])))) {
    const v = await prisma.venue.findUnique({ where: { code }, select: { id: true } });
    if (!v) throw new Error(`Venue ${code} not found - run the base seed once first.`);
    venues.set(code, v.id);
  }
  const equipment = new Map<string, string>();
  for (const name of new Set(FIXTURES.flatMap((f) => (f.equipment ? [f.equipment.name] : [])))) {
    const e = await prisma.equipment.findFirst({ where: { name }, select: { id: true } });
    if (!e) throw new Error(`Equipment "${name}" not found - run the base seed once first.`);
    equipment.set(name, e.id);
  }

  // The four accounts, upserted so a rerun refreshes them in place.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {} as Record<Who, string>;
  for (const [who, account] of Object.entries(ACCOUNTS) as [Who, (typeof ACCOUNTS)[Who]][]) {
    const u = await prisma.user.upsert({
      where: { email: account.email },
      create: { ...account, passwordHash },
      update: { ...account, passwordHash, isActive: true },
      select: { id: true },
    });
    ids[who] = u.id;
  }
  console.log(`Accounts ready (password ${DEMO_PASSWORD}): ${Object.values(ACCOUNTS).map((a) => a.email).join(", ")}`);

  // Their notifications start from nothing, so every count the cases quote holds.
  const cleared = await prisma.notification.deleteMany({ where: { recipientId: { in: Object.values(ids) } } });
  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} SPM-71 event(s) and ${cleared.count} notification(s) of the test accounts.`);

  const events = new Map<string, { id: string; sequenceNumber: number }>();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAINS[f.status];
    const historyStart = new Date("2026-09-14T02:00:00.000Z");
    const coordinatorId = ids[f.coordinator];

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-71 view notifications test event",
        category: "networking",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: f.status,
        startsAt,
        endsAt,
        expectedAttendance: f.attendance,
        preferredLayout: f.layout,
        submittedAt: historyStart,
        statusHistory: {
          create: chain.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : chain[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
            changedAt: addDays(historyStart, i * 4),
            reason: REASONS[to],
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });
    events.set(f.key, created);

    if (f.booking) {
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          venueId: venues.get(f.booking.venueCode)!,
          layoutName: f.layout,
          startsAt,
          endsAt,
          status: "approved",
          requestedBy: coordinatorId,
          requestedAt: addDays(historyStart, 14),
          decidedBy: venueStaff,
          decidedAt: addDays(historyStart, 15),
        },
      });
    }
    if (f.equipment) {
      await prisma.equipmentRequest.create({
        data: {
          eventId: created.id,
          equipmentId: equipment.get(f.equipment.name)!,
          quantityRequested: f.equipment.quantity,
          quantityReserved: f.equipment.quantity,
          startsAt,
          endsAt,
          status: "reserved",
          requestedBy: coordinatorId,
          requestedAt: addDays(historyStart, 14),
          reviewedBy: techSupport,
          reviewedAt: addDays(historyStart, 16),
        },
      });
    }
    if (f.registered) {
      await prisma.registration.create({
        data: {
          eventId: created.id,
          attendeeId: ids[f.registered],
          status: f.withdrewOn ? "withdrawn" : "registered",
          registeredAt: sgt("2026-10-01", 12),
          withdrawnAt: f.withdrewOn ? sgt(f.withdrewOn, 12) : undefined,
        },
      });
    }
    console.log(`  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(30)} ${f.status}`);
  }

  for (const n of NOTES) {
    await prisma.notification.create({
      data: {
        recipientId: ids[n.to],
        type: n.type,
        title: n.title,
        body: n.body,
        eventId: events.get(n.event)!.id,
        isRead: n.read ?? false,
        createdAt: n.at,
      },
    });
  }
  const unread = (who: Who) => NOTES.filter((n) => n.to === who && !n.read).length;
  console.log(
    `Notifications: Leon ${NOTES.filter((n) => n.to === "leon").length} (${unread("leon")} unread), ` +
      `Ivy 1 (${unread("ivy")} unread), Zara 1 (${unread("zara")} unread), Owen none.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
