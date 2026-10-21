-- Request Event Clarification (SPM-29, PR #70 review): at most one OPEN
-- clarification per event. The route checks for one before creating, but two
-- requests at the same moment (a double-click, two tabs) can both pass that
-- check before either saves. This index makes the second insert fail, and the
-- route turns that into "This event already has an open clarification."
-- Respond to Clarification Request (SPM-26) relies on there being only one.
--
-- PARTIAL, so answered and closed clarifications - the history of earlier
-- rounds - do not count. Not expressible in schema.prisma (no WHERE clause on
-- @@unique), so it exists only here, like the equipment_requests ones in
-- 20260919100000_add_partial_unique_equipment_request_session.
--
-- Safe on existing data: checked before writing this that no event has more
-- than one open clarification (the seed's two are on different events).

CREATE UNIQUE INDEX "clarification_requests_one_open_per_event_key"
  ON "clarification_requests" ("event_id")
  WHERE "status" = 'open';
