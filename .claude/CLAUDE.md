# Project rules

Tag every new test [SPM-xx][ACn]. Update the story's TC file in the same PR. Run npm run trace before marking a PR ready (without a Jira token: npm run trace -- --repo-only, which updates everything the CI check compares).

- The tag goes at the start of the `it()` / `test()` name, e.g. `it("[SPM-43][AC3] approves a free room", …)`. Several ACs: `[SPM-43][AC3][AC7]`. If no single AC fits, use the story alone: `[SPM-43]`. A bug's test: the story whose page it tests plus the bug, `[SPM-41][BUG-98]`. Code no story asks for: `[UNTRACED:<feature>]`, the feature in lowercase letters, digits and hyphens, e.g. `[UNTRACED:self-registration]` (listed under that feature in the matrix's "Code with no story"; a new feature also needs an entry in `UNTRACED_FEATURES` in `scripts/trace.ts`); do not tag it with an unrelated story. CI's Traceability job fails on an untagged test (`npm run trace:tags`).
- Test case workbooks (`docs/test-cases/SPM-<n>_Test_Cases.xlsx`) are the source of truth. Add a new execution block per run and never overwrite one; retire a case instead of deleting it (`docs/test-cases/README.md`, `docs/test-cases/DECOMMISSIONED.md`). Do not rebuild an existing workbook from its JSON: that drops the execution blocks.
- Jira is read-only from this repo: `npm run trace` sends GET requests only.
