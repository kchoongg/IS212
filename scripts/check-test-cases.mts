/**
 * Warns when a story's pull request has no test case document. The story is
 * the Jira key at the start of the PR title or branch name (e.g. "SPM-90 ..."
 * or "SPM-90-check-each-venue..."); a PR without one - CI, docs, a bug fix -
 * is not checked.
 *
 * A warning, not a failure: a story's test cases are sometimes reviewed and
 * added in a later PR. CI runs it on every pull request (PR_TITLE, HEAD_REF);
 * locally it reads the current branch name.
 *
 *   npm run test-cases:check
 *
 * Runs with plain `node` (Node 24 strips the types), so CI needs no install.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

const inCi = process.env.GITHUB_ACTIONS === "true";

function storyKey(): string | null {
  const branch = process.env.HEAD_REF || execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  for (const text of [process.env.PR_TITLE ?? "", branch]) {
    const match = /^\s*(SPM-\d+)\b/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function report(message: string, warn: boolean) {
  console.log(message);
  if (inCi && warn) console.log(`::warning::${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test cases\n\n${message}\n`);
  }
}

const key = storyKey();
if (!key) {
  report("No Jira key in the PR title or branch name, so there is no story's test cases to look for.", false);
} else {
  const document = `docs/test-cases/${key}_Test_Cases.xlsx`;
  if (existsSync(document)) {
    report(`${key}: test cases found in \`${document}\`.`, false);
  } else {
    report(
      `${key}: no test case document at \`${document}\`. Add the story's test cases before it is marked Done ` +
        "(the generate-test-cases skill writes them).",
      true
    );
  }
}
