<!--
Title: start with the Jira key so the PR shows on the story, e.g.
"SPM-33 Track Outstanding Arrangements". Commit messages need the key too -
Jira links a commit only when its message contains it.
-->

## Story

**Jira:** SPM-
<!-- Not a story? Say what it is instead: bug fix, docs, CI, refactor. -->

## What changed

<!-- What this PR does and why, in a few lines. Name anything a reviewer
would not guess from the diff: a decision made, a rule changed, something
deliberately left out and which story picks it up. -->

-

## Acceptance criteria

<!-- One line per criterion in the story: met, or not in this PR and why. -->

- [ ] AC1 -

## Test cases

**Document:** `docs/test-cases/SPM-_Test_Cases.xlsx`
**Fixtures:** `npm run fixtures:spm` <!-- or "none needed" -->

## Screenshots

<!-- Optional. Taken by you, the PR author, and dragged into this box, for a
new or changed screen. Delete this section if there is none. -->

## Checklist

CI runs lint, type-check, tests with coverage, end-to-end smoke tests, build
and migrations on this PR, so those are not repeated here. It also fails if a line this PR adds or
changes under `src/` never runs in a test, and warns if the story has no test
case document.

**Tests**
- [ ] New or changed code has automated tests, and they pass locally (`npm test`)
- [ ] `npm run test:coverage` then `npm run coverage:changed` lists no untested lines (a line no test can reach is marked `// v8 ignore next -- <why>`)
- [ ] Test cases are in `docs/test-cases/` (`SPM-<n>_Test_Cases.xlsx` and `.json`) and were run by hand
- [ ] Other stories' test cases this PR makes out of date are listed under Known Gaps in `DOCUMENTATION.md`

**Database** <!-- tick "no schema change" and skip the rest if so -->
- [ ] No schema change
- [ ] Said so in the team chat before running `migrate dev`
- [ ] Migration is committed with the code that needs it
- [ ] `prisma/seed.ts` is updated, and the story's fixture script if it has one
- [ ] `SCHEMA_REFERENCE.md` is updated

**Documentation**
- [ ] Changelog entry added at the top of the Changelog in `DOCUMENTATION.md`
- [ ] Known Gaps in `DOCUMENTATION.md`: rows this PR closes are deleted, new gaps are added
- [ ] `docs/PERMISSIONS.md` is updated if who can do what has changed
- [ ] `UI_DESIGN.md` is updated if a screen, tab or navigation link was added or changed
- [ ] `docs/architecture/` is updated (DSL, class/sequence diagram, or ADR) if a role, container, external system, the schema or a key flow changed

**Before merging**
- [ ] Branch is up to date with `main`
- [ ] The team has been told to run `git pull && npx prisma generate` (schema changes only)

## Notes for the reviewer

<!-- Where to look first, anything you are unsure about, follow-up stories.
Delete if there is nothing to add. -->
