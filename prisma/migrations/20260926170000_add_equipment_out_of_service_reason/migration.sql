-- Why some units of an equipment item are out of service (SPM-48 AC7 / SPM-55).
-- NULL means none are, or nobody recorded a reason - every existing row keeps
-- working unchanged and needs no backfill.

-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "out_of_service_reason" TEXT;
