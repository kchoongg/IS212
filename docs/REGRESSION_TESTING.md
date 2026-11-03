# Regression testing at the end of a sprint

Regression testing checks that the stories we finished earlier still work after
this sprint's changes. We do it once per sprint, on `main`, after the last pull
request of the sprint has merged and before the sprint review. One person
prepares the log, then the five of us each test one feature area, which takes a
day or two.

Runs so far: Sprint 3 and Sprint 4, logged in [regression/](regression/). There
was no Sprint 2 run.

## Rules

1. **Retest only the stories this sprint's code could have affected**, not
   every test case.
2. **Never run `npx prisma db seed`.** The database is shared and a full reseed
   wipes everyone's data. Use the story's fixture script instead.
3. **Record results only in the regression log**, not in the story workbooks in
   [test-cases/](test-cases/). The log copies in each case's steps, so you never
   need to open the story workbooks.
4. **Every Fail gets a Jira bug**, and its key goes in the case's notes.

## Step 1: Prepare the log (one person)

One person prepares the whole log with Claude, then hands out the sheets.

1. **Start the log.** Copy the previous sprint's tracker to
   `docs/regression/Sprint-<N>_Regression.xlsx` and clear the results.
2. **Find the stories in scope.** List the files changed since the previous
   sprint's tag:

   ```
   git diff --name-only sprint-<N-1>..main -- src prisma
   ```

   A story is in scope if a file in its JSON's `code_references` changed:

   ```
   git grep -l "src/lib/permissions.ts" -- "docs/test-cases/*.json"
   ```

   Leave out stories finished this sprint unless a later merge changed their
   files. Shared files (`permissions.ts`, `statuses.ts`, `roles.ts`,
   `schema.prisma`, `seed.ts`) bring a story in only if the rule, status, role
   or table it uses changed. Record every earlier story on the **Scope** sheet,
   in scope or not, with the reason.
3. **Pick the cases.** For each story in scope, take the `Positive` cases whose
   Source is `Acceptance Criteria`, about one per acceptance criterion. Add a
   case that a selected case's preconditions say must run first.
4. **Rewrite out-of-date cases.** Where a later story changed on purpose what a
   selected case expects, rewrite it in the log with `-R` on the end of its ID.
   List every out-of-date case, selected or not, on the **Out-of-date cases**
   sheet with the story that changed it.
5. **Split the cases** into one sheet per tester by feature area.

## Step 2: Run the automated checks

Check on GitHub that CI is green on `main` for the commit being tested. Then,
with `npm run dev` running in a second terminal:

```
git checkout main
git pull
npm install
npm run verify:permissions
npm run verify:login
```

Record all three on the **Summary** sheet. A failure here is a regression:
raise a bug before anyone starts testing by hand.

## Step 3: Run your cases

Fill in the shared copy of the log on Google Drive, so nobody overwrites anyone
else. Work down your own sheet from top to bottom. A blue row starts each story
and names its fixture script (`npm run fixtures:spm<NN>`): run it before that
story, and again whenever a case's preconditions say so.

Give each case one result, with the date:

| Result | Meaning | What to do |
| --- | --- | --- |
| Pass | The app matches the expected result. | Nothing. |
| Fail | The app is wrong. | Raise a Jira bug linked to the story, quoting the case ID, the step and what was on screen. Put its key in the notes. |
| Changed by design | A later story changed the behaviour on purpose. | Name that story in the notes. |
| Blocked | The case could not be run, e.g. its test data is missing. | Say why in the notes. Do not reseed to fix it. |

## Step 4: Close out

Download the finished log from Drive into `docs/regression/` and commit it to
`main` through a pull request.

## The log's sheets

| Sheet | What goes in it |
| --- | --- |
| Summary | The automated checks and the result counts per tester, which fill in by themselves. |
| One sheet per tester | That tester's cases with their preconditions, test data, steps and expected results, then the result, date and notes. IDs ending in `-R` were rewritten for this run. |
| Out-of-date cases | Story test cases a later story has made out of date, and which story changed them. |
| Scope | Every earlier story, whether it is in scope, and why. |
