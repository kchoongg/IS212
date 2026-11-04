# C4 diagrams – where each box is in the code

Two sets, both drawn from Structurizr DSL (the `.dsl` file in each folder) and
exported with `structurizr-cli export -format plantuml`, then `plantuml -tpng`.

| Set | Code it describes | How to open that code |
|---|---|---|
| [before-week-7/](before-week-7/) | `main` at commit `a5730c5`, end of Sprint 2 (4 Oct 2026). The Week 7 changes reached Jira on 2 Oct; no Week 7 code was merged before 9 Oct. | `git checkout a5730c5` (then `git checkout main` to come back) |
| [after-week-7/](after-week-7/) | `main` today | `git checkout main` |

Earlier versions are in git history: the 19 Sep model was `docs/architecture/connectsphere.dsl` (removed when
these two sets were added), and the 29 Sep update is on branch `SPM-2-update-c4-diagrams` (commit 4a33d91, never merged).

---

## C1 – System Context

| Box | Show this |
|---|---|
| Each person (role) | `src/lib/roles.ts:7` `ROLES` and `:23` `ROLE_LABELS`. Before: six roles. After: seven – `safety_officer` added (SPM-85); `ops_manager` relabelled "Event Coordinator Lead" (SPM-84, forum #129), key unchanged |
| What each role may do (the arrow labels) | `src/lib/permissions.ts:76` `ROLE_PERMISSIONS`, e.g. `safety_officer` at `:132` |
| External vs internal person (grey vs blue) | `src/lib/roles.ts` `EXTERNAL_ROLES` (organiser, attendee) |
| No external systems | Notifications are in-app only: `src/lib/notifications.ts` writes rows to the database. Email is a To Do story (SPM-91), not built |
| No technology on C1 | Week 4 lab checklist: technology belongs on C2 and below |

## C2 – Containers

| Box / arrow | Show this |
|---|---|
| Web UI (React 19, Next.js App Router, Tailwind) | `src/app/**/page.tsx` (screens), `src/components/`; versions in `package.json` |
| API Server (Next.js 16 Route Handlers) | `src/app/api/**/route.ts` – one folder per URL |
| Database (PostgreSQL on Neon) | `prisma/schema.prisma` (tables), `prisma/migrations/`; connection from `DATABASE_URL` (`schema.prisma:17`) |
| Web UI → API "session token in the Authorization header" | `src/lib/session.ts:41` `authedFetch`, header at `:47` |
| API → Database | `src/lib/prisma.ts:8` (one shared Prisma client) |
| Why one Next.js app, not separate services | Decision & Change Log › Design decisions (one app on Neon instead of microservices) |
| After: why no worker container | Time-based rules run on request, not on a schedule: `src/app/api/notifications/unread-count/route.ts:18-22` calls `expireDueHolds()`, `completeDueEvents()`, `sweepWaitingList()`. Decided 15 Oct (`src/lib/holdExpiryService.ts:1-7`) |

## C3 – Request Pipeline (how the API routes work; sign-up is the one route with no login check)

| Box | Show this |
|---|---|
| Request Auth – who is calling | `src/lib/apiAuth.ts:31` `getActor()`; 401/403/404 helpers in the same file |
| Password & Token Helpers | `src/lib/auth.ts` – bcrypt; JWT signed for 8 hours at `:24` |
| Permission Model | `src/lib/permissions.ts` – role rules plus relationship to the event (owner, organisation, assigned coordinator) |
| Validation Schemas | `src/lib/validation/` – one Zod file per domain. Some newer rules keep their schema with the rule, e.g. `safetyDecisionSchema` at `src/lib/safetyDecision.ts:31` |
| Notifications in the same transaction | `src/lib/notifications.ts` – takes `tx: Prisma.TransactionClient`, so the caller's transaction writes it. Mostly called by the route handlers (e.g. `safety-decision/route.ts:7`, `events/[id]/coordinator/route.ts:8`); a few services call it too (`waitingListService.ts`, `venueUnavailabilityService.ts`, `venueBookingReviewService.ts`) |
| Before: example route | `src/app/api/events/[id]/route.ts` (status changes) |
| After: example route | `src/app/api/events/[id]/safety-decision/route.ts` → `src/lib/safetyDecision.ts:18` (approved / changes_requested / rejected), schema at `:31` |

## C3 – API Server: rules most likely to be asked about

| Box | File(s) | Point to |
|---|---|---|
| Venue Time & Conflict Rules (after, Week 7 #1) | `src/lib/venueTime.ts` | `occupiedWindow()` at `:238` = start − setup to end + turnaround |
| Search excludes a venue whose setup is before opening (after) | `src/lib/venueSearch.ts:184` | `withinOpeningHours(venue, occupiedWindow(...))` – why Marina Grand Hall drops out of SPM-40-TC13 |
| Venue Availability Rules (before) | `src/lib/venueSlots.ts` (AM / PM / Night slots) | replaced by 15-minute times in SPM-93 |
| Venue Change Impact Rules | `src/lib/venueImpact.ts`; after also `venueUnavailability*.ts`, `turnaroundRecheck.ts` | bookings are flagged (`needsReview`), never changed |
| Hold Expiry Rules (after, Week 7 #4) | `src/lib/holdExpiry.ts` (`HOLD_DAYS = 7` at `:14`), `src/lib/holdExpiryService.ts` | `expireDueHolds()` |
| Safety Check Rules (after, Week 7 #6) | `src/lib/safetyCheck.ts`, `safetyDecision.ts`, `safetyResolution.ts`, `safetyCheckClose.ts` | confirm waits for approval: `src/lib/eventConfirmation.ts` |
| Coordinator Assignments (after, Week 7 #5) | `src/lib/coordinatorAssignments.ts`; routes `/api/queue`, `/api/assignments`, `/api/events/[id]/coordinator` | |
| Event Lifecycle Rules | `beginPlanning.ts`, `eventConfirmation.ts` (before); after adds `eventPostponement.ts`, `eventCancellation.ts`, `eventCompletion.ts` (`AUTO_COMPLETE_AFTER_DAYS = 7` at `:17`) | |
| Equipment Availability Engine | `src/lib/equipmentAvailability*.ts` | Reserve locks the equipment row: `reserve/route.ts:79` `SELECT … FOR UPDATE` |
| Venue Booking Rules | `src/lib/venueBookingRequest.ts`, `venueBookingReview.ts`, `venueBookingReviewService.ts`; after also `venueBookingChange.ts` (withdraw/release one booking) | the request rules call `venueConflict.ts` / `venueTime.ts` |
| Venue booking decided under a lock | `src/app/api/venue-bookings/[id]/route.ts:53` (`:50` at `a5730c5`) `SELECT … FROM venues … FOR UPDATE` – done in the route | |
| Hold warnings | `src/lib/holdExpiryService.ts:62` writes the warning rows itself (`notification.createMany`) | |
| App Shell wraps every page | `src/app/layout.tsx:3` imports `AppShell` | |
| Registration & Waiting List Rules | `registrationEligibility.ts`, `waitingList.ts`, `waitingListService.ts` | last place locked: `src/app/api/registrations/route.ts:124` (SPM-111 fix) |

## Web UI container – where its parts are (no C3 drawn for it; see the C2 box)

| Box | Show this |
|---|---|
| App Shell & Navigation | `src/components/AppShell.tsx`; sidebar items per role are data in `src/lib/roles.ts` (`NAV_BY_ROLE`). After: the shell fetches the unread-notifications badge on every page, `AppShell.tsx:296` (`/api/notifications/unread-count`) – the request that runs the time-based sweeps |
| Event tabs per role | `src/lib/eventTabs.ts`, used by the event pages (part of Pages, not the shell) |
| Access Gate | `src/components/RequirePermission.tsx` (before also `NotBuiltYet.tsx` for unbuilt screens) |
| Pages | `src/app/**/page.tsx`, e.g. `src/app/safety-checks/page.tsx` (after) |
| Shared Feature Components | `src/components/*.tsx` (AssignCoordinator, BeginPlanningDialog, VenueForm, …) |
| UI Kit | `src/components/ui/` (Button, Alert, ConfirmDialog, …), exported from `src/components/ui/index.ts` |
| Session & Current User | `src/lib/session.ts`, `src/lib/useCurrentUser.ts` |
| Formatting & Statuses | `src/lib/format.ts`, `src/lib/statuses.ts` |
| Form Logic | `src/lib/eventForm.ts`, `venueForm.ts`, `venueSearchForm.ts`, `formErrors.ts` |

## Colour key

- Blue box = API route handler; green = business rules (pure functions, unit tested); light blue = shared service.
- Grey person = external user; blue person = internal staff.
- Orange outline (after set only) = added or changed by the Week 7 changes.
