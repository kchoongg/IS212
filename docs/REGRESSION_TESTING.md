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
```

Then, with `npm run dev` running in a second terminal:

```
npm run verify:permissions
npm run verify:login
```

All five must pass before any manual testing. A failure here is a regression:
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
**Source** is `Acceptance Criteria`. That is about one case per acceptance
criterion.

Add a `Negative` or `Boundary` case only when the diff changed the exact
validation or limit that the case checks.

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
story's fixtures are touched. As of sprint 2 the flow is:

1. Event Organiser logs in, creates an event request, saves it as a draft,
   reopens it and submits it.
2. Event Operations Manager assigns an Event Coordinator.
3. Event Coordinator reviews and approves the request.
4. Event Coordinator begins planning, searches for a venue, checks its
   availability and submits a venue booking request.
5. Event Coordinator records the equipment required.
6. Technical Support Staff checks equipment availability and reserves it.
7. Venue Staff opens the venue list, edits a venue and views its availability
   calendar.
8. Each role sees only its own sidebar links, and the organiser sees only
   their own events.

When a sprint adds a step to the flow, add it to this list in the same pull
request as the story.

## Step 6: Record the results

Create `docs/regression/Sprint-<N>_Regression.md` from this template:

```markdown
# Sprint <N> regression test

- Date:
- Tested by:
- Commit tested: <output of `git rev-parse --short HEAD` on main>
- Baseline: <tag or commit used in step 2>

## Automated checks

| Check | Result | Notes |
| --- | --- | --- |
| npm test | | |
| npm run lint | | |
| npm run build | | |
| npm run verify:permissions | | |
| npm run verify:login | | |

## Scope

| Story | In scope? | Reason (changed file, or "not affected") |
| --- | --- | --- |

## Retested cases

| Test case ID | Result | Tested by | Notes / bug key |
| --- | --- | --- | --- |

## Smoke run

| Step | Result | Notes |
| --- | --- | --- |

## Summary

- Cases run:
- Pass / Fail / Changed by design / Blocked:
- Bugs raised:
- Test cases that need updating:
```

Use one of four results for each case:

| Result | Meaning | What to do |
| --- | --- | --- |
| Pass | The app matches the expected result. | Nothing. |
| Fail | The app is wrong. | Raise a bug (step 7). |
| Changed by design | The app differs because a later story changed the behaviour on purpose. | Name the story that changed it in the notes. List the case under "Test cases that need updating". |
| Blocked | The case could not be run, for example because its test data no longer exists. | Say why in the notes. List the case under "Test cases that need updating". |

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
