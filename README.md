# IS212

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- PostgreSQL via Prisma
- Hand-rolled auth: bcryptjs (password hashing) + jsonwebtoken (sessions)
- Zod (validation)
- Vitest (testing)

## Getting started

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (local Postgres, Neon, or Supabase) and `JWT_SECRET`.
3. Apply the schema to your database:
   ```
   npm run prisma:migrate
   ```
4. Run the dev server:
   ```
   npm run dev
   ```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint the whole repo |
| `npx tsc --noEmit` | Type-check |
| `npm test` | Run tests once |
| `npm run test:coverage` | Run tests once and report coverage (`coverage/index.html`) |
| `npm run test:integration` | Integration tests against a real local Postgres (`DATABASE_URL` must be on localhost) |
| `npm run test:e2e` | End-to-end tests in Chromium (run `npm run build` first; local Postgres only) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate` | Create/apply a migration |
| `npm run prisma:studio` | Open Prisma Studio |

## Project layout

- `src/app` — App Router routes (pages and `api/`)
- `src/components/ui` — the shared component library; import from `@/components/ui`
- `src/components/AppShell.tsx` — top bar and role-aware sidebar
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/auth.ts` — password hashing and JWT session helpers
- `src/lib/validation/` — Zod schemas, one file per domain (`events.ts`, `equipment.ts`, ...)
- `src/lib/roles.ts`, `statuses.ts`, `format.ts` — role, status and display rules
- `prisma/schema.prisma` — data model

## Coverage exclusions

`npm run test:coverage` covers **100% of lines** under `src/`, 99.82% of
statements, 99.94% of functions and 99.37% of branches (2026-10-19). Every
piece that is not covered is listed here with the reason. None is a business
rule left untested. How the tests are organised is in `docs/TESTING.md`.

**1. Not reachable: an earlier check guarantees the value**

| File | Line | Why it cannot run |
|---|---|---|
| `src/app/api/equipment/[id]/out-of-service/route.ts` | 73 | `data.type ?? null`: when units are out of service, the schema (`recordOutOfServiceSchema`'s refine) already requires a `type` |
| `src/app/api/venues/[id]/route.ts` | 219 | `if (!booking) continue`: every impact is computed from the same `candidates` list, so its booking is always found |
| `src/lib/validation/events.ts` | 81 | `d.sessions ?? []`: both callers check `!d.sessions?.length` first, so `sessions` is always present here |
| `src/lib/venueBookingReview.ts` | 77 | `conflict.block?.reason … ?? "unavailable"`: an "unavailable" conflict from `findVenueConflict()` always carries its period |
| `src/lib/venueTime.ts` | 78 | `part ? … : 0`: `Intl.DateTimeFormat` always returns every date part asked for |
| `src/lib/venueTime.ts` | 140, 286 | `dayNumberOf(dayKey) ?? 0`: callers pass only day keys validated at the boundary (`isDayKey()`), as the function's comment requires |
| `src/lib/venueUnavailabilityService.ts` | 71 | `input.otherReason ?? null`: the schema requires `otherReason` when the reason is "other" |

**2. Not reachable: screen guards for state that is always loaded first.**
Each is a handler or state update that runs only after the page has loaded
its data, or a dialog ref that is always set once mounted. The fallback side
(`current ? … : current`, `?? current`, `?? []`, `if (!x) return`) cannot be
reached from the screen.

| File | Lines |
|---|---|
| `src/app/equipment/page.tsx` | 128 (dialog ref), 191 (`if (!editing) return`) |
| `src/app/equipment/requests/[id]/page.tsx` | 222 (`if (!editing) return`) |
| `src/app/events/[id]/equipment/page.tsx` | 161, 168, 341, 364, 406, 479, 692 (state updates before the page has loaded) |
| `src/app/events/[id]/page.tsx` | 717 (`coordinators ?? []` once the coordinators have loaded) |
| `src/app/events/[id]/readiness/page.tsx` | 390 (`OWN_STATUS[kind] ?? "Status"`: every arrangement kind has a label) |
| `src/app/events/[id]/review/page.tsx` | 188 |
| `src/app/events/[id]/update/page.tsx` | 152, 164, 176, 199, 400 |
| `src/app/events/[id]/venue/page.tsx` | 287 (`if (!changing) return`), 373 |
| `src/app/venues/[id]/availability/page.tsx` | 238 (`if (!data) return`), 293 |
| `src/app/venues/[id]/edit/page.tsx` | 229 (`user?.role ?? ""` when signed in) |
| `src/app/venues/new/page.tsx` | 105 (same) |
| `src/app/venues/search/page.tsx` | 224, 267 (`if (event)` when choosing a session, which needs an event) |
| `src/components/AssignCoordinator.tsx` | 63 (`if (!chosen) return`: Assign is disabled until a coordinator is chosen) |
| `src/components/ui/ConfirmDialog.tsx` | 42 (dialog ref) |

**3. Counted as missed by the coverage tool, but tested**

| File | Line | Why |
|---|---|---|
| `src/app/api/venues/search/route.ts` | 67 | V8 reports the path past `if (!event \|\| !canViewEvent(...)) return hidden();` as never taken, but the next statement (`eventId = event.id`) runs and is covered: "still offers a venue to the event that already holds it" in `venue-availability-search.test.ts` |

**4. Reachable, but not tested, because what it does is a known gap**

| File | Line | Why |
|---|---|---|
| `src/app/events/[id]/booking/new/page.tsx` | 245 | `res.json().catch(() => ({}))`: an error reply that is not JSON. The form then shows no message at all. A test would lock that in, so this is a Known Gap in DOCUMENTATION.md, to be fixed and tested together |

## Documentation

- `DOCUMENTATION.md` — how the app is built, conventions, changelog
- `docs/TESTING.md` — test levels, CI jobs, traceability, what happens when a test fails
- `UI_DESIGN.md` — every screen, navigation, forms, error states
- `SCHEMA_REFERENCE.md` — per-table field reference
- `design/mockups/` — visual mockups, one file per screen
