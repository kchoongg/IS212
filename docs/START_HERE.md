# Start here

A map of the ConnectSphere project for anyone new to it, including our
assessor: what it is, where everything lives, how to run it, how to follow one
story from its estimate to Done, and how to undo things.

## What the project is

ConnectSphere is a web app for ConnectSphere Event Services. It "lets
ConnectSphere staff and clients plan events, book venues, reserve equipment,
and manage attendee registration" (`docs/architecture/connectsphere.dsl`).
An Event Organiser submits an event request. The Event Coordinator Lead
(called the Event Operations Manager until SPM-84) assigns it to an Event
Coordinator, who reviews it and plans it: venue bookings with Venue Staff,
equipment with Technical Support, and an Operational Safety Check with the
Safety Officer. The Coordinator then confirms the event, and Attendees
register for it.

**Product Goal:** _[placeholder – copy the Product Goal from the team playbook]_

It is one Next.js app (UI and API) on one PostgreSQL database (Neon), built by
five people in two-week sprints. Sprint 4 runs from 19 Oct to 1 Nov 2026.

## Where everything lives

| What | Where |
|---|---|
| Team playbook (ways of working, Definition of Done, roles) | _[placeholder – playbook link]_ |
| Jira board: every story, its ACs, estimate comments and sprint | https://kkchoong.atlassian.net/browse/SPM |
| Code and pull requests | https://github.com/kchoongg/IS212 |
| **Traceability matrix**: every story from estimate to Done, in one table | [traceability/TRACEABILITY.md](traceability/TRACEABILITY.md) (and [.csv](traceability/TRACEABILITY.csv)) |
| Manual test cases, one workbook per story | [test-cases/](test-cases/README.md) |
| End-of-sprint regression runs | [regression/](regression/), process in [REGRESSION_TESTING.md](REGRESSION_TESTING.md) |
| How we test: levels, CI, naming, coverage | [TESTING.md](TESTING.md) |
| Architecture before Week 7: C4 System Context and Containers | [architecture/](architecture/README.md) (`connectsphere.dsl`, last changed 2026-09-19) |
| Architecture after Week 7 | _[not produced yet – the C4 model has no Safety Officer or Event Coordinator Lead; the status lifecycle and permissions were updated: [ConnectSphere_Status_Lifecycle.drawio](ConnectSphere_Status_Lifecycle.drawio), [PERMISSIONS.md](PERMISSIONS.md)]_ |
| Business process (BPMN), status lifecycle, permissions | [ConnectSphere_BPMN.drawio](ConnectSphere_BPMN.drawio), [ConnectSphere_Status_Lifecycle.drawio](ConnectSphere_Status_Lifecycle.drawio), [PERMISSIONS.md](PERMISSIONS.md) |
| Requirement changes (Week 7, forum answers) | [CHANGES.md](CHANGES.md) |
| Test cases and tests retired by those changes | [test-cases/DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md) |
| Customer clarifications (forum Q&A, by topic) | [CUSTOMER_CLARIFICATIONS.md](CUSTOMER_CLARIFICATIONS.md), raw threads in [discussions/](discussions/) |
| Developer guide: setup, structure, conventions, changelog, known gaps | [../DOCUMENTATION.md](../DOCUMENTATION.md) |
| Schema and screens | [../SCHEMA_REFERENCE.md](../SCHEMA_REFERENCE.md), [../UI_DESIGN.md](../UI_DESIGN.md) |
| Sprint evidence (reviews, retros, velocity) | _[placeholder – sprint evidence link]_ |
| Old copies of test cases (read-only archive) | [Drive folder](https://drive.google.com/drive/folders/1QRM41o-J406Ln-RShGYn9_XaN-q9f7m2): do not edit; the repo is the source of truth since 2026-10-19 |

## Running it

First-time setup (Node 20.12+, a `.env` with `DATABASE_URL` and `JWT_SECRET`)
is in [DOCUMENTATION.md › Quick start](../DOCUMENTATION.md#-quick-start). Then:

| What | Command | Needs |
|---|---|---|
| The app | `npm run dev`, then http://localhost:3000 (every seeded password is `password123`) | Your own database |
| Unit and mocked-route tests | `npm test` | Nothing |
| The same, with coverage | `npm run test:coverage` | Nothing |
| Integration tests (real database) | `npm run test:integration` | `DATABASE_URL` to a **local** migrated, seeded Postgres |
| End-to-end tests (real browser) | `npm run build`, then `npm run test:e2e` | The same local database |
| Traceability matrix | `npm run trace` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` in `.env` (see [.env.example](../.env.example)) |
| Check every test is tagged | `npm run trace:tags` | Nothing |
| One story's manual test data | `npm run fixtures:spm<n>`, e.g. `npm run fixtures:spm43` | Your own database |

Integration and end-to-end tests refuse any database that is not on
`localhost`, because they write to it. CI runs all of these on every pull
request, plus a **Traceability** job: it fails if a test has no `[SPM-xx]` tag,
or the PR's title and branch name no story.

## How to trace a story end to end: SPM-43

SPM-43 *Review Venue Booking Request*: Venue Staff approve or reject a
Coordinator's venue booking request. Each step below says where to click.

**1. Find it in the matrix.** Open
[traceability/TRACEABILITY.md](traceability/TRACEABILITY.md) and find the
SPM-43 row (Ctrl+F "SPM-43"). It reads: epic SPM-17 Venue Booking, Sprint 2,
3 points, 7 ACs, all 7 with automated tests, 14 Active and 2 Retired test
cases, latest manual result "14 Pass (2026-10-03)", 52 unit + 18 route + 1
integration + 1 E2E test, design element "Web Application › Venues API",
PR #34 merged 2026-10-03, status Done. Its gap is "no estimate comment": SPM-43
was estimated in Sprint 2 planning, and Jira has no "Estimate: …" comment for
it. The steps below show where each of those comes from.

**2. The story, estimate and ACs: Jira.** Open
https://kkchoong.atlassian.net/browse/SPM-43.
- The description has the user story and the seven acceptance criteria. They are numbered by position: AC1 is the first bullet.
- The right-hand panel shows **Story point estimate** (3), **Sprint** (SPM Sprint 2) and the **Parent** epic.
- Scroll to **Activity → Comments** for the reasons ACs changed. For example, 2026-09-18: "Removed the 'Event Coordinator is notified of the outcome' AC…".
- Stories estimated from Sprint 3 on carry an "Estimate: N. …" comment with the reasoning; the matrix shows it in **Estimate rationale**.
- **Activity → History** shows every edit to the description, with the old and new text.

**3. The test cases: the workbook.** Open
[test-cases/SPM-43_Test_Cases.xlsx](test-cases/SPM-43_Test_Cases.xlsx).
- The **Summary** sheet lists SPM-43-TC01 to TC16. Each has its Linked AC, its Type and its **Status**. TC05 and TC16 are Retired: they tested the AM/PM/Night slots, which SPM-93 replaced. Their sheets are at the end, named `RETIRED – TC05` and `RETIRED – TC16`, and the reason is in [DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md).
- Below the cases, the AC table shows which cases cover each AC.
- Each case's own sheet has the steps, then one **execution block** per run: who ran it, on which date, and the result. TC01 was run by Kayal and by Kristen on 2026-10-03, and passed both times.
- The end-of-sprint regression results are in [regression/Sprint-3_Regression.xlsx](regression/Sprint-3_Regression.xlsx), on Sammi's sheet (SPM-43-TC01-R and others, 2026-10-18).

**4. The design: the architecture model.** The matrix names "Web Application ›
Venues API". In [architecture/connectsphere.dsl](architecture/connectsphere.dsl)
that is the `venuesApi` component, "Venue catalogue and booking endpoints",
used by Venue Staff ("Manages venues and booking decisions using"). The
business rules for the review are in [PERMISSIONS.md](PERMISSIONS.md) and
[CUSTOMER_CLARIFICATIONS.md](CUSTOMER_CLARIFICATIONS.md).

**5. The code and its review: GitHub.** Open
https://github.com/kchoongg/IS212/pull/34 (the matrix's PR link).
- **Files changed** shows the code: `src/app/bookings/page.tsx` (the Booking Requests screen), `src/app/api/venue-bookings/[id]/route.ts` (approve and reject) and `src/lib/venueBookingReview.ts` (the rules).
- **Conversation** shows the reviewer and their comments. The matrix's Reviewer column reads "n/a (no gh)" when it was generated without the GitHub CLI; the PR page always shows it.
- **Checks**, the matrix's "run" link, shows the CI run: lint, type-check, unit tests with coverage, build, migrations, integration and end-to-end.
- To find every commit for the story: on GitHub, search the repository's commits for "SPM-43", or run `git log --oneline --grep SPM-43`.

**6. The automated tests, by level.** Every test name starts with its story
and ACs, so a search for `[SPM-43]` finds them all (`git grep -n "\[SPM-43\]"`):
- Unit: `src/lib/__tests__/venueBookingReview.test.ts`, e.g. "[SPM-43][AC5] a reason is required: empty or spaces-only is refused…".
- Mocked route: `src/app/api/__tests__/venue-booking-review.test.ts`, e.g. "[SPM-43][AC3][AC7] marks the request approved, recording who decided and when".
- Screen: the Booking Requests tests in `src/app/__tests__/list-pages.test.tsx`.
- Integration: `integration/venue-booking.test.ts`, "[SPM-43][AC3][AC7] (SPM-43-TC03, normal): a booking request approved by Venue Staff becomes a confirmed booking…".
- End to end: `e2e/event-request-journey.spec.ts`, where Venue Staff approve the booking in the full journey.

**7. Definition of Done and Done.** The matrix's **Status** column is Jira's
status, Done for SPM-43. The Definition of Done itself is in the playbook. The
evidence for it in the repository and Jira is what steps 2 to 6 found: every
AC covered by tests (7/7), every Active test case run and passed, and the PR
merged after review with its CI checks. The sprint review it was accepted at is
in the sprint evidence.

**8. What changed later.** [CHANGES.md](CHANGES.md#forum-128--15-minute-booking-unit-week-7-clarification)
records that forum #128 replaced the fixed slots with 15-minute times
(SPM-93). That retired two SPM-43 cases and updated thirteen, as listed in
[DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md).

The same eight steps work for any story: start from its row in the matrix.

## How to recover

**Undo a merge that broke main.** Never rewrite main's history. Revert the
merge in a new PR:

```bash
git switch main && git pull
git switch -c revert-pr-<n>
git revert -m 1 <merge commit sha>     # -m 1 keeps main's side
git push -u origin revert-pr-<n>       # then open a PR, so CI checks the revert
```

GitHub's **Revert** button on a merged PR does the same. If the merge brought a
migration, the revert does not undo it in any database already migrated. Tell
the team before reverting it.

**Look at the code as it was at the end of a sprint.** Once the sprint tags
exist (`sprint-1`, `sprint-2`, `sprint-3`: the last merge to main before each
sprint ended):

```bash
git fetch --tags
git switch -c look-at-sprint-2 sprint-2   # a throwaway branch at that point
npm ci && npx prisma generate
```

**Reset a database to the seed data, only one that is yours.** Never reseed the
team's shared Neon database: it wipes everyone's data, and any manual test
data in it. For a story's test data, use its fixture script
(`npm run fixtures:spm<n>`); it resets only that story's rows, in place.

- To start fresh, use your own Neon branch (`neon checkout <name>`, then `neon env pull`; see [DOCUMENTATION.md › Neon branches](../DOCUMENTATION.md#neon-branches)) or a local Postgres.
- Then rebuild it there:

```bash
npx prisma migrate reset    # drops and re-creates YOUR database, re-applies every migration, then seeds
# or, on a database that is already migrated:
npx prisma db seed
```

Check that `DATABASE_URL` in `.env` points at your own database before you run
either.
