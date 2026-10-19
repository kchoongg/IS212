-- Request Event Clarification (SPM-29, AC1): the coordinator says which
-- information needs clarifying. Comma-separated codes, as
-- venue_bookings.review_reason. NULL on the rows raised before SPM-29 (the
-- seed's), which read as no items, so nothing to backfill and no reseed.

-- AlterTable
ALTER TABLE "clarification_requests" ADD COLUMN     "fields" TEXT;
