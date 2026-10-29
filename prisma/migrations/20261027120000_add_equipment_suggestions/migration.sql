-- Suggest Alternative Equipment (SPM-77). Technical Support suggests another
-- item for a requirement they cannot provide, or can provide only in part; the
-- assigned Coordinator accepts or declines it. A suggestion reserves nothing
-- and changes nothing by itself - see prisma/schema.prisma, EquipmentSuggestion.

-- CreateTable
CREATE TABLE "equipment_suggestions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "equipment_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "suggested_by" TEXT NOT NULL,
    "suggested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "equipment_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_suggestions_request_id_status_idx" ON "equipment_suggestions"("request_id", "status");

-- AddForeignKey
ALTER TABLE "equipment_suggestions" ADD CONSTRAINT "equipment_suggestions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "equipment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_suggestions" ADD CONSTRAINT "equipment_suggestions_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_suggestions" ADD CONSTRAINT "equipment_suggestions_suggested_by_fkey" FOREIGN KEY ("suggested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_suggestions" ADD CONSTRAINT "equipment_suggestions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one PENDING suggestion per requirement. The route checks for one
-- before creating, but two Technical Support users suggesting at the same
-- moment can both pass that check; this makes the second insert fail, and the
-- route answers 409. Partial, so decided suggestions - the record of what was
-- offered - do not count. Not expressible in schema.prisma (no WHERE clause on
-- @@unique), like clarification_requests_one_open_per_event_key.
CREATE UNIQUE INDEX "equipment_suggestions_one_pending_per_request_key"
  ON "equipment_suggestions" ("request_id")
  WHERE "status" = 'pending';
