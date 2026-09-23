-- Persists prisma/seed.ts's own natural key (e.g. "confirmed_claims") on the
-- Event row, so a test fixture, report, or anything else needing to refer
-- back to "the same event" survives a reseed. NULL for every event raised
-- through the app itself (POST /api/events) — those have no equivalent
-- concept, and their id is already durable in practice since production is
-- never reseeded. See the comment on Event.seedKey in schema.prisma, and
-- SCHEMA_REFERENCE.md's note that "Event has no unique identifier at all".

ALTER TABLE "events" ADD COLUMN "seed_key" TEXT;

CREATE UNIQUE INDEX "events_seed_key_key" ON "events"("seed_key");
