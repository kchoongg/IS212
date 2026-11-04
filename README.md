# ConnectSphere (IS212 G7)

ConnectSphere is a web app that lets ConnectSphere Event Services staff and clients plan events, book venues, reserve equipment, and manage attendee registration.

**Team:** Kristen Choong, Jordan Tan, Kayalvizhi Kandasamy, Janelle Ip, Sammi Chua

**Repository:** https://github.com/kchoongg/IS212 (the instructors have been added as collaborators)

**Live demo:** https://connectsphere-orcin.vercel.app/login

Hosted on Vercel; the code is the same as main.

**Demo accounts:** every seeded account's password is `password123`. One per role (from `prisma/seed.ts`):

| Role | Email |
| --- | --- |
| Event Coordinator Lead (`ops_manager`) | `grace.lim@connectsphere.com` |
| Event Coordinator (`coordinator`) | `daniel.tan@connectsphere.com` |
| Venue Staff (`venue_staff`) | `marcus.wong@connectsphere.com` |
| Technical Support (`tech_support`) | `kenji.sato@connectsphere.com` |
| Safety Officer (`safety_officer`) | `hana.yusof@connectsphere.com` |
| Event Organiser (`organiser`) | `rachel.ng@meridianfina.com` |
| Attendee (`attendee`) | `lee.wei.ming@example.com` |

**New here? Start with [docs/START_HERE.md](docs/START_HERE.md):** where everything lives, how to run it, and how to trace any story end to end.

## Stack

- Next.js 16 (App Router, TypeScript) with React 19
- Tailwind CSS 3
- PostgreSQL via Prisma 6
- Hand-rolled auth: bcryptjs (password hashing) + jsonwebtoken (sessions)
- Zod 3 (validation)
- Vitest 5 (unit and integration tests), Playwright (end-to-end tests)
- Node.js 24 in CI

## Getting started

Requires Node.js 20.12 or later (CI uses 24).

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` (local Postgres, Neon, or Supabase) and `JWT_SECRET`.
3. Apply the schema to your database:
   ```
   npm run prisma:migrate
   ```
4. Generate the Prisma client and load the demo data (the demo accounts above). Never run the seed on the shared team database:
   ```
   npx prisma generate
   npx prisma db seed
   ```
5. Run the dev server:
   ```
   npm run dev
   ```
   then open http://localhost:3000/login

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

`npm run test:coverage` covers **100% of lines** and **100% of functions**
under `src/`, 99.88% of statements and 99.54% of branches (2026-11-04). Every
piece that is not covered is listed here with the reason, at its line in
`coverage/coverage-final.json` from that run. None is a business rule left
untested. How the tests are organised is in `docs/TESTING.md`.

**1. Not reachable: an earlier check guarantees the value**

| File | Line | Why it cannot run |
|---|---|---|
| `src/app/api/equipment/[id]/out-of-service/route.ts` | 73 | `data.type ?? null`: when units are out of service, the schema (`recordOutOfServiceSchema`'s refine) already requires a `type` |
| `src/lib/validation/events.ts` | 82 | `d.sessions ?? []`: both callers check `!d.sessions?.length` first, so `sessions` is always present here |
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
| `src/app/equipment/requests/[id]/page.tsx` | 387 (`if (!editing) return`) |
| `src/app/events/[id]/equipment/page.tsx` | 185, 192, 370, 393, 435, 798 (state updates before the page has loaded), 545 (`event ? … : "finished"`: `locked` is true only once the event has loaded) |
| `src/app/events/[id]/page.tsx` | 1038 (`coordinators ?? []` once the coordinators have loaded) |
| `src/app/events/[id]/readiness/page.tsx` | 394 (`OWN_STATUS[kind] ?? "Status"`: every arrangement kind has a label) |
| `src/app/events/[id]/review/page.tsx` | 216 |
| `src/app/events/[id]/update/page.tsx` | 153, 172, 177, 200, 397 |
| `src/app/events/[id]/venue/page.tsx` | 287 (`if (!changing) return`), 368 (`sessionId ?? ""`: the Session select shows only once the load has set `sessionId` to the first session) |
| `src/app/venues/[id]/availability/page.tsx` | 239 (`if (!data) return`), 289 |
| `src/app/venues/[id]/edit/page.tsx` | 234 (`user?.role ?? ""` when signed in) |
| `src/app/venues/new/page.tsx` | 105 (same) |
| `src/app/venues/search/page.tsx` | 226 (`startPlanning` runs only from the begin-planning dialog, which opens only with a user, a loaded event and `shouldStartPlanning()` true), 269 (`if (event)` when choosing a session, which needs an event) |
| `src/components/AssignCoordinator.tsx` | 63 (`if (!chosen) return`: Assign is disabled until a coordinator is chosen) |
| `src/components/ui/ConfirmDialog.tsx` | 42 (dialog ref) |

## Submission evidence

- [docs/START_HERE.md](docs/START_HERE.md) — where everything lives and how to trace a story end to end
- [docs/traceability/TRACEABILITY.md](docs/traceability/TRACEABILITY.md) — story → acceptance criteria → test cases → automated tests
- [docs/test-cases/](docs/test-cases/) — test case workbooks, one per story, with execution blocks
- [docs/regression/](docs/regression/) — regression logs for Sprints 3 and 4
- [docs/CHANGES.md](docs/CHANGES.md) — requirement changes and how they were handled
- [docs/architecture/](docs/architecture/) — C4 architecture diagrams
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — the CI pipeline run on every pull request
- Sprint 4 (the final sprint) recordings. These links open only for SMU accounts. Sign in to Google with your @smu.edu.sg email first; a personal Gmail account will show 'Request access'.

  | Meeting | Date | Recording |
  | --- | --- | --- |
  | Sprint planning | 18 Oct | [Watch](https://drive.google.com/file/d/1GSrJ3w9OPvY5AV_IYTYhD-O0h21zkcYl/view) |
  | Daily standup (live) | 26 Oct | [Watch](https://drive.google.com/file/d/12LJlRiy0CNZpqFfTkr5l5UjDdo0np5Vg/view) |
  | Sprint review | 1 Nov | [Watch](https://drive.google.com/file/d/1PTGWKrtNJEbYlIyLJY8aHcna2SfsLO6y/view) |
  | Sprint retrospective | 1 Nov | [Watch](https://drive.google.com/file/d/1jZo7Yiot2sgfNLXKI2elwIKr64QbW3r4/view) |

## Known limitations

- Notifications are in-app only; sending them by email is backlog story SPM-91.
- The Vercel demo uses one shared database, so its data may change between visits.
- Everything else still open is in [DOCUMENTATION.md › Known Gaps](DOCUMENTATION.md#-known-gaps).

## Documentation

- Requirement changes (`docs/CHANGES.md`), the C4 architecture (`docs/architecture/`) and the traceability matrix are linked under [Submission evidence](#submission-evidence)
- `docs/ConnectSphere_BPMN.drawio` and `docs/ConnectSphere_Status_Lifecycle.drawio` — the BPMN process and event status lifecycle after the Week 7 changes; the `_pre-Week7` versions beside them show them before, for comparison
- `DOCUMENTATION.md` — how the app is built, conventions, changelog
- `docs/TESTING.md` — test levels, CI jobs, traceability, what happens when a test fails
- `UI_DESIGN.md` — every screen, navigation, forms, error states
- `SCHEMA_REFERENCE.md` — per-table field reference
- `design/mockups/` — visual mockups, one file per screen
