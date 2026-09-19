-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "flagged_at" TIMESTAMP(3),
ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_reason" TEXT;

-- CreateIndex
CREATE INDEX "venue_bookings_needs_review_flagged_at_idx" ON "venue_bookings"("needs_review", "flagged_at");
