# CONNECTSPHERE — TECHNOLOGY STACK RESEARCH

**User story:** As a development team, we want to investigate the available
technology options so that we can select an appropriate technology stack for
ConnectSphere.

**Purpose:** Records the technology options the team considered (SPM-8) and
the stack the project now runs on. Requirements are drawn from the **IS212
Scrum Project Instructions**, the **customer briefing**, and **customer
clarifications**. Items marked **(planned)** are decisions the team has made
but not yet set up in the repo — currently CI/CD.

---

## 1. Requirements

| # | Requirement |
|---|---|
| **R1** | Small team with a fixed, short time budget (four ~2-week sprints, final release Week 12) — little room for setup or tooling that doesn't directly serve a demo. *(Project Instructions, "Project Goal")* |
| **R2** | Core features are explicitly **not isolated** — an event flows through review, coordinator assignment, venue booking, and equipment reservation as one coherent workflow, and a change in one domain ripples into others. *(feature-table note "not isolated functionality"; `#7` — architecture should match the team's own coupling and size, not anticipated future scale; `#120`, `#4` — a change in one domain must flag/re-validate others)* |
| **R3** | Relational data with real integrity constraints — no overlapping venue bookings, capacity checks, equipment quantity limits, timed waitlist offers. *("Booking Conflict Detection," "Venue Suitability Checking," "Equipment Availability Checking"; `#41`, `#112`, `#13`, `#44`)* |
| **R4** | Access control across **six** roles (Organiser, Coordinator, Ops Manager, Venue Staff, Tech Support, Attendee), with Organiser access additionally scoped by client organisation. *("User Authorisation and Authentication"; `#101` — Ops Manager is a separate role; `#81` — org-scoped access)* |
| **R5** | Traceable, high-coverage tests (rubric expects ~100% coverage) running in an automated CI pipeline — itself a graded deliverable. *(Deliverables 3 & 6; "Testing and traceability" / "Code quality and CI" rubric rows)* |
| **R6** | Every decision — including AI-assisted code — must be explainable in a 20-minute Q&A. *("Interactive Q&A Session"; "Accountability and Explainability" rubric row)* |

R1 (team size/time budget) and R2 (cross-domain coupling) are kept separate
because they point to different risks. For example, Tailwind addresses R1
(parallel work under a fixed calendar), not R2 (workflow coupling).

---

## 2. Candidates evaluated

### 2.1 Architecture

| Option | Advantages | Disadvantages |
|---|---|---|
| Microservices | Independently deployable/scalable; isolated failures | R2's cross-domain workflows need distributed transactions across services — real cost, no benefit here; also needs Docker/orchestration the team has no time for (R1) |
| **Monolith** ✅ | One shared DB makes R2's cross-domain consistency a single transaction, not distributed; one app to run fits R1 | Less separation if independent scaling were ever needed — accepted trade, not a concern at this scale |

### 2.2 Language

| Option | Advantages | Disadvantages |
|---|---|---|
| JavaScript | No compile step — faster to start writing routes under R1's calendar | A mismatched field across domains (R2) fails silently at runtime — costly in R6's Q&A, and R5's tests must catch it by hand |
| **TypeScript** ✅ | Mismatches become compile errors across domains (R2), shrinking what R5 must test and giving R6 a compiler error to point to instead of a runtime bug | Real cost against R1: type annotations and stricter compilation slow down early route-building, and the team pays a learning-curve tax before this benefit outweighs it |

### 2.3 Database engine

| Option | Advantages | Disadvantages |
|---|---|---|
| MongoDB | Flexible schema, no upfront modelling — faster start under R1 | Conflicts with R3 — conflict/suitability/availability are relational integrity rules, not documents |
| MySQL | Relational, satisfies R3 | Fewer free serverless-hosting options than Postgres |
| **PostgreSQL** ✅ | Relational model with foreign keys and unique constraints gives R3's rules a consistent base; most mature TypeScript ORM support | Relational schema must be modelled up front — real cost against R1 that MongoDB avoids, accepted because R3's data is relational anyway |

Note: Postgres provides the relational structure, but the business rules in
R3 themselves (booking conflicts, capacity, equipment availability, draft
completeness) are enforced in application code, not as database constraints
— see the header of `prisma/schema.prisma`. Keeping them in TypeScript makes
them unit-testable with Vitest (R5) and easier to explain (R6).

### 2.4 Data access layer

| Option | Advantages | Disadvantages |
|---|---|---|
| Raw SQL | Full control | No compile-time field checks (hurts R2/R5); slow for a small team (R1) |
| Drizzle | Lightweight, strong type inference | Smaller ecosystem — less reference material under R1's time budget |
| **Prisma** ✅ | One schema file for cross-domain fields (R2); fully-typed client shrinks R5's test surface; scriptable migrations for CI (R5) | Concurrent schema edits need coordination; major upgrades can change client imports |

### 2.5 Database hosting

| Option | Advantages | Disadvantages |
|---|---|---|
| Supabase | Free tier, Postgres | Pauses fully after inactivity — risks a dead DB at demo or CI time (R1, R5) |
| Self-hosted Postgres | No third-party dependency | Needs an always-on server the team doesn't have time to run (R1) |
| **Neon** ✅ | Scales to zero instead of pausing (R1); free; database branching — today the team works against a shared `is212-dev` branch, and new branches auto-expire after 7 days (`neon.ts`). **(Planned)** once CI exists, a branch per CI run would give each run a clean, reproducible database — an R5 *isolation/reliability* benefit, not a speed claim | Cold-start latency after idle adds a few seconds to the first query of an idle branch (and, once CI exists, to a CI run's first request) |

### 2.5a App hosting

Not in scope. The team does not plan to host the app; it runs locally
(`npm run dev`) against the shared Neon database, including for demos.

### 2.5b CI/CD (planned)

No pipeline exists yet (there is no `.github/workflows`, and the
`ci/cd-pipeline` branch has no commits beyond `main`). The intended pipeline
is GitHub Actions running `npm run lint`, `npm test`, and `npm run build` on
every pull request to `main`. It checks and builds the code only; there is
no deploy step, since the app is not hosted (§2.5a). This is the part of R5
that is not yet met.

### 2.6 Authentication

| Option | Advantages | Disadvantages |
|---|---|---|
| NextAuth.js | Handles OAuth/session out of the box | Six-role, org-scoped model (R4) still needs custom logic on top — added config layer harder to explain (R6) |
| Managed auth (Clerk, Auth0) | Fully hosted | Costs money; external internals the team can't fully explain (R6) |
| **Hand-rolled (bcryptjs + JWT)** ✅ | Fully explainable (R6); free. The token carries only the user's id and role (8-hour expiry, `src/lib/auth.ts`); organisation and active status are looked up per request (`src/lib/apiAuth.ts`), so a changed organisation or deactivated account takes effect immediately rather than when the token expires | No password-reset/account-recovery flow — but this isn't a silent gap: clarification `#64` states this is "not specified in the current requirements," so the team is explicitly deferring it beyond Release 1 per the customer's own answer, not hiding an unanswerable question |

### 2.7 Validation

| Option | Advantages | Disadvantages |
|---|---|---|
| Manual checks | No dependency | Inconsistent across R2's many cross-domain endpoints; R5 catches gaps late |
| **Zod** ✅ | One schema drives both validation and inferred types — supports R5 and gives R6 one pattern to explain | The schema still has to be kept in sync by hand with any external contract (e.g. the frontend) — Zod doesn't eliminate that, only localises it to one file |

### 2.8 Styling

| Option | Advantages | Disadvantages |
|---|---|---|
| Plain CSS | No dependency | Hard to keep consistent when several people style different pages in parallel — a cost under R1's time budget, unrelated to R2's coupling |
| Component library | Faster initial UI | Harder to customise; extra API surface (R1) |
| **Tailwind CSS** ✅ | Styles co-located with markup — no collisions across parallel work under R1's calendar; free | Class-heavy markup (taste, not cost) |

### 2.9 Testing framework

| Option | Advantages | Disadvantages |
|---|---|---|
| Jest | Large ecosystem | Slower, more TS/ESM config — costs R1's time and R5's CI feedback speed |
| **Vitest** ✅ | Minimal config (R1); fast runs locally and, once CI exists, in the pipeline (R5); Jest-compatible API | Smaller ecosystem — not a practical issue here |

Coverage measurement is not configured yet — no coverage provider is
installed and `vitest.config.mts` has no coverage settings. Adding
`@vitest/coverage-v8` is needed before the ~100% target in R5 can be shown.

### 2.10 UI library

Constrained by the framework, not an independent choice — React is required
by Next.js. **Selected: React.**

### 2.11 Linting

| Option | Advantages | Disadvantages |
|---|---|---|
| None | No setup | Inconsistent code across shared domains (R2); issues surface late (R5/R6) |
| **ESLint** ✅ | Framework's official rule set plugs in directly (R1); cheap first CI step (R5) | Config format shifts across ESLint major versions |

---

## 3. Requirements coverage

| Requirement | Addressed by |
|---|---|
| R1 — small team, fixed time budget | Low-config Vitest/ESLint, Tailwind, Neon's zero-ops model, no app hosting to run |
| R2 — cross-domain workflow coupling | Monolith + shared DB, Prisma's single schema, TypeScript's cross-domain type checks |
| R3 — relational integrity | PostgreSQL for structure; business rules in tested application code |
| R4 — 6-role, org-scoped access | Hand-rolled auth: role in the session token, organisation looked up per request |
| R5 — traceable testing in CI | Now: TypeScript, Zod, Vitest, ESLint, Prisma migrations. Planned: CI pipeline, coverage reporting, Neon branch-per-run |
| R6 — explainable decisions | Hand-rolled auth, framework-aligned lint/UI, Zod's single pattern |

---

## 4. Selected stack

| Layer | Choice |
|---|---|
| Architecture | Monolith |
| Framework | Next.js (App Router, TypeScript) |
| UI library | React |
| Styling | Tailwind CSS |
| Database | PostgreSQL on Neon |
| ORM | Prisma |
| Authentication | Hand-rolled — bcryptjs + jsonwebtoken |
| Validation | Zod |
| Testing | Vitest |
| Linting | ESLint (`eslint-config-next`) |
| Workflow | GitHub + Jira, one branch per ticket (e.g. `SPM-40-search-filter-venues`) |
| App hosting | None — runs locally; hosting not in scope |
| CI/CD | GitHub Actions (lint, test, build; no deploy) — **planned**, not yet set up |

---

## 5. Summary

A small team with a fixed time budget (R1) building features that aren't
isolated from each other (R2), over relational data with real integrity
rules (R3) and a six-role, org-scoped access model (R4) — while the rubric
demands tested/traceable/CI'd code (R5) that the team can personally
explain (R6). That ruled out heavy configuration (managed auth) and
infrastructure the team has no time to run (microservices, self-hosted
DBs/servers). Two choices (UI library, linting) weren't independent
decisions — they followed from the framework. Not every choice is free of
trade-offs even where selected: TypeScript costs setup time against R1,
Neon's cold start adds latency to the first query on an idle branch, and
hand-rolled auth explicitly leaves password recovery unbuilt (deferred per
`#64`, not overlooked).

**Not yet in place:** the CI/CD pipeline and coverage reporting are planned
but not set up, so R5 is only partly met today. Hosting the app is not
planned; it runs locally.

**Known gap:** clarifications `#71`, `#44`, `#55` describe schedule-driven
behaviour (auto-completing events, expiring waitlist offers, batched
notifications) that needs something to run on a timer, which nothing above
provides. Left open deliberately until those stories are picked up.
Equipment turnaround (`#5`) did not need a scheduler: availability is
computed at query time from the event dates (`src/lib/equipmentAvailability.ts`).
