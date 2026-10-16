# Regression testing at the end of a sprint

Regression testing checks that the stories we finished earlier still work after
this sprint's changes. Do it once per sprint, on `main`, after the last pull
request of the sprint has merged and before the sprint review.

It should take one or two people about half a day. If it is taking longer, the
scope in step 2 is too wide.

## Rules

1. **Do not rerun every test case.** Retest only the stories that this sprint's
   code could have affected, plus one end-to-end smoke run for the rest.
2. **Do not record regression results in the story workbooks.** The files in
   [test-cases/](test-cases/) hold each story's original test run and stay as
   they are. Open them to read the steps; write the results in the sprint's
   regression log (step 6).
3. **Never run `npx prisma db seed`.** The database is shared and a full reseed
   wipes everyone's data. Use the per-story fixture scripts (step 4).

## Step 1: Run the automated checks

On an up-to-date `main`:

```
git checkout main
git pull
npm install
npm test
npm run lint
npm run build
npm run test-cases:check
```

Then, with `npm run dev` running in a second terminal:

```
npm run verify:permissions
npm run verify:login
```

Also check that CI is green on GitHub for the commit you are testing. CI runs
the end-to-end smoke tests, which refuse to run against the shared database.

All of them must pass before any manual testing. A failure here is a regression:
handle it as in step 7, then start again from this step.

## Step 2: Work out which stories to retest

Find the files that changed this sprint. The baseline is the tag left at the
end of the previous sprint (step 8):

```
git diff --name-only sprint-<N-1>-end..main -- src prisma
```

If the previous sprint was not tagged, use the last commit on `main` before
this sprint started:

```
git rev-list -1 --before="<sprint start date, YYYY-MM-DD>" main
```

For each changed file, find the stories that depend on it. Every story's JSON
lists the files it covers under `code_references`, so search for the path:

```
git grep -l "src/lib/permissions.ts" -- "docs/test-cases/*.json"
```

A story is in scope if any of its files changed. Three adjustments:

- **Stories finished this sprint** were tested this sprint, so leave them out,
  unless a later merge in the same sprint changed their files.
- **Shared files** (`permissions.ts`, `statuses.ts`, `roles.ts`,
  `schema.prisma`, `seed.ts`) match many stories. Read the diff: put a story in
  scope only if the rule, status, role or table it uses changed. The automated
  checks in step 1 cover the rest.
- **`code_references` is not complete.** If you know a change affects a screen
  that an earlier story uses, add that story even if the search missed it.

## Step 3: Pick the test cases

For each story in scope, select the cases where **Type** is `Positive` and
**Source** is `Acceptance Criteria`. Where several of them cover the same
acceptance criterion, keep one, so that you end up with about one case per
criterion.

If a selected case's preconditions say another case must be run first, add
that case too.

Add a `Negative` or `Boundary` case only when the diff changed the exact
validation or limit that the case checks.

Before the run, check whether a story finished this sprint changed on purpose
what a selected case expects. For example, a case that ticks booking slots that
no longer exist, or one that expects a refusal message that now reads
differently. Do not edit the story's test case files for this. Rewrite the case
on the log's **Rewritten cases** sheet, give it the same ID with `-R` on the
end, and run it on a copy of the database before the regression run, so its
expected results come from the screen. List every out-of-date case, selected
or not, on the **Out-of-date cases** sheet with the story that changed it. The
story's owner updates the test case files afterwards (step 6).

Write the selected case IDs into the regression log before you start, so the
scope is fixed before the results come in.

## Step 4: Prepare the test data

- If a story in scope has a fixture script (`npm run fixtures:spm<NN>`, listed
  in `package.json`), run it before testing that story, and again after any
  case that changes data. The case's preconditions say when.
- Stories without a fixture script use the base seed data. If a precondition
  no longer matches what is in the database, record the case as `Blocked` and
  move on. Do not reseed to fix it.

## Step 5: Run the selected cases and the smoke run

**Selected cases.** Open each story's workbook, follow the steps for the
selected cases, and compare with the expected results. Do not type into the
workbook.

**Smoke run.** Take one new event through the whole flow, logging in as each
role in turn. Create a new event for this, titled `REG S<N> <your name>`, so no
story's fixtures are touched. The tracker's **Smoke run** sheet has the
accounts and what to check at each step. As of sprint 3 the flow is:

1. Event Organiser logs in, creates an event request, saves it as a draft,
   reopens it and submits it.
2. Event Operations Manager assigns an Event Coordinator.
3. Event Coordinator reviews and approves the request, then begins planning.
4. Event Coordinator makes an ordinary edit to the event information.
5. Event Coordinator searches for venues and requests two venues for the same
   times, each for its own purpose, attendance and layout.
6. Event Coordinator records the equipment required.
7. Technical Support Staff checks equipment availability and reserves it, then
   marks an unrelated item under maintenance and returns it.
8. Venue Staff approves both booking requests.
9. Venue Staff marks one of the two venues unavailable over the event's times.
10. Event Coordinator sees the notification and the flagged booking.
11. Event Coordinator requests a replacement venue and releases the flagged
    booking.
12. Venue Staff approves the replacement.
13. Event Coordinator sets up registration and tries to confirm the event,
    which is refused for the missing safety check.
14. Event Coordinator submits the event for a safety check.
15. Safety Officer requests changes.
16. Event Coordinator reads the decision and resubmits; the organiser cannot
    see the reason.
17. Safety Officer approves, and the Event Coordinator confirms the event.
18. An Attendee registers for the event, then withdraws.
19. The organiser and the coordinator see the withdrawal on the registration
    list.
20. Each role sees only its own sidebar links, and the organiser sees only
    their own events.

When a sprint adds a step to the flow, add it to this list in the same pull
request as the story.

## Step 6: Record the results

Results go in the sprint's regression log, an Excel tracker at
`docs/regression/Sprint-<N>_Regression.xlsx`. To start a new one, copy the
previous sprint's tracker, rename it, and clear the yellow cells. Then replace
the rows on the **Scope** and **Retested cases** sheets with this sprint's
(steps 2 and 3).

| Sheet | What goes in it |
| --- | --- |
| Summary | Date, testers and the commit tested. The result counts fill in by themselves. |
| Testers | Who retests which area, with each tester's case count and progress. Nobody retests their own stories from this sprint. |
| Retested cases | One row per selected case: who it is assigned to, the result, who tested it, the date and notes. |
| Rewritten cases | Steps and expected results for selected cases whose story workbook is out of date. Their IDs end in `-R`. |
| Out-of-date cases | Every story test case that a later story has made out of date, which story changed it, and whether it has been updated. |
| Automated checks | The result of each command in step 1. |
| Scope | Every earlier story, whether it is in scope, and why. |
| Smoke run | The result of each step of the smoke run. |
| Follow-ups | Bugs raised and test cases that need updating. |

If several people are testing at once, upload the tracker to the team's Google
Drive and fill it in there, so nobody overwrites anyone else. Download the
finished copy back into `docs/regression/` at close-out.

Use one of four results for each case:

| Result | Meaning | What to do |
| --- | --- | --- |
| Pass | The app matches the expected result. | Nothing. |
| Fail | The app is wrong. | Raise a bug (step 7). Add a row to Follow-ups. |
| Changed by design | The app differs because a later story changed the behaviour on purpose. | Name the story that changed it in the notes. Add a row to Follow-ups. |
| Blocked | The case could not be run, for example because its test data no longer exists. | Say why in the notes. Add a row to Follow-ups. |

`Changed by design` and `Blocked` are not failures, but they mean the test case
is out of date. The story's owner updates the case's JSON and rebuilds the
workbook as a separate change. That is a correction to the test case, not a
regression result, so it does not break rule 2.

## Step 7: Deal with failures

1. Raise a Jira bug linked to the story whose case failed. Quote the test case
   ID, the step that failed, and what appeared on screen.
2. Decide as a team whether to fix it before the sprint review or carry it to
   the next sprint. Write the decision in the log.
3. After a fix merges, rerun step 1 and the failed case, and add a second row
   for that case to the log. Keep the original `Fail` row.

## Step 8: Close out

1. Commit the regression log to `main` through a pull request.
2. Tag the commit that was tested, so the next sprint has a baseline:

```
git tag sprint-<N>-end <commit tested>
git push origin sprint-<N>-end
```
