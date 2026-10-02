/**
 * SPM-43 (Review Venue Booking Request) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm43
 *
 * Only touches events whose seedKey starts with "spm43_". The first run
 * creates them; every later run resets them IN PLACE - the event row is kept
 * (so its EVT- reference never changes) and put back to its starting values,
 * and its booking requests, sessions and notifications are dropped and
 * recreated, which is what undoes every decision a test pass made. Each
 * event ends up with the booking requests Venue Staff will find on
 * /bookings. The fixtures sit in May 2027, clear of the SPM-42
 * (March) and SPM-44 (April) fixtures, on base-seed venues plus two test
 * venues of their own, which this script upserts:
 *   - "SPM43 Maintenance Room" (SPM43-MNT), with one unavailability period
 *     (14 May 2027). No screen can create one yet (Block venue, S-23), so the
 *     script does; its periods are replaced on every run.
 *   - "SPM43 Retire Test Room" (SPM43-RET), which SPM-43-TC14 retires through
 *     the app. A dedicated room, so retiring it flags nobody else's bookings;
 *     every run makes it active again.
 * Nothing else is changed.
 *
 * Re-run before each test pass: approving and rejecting is exactly what the
 * cases do to these requests, and a decided request cannot be decided again.
 * Running it is also the full revert after a pass.
 *
 * Needs the base seed's users and venues to exist already.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm43_";

/** Singapore has no daylight saving: always UTC+8. */
const SGT_OFFSET_HOURS = 8;

/** A fixed calendar date at a Singapore wall-clock hour (may be fractional). */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - SGT_OFFSET_HOURS));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** The customer's slots (#50), as [start hour, end hour]. */
const SLOT_HOURS = { AM: [7, 12], PM: [13, 18], Night: [19, 24] } as const;
type SlotName = keyof typeof SLOT_HOURS;

type BookingFixture = {
  venueCode: string;
  /// First and last slot held, on the event's (or session's) own date.
  slots: [SlotName, SlotName];
  status: "pending" | "approved";
  /// Index into the event's sessions, for a session's own request.
  session?: number;
  note?: string;
};

type Fixture = {
  key: string;
  title: string;
  status: "approved" | "planning" | "cancelled";
  date: string; // YYYY-MM-DD, Singapore
  startHour: number;
  durationHours: number;
  attendance: number;
  layout: string;
  sessions?: { label: string; date: string; startHour: number; durationHours: number; attendance: number; layout: string }[];
  bookings: BookingFixture[];
  /// What the request is there to show.
  purpose: string;
};

const TEST_VENUE = {
  building: "Orchard Hub",
  floor: "L1",
  maxCapacity: 40,
  opensAt: "07:00",
  closesAt: "23:00",
  setupMinutes: 0,
  teardownMinutes: 0,
};
const TEST_VENUES = [
  { code: "SPM43-MNT", name: "SPM43 Maintenance Room", description: "SPM-43 test venue: closed for maintenance on 14 May 2027" },
  { code: "SPM43-RET", name: "SPM43 Retire Test Room", description: "SPM-43 test venue: retired and restored by SPM-43-TC14" },
];
const TEST_VENUE_LAYOUTS = [
  { layoutName: "classroom", capacity: 40 },
  { layoutName: "theatre", capacity: 40 },
];
/** The one unavailability period, on SPM43-MNT: the whole of 14 May 2027. */
const MAINTENANCE = { venueCode: "SPM43-MNT", date: "2027-05-14", reason: "maintenance", notes: "SPM-43 fixture: floor resurfacing" };

const FIXTURES: Fixture[] = [
  { key: "spm43_approve", title: "SPM43 Leadership Offsite", status: "planning",
    date: "2027-05-04", startHour: 9, durationHours: 8, attendance: 100, layout: "theatre",
    bookings: [{ venueCode: "ORC-SEM", slots: ["AM", "PM"], status: "pending", note: "Lectern and two handheld microphones." }],
    purpose: "approve (AC1-AC3, AC7)" },
  { key: "spm43_reject", title: "SPM43 Product Briefing", status: "planning",
    date: "2027-05-05", startHour: 14, durationHours: 3, attendance: 150, layout: "theatre",
    bookings: [{ venueCode: "MAR-AUD", slots: ["PM", "PM"], status: "pending" }],
    purpose: "reject with a reason; blank reason refused (AC4, AC5)" },
  { key: "spm43_suggest", title: "SPM43 Awards Dinner", status: "planning",
    date: "2027-05-06", startHour: 19, durationHours: 3, attendance: 80, layout: "banquet",
    bookings: [{ venueCode: "ORC-GAL", slots: ["Night", "Night"], status: "pending", note: "Round tables of ten, stage for the awards." }],
    purpose: "reject and suggest another venue / arrangement (AC6)" },
  { key: "spm43_arrangement", title: "SPM43 Investor Update", status: "planning",
    date: "2027-05-08", startHour: 14, durationHours: 2, attendance: 90, layout: "theatre",
    bookings: [{ venueCode: "ONE-AUD", slots: ["PM", "PM"], status: "pending" }],
    purpose: "reject and suggest an arrangement only, no venue (AC6)" },
  // The approved booking the next request runs into.
  { key: "spm43_confirmed", title: "SPM43 Board Strategy Day", status: "planning",
    date: "2027-05-07", startHour: 9, durationHours: 8, attendance: 120, layout: "theatre",
    bookings: [{ venueCode: "MAR-AUD", slots: ["AM", "PM"], status: "approved" }],
    purpose: "already approved - holds MAR-AUD on 7 May" },
  { key: "spm43_turnaround", title: "SPM43 Evening Recital", status: "planning",
    date: "2027-05-07", startHour: 19, durationHours: 3, attendance: 200, layout: "theatre",
    bookings: [{ venueCode: "MAR-AUD", slots: ["Night", "Night"], status: "pending" }],
    purpose: "conflict through Board Strategy Day's turnaround slot" },
  // Two requests for one room and slot: approving either puts the other in conflict.
  { key: "spm43_rival_a", title: "SPM43 Design Workshop", status: "planning",
    date: "2027-05-10", startHour: 14, durationHours: 3, attendance: 30, layout: "classroom",
    bookings: [{ venueCode: "ORC-STU", slots: ["PM", "PM"], status: "pending" }],
    purpose: "rival request A for ORC-STU, 10 May PM" },
  { key: "spm43_rival_b", title: "SPM43 Coding Workshop", status: "planning",
    date: "2027-05-10", startHour: 13, durationHours: 4, attendance: 24, layout: "classroom",
    bookings: [{ venueCode: "ORC-STU", slots: ["PM", "PM"], status: "pending" }],
    purpose: "rival request B for ORC-STU, 10 May PM" },
  // Event times span its sessions (11 May 09:00 to 12 May 17:00).
  { key: "spm43_sessions", title: "SPM43 Two-Day Forum", status: "approved",
    date: "2027-05-11", startHour: 9, durationHours: 32, attendance: 60, layout: "theatre",
    sessions: [
      { label: "Day 1", date: "2027-05-11", startHour: 9, durationHours: 3, attendance: 60, layout: "theatre" },
      { label: "Day 2", date: "2027-05-12", startHour: 14, durationHours: 3, attendance: 30, layout: "classroom" },
    ],
    bookings: [
      { venueCode: "ONE-SEM", slots: ["AM", "AM"], status: "pending", session: 0 },
      { venueCode: "JUR-TRN", slots: ["PM", "PM"], status: "pending", session: 1, note: "Tables in rows, power at every seat." },
    ],
    purpose: "one request per session, each with the session's own details (AC2)" },
  { key: "spm43_cancelled_event", title: "SPM43 Cancelled Launch", status: "cancelled",
    date: "2027-05-13", startHour: 9, durationHours: 8, attendance: 140, layout: "theatre",
    bookings: [{ venueCode: "CBP-CONF", slots: ["AM", "PM"], status: "pending" }],
    purpose: "event already cancelled - approve refused, reject allowed" },
  { key: "spm43_maintenance", title: "SPM43 Staff Briefing", status: "planning",
    date: "2027-05-14", startHour: 9, durationHours: 2, attendance: 30, layout: "classroom",
    bookings: [{ venueCode: "SPM43-MNT", slots: ["AM", "AM"], status: "pending" }],
    purpose: "conflict: the room is unavailable (maintenance) that day" },
  { key: "spm43_retire", title: "SPM43 Team Retrospective", status: "planning",
    date: "2027-05-17", startHour: 14, durationHours: 2, attendance: 20, layout: "classroom",
    bookings: [{ venueCode: "SPM43-RET", slots: ["PM", "PM"], status: "pending" }],
    purpose: "approve refused once the tester retires the room" },
];

const CHAIN: Record<Fixture["status"], string[]> = {
  approved: ["submitted", "under_review", "approved"],
  planning: ["submitted", "under_review", "approved", "planning"],
  cancelled: ["submitted", "under_review", "approved", "planning", "cancelled"],
};
const REASONS: Record<string, string> = {
  under_review: "Coordinator assigned",
  approved: "Requirements sufficiently clear",
  planning: "Venue search started",
  cancelled: "Client withdrew the launch",
};

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-43 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  // Resolve every seeded row first, so a missing one fails before any write.
  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const opsManager = await find("grace.lim@connectsphere.com");
  const venueStaff = await find("marcus.wong@connectsphere.com");
  const coordinatorId = await find("daniel.tan@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');
  const venueIds = new Map<string, string>();
  const testCodes = TEST_VENUES.map((v) => v.code);
  for (const code of new Set(FIXTURES.flatMap((f) => f.bookings.map((b) => b.venueCode)))) {
    if (testCodes.includes(code)) continue; // upserted below
    const v = await prisma.venue.findUnique({ where: { code }, select: { id: true } });
    if (!v) throw new Error(`Venue ${code} not found - run the base seed once first.`);
    venueIds.set(code, v.id);
  }

  // Only a fixture this script no longer defines is deleted. The events it
  // does define are reset IN PLACE further down, so each keeps its EVT-
  // reference from one run to the next.
  const removed = await prisma.event.deleteMany({
    where: { seedKey: { startsWith: KEY_PREFIX, notIn: FIXTURES.map((f) => f.key) } },
  });
  if (removed.count > 0) console.log(`Removed ${removed.count} SPM-43 fixture event(s) no longer defined.`);

  // The two test venues, back in their starting state: active (undoing
  // SPM-43-TC14's retire), with only the one maintenance period.
  for (const v of TEST_VENUES) {
    const venue = await prisma.venue.upsert({
      where: { code: v.code },
      create: { ...TEST_VENUE, ...v },
      update: { ...TEST_VENUE, ...v, isActive: true },
    });
    for (const l of TEST_VENUE_LAYOUTS) {
      await prisma.venueLayout.upsert({
        where: { venueId_layoutName: { venueId: venue.id, layoutName: l.layoutName } },
        create: { venueId: venue.id, ...l },
        update: { capacity: l.capacity },
      });
    }
    await prisma.venueUnavailability.deleteMany({ where: { venueId: venue.id } });
    venueIds.set(v.code, venue.id);
  }
  await prisma.venueUnavailability.create({
    data: {
      venueId: venueIds.get(MAINTENANCE.venueCode)!,
      startsAt: sgt(MAINTENANCE.date, 0),
      endsAt: sgt(MAINTENANCE.date, 24),
      reason: MAINTENANCE.reason,
      notes: MAINTENANCE.notes,
      createdBy: venueStaff,
    },
  });
  console.log(`Venues ${testCodes.join(", ")} ready.`);

  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = new Date(startsAt.getTime() + f.durationHours * 3_600_000);
    const chain = CHAIN[f.status];
    const historyStart = addDays(new Date(), -(chain.length * 5 + 2));

    const fields = {
      title: f.title,
      purpose: "SPM-43 venue booking review test event",
      category: "meeting",
      organiserId: organiser.id,
      organisationId: organiser.organisationId,
      coordinatorId,
      status: f.status,
      startsAt,
      endsAt,
      expectedAttendance: f.attendance,
      preferredLayout: f.layout,
      cancellationReason: f.status === "cancelled" ? REASONS.cancelled : null,
    };
    // An event that already exists is put back to its starting values, never
    // deleted: deleting and recreating it would give it a new EVT- reference
    // on every run. What a test pass changed - its booking requests and their
    // decisions - is dropped and recreated below instead; those rows carry no
    // number anyone quotes.
    const existing = await prisma.event.findUnique({ where: { seedKey: f.key }, select: { id: true } });
    if (existing) {
      await prisma.venueBooking.deleteMany({ where: { eventId: existing.id } });
      await prisma.eventSession.deleteMany({ where: { eventId: existing.id } });
      await prisma.notification.deleteMany({ where: { eventId: existing.id } });
    }
    const sessions = f.sessions && {
      create: f.sessions.map((s) => {
        const from = sgt(s.date, s.startHour);
        return {
          label: s.label,
          startsAt: from,
          endsAt: new Date(from.getTime() + s.durationHours * 3_600_000),
          expectedAttendance: s.attendance,
          preferredLayout: s.layout,
        };
      }),
    };
    const select = { id: true, sequenceNumber: true, sessions: { orderBy: { startsAt: "asc" }, select: { id: true } } } as const;
    const created = existing
      ? await prisma.event.update({ where: { id: existing.id }, data: { ...fields, sessions }, select })
      : await prisma.event.create({
          data: {
            ...fields,
            seedKey: f.key,
            submittedAt: historyStart,
            statusHistory: {
              create: chain.map((to, i) => ({
                fromStatus: i === 0 ? "draft" : chain[i - 1],
                toStatus: to,
                changedBy: to === "submitted" ? organiser.id : to === "under_review" ? opsManager : coordinatorId,
                changedAt: addDays(historyStart, i * 5),
                reason: REASONS[to],
              })),
            },
            sessions,
          },
          select,
        });

    // Bookings after the event, so a session's request can point at its row.
    for (const b of f.bookings) {
      const session = b.session === undefined ? undefined : f.sessions?.[b.session];
      const date = session?.date ?? f.date;
      await prisma.venueBooking.create({
        data: {
          eventId: created.id,
          sessionId: b.session === undefined ? undefined : created.sessions[b.session].id,
          venueId: venueIds.get(b.venueCode)!,
          layoutName: session?.layout ?? f.layout,
          startsAt: sgt(date, SLOT_HOURS[b.slots[0]][0]),
          endsAt: sgt(date, SLOT_HOURS[b.slots[1]][1]),
          status: b.status,
          requestedBy: coordinatorId,
          requestedAt: addDays(new Date(), -3),
          requirementsNote: b.note,
          decidedBy: b.status === "approved" ? venueStaff : undefined,
          decidedAt: b.status === "approved" ? addDays(new Date(), -2) : undefined,
        },
      });
    }

    const ref = `EVT-${String(created.sequenceNumber).padStart(6, "0")}`;
    console.log(`  ${ref}  ${f.title.padEnd(26)} ${f.purpose}`);
  }

  console.log(`Done: ${FIXTURES.length} SPM-43 fixture events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
