-- A user-facing, auto-generated reference number for every event, distinct
-- from Event.seedKey (internal, seed-data only) and from id (an opaque UUID
-- that changes on every reseed). Formatted for display as "EVT-000123" by
-- eventReference() (src/lib/format.ts). Visible to every role, including an
-- Attendee (see ATTENDEE_EVENT_FIELDS in src/lib/permissions.ts).

CREATE SEQUENCE "events_sequence_number_seq";

ALTER TABLE "events" ADD COLUMN "sequence_number" INTEGER NOT NULL DEFAULT nextval('events_sequence_number_seq');

ALTER SEQUENCE "events_sequence_number_seq" OWNED BY "events"."sequence_number";

CREATE UNIQUE INDEX "events_sequence_number_key" ON "events"("sequence_number");
