-- SPM-66 (Join and Respond to Waiting List).
-- Four nullable columns on registrations: when the attendee joined the
-- waiting list (its first-in, first-out order), and the place offered to them -
-- when, until when, and how the offer ended. Existing rows keep NULLs: nobody
-- has been on a waiting list yet, so no data is changed.

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "offer_ended_reason" TEXT,
ADD COLUMN     "offer_expires_at" TIMESTAMP(3),
ADD COLUMN     "offered_at" TIMESTAMP(3),
ADD COLUMN     "waitlisted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "registrations_status_offer_expires_at_idx" ON "registrations"("status", "offer_expires_at");
