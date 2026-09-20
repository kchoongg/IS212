-- Two sessions of the same event may now request the same equipment type
-- independently. Previously blocked because the old unique index
-- (event_id, equipment_id) didn't consider session_id at all — a whole-event
-- request and a session-scoped request for the same item collided even
-- though they're conceptually different things.
--
-- A single index can't express both rules Postgres needs here, because NULL
-- is treated as distinct from every other value in a unique index:
--   - a plain (event_id, equipment_id) index dedupes whole-event requests
--     correctly, but also wrongly blocks two different sessions from each
--     requesting the same item (this was the bug)
--   - a plain (event_id, session_id, equipment_id) index would fix that, but
--     since session_id is NULL for every whole-event request, NULL <> NULL
--     means it would stop deduplicating those entirely (the common case,
--     until session creation exists)
-- Splitting it into two PARTIAL indexes, each only enforcing its own case,
-- gets both right at once.

DROP INDEX "equipment_requests_event_id_equipment_id_key";

-- Whole-event requests (no session): same rule as before this migration.
CREATE UNIQUE INDEX "equipment_requests_event_equipment_no_session_key"
  ON "equipment_requests" ("event_id", "equipment_id")
  WHERE "session_id" IS NULL;

-- Session-scoped requests: unique per session, so two different sessions of
-- the same event can each request the same equipment type.
CREATE UNIQUE INDEX "equipment_requests_event_session_equipment_key"
  ON "equipment_requests" ("event_id", "session_id", "equipment_id")
  WHERE "session_id" IS NOT NULL;
