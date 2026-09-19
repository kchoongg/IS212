-- AlterTable
ALTER TABLE "equipment_requests" ADD COLUMN     "session_id" TEXT;

-- AlterTable
ALTER TABLE "venue_bookings" ADD COLUMN     "session_id" TEXT;

-- CreateTable
CREATE TABLE "event_sessions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "label" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "expected_attendance" INTEGER,
    "preferred_layout" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_sessions_event_id_starts_at_idx" ON "event_sessions"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "equipment_requests_session_id_idx" ON "equipment_requests"("session_id");

-- CreateIndex
CREATE INDEX "venue_bookings_session_id_idx" ON "venue_bookings"("session_id");

-- AddForeignKey
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_bookings" ADD CONSTRAINT "venue_bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_requests" ADD CONSTRAINT "equipment_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "event_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
