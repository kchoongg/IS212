-- Review Venue Booking Request (SPM-43 AC6): when rejecting a request, Venue
-- Staff may suggest another venue and/or describe an alternative arrangement.
-- Both columns are NULL on every existing row - nothing to backfill, and no
-- reseed needed.

-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "suggested_alternative" TEXT,
ADD COLUMN     "suggested_venue_id" TEXT;

-- AddForeignKey
ALTER TABLE "venue_bookings" ADD CONSTRAINT "venue_bookings_suggested_venue_id_fkey" FOREIGN KEY ("suggested_venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
