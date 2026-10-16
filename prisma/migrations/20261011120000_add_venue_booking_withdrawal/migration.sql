-- Withdraw or Release Venue Booking (SPM-67): the assigned Coordinator
-- withdraws a pending request or releases an approved booking, optionally with
-- a reason. The booking stays on the event with status `withdrawn` or
-- `released` (a string column - no enum to change). These three columns record
-- who did it, when, and why. All NULL on every existing row - nothing to
-- backfill, and no reseed needed.

-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "cancellation_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by" TEXT;

-- AddForeignKey
ALTER TABLE "venue_bookings" ADD CONSTRAINT "venue_bookings_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
