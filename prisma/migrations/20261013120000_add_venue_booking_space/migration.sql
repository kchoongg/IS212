-- Check Each Venue Against Its Own Requirements (SPM-90): an event may book
-- several rooms, each for its own use. A booking now records what its space is
-- for and how many people that space is for; its layout was already per
-- booking (layout_name). Both columns are nullable, so no reseed is needed.

-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "expected_attendance" INTEGER,
ADD COLUMN     "purpose" TEXT;

-- Backfill: an existing booking was judged against its session's attendance
-- where it has a session, else its event's - record that figure on it.
-- "purpose" stays NULL: nobody said what those rooms were for.
UPDATE "venue_bookings" AS b
SET "expected_attendance" = COALESCE(
  (SELECT s."expected_attendance" FROM "event_sessions" AS s WHERE s."id" = b."session_id"),
  (SELECT e."expected_attendance" FROM "events" AS e WHERE e."id" = b."event_id")
);
