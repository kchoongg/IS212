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
- **Write for a manual tester using the app, not a developer using an API client.**
  Every `steps` entry is a click, a typed value, or an on-screen action — never
  an HTTP method, a JSON body, or a raw endpoint path (no "POST /api/events",
  no "Send GET .../{id}"). Refer to pages by their on-screen title ("the New
  event request page"), not their route (`/events/new`); refer to fields by
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
- `created_by`: use the output of `git config user.name`.
- `creation_date`: today, as YYYY-MM-DD.
- Do not invent requirements. If the code and the acceptance criteria disagree, or something is unclear, add it to `open_questions`. Write test cases against the acceptance criteria, not the code, when they conflict.
- List the files you read in `code_references`.

## Step 4: Build the Excel file

Run (use `python3` if `python` is not found):

```
python .claude/skills/generate-test-cases/scripts/fill_template.py docs/test-cases/<ISSUE-KEY>_test_cases.json docs/test-cases/<ISSUE-KEY>_Test_Cases.xlsx
```

If it prints `VALIDATION FAILED`, fix the JSON and run it again. Repeat until it prints `OK`.

If it says openpyxl is not installed, tell the user to run `pip install openpyxl`.

## Step 5: Report back

Tell the user, briefly:
- The output file path
- Number of test cases, and how many came from code rather than acceptance criteria
- The open questions, listed in full, since they need a human answer

Do not update, comment on, or attach anything to the Jira issue unless the user asks.
