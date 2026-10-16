-- Update Event Information (SPM-62): review flags raised by a change to an
-- event's information. See schema.prisma for what each column means.

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "registration_review_reason" TEXT;

-- AlterTable
ALTER TABLE "equipment_requests" ADD COLUMN     "flagged_at" TIMESTAMP(3),
ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_reason" TEXT;

-- CreateIndex
CREATE INDEX "equipment_requests_needs_review_flagged_at_idx" ON "equipment_requests"("needs_review", "flagged_at");
