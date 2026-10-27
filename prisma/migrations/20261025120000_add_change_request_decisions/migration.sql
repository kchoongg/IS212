-- SPM-32 (Process Event Change Request): the coordinator's outcome for each
-- field of a change request, and the reason for each rejected field (AC3).
-- Adds one nullable column; existing rows are unchanged.
ALTER TABLE "event_change_requests" ADD COLUMN "decisions" JSONB;
