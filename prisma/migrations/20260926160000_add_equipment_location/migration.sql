-- Where a piece of equipment is kept (SPM-48; customer Q&A #2). NULL means
-- ConnectSphere's own storage, so every existing row keeps meaning "in storage"
-- and needs no backfill. Equipment set to a venue needs no transfer time for an
-- event at that same venue. ON DELETE SET NULL: retiring or removing a venue
-- sends its kit back to storage rather than blocking the delete.

-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "location_venue_id" TEXT;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_location_venue_id_fkey" FOREIGN KEY ("location_venue_id") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
