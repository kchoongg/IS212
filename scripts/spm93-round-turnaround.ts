/**
 * SPM-93 (Book Venues in 15-Minute Units) - one-off data fix, WITHOUT reseeding.
 *
 *   npx tsx scripts/spm93-round-turnaround.ts            # dry run: reports only
 *   npx tsx scripts/spm93-round-turnaround.ts --apply    # writes the change
 *
 * AC5: "Each venue's setup time and turnaround time are set in minutes, in
 * 15-minute steps (including zero)". The venue form and API now refuse
 * anything else, but venues saved before this story can still hold, say, 20
 * minutes (CBP-MTG1 and CBP-MTG2 in the base seed). This rounds every such
 * value UP to the next 15-minute step - never down, so Venue Staff never get
 * less time than they recorded - and changes nothing else.
 *
 * Week 7 Customer Changes, Change #1: "Existing bookings that become
 * problematic under the new rule should be identified rather than silently
 * removed." So nothing is removed or moved: the script LISTS every approved,
 * upcoming booking at a venue it changes whose room-in-use time now overlaps
 * another approved booking or an unavailable period, or no longer fits the
 * opening hours. Flagging them for the coordinator is SPM-80 (Re-check
 * Bookings When Setup or Turnaround Time Changes); until that is built, give
 * this list to Venue Staff.
 *
 * prisma/seed.ts already holds the rounded values, so a full reseed needs no fix.
 */

import { PrismaClient } from "@prisma/client";
import { BOOKING_STEP_MINUTES, occupiedWindow, overlapping, withinOpeningHours } from "../src/lib/venueTime";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const roundUp = (minutes: number) => Math.ceil(minutes / BOOKING_STEP_MINUTES) * BOOKING_STEP_MINUTES;

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  console.log(`SPM-93 setup/turnaround rounding -> ${host || "(DATABASE_URL not set)"}${apply ? "" : " (dry run)"}`);

  const venues = await prisma.venue.findMany({ orderBy: { code: "asc" } });
  const offGrid = venues.filter(
    (v) => v.setupMinutes % BOOKING_STEP_MINUTES !== 0 || v.teardownMinutes % BOOKING_STEP_MINUTES !== 0
  );
  if (offGrid.length === 0) {
    console.log("Every venue's setup and turnaround is already in 15-minute steps. Nothing to do.");
    return;
  }

  const now = new Date();
  for (const v of offGrid) {
    const rounded = { setupMinutes: roundUp(v.setupMinutes), teardownMinutes: roundUp(v.teardownMinutes) };
    console.log(
      `${v.code} ${v.name}: setup ${v.setupMinutes} -> ${rounded.setupMinutes} min, ` +
        `turnaround ${v.teardownMinutes} -> ${rounded.teardownMinutes} min`
    );

    const [bookings, blocks] = await Promise.all([
      prisma.venueBooking.findMany({
        where: { venueId: v.id, status: "approved", endsAt: { gt: now } },
        include: { event: { select: { sequenceNumber: true, title: true } } },
        orderBy: { startsAt: "asc" },
      }),
      prisma.venueUnavailability.findMany({ where: { venueId: v.id, endsAt: { gt: now } } }),
    ]);
    for (const b of bookings) {
      const inUse = occupiedWindow(b, rounded);
      const problems = [
        ...bookings
          .filter((other) => other.id !== b.id && overlapping(inUse, occupiedWindow(other, rounded)))
          .map((other) => `overlaps ${other.event.title ?? "another booking"}`),
        ...blocks.filter((u) => overlapping(inUse, u)).map((u) => `overlaps unavailable period (${u.reason})`),
        ...(withinOpeningHours(v, inUse) ? [] : ["no longer fits the opening hours"]),
      ];
      if (problems.length > 0) {
        const ref = `EVT-${String(b.event.sequenceNumber).padStart(6, "0")}`;
        console.log(`  REVIEW ${ref} ${b.event.title ?? "Untitled event"} ${b.startsAt.toISOString()}: ${problems.join("; ")}`);
      }
    }

    if (apply) await prisma.venue.update({ where: { id: v.id }, data: rounded });
  }

  console.log(apply ? `Done: ${offGrid.length} venue(s) updated.` : "Dry run - nothing written. Run again with --apply.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
