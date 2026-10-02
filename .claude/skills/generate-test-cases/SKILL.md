---
name: generate-test-cases
description: Generate test cases in the team's Excel test case template from a Jira user story (acceptance criteria) and the code that implements it. Use when asked to create, write, or update test cases for a Jira issue or user story.
---

# Generate test cases

Input: $ARGUMENTS — a Jira issue key (e.g. PROJ-123), or a path to a user story file.

Output: `docs/test-cases/<ISSUE-KEY>_Test_Cases.xlsx`, built from `Test_Case_Template.xlsx` in this skill folder.

Never write the Excel file by hand. Always produce the JSON, then run the script. The script copies the template sheet, so the format stays fixed.

## Step 1: Get the user story

If the input is a Jira key:
- Use the Atlassian MCP tools to fetch the issue: summary, description, and all fields.
- Acceptance criteria may be in a dedicated "Acceptance Criteria" field or inside the description. Check both.
- Also read linked issues and subtasks if they add requirements.
- If the Atlassian tools are not available, stop and tell the user to run `/mcp` and authenticate Atlassian.

If the input is a file path, read the file.

Number the acceptance criteria AC1, AC2, ... in the order they appear. Keep the original wording in `text`.

If the story has no acceptance criteria, stop and tell the user. Do not invent them.

## Step 2: Find the code

Jira is linked to GitHub through the issue key, so find the code with it:
- `git log --all --oneline --grep="<ISSUE-KEY>"` to find commits
- `git branch -a --list "*<ISSUE-KEY>*"` to find branches
- `git show --stat <commit>` to see which files changed

If nothing matches, search the codebase for terms from the story (screen names, endpoints, field names).

Read the relevant files. Note behaviour the acceptance criteria don't mention: validation rules, limits, error messages, permissions, and edge cases.

## Step 3: Write the test cases as JSON

Write `docs/test-cases/<ISSUE-KEY>_test_cases.json` using exactly the structure of `reference/example_test_cases.json`. Match its level of detail.

Rules:
- Test case IDs: `<ISSUE-KEY>-TC01`, `<ISSUE-KEY>-TC02`, ...
- For each AC, write at least one Positive case, plus Negative and Boundary cases where they apply.
- `type` is one of: Positive, Negative, Boundary.
- `source` is "Acceptance Criteria" or "Code". Use "Code" when the case tests behaviour found only in the code, so a reviewer knows to check it.
- `steps` is a list of short actions, one action per step. Do not number them; the script numbers them.
- `test_data` must be concrete values (real emails, amounts, strings), not "valid input".
- `expected_result` must be observable: exact messages, screen, or data change.
- **Tie every expected result to the step that produces it.** Steps and
  expected results land in separate cells, so write `expected_result` as one
  line per checked step, prefixed with its number: `"Step 3: A confirmation
  dialog appears.\nStep 4: The status badge changes to 'Approved'."`
  - Every result needs a step that triggers it. If you want to check
    something (e.g. the status after reopening the event), add the step that
    reopens it.
  - Steps that only navigate or type, with nothing to check yet, get no line.
  - No filler steps like "Read the list" — put the result on the click that
    shows it.
  - Don't write "Repeat the checks for user B". Write the repeated steps out
    so each has its own result.
- **Write for a manual tester using the app, not a developer using an API client.**
  Every `steps` entry is a click, a typed value, or an on-screen action — never
  an HTTP method, a JSON body, or a raw endpoint path (no "POST /api/events",
  no "Send GET .../{id}"). Refer to pages by their on-screen title ("the New
  event request page"), not their route (`/events/new`) — **except when the
  tester has to type the address**: then give the page's URL path in the step,
  e.g. "Type /queue after the site address in the browser address bar (e.g.
  http://localhost:3000/queue) and press Enter". For a path with an event
  reference in it, quote the real reference (`/events/EVT-000124/review`) when
  the story's fixture script pins it (see `scripts/seed-spm28.ts`: it recreates
  its events at the numbers `npx prisma db seed` gives them). If the reference
  isn't pinned, add an earlier step that notes it from the screen and write
  `/events/<reference from step 2>/review`.
  **Sidebar links differ by role** — take each label from `NAV_BY_ROLE` in
  `src/lib/roles.ts` for the user logged in at that step. The same `/events`
  page is "My Events" for an Event Organiser but "All Events" for a
  coordinator or the Ops Manager; an Attendee has "Browse Events". Check every
  "Click '…' in the sidebar" against the role before building. Refer to fields by
  their visible label ("Expected attendance"), not the underlying field name
  (`expectedAttendance`). `expected_result` describes what appears on screen —
  a message, a badge, a redirect, a value shown on reopening the record —
  never a status code or response body.
- If a piece of code behaviour can only be triggered by calling the API
  directly — bypassing client-side validation, sending a payload the UI never
  actually sends — and there's no way to reach it by clicking through the app,
  don't write a test case for it. A manual tester can't exercise something
  that isn't reachable from the UI. If it still seems worth a developer's
  attention, note it in `open_questions` instead of turning it into a test
  case.
- **Test only what's in scope.** If a feature was ruled out of this story
  (for SPM-28: clarifications, notifications), write no case for it — not even
  a read-only one. Record each decision as `"RESOLVED <date>: …"` in
  `open_questions`. Resolved entries stay in the JSON as the record; the
  script leaves them out of the workbook, and writes no Open Questions sheet
  when none are still open.
- **Quote the app exactly.** Take button labels, messages, headings and badge
  text from the code (or the built screen), not the mockup — they differ.
- **Order and overlap.**
  - A case that needs another run first goes **immediately after** it, and
    its preconditions say `"<ISSUE-KEY>-TCnn has just been run (…)"`.
  - Before finishing, remove redundant cases: two cases that check the same
    thing are one case. Where two cases overlap across users, split them by
    user (everything user A can't do in one case, user B's route in another)
    rather than repeating checks.
- `created_by`: use the output of `git config user.name`.
- `creation_date`: today, as YYYY-MM-DD.
- Do not invent requirements. If the code and the acceptance criteria disagree, or something is unclear, add it to `open_questions`. Write test cases against the acceptance criteria, not the code, when they conflict.
- List the files you read in `code_references`.

### Test data: the story's own fixture events

Test cases run on a **shared** database that several testers use, so a case
must never depend on data another story's tester might change, and a tester
must be able to put back whatever a case changed. Follow
`scripts/seed-spm28.ts` (and `scripts/seed-spm30.ts`):

- **Dedicated events.** Give the story its own events, titled `"<STORY> …"`
  (e.g. "SPM28 Nusantara Product Launch") with seed keys prefixed
  `spm28_`. Don't build cases on base-seed events or another story's
  fixtures. A case that changes data (approve, reject, assign…) gets its own
  event, so it doesn't disturb the read-only cases.
- **A reset script.** `scripts/seed-<story>.ts`, run as
  `npm run fixtures:<story>` (add it to package.json), deletes and recreates
  **only** those events. Never tell a tester to run `npx prisma db seed` —
  it wipes everyone's data (the build script refuses it).
- **The same events in `prisma/seed.ts`**, appended **after** the last
  existing block, so a full reseed includes them and no earlier event's EVT-
  number moves. Keep the two in step.
- **Fixed dates.** Use calendar dates (`daysUntil("2027-03-17")` in the seed,
  literal dates in the script), never "today + n", so dates quoted in a case
  never go stale.
- **Fixed references.** Have the script recreate each event at the EVT-
  number a full reseed gives it (its position in the seed's creation order;
  the seed restarts numbering at 1), refuse if another event holds one, and
  move the Postgres sequence past them. Then cases can quote
  `/events/EVT-000124/review`.
- **Preconditions** say the fixtures are loaded. A case that changes data
  says to run the script **before and after** it; if the next case needs that
  change, it says to go straight to that case and reset after it instead.

## Step 4: Build the Excel file

Run (use `python3` if `python` is not found):

```
python .claude/skills/generate-test-cases/scripts/fill_template.py docs/test-cases/<ISSUE-KEY>_test_cases.json docs/test-cases/<ISSUE-KEY>_Test_Cases.xlsx
```

If it prints `VALIDATION FAILED`, fix the JSON and run it again. Repeat until it prints `OK`.
Besides the structure, it checks the writing rules: every expected-result
line starts `Step N:` for a step that exists, in order; no hand-numbered,
filler ("Read the list") or "Repeat…" steps; every `<ISSUE-KEY>-TCnn`
mentioned exists; a case that says another "has just been run" comes
straight after it; no full reseed as a reset. It can't check sidebar labels
against roles or quoted UI text — check those yourself before building.

`--legacy` turns the writing rules into a warning. Use it **only** to rebuild
an unchanged file written before 2026-09-30; any file you write or revise
must pass without it.

If it says openpyxl is not installed, tell the user to run `pip install openpyxl`.

## Step 5: Report back

Tell the user, briefly:
- The output file path
- Number of test cases, and how many came from code rather than acceptance criteria
- The open questions, listed in full, since they need a human answer

Do not update, comment on, or attach anything to the Jira issue unless the user asks.
