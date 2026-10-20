# Project rules

Tag every new test [SPM-xx][ACn]. Update the story's TC file in the same PR. Run npm run trace before marking a PR ready.

- The tag goes at the start of the `it()` / `test()` name, e.g. `it("[SPM-43][AC3] approves a free room", …)`. Several ACs: `[SPM-43][AC3][AC7]`. If no single AC fits, use the story alone: `[SPM-43]`. CI's Traceability job fails on an untagged test (`npm run trace:tags`).
- Test case workbooks (`docs/test-cases/SPM-<n>_Test_Cases.xlsx`) are the source of truth. Add a new execution block per run and never overwrite one; retire a case instead of deleting it (`docs/test-cases/README.md`, `docs/test-cases/DECOMMISSIONED.md`). Do not rebuild an existing workbook from its JSON: that drops the execution blocks.
- Jira is read-only from this repo: `npm run trace` sends GET requests only.
