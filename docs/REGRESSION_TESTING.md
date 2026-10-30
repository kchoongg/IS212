# Regression testing at the end of a sprint

Regression testing checks that the stories we finished earlier still work after
this sprint's changes. Do it once per sprint, on `main`, after the last pull
request of the sprint has merged and before the sprint review.

Split the cases between the team by feature area, so each person's share takes
an afternoon. If it is taking longer, the scope in step 2 is too wide.

## Rules

1. **Do not rerun every test case.** Retest only the stories that this sprint's
   code could have affected, plus one end-to-end smoke run for the rest.
2. **Do not record regression results in the story workbooks.** The files in
   [test-cases/](test-cases/) hold each story's original test run and stay as
   they are. The sprint's regression log (step 6) copies in the steps of every
   selected case, so testers work from the log alone.
3. **Never run `npx prisma db seed`.** The database is shared and a full reseed
   wipes everyone's data. Use the per-story fixture scripts (step 4).

## Step 1: Run the automated checks

CI runs lint, type-check, unit tests, the test case check, the build,
migrations, the fixture scripts and the end-to-end tests on every merge to
`main`. Check on GitHub that CI is green for the commit you are testing.

CI does not run the two checks that need the shared database. Run them on an
up-to-date `main`, with `npm run dev` running in a second terminal:

```
git checkout main
git pull
npm install
npm run verify:permissions
npm run verify:login
```

Record all three on the log's **Summary** sheet. They must pass before any
manual testing. A failure here is a regression: handle it as in step 7, then
start again from this step.

## Step 2: Work out which stories to retest

Find the files that changed this sprint. The baseline is the tag left at the
end of the previous sprint (step 8):

```
git diff --name-only sprint-<N-1>..main -- src prisma
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
in the log, give it the same ID with `-R` on the end, and run it on a copy of
the database before the regression run, so its expected results come from the
screen. List every out-of-date case, selected or not, on the **Out-of-date
cases** sheet with the story that changed it. The story's owner updates the
test case files afterwards (step 6).

Put the selected cases into the log before you start, so the scope is fixed
before the results come in. Give each tester one feature area, and avoid
giving anyone their own stories from this sprint.

## Step 4: Prepare the test data

- If a story in scope has a fixture script (`npm run fixtures:spm<NN>`, listed
  in `package.json`), run it before testing that story, and again after any
  case that changes data. The case's preconditions say when.
- Stories without a fixture script use the base seed data. If a precondition
  no longer matches what is in the database, record the case as `Blocked` and
  move on. Do not reseed to fix it.

## Step 5: Run the selected cases and the smoke run

**Selected cases.** Work down your own sheet in the log from top to bottom. A
blue row starts each story and names its fixture script. Each case row has the
preconditions, test data, steps and expected results, so there is no need to
open the story workbooks.

Do the smoke run first, together, before splitting up to work through your
own sheets.

**Smoke run.** Take one new event through the whole flow, logging in as each
role in turn. Create a new event for this, titled `REG S<N> Smoke`, so no
story's fixtures are touched. A flow that ends an event may need a second event. Run it as a relay on a call: each person stays
logged in as one or two roles on their own laptop and does their steps when the
event reaches them. The tracker's **Smoke run** sheet says who does each step,
which account to use and what to check. As of sprint 4 the flow is:

1. Event Organiser logs in, creates an event request, saves it as a draft,
   reopens it and submits it.
2. Event Coordinator Lead sees the notification and assigns an Event
   Coordinator.
3. Safety Officer cannot see the event yet.
4. Event Coordinator asks the organiser for clarification.
5. Event Organiser reads the notification, updates the request and resubmits.
6. Event Coordinator approves the request, then begins planning.
7. Event Coordinator makes an ordinary edit to the event information.
8. Event Coordinator searches for venues and requests two venues for the same
   times, each for its own purpose, attendance and layout.
9. Event Coordinator records three equipment requirements.
10. Technical Support Staff checks availability, reserves two lines, marks the
    third as not available and suggests an alternative, then marks an unrelated
    item under maintenance and returns it.
11. Event Coordinator accepts the alternative.
12. Technical Support Staff reserves the alternative.
13. Venue Staff approves both booking requests.
14. Venue Staff marks one of the two venues unavailable over the event's times.
15. Event Coordinator sees the notification and the flagged booking.
16. Event Coordinator requests a replacement venue and releases the flagged
    booking.
17. Venue Staff approves the replacement.
18. Event Coordinator sets up registration and tries to confirm the event,
    which is refused for the missing safety check.
19. Event Coordinator submits the event for a safety check.
20. Safety Officer requests changes.
21. Event Coordinator reads the decision and resubmits; the organiser cannot
    see the reason.
22. Safety Officer approves, and the Event Coordinator confirms the event.
23. An Attendee registers for the event.
24. Event Coordinator adds a second Attendee, which fills the event.
25. A third Attendee joins the waiting list.
26. The first Attendee withdraws, and the third is offered the place and
    accepts it.
27. The organiser and the coordinator see all of this on the registration list.
28. Event Organiser requests a change to the event.
29. Event Coordinator approves the change request.
30. Technical Support Staff releases one equipment reservation.
31. Event Coordinator sees the notification and postpones the event.
32. An Attendee who holds a place can still open the postponed event.
33. Event Organiser requests a new date.
34. Event Coordinator approves it, and the event returns to Approved.
35. Event Coordinator cancels the event.
36. On a second event, the Event Coordinator records the organiser's
    withdrawal while it is under review.
37. Each role sees only its own sidebar links, and the organiser sees only
    their own events.

Marking an event completed needs an event that has already ended, so it stays
out of the smoke run and is covered by SPM-36's selected cases.

When a sprint adds a step to the flow, add it to this list in the same pull
request as the story.

## Step 6: Record the results

Results go in the sprint's regression log, an Excel tracker at
`docs/regression/Sprint-<N>_Regression.xlsx`. To start a new one, copy the
previous sprint's tracker, rename it, and clear the yellow cells. Then replace
the rows on the **Scope** sheet and the testers' sheets with this sprint's
(steps 2 and 3).

| Sheet | What goes in it |
| --- | --- |
| Summary | Date, testers and the commit tested, the three automated checks (step 1), and the result counts per tester, which fill in by themselves. |
| Smoke run | Who does each step of the smoke run, and its result. |
| One sheet per tester | That tester's cases in run order, each with its preconditions, test data, steps and expected results, then the result, date and notes. IDs ending in `-R` were rewritten for this run. |
| Out-of-date cases | Every story test case that a later story has made out of date, which story changed it, and whether its owner has updated it. |
| Scope | Every earlier story, whether it is in scope, and why. |

If several people are testing at once, upload the tracker to the team's Google
Drive and fill it in there, so nobody overwrites anyone else. Download the
finished copy back into `docs/regression/` at close-out.

Use one of four results for each case:

| Result | Meaning | What to do |
| --- | --- | --- |
| Pass | The app matches the expected result. | Nothing. |
| Fail | The app is wrong. | Raise a bug (step 7) and put its key in the case's notes. |
| Changed by design | The app differs because a later story changed the behaviour on purpose. | Name the story that changed it in the notes, and add the case to **Out-of-date cases** if it is not there already. |
| Blocked | The case could not be run, for example because its test data no longer exists. | Say why in the notes. |

`Changed by design` and `Blocked` are not failures, but they mean the test case
is out of date. The story's owner marks the case Updated or Retired in the
story's workbook, as [test-cases/README.md](test-cases/README.md#retiring-or-updating-a-test-case)
describes, and adds it to [DECOMMISSIONED.md](test-cases/DECOMMISSIONED.md). That
is a correction to the test case, not a regression result, so it does not break
rule 2. Edit the workbook itself: rebuilding it from its JSON would drop its
execution blocks.

## Step 7: Deal with failures

1. Raise a Jira bug linked to the story whose case failed. Quote the test case
   ID, the step that failed, and what appeared on screen.
2. Decide as a team whether to fix it before the sprint review or carry it to
   the next sprint. Write the decision in the case's notes.
3. After a fix merges, rerun step 1 and the failed case, and add a second row
   for that case under the original on your sheet. Keep the original `Fail`
   row.

## Step 8: Close out

1. Commit the regression log to `main` through a pull request.
2. Tag the commit that was tested, so the next sprint has a baseline:

```
git tag sprint-<N> <commit tested>
git push origin sprint-<N>
```
