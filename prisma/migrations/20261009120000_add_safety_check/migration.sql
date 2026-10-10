-- CreateTable
CREATE TABLE "safety_checks" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "safety_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "safety_checks_event_id_submitted_at_idx" ON "safety_checks"("event_id", "submitted_at");

-- AddForeignKey
ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

