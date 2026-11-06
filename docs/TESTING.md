# Testing

How ConnectSphere is tested: the levels we use, what CI runs, how a test
traces back to a story, what happens when one fails, and the trade-offs we
chose. Counts are as of 2026-11-06.

## Test levels

| Level | What it checks | Database | Where | Files | Tests | How to run |
|---|---|---|---|---|---|---|
| **Unit: rules** | Pure functions in `src/lib`: business rules such as conflicts, availability, eligibility, permissions, statuses, form checks | None | `src/lib/__tests__/` | 54 | 1,900 | `npm test` |
| **Unit: screens** | Pages and components rendered in jsdom and driven by label and role, with the network faked (`mockApi`) | None | `src/app/__tests__/`, `src/components/__tests__/` | 26 | 2,098 | `npm test` |
| **Route, Prisma mocked** | API route handlers with real authentication, permissions and validation; only Prisma is faked (`vi.mock("@/lib/prisma")`) | Mocked | `src/app/api/__tests__/`, plus 5 service files in `src/lib/__tests__/` | 42 | 2,214 | `npm test` |
| **Integration, real database** | Route handlers with the real Prisma client against a real Postgres: transactions, row locks, and rules that span several tables | Real, local only | `integration/` | 5 | 19 | `npm run test:integration` |
| **End-to-end** | The production build in real Chromium against a real, seeded Postgres: whole journeys across roles | Real, local only | `e2e/` | 4 | 12 | `npm run build`, then `npm run test:e2e` |
| **Manual system test cases** | A person runs each case through the app, step by step, and records the result. These are traced to the story's ACs | Shared | `docs/test-cases/SPM-<n>_Test_Cases.xlsx` (the Drive copies are a read-only archive since 2026-10-19) | 57 stories | 807 cases (398 positive, 267 negative, 142 boundary), 17 of them Retired | By hand; the end-of-sprint regression run is in `docs/regression/` |

Unit and mocked-route tests run together in one Vitest run, with coverage
(`npm run test:coverage`). Integration and end-to-end tests refuse any
`DATABASE_URL` that is not on `localhost`, because they write data. The
team's shared Neon database is never used for them.

### What each automated level is for

- **Unit tests** hold almost all of the business rules. They are fast (the
  whole suite runs in about 4 minutes), and a failure points straight at one
  function.
- **Mocked-route tests** check what a route does with a request: who may call
  it, what it refuses, and what it writes. They don't check what the database
  then does.
- **Integration tests** cover what only a real database can show:
  - two requests at the same moment meeting a row lock (bookings, equipment,
    registration)
  - expiry sweeps that change rows before the next read
  - counts over real rows (registration capacity)
- **End-to-end tests** prove the screens, routes and database work together
  for the journeys that matter most.

### Integration tests

| Test | Story / AC / test case | Scenario |
|---|---|---|
| Two booking requests for the same room at overlapping times, sent at the same moment: exactly one accepted, the other refused naming it | SPM-44 AC4, AC5, AC9 / SPM-44-TC04 | Conflict |
| An approved request is shown booked on the calendar and blocks another event | SPM-43 AC3, AC7 / SPM-43-TC03 | Normal |
| An expired hold frees its time for another event's request | SPM-82 AC4, AC6 / SPM-82-TC10 | Boundary |
| An expired hold cannot be approved | SPM-82 AC5 | Failure |
| A reservation reduces what an overlapping event can have; that event then gets only what is left | SPM-49 AC4, AC5, SPM-48 AC4 / SPM-49-TC09, TC15 | Normal, boundary |
| Two reservations of the last unit at the same moment: exactly one gets it | SPM-49 AC5 / SPM-49-TC16 | Conflict |
| Two clarification requests for one event at the same moment: exactly one is opened | SPM-29 AC3 / PR #70 review | Conflict |
| Registration refused once the capacity is reached | SPM-51 AC9 / SPM-51-TC05 | Failure |
| Two attendees register for the last place at the same moment: exactly one gets it | SPM-51 AC9 / SPM-111 (bug) | Conflict |
| A withdrawn attendee does not hold a place; the last place can still be taken, then no more | SPM-51 AC9 / SPM-51-TC04 | Boundary |
| Raising a venue's turnaround time flags both bookings that now overlap, each naming the other, notifies the coordinator, and changes neither booking | SPM-80 AC1, AC2, AC4, AC5 / SPM-80-TC02, TC03 | Normal |
| A booking whose new setup time now overlaps a recorded unavailable period is flagged | SPM-80 AC3 / SPM-80-TC07 | Normal |
| Bookings that do not clash under the new times, and bookings in the past, are left alone | SPM-80 AC6, AC7 / SPM-80-TC02 | Normal |
| The booking after one that has just ended is flagged, but the ended one is not | SPM-80 AC2, AC7 / PR #74 review | Boundary |
| A booking request made after the change is checked with the new turnaround time: refused, then accepted once the turnaround is back to 0 | SPM-80 AC8 / SPM-80-TC08 | Failure, normal |

The "same moment" tests were each checked against the bug they exist for.
With the row lock removed from the route, both requests were accepted 3 runs
out of 3, so the test failed as it should. The registration one found a real
bug (SPM-111): the route had no lock, so two attendees could both take the
last place. It was written first and failed (both 201, 3 runs out of 3), then
the route was fixed to lock the event row before counting.

### End-to-end tests

| Spec | Journey | Scenario |
|---|---|---|
| `e2e/event-request-journey.spec.ts` | Organiser submits, then each step in order: Ops Manager assigns, coordinator approves, books Marina Auditorium, Venue Staff approve, coordinator requests equipment, Technical Support reserve, coordinator sets up registration and submits for the safety check, Safety Officer approves, coordinator confirms, attendee registers. SPM-25, 30, 28, 42, 43, 47, 49, 64, 86, 87, 34, 51 | Normal, across all 7 roles |
| `e2e/venue-booking-conflict.spec.ts` | A second event's request for a room already held at that time is refused, naming the event that holds it. SPM-44-TC04 | Conflict |
| `e2e/venue-turnaround-recheck.spec.ts` | Venue Staff raise a venue's turnaround time and are told which bookings now clash; the coordinator finds both bookings flagged on Flagged Arrangements, each naming the other. SPM-80 AC1, AC2, AC4, AC5 / SPM-80-TC02, TC03 | Conflict |
| `e2e/login.spec.ts` | Every role logs in to its own sidebar; a logged-out visitor is sent to log in and brought back; a wrong password is refused. SPM-21, SPM-22 | Normal, failure |

## What CI runs, and when

All jobs are in `.github/workflows/ci.yml`. They run on every pull request,
and again on `main` after a merge, so `main`'s own status is always visible.

| Job | Runs | On |
|---|---|---|
| Lint | `npm run lint` | PR and main |
| Type-check | `npx tsc --noEmit` | PR and main |
| Unit tests | `npm run test:coverage`: unit and mocked-route tests. Fails below the coverage minimums in `vitest.config.mts`. On a PR it also fails if any line the PR adds or changes under `src/` never runs in a test | PR and main |
| Integration tests | `npm run test:integration` on its own Postgres 18, migrated and seeded first | PR and main |
| End-to-end | `npm run test:e2e` on the production build, on its own Postgres 18, migrated and seeded first | PR and main |
| Build | `npm run build` | PR and main |
| Migrations | Replays every migration on an empty database, checks the schema matches them, then loads the seed and every `fixtures:*` script twice | PR and main |
| Test cases | Warns if the story in the branch name has no `docs/test-cases/` document (a warning, never a failure) | PR only |
| Traceability | `npm run trace:tags`: fails on a test with no `[SPM-xx]` tag, or a PR whose title and branch name no story (titles starting "Docs:" or "Chore:" are exempt). Then `npm run trace -- --check`: fails if the matrix in `docs/traceability/` is out of date for the tests and test case workbooks | PR and main |
| Dependency audit | Warns on high or critical advisories (a warning, never a failure) | PR and main |

**Why the levels are separate jobs:**
- **They run in parallel.** The slowest level (E2E, a production build plus a
  browser) doesn't hold up the fastest.
- **A red check names the level that failed.** "Integration tests" failing
  means a real-database rule broke, not a screen.
- **Each job gets only the services it needs.** Only Integration tests and
  End-to-end start a Postgres.
- **A flaky browser test can be re-run on its own**, without re-running
  everything else.

## Naming, and tracing a test to its story

**Story → acceptance criterion → test case → automated test.** The whole chain,
for every story, is in [traceability/TRACEABILITY.md](traceability/TRACEABILITY.md)
(`npm run trace`, or `npm run trace -- --repo-only` without a Jira token);
[START_HERE.md](START_HERE.md) walks through one story.

- **Stories and ACs** are in Jira (SPM-n). Each story's ACs are numbered by
  position (AC1, AC2, …).
- **Test cases** are in `docs/test-cases/SPM-<n>_Test_Cases.xlsx`, the source of
  truth since 2026-10-19 ([test-cases/README.md](test-cases/README.md)). Each case
  has an ID such as `SPM-44-TC04`, a "Linked AC" column, a type (positive,
  negative, boundary) and a Status (Active, Updated or Retired). The `.json`
  beside a workbook is what first generated it and is now older than it: do not
  rebuild a workbook from it.
- **Every automated test names its story and ACs** at the start of its name:
  `it("[SPM-44][AC4][AC5] ...")`. A test that belongs to a story but checks
  something no single AC states (a load error, a helper) carries the story
  alone: `[SPM-44]`. A bug's test adds the bug after the story whose page or
  rule it tests: `[SPM-41][BUG-98]`. A test of code no story asks for is tagged
  `[UNTRACED:<feature>]`, the feature in lowercase letters, digits and hyphens
  (e.g. `[UNTRACED:self-registration]`); the matrix lists it under that feature
  in "Code with no story" until the team removes the code or writes a story
  for it. A new feature also needs its description in `UNTRACED_FEATURES` in
  `scripts/trace.ts`. CI's **Traceability** job fails on a test with no tag
  (`npm run trace:tags`). Integration and E2E tests also name the test case,
  e.g. `[SPM-44][AC4][AC5][AC9] (SPM-44-TC04, conflict): …`.
- **To find the tests for an AC:** search for the tag, e.g. `git grep -n "\[SPM-44\]"`.
  Tests that no longer apply are archived in `tests/archive/`, which nothing
  runs ([test-cases/DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md)).

## When a test fails

This follows playbook 5.6.

1. **CI fails on the PR.** The failing check names the level. The log names
   the test, and the test's name names the story and AC. For E2E, the run's
   `e2e-report` artifact has a screenshot and a replayable trace.
2. **Decide which side is wrong.**
   - If the app changed **on purpose**, update the test in the same PR and
     say so in the changelog entry.
   - If the app is **wrong**, it's a bug.
   - Never loosen an assertion just to make it pass.
3. **Raise a Jira Bug** linked to the story, with the failing test's name,
   the steps, and what was expected against what happened.
4. **Fix it test-first.**
   - Write (or keep) the test that fails because of the bug, and see it fail.
   - Then fix the code, and see it pass.
   - The PR carries both, with the Bug's key in its title.
5. **Record the retest.** Re-run the affected manual test cases and record
   the result in the sprint's regression workbook (`docs/regression/`), with
   the Bug key in its notes.

A bug that can't be fixed in the current PR goes in DOCUMENTATION.md's
Known Gaps, with an owner, until its Bug is done.

Known flaky test: `[SPM-90][AC1]` in `event-venue-pages.test.tsx` failed
once in a full `npm run test:coverage` run on 2026-11-04, then passed 3/3 in
isolation plus a clean full rerun (suspected timing under load).

## Coverage

Unit and mocked-route tests cover 100% of lines under `src/`, 100% of
functions, 99.88% of statements and 99.54% of branches (2026-11-06, the same
as the 2026-11-04 run README.md's exclusions are listed from). CI enforces the minimums in `vitest.config.mts`, and fails any
PR that adds or changes a line under `src/` that no test runs. Every line
that is still not covered is listed in README.md under "Coverage
exclusions", with the reason.

## Our trade-offs

- **Few E2E tests, on purpose.** Browser tests are slow (a production build
  plus Chromium) and break when on-screen text changes. Besides logging in,
  we keep three journeys: the whole core workflow, one booking conflict, and
  the re-check when a venue's turnaround time changes. The rules behind each
  step are tested at the unit level, where a failure is cheap to find and
  fix.
- **Real database only where it changes the answer.** Most rules are pure
  functions, tested without a database. Integration tests are kept for what
  a mock can't show: concurrent requests and row locks, expiry sweeps, and
  counts over real rows.
- **Setup through the API, behaviour through the screen.** The conflict spec
  creates its events through the API and tests only the refusal in the
  browser. Repeating the full journey would make it slower and more fragile
  without testing anything new.
- **Fresh data per test, no reseeding.** Integration tests create rows with
  names no seed row uses and delete them afterwards. E2E events get a random
  day from 2030 on. So reruns don't collide, and nobody reseeds a shared
  database.
- **Each wait is tied to a condition.** E2E tests wait on what should appear,
  never on a fixed sleep. UI unit tests wait up to 5 seconds for an element,
  long enough for a loaded machine without hiding a real failure.
- **Manual test cases stay.** They are the record against each AC, and the
  end-of-sprint regression run. The automated tests repeat their riskiest
  checks on every PR.
