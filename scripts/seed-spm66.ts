/**
 * SPM-66 (Join and Respond to Waiting List) — QA fixtures, WITHOUT reseeding.
 *
 *   npm run fixtures:spm66
 *
 * Creates (or refreshes) five attendee accounts of SPM-66's own and recreates
 * the story's events, each with its registrations, waiting list and offers.
 * The accounts are the story's own so a position on a waiting list never moves
 * with other testers' work.
 *
 * Touches only its own rows: the five accounts below (their notifications are
 * cleared, so the cases can read the ones SPM-66 sends) and the events whose
 * seedKey starts with "spm66_" (their registrations and status history go with
 * them). Run it before and after any case that joins, leaves, accepts,
 * declines or offers (docs/test-cases/SPM-66_Test_Cases.xlsx).
 *
 * Offers are made relative to when it runs, because they are about time
 * passing: a standing offer ends 3 days later, and the lapsed one ended an hour
 * before - the app ends it, and offers the place on, the next time anyone
 * opens a page. Every other date is fixed.
 *
 * Needs the migration 20261023120000_add_waiting_list_offers.
 * prisma/seed.ts creates the same accounts and events, but not their
 * registrations - run this once after a full reseed.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const KEY_PREFIX = "spm66_";
const DEMO_PASSWORD = "password123";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Singapore has no daylight saving: always UTC+8. */
function sgt(isoDate: string, hour: number): Date {
  const [year, month, date] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, hour - 8));
}

/// SPM-66's own attendees.
const ACCOUNTS = {
  hana: { email: "hana.quek@example.com", fullName: "Hana Quek" },
  ravi: { email: "ravi.nathan@example.com", fullName: "Ravi Nathan" },
  siew: { email: "siew.ling.goh@example.com", fullName: "Siew Ling Goh" },
  tomas: { email: "tomas.reyes@example.com", fullName: "Tomas Reyes" },
  uma: { email: "uma.pillay@example.com", fullName: "Uma Pillay" },
} as const;
type Who = keyof typeof ACCOUNTS;

/// One registration: registered, or waiting - joined on `joined` (the queue's
/// order) and, for an offer, `offer` = "standing" (ends 3 days after the
/// script runs) or "lapsed" (ended an hour before it ran).
type Entry = { who: Who; status: "registered" | "waitlisted"; joined: string; offer?: "standing" | "lapsed" };

type Fixture = {
  key: string;
  title: string;
  date: string;
  /// Hours; an end past 24 runs into the next days.
  startHour: number;
  endHour: number;
  capacity: number;
  entries: Entry[];
  testCases: string;
};

const reg = (who: Who, joined: string): Entry => ({ who, status: "registered", joined });
const wait = (who: Who, joined: string, offer?: Entry["offer"]): Entry => ({ who, status: "waitlisted", joined, offer });

const FIXTURES: Fixture[] = [
  // Full, with two waiting: join (TC01), already in (TC02), position and leave (TC03).
  { key: "spm66_summit", title: "SPM66 Harbour Summit", date: "2027-11-08", startHour: 9, endHour: 17, capacity: 2,
    entries: [reg("uma", "2026-10-01"), reg("tomas", "2026-10-02"), wait("hana", "2026-10-10"), wait("ravi", "2026-10-11")],
    testCases: "TC01 TC02 TC03" },
  // A place offered to Hana, to accept (TC04).
  { key: "spm66_gala", title: "SPM66 Offer Gala", date: "2027-11-10", startHour: 19, endHour: 22, capacity: 2,
    entries: [reg("uma", "2026-10-01"), wait("hana", "2026-10-10", "standing"), wait("ravi", "2026-10-11")],
    testCases: "TC04" },
  // Full; Uma withdraws and the place goes to Hana, while Siew Ling can't take it (TC05).
  { key: "spm66_forum", title: "SPM66 Withdrawal Forum", date: "2027-11-12", startHour: 9, endHour: 12, capacity: 2,
    entries: [reg("uma", "2026-10-01"), reg("tomas", "2026-10-02"), wait("hana", "2026-10-10"), wait("ravi", "2026-10-11")],
    testCases: "TC05" },
  // A place offered to Hana, to decline - it then goes to Ravi (TC06).
  { key: "spm66_workshop", title: "SPM66 Decline Workshop", date: "2027-11-15", startHour: 14, endHour: 17, capacity: 2,
    entries: [reg("uma", "2026-10-01"), wait("hana", "2026-10-10", "standing"), wait("ravi", "2026-10-11")],
    testCases: "TC06" },
  // Hana's offer has lapsed - the app ends it and offers the place to Ravi (TC07).
  { key: "spm66_talk", title: "SPM66 Lapsed Offer Talk", date: "2027-11-17", startHour: 9, endHour: 11, capacity: 2,
    entries: [reg("uma", "2026-10-01"), wait("hana", "2026-10-10", "lapsed"), wait("ravi", "2026-10-11")],
    testCases: "TC07" },
  // Hana holds an offer; the coordinator gives it to Siew Ling (TC08, TC09).
  { key: "spm66_showcase", title: "SPM66 Override Showcase", date: "2027-11-19", startHour: 10, endHour: 16, capacity: 2,
    entries: [reg("uma", "2026-10-01"), wait("hana", "2026-10-10", "standing"), wait("ravi", "2026-10-11"), wait("siew", "2026-10-12")],
    testCases: "TC08 TC09" },
  // Started on 20 Oct 2026 and runs into 2027: Hana's offer ends with the
  // start, and she stays first in the queue (TC10).
  { key: "spm66_expo", title: "SPM66 Started Expo", date: "2026-10-20", startHour: 9, endHour: 24 * 100 + 17, capacity: 2,
    entries: [reg("uma", "2026-10-01"), wait("hana", "2026-10-10", "standing"), wait("ravi", "2026-10-11")],
    testCases: "TC10" },
];

const CHAIN = ["submitted", "under_review", "approved", "planning", "confirmed"];

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-66 fixtures -> ${host || "(DATABASE_URL not set)"}`);

  const find = async (email: string) => {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!u) throw new Error(`Base seed user ${email} not found - run the base seed once first.`);
    return u.id;
  };
  const lead = await find("grace.lim@connectsphere.com");
  const coordinatorId = await find("daniel.tan@connectsphere.com");
  const organiser = await prisma.user.findFirst({
    where: { fullName: "Rachel Ng", role: "organiser" },
    select: { id: true, organisationId: true },
  });
  if (!organiser) throw new Error('Organiser "Rachel Ng" not found - run the base seed once first.');

  // The five accounts, upserted so a rerun refreshes them in place.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {} as Record<Who, string>;
  for (const [who, account] of Object.entries(ACCOUNTS) as [Who, (typeof ACCOUNTS)[Who]][]) {
    const data = { ...account, role: "attendee", passwordHash, isActive: true };
    const u = await prisma.user.upsert({ where: { email: account.email }, create: data, update: data, select: { id: true } });
    ids[who] = u.id;
  }
  const cleared = await prisma.notification.deleteMany({ where: { recipientId: { in: Object.values(ids) } } });
  console.log(`Accounts ready (password ${DEMO_PASSWORD}): ${Object.values(ACCOUNTS).map((a) => a.email).join(", ")}`);
  console.log(`Cleared ${cleared.count} notification(s) of theirs.`);

  const removed = await prisma.event.deleteMany({ where: { seedKey: { startsWith: KEY_PREFIX } } });
  console.log(`Removed ${removed.count} SPM-66 event(s).`);

  const now = new Date();
  for (const f of FIXTURES) {
    const startsAt = sgt(f.date, f.startHour);
    const endsAt = sgt(f.date, f.endHour);
    const historyStart = sgt("2026-09-01", 9);

    const created = await prisma.event.create({
      data: {
        seedKey: f.key,
        title: f.title,
        purpose: "SPM-66 waiting list test event",
        category: "conference",
        organiserId: organiser.id,
        organisationId: organiser.organisationId,
        coordinatorId,
        status: "confirmed",
        startsAt,
        endsAt,
        expectedAttendance: f.capacity,
        preferredLayout: "theatre",
        registrationEnabled: true,
        registrationCapacity: f.capacity,
        registrationOpensAt: sgt("2026-09-01", 9),
        // Closes before the event starts, as SPM-64 requires.
        registrationClosesAt: startsAt < sgt("2027-10-31", 17) ? new Date(startsAt.getTime() - DAY) : sgt("2027-10-31", 17),
        submittedAt: historyStart,
        confirmedAt: new Date(historyStart.getTime() + 12 * DAY),
        statusHistory: {
          create: CHAIN.map((to, i) => ({
            fromStatus: i === 0 ? "draft" : CHAIN[i - 1],
            toStatus: to,
            changedBy: to === "submitted" ? organiser.id : to === "under_review" ? lead : coordinatorId,
            changedAt: new Date(historyStart.getTime() + i * 3 * DAY),
          })),
        },
      },
      select: { id: true, sequenceNumber: true },
    });

    for (const e of f.entries) {
      const joined = sgt(e.joined, 10);
      const offeredAt = e.offer === "lapsed" ? new Date(now.getTime() - 3 * DAY - HOUR) : new Date(now.getTime() - HOUR);
      const offerExpiresAt = e.offer === "lapsed" ? new Date(now.getTime() - HOUR) : new Date(offeredAt.getTime() + 3 * DAY);
      await prisma.registration.create({
        data: {
          eventId: created.id,
          attendeeId: ids[e.who],
          status: e.status,
          registeredAt: joined,
          ...(e.status === "waitlisted" ? { waitlistedAt: joined } : {}),
          ...(e.offer ? { offeredAt, offerExpiresAt } : {}),
        },
      });
    }

    const queue = f.entries.filter((e) => e.status === "waitlisted").map((e) => `${ACCOUNTS[e.who].fullName}${e.offer ? ` (${e.offer} offer)` : ""}`);
    console.log(`  EVT-${String(created.sequenceNumber).padStart(6, "0")}  ${f.title.padEnd(26)} waiting: ${queue.join(", ").padEnd(55)} ${f.testCases}`);
  }

  console.log(`Done: 5 SPM-66 attendees and ${FIXTURES.length} SPM-66 events ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
