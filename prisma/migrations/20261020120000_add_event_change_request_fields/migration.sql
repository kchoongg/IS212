-- SPM-35 (Request Event Change): what kind of request, the fields it changes
-- with their current and proposed values, and equipment changes in free text.
-- Adds columns only; existing rows become "change" requests with no field list.
ALTER TABLE "event_change_requests" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'change';
ALTER TABLE "event_change_requests" ADD COLUMN "changes" JSONB;
ALTER TABLE "event_change_requests" ADD COLUMN "equipment_changes" TEXT;
