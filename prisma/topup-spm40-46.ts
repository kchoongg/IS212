/**
 * Adds SPM-40's and SPM-46's test data to an already-seeded database WITHOUT
 * reseeding, so nobody loses what they created in the app.
 *
 * Run with:  npx tsx prisma/topup-spm40-46.ts
 *
 * Writes exactly what prisma/seed.ts writes for the same rows (same anchor,
 * same dates), so a later full reseed produces the same data:
 *   - SPM-46-TC10: Jurong Expo Floor's two overlapping unavailable periods
 *     (days 40-44 and 42-46).
 *   - SPM-40-TC15: "SPM40 Approved Workshop" (day 180) and its status history.
 *
 * Safe to re-run: it creates only what is missing and deletes nothing else.
 * Re-running also puts the workshop back to Approved, which is how SPM-40-TC15
 * (it moves the event to Planning) is reset before running it again.
 *
 * The one difference from a reseed: the workshop takes the next free EVT-
 * number, not the one a reseed would give it. No test case quotes it.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Same anchor and day() as prisma/seed.ts - keep them in step.
const SEED_ANCHOR = "2026-09-26";
const [anchorYear, anchorMonth, anchorDay] = SEED_ANCHOR.split("-").map(Number);
const SGT_OFFSET_HOURS = 8;
function day(n: number, hour = 9, minute = 0): Date {
  return new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay + n, hour - SGT_OFFSET_HOURS, minute));
}

async function userId(email: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!u) throw new Error(`User ${email} not found - is the database seeded?`);
  return u.id;
}

async function jurongOverlappingBlocks() {
  const venue = await prisma.venue.findUnique({ where: { code: "JUR-EXP" }, select: { id: true } });
  if (!venue) throw new Error("Venue JUR-EXP not found - is the database seeded?");

  // [from, to, reason, notes, createdBy] - createdBy matches the seed's
  // round-robin over venue staff for these rows' positions.
  const blocks: [number, number, string, string, string][] = [
    [40, 44, "maintenance", "Loading bay hoist inspection.", "siti.hassan@connectsphere.com"],
    [42, 46, "safety", "Fire suppression system recertification.", "roy.chandra@connectsphere.com"],
  ];
  for (const [from, to, reason, notes, createdBy] of blocks) {
    const startsAt = day(from, 0);
    const endsAt = day(to, 23, 59);
    const existing = await prisma.venueUnavailability.findFirst({
      where: { venueId: venue.id, startsAt, endsAt, reason },
    });
    if (existing) {
      console.log(`JUR-EXP ${reason} (days ${from}-${to}): already there`);
      continue;
    }
    await prisma.venueUnavailability.create({
      data: { venueId: venue.id, startsAt, endsAt, reason, notes, createdBy: await userId(createdBy) },
    });
    console.log(`JUR-EXP ${reason} (days ${from}-${to}): added`);
  }
}

async function approvedWorkshop() {
  const days = 180;
  const startsAt = day(days, 9);
  const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000);
  const organiserId = await userId("rachel.ng@meridianfina.com");
  const coordinatorId = await userId("daniel.tan@connectsphere.com");
  const organiser = await prisma.user.findUnique({ where: { id: organiserId }, select: { organisationId: true } });

  const fields = {
    title: "SPM40 Approved Workshop",
    purpose: "Venue search walkthrough",
    category: "workshop",
    organiserId,
    organisationId: organiser?.organisationId,
    coordinatorId,
    status: "approved",
    startsAt,
    endsAt,
    expectedAttendance: 30,
    preferredLayout: "classroom",
    registrationEnabled: false,
    submittedAt: day(days - 40),
  };

  const existing = await prisma.event.findUnique({ where: { seedKey: "spm40_approved" }, select: { id: true, status: true } });
  const event = existing
    ? await prisma.event.update({ where: { id: existing.id }, data: fields })
    : await prisma.event.create({ data: { seedKey: "spm40_approved", ...fields } });
  console.log(existing
    ? `SPM40 Approved Workshop: already there (was ${existing.status}) - reset to approved`
    : "SPM40 Approved Workshop: added");

  // Same chain, reasons and dates as the seed's status history.
  await prisma.eventStatusHistory.deleteMany({ where: { eventId: event.id } });
  const chain: [string, string, string, string | undefined][] = [
    ["draft", "submitted", organiserId, undefined],
    ["submitted", "under_review", coordinatorId, "Coordinator assigned"],
    ["under_review", "approved", coordinatorId, "Requirements sufficiently clear"],
  ];
  for (let i = 0; i < chain.length; i++) {
    const [fromStatus, toStatus, changedBy, reason] = chain[i];
    await prisma.eventStatusHistory.create({
      data: { eventId: event.id, fromStatus, toStatus, changedBy, changedAt: day(days - 40 + i * 5), reason },
    });
  }
}

async function main() {
  await jurongOverlappingBlocks();
  await approvedWorkshop();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
