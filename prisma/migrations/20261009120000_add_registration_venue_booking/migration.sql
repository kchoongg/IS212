-- Configure Event Registration (SPM-64, AC4): the venue booking an event's
-- registration capacity is measured against. See schema.prisma for what the
-- column means. Nullable, so existing events are unaffected.

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "registration_venue_booking_id" TEXT;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_registration_venue_booking_id_fkey" FOREIGN KEY ("registration_venue_booking_id") REFERENCES "venue_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
