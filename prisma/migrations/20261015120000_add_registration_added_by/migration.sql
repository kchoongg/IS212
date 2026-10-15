-- View Registration List (SPM-65, AC4): attendees added on the Organiser's
-- behalf are identifiable on the registration list. This column records who
-- added the registration; Manually Add Attendee sets it. NULL - the attendee
-- registered themselves - on every existing row, so nothing to backfill and
-- no reseed needed.

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "added_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
