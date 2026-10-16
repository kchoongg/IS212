-- SPM-82 (Expire Tentative Venue Hold, Week 7 change #4).
-- A pending venue booking request is a tentative hold that expires unless
-- Venue Staff approve it in time. Both columns are nullable: requests made
-- before this migration keep no expiry and never expire, so nobody's existing
-- pending bookings (or other stories' test data) start expiring.

-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "hold_expires_at" TIMESTAMP(3),
ADD COLUMN     "expiry_warning_sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "venue_bookings_status_hold_expires_at_idx" ON "venue_bookings"("status", "hold_expires_at");
