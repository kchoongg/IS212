/**
 * One-off data fix, WITHOUT reseeding.
 *
 *   npx tsx scripts/remove-pre-approval-bookings.ts            (shows the rows, changes nothing)
 *   npx tsx scripts/remove-pre-approval-bookings.ts --apply    (deletes them)
 *
 * The base seed gave two events that are not approved yet a PENDING venue
 * booking request:
 *   - "Straits Medical Journal Club" (seedKey review_journal, Under review)
 *     at Changi Meeting Room 1 (CBP-MTG1)
 *   - "Nusantara Developer Summit" (seedKey submitted, Submitted) at Orchard
 *     Seminar Room (ORC-SEM)
 * Since SPM-54 a venue can only be requested once the event is approved, so
 * those requests are a state the app can no longer produce - and Booking
 * Requests does not list them, so nobody could clear the hold they keep on
 * the room. prisma/seed.ts no longer creates them; this removes the copies
 * already in a database seeded before that.
 *
 * Touches only those two requests, and only while each is still pending and
 * its event still not approved - otherwise someone has acted on it and it is
 * left alone. The summit's REJECTED request at Marina Auditorium stays:
 * SPM-46-TC13 uses it.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGETS = [
  { seedKey: "review_journal", venueCode: "CBP-MTG1" },
  { seedKey: "submitted", venueCode: "ORC-SEM" },
];

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.venueBooking.findMany({
    where: {
      status: "pending",
      OR: TARGETS.map((t) => ({
        event: { seedKey: t.seedKey, status: { in: ["submitted", "under_review"] } },
        venue: { code: t.venueCode },
      })),
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      layoutName: true,
      requestedAt: true,
      requester: { select: { email: true } },
      event: { select: { sequenceNumber: true, title: true, status: true } },
      venue: { select: { code: true, name: true } },
    },
  });

  if (rows.length === 0) {
    console.log("Nothing to fix: neither request is in this database.");
    return;
  }

  for (const row of rows) {
    console.log(JSON.stringify(row, null, 2));
  }

  if (!apply) {
    console.log(`\nFound ${rows.length} request(s). Nothing changed - run again with --apply to delete.`);
    return;
  }

  const { count } = await prisma.venueBooking.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  console.log(`\nDeleted ${count} request(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
