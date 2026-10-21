# Test cases

**Source of truth: this folder (moved from Drive on 2026-10-19; the Drive folder is a read-only archive: https://drive.google.com/drive/folders/1QRM41o-J406Ln-RShGYn9_XaN-q9f7m2)**

Every user story that has manual test cases has one workbook here. Edit the
workbook in this folder, commit it, and never edit the Drive copy again.

## Naming

| What | Name | Example |
|---|---|---|
| A story's workbook | `SPM-<n>_Test_Cases.xlsx` | `SPM-43_Test_Cases.xlsx` |
| A test case | `SPM-<n>-TC<nn>`, two digits | `SPM-43-TC07` |
| Its sheet in the workbook | `TC<nn>` | `TC07` |
| A retired test case's sheet | `RETIRED – TC<nn>`, moved to the end | `RETIRED – TC05` |
| A case rewritten for one regression run | `SPM-<n>-TC<nn>-R`, only in `docs/regression/` | `SPM-43-TC01-R` |
| A sprint's regression log | `docs/regression/Sprint-<N>_Regression.xlsx` | `Sprint-3_Regression.xlsx` |

One workbook per story, never one per sprint. Test case IDs are never reused
or renumbered, even after a case is retired.

Each workbook has:

- **Summary**: one row per test case (Sheet, Test Case ID, Title, Linked AC,
  Type, Source, Status, Superseded by, Change #), then the story's ACs with the
  cases that cover each one.
- **Open Questions**: what the cases assume, and what is still to be decided.
- **One sheet per test case**: the case itself (rows 1–9 with the Summary row
  newer workbooks have under Test Case ID; rows 1–8 in older ones), then its
  execution blocks. Read a sheet by its labels in column A, not by row number.

The `SPM-<n>_test_cases.json` beside a workbook is the input the
`generate-test-cases` skill used to build it the first time. Since the import
from Drive, the workbook is newer than its JSON. **Do not rebuild an existing
workbook from its JSON**: that would drop every execution block. Edit the
workbook directly.

## Starting a new story's workbook

Use the `generate-test-cases` skill (`/generate-test-cases SPM-<n>` in Claude
Code). It writes `SPM-<n>_test_cases.json` and builds the workbook from
`.claude/skills/generate-test-cases/Test_Case_Template.xlsx` with
`fill_template.py`, so every workbook has the same layout: the Summary sheet
with the Status, Superseded by and Change # columns, each case's sheet with its
Summary row, and an empty execution block with a Commit row. There is no
separate blank workbook to copy; the generator is the one source of the layout.

Build a workbook from its JSON only once, when it is new. After that, edit the
workbook.

## Adding an execution block

Every run of a test case gets a **new** block below the last one on that case's
sheet. Never overwrite or delete an earlier block, even a failed one: the
blocks are the case's history.

Leave one empty row after the previous block, then add:

| Column A | Column B |
|---|---|
| Item | |
| Actual Result | What happened, step by step |
| Pass/Fail/Not Executed/Blocked | One of the four |
| Remarks | `NA`, or the bug key for a Fail (e.g. `SPM-102`), or why it was Blocked |
| Executed by | Your name |
| Date of Execution | The date you ran it (a date cell) |
| Commit | Leave blank: filled in when you commit (below) |

Blocks written before 2026-10-19 have no Commit row. Do not add one to them.

**The Commit row fills itself.** Run the test on your checkout, type in the
results with Commit left blank, save, and commit the workbook from that same
checkout. The pre-commit hook (`.githooks/pre-commit`, switched on by
`npm install`) writes `git rev-parse --short HEAD` - the build you tested -
into the Commit cell of every block whose result is new since the last commit,
and adds the filled-in workbook to the commit. Blocks already committed are
never changed. So commit your results before you pull, merge or switch branch,
or the hash will be of a build you did not test.

If the hook could not fill a cell (the workbook was open in Excel, or part of
it was not staged), close the workbook and run `npm run test-cases:commit`
(or `npm run test-cases:commit -- SPM-35`), then commit again. A workbook with
uncommitted changes under `src/` or `prisma/` gets a warning: the hash then does
not fully describe what you tested, so say so in Remarks.

`npm run trace` reads the newest block of each Active case for the
traceability matrix (`docs/traceability/TRACEABILITY.md`).

## Retiring or updating a test case

When a change to a story's acceptance criteria makes a case out of date:

1. On the Summary sheet, set the case's **Status**:
   - **Retired**: the behaviour it checks no longer exists, or its steps can no
     longer be followed. Fill in **Superseded by** (the case or automated test
     that replaces it, or `gap`) and **Change #** (the entry in
     [docs/CHANGES.md](../CHANGES.md)).
   - **Updated**: the behaviour is the same and only wording or values in the
     case are out of date. Add a line `v2 (<date>): <what changed>` in row 1 of
     the case's sheet.
   - **Active**: everything else.
2. For a Retired case, rename its sheet to `RETIRED – TC<nn>` and move it to the
   end of the workbook. Keep all of its execution blocks.
3. Add a row to [DECOMMISSIONED.md](DECOMMISSIONED.md).

Never delete a test case or renumber the ones after it. A new case for a new or
changed AC takes the next free number.

## When to update this folder

**A story's test case file is updated in the same PR as the story.** If a PR
changes behaviour that another story's cases check, update (or retire) those
cases in that PR too, and record it in [DECOMMISSIONED.md](DECOMMISSIONED.md).

## Regression logs

`docs/regression/Sprint-<N>_Regression.xlsx` holds the end-of-sprint
regression run: who ran which cases, on which date, with which result. The
process is in [REGRESSION_TESTING.md](../REGRESSION_TESTING.md). Results from a
regression run stay in the regression log; they are not copied into the story
workbooks.
