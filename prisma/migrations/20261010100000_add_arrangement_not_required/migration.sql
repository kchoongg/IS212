-- Track Outstanding Arrangements (SPM-33): an arrangement the assigned
-- Coordinator has marked as not required for the event, and who made the
-- latest decision and when. See schema.prisma for what each column means.
-- Additive only: every existing row keeps its meaning (not_required = false).

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "registration_not_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registration_not_required_at" TIMESTAMP(3),
ADD COLUMN     "registration_not_required_by" TEXT;

-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "not_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "not_required_at" TIMESTAMP(3),
ADD COLUMN     "not_required_by" TEXT;

-- AlterTable
ALTER TABLE "equipment_requests" ADD COLUMN     "not_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "not_required_at" TIMESTAMP(3),
ADD COLUMN     "not_required_by" TEXT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_registration_not_required_by_fkey" FOREIGN KEY ("registration_not_required_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_bookings" ADD CONSTRAINT "venue_bookings_not_required_by_fkey" FOREIGN KEY ("not_required_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_not_required_by_fkey" FOREIGN KEY ("not_required_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
