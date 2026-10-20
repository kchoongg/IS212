/**
 * The CI "Traceability" job's two hard checks:
 *
 *   1. every automated test (outside tests/archive/) names its story -
 *      it("[SPM-43][AC3] ...") - or is marked [UNTRACED] (code no story asks
 *      for); the format is in scripts/lib/testTags.ts;
 *   2. the pull request's title or branch names a Jira key (SPM-n). A title
 *      starting "Docs:" or "Chore:" is exempt.
 *
 *   npm run trace:tags        (locally: checks the tests; add PR_TITLE="..." to check a title too)
 *
 * CI passes the PR's title and branch as PR_TITLE and HEAD_REF. On a push to
 * main there is no PR, so only the tests are checked.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { findTests } from "./lib/testTags";

const ROOT = path.resolve(__dirname, "..");
const inCi = process.env.GITHUB_ACTIONS === "true";
const failures: string[] = [];

const { tests, unnamed } = findTests(ROOT);
const untagged = tests.filter((t) => !t.tags.length && !t.untraced);
for (const t of untagged) {
  const where = `${t.file}:${t.line}`;
  failures.push(`${where} "${t.name}" has no [SPM-xx] tag`);
  if (inCi) console.log(`::error file=${t.file},line=${t.line}::Test has no [SPM-xx][ACn] tag: "${t.name}"`);
}
for (const u of unnamed) {
  failures.push(`${u.file}:${u.line} has a name that is not a string, so its tag cannot be read`);
  if (inCi) console.log(`::error file=${u.file},line=${u.line}::Test name is not a string literal, so its [SPM-xx] tag cannot be read`);
}

const title = process.env.PR_TITLE ?? "";
const branch = process.env.HEAD_REF || (inCi ? "" : execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim());
// Locally there is no PR title to read, so the second check runs only when
// PR_TITLE is given: PR_TITLE="SPM-43 ..." npm run trace:tags
const isPr = inCi ? Boolean(process.env.HEAD_REF) : Boolean(process.env.PR_TITLE);
if (isPr) {
  const exempt = /^\s*(Docs|Chore):/i.test(title);
  const hasKey = /\bSPM-\d+\b/i.test(title) || /(^|[^A-Za-z0-9])SPM-\d+(?![0-9])/i.test(branch);
  if (!exempt && !hasKey) {
    failures.push(
      `Neither the PR title ("${title || "not given"}") nor the branch ("${branch}") names a Jira key such as SPM-43. ` +
        'Add the key, or start the title with "Docs:" or "Chore:" for a change that belongs to no story.'
    );
  }
}

const summary = failures.length
  ? `Traceability check failed:\n\n${failures.map((f) => `- ${f}`).join("\n")}`
  : `Traceability check passed: all ${tests.length} tests are tagged${isPr ? ", and the PR names its story (or is exempt)" : ""}.`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Traceability\n\n${summary}\n`);
if (failures.length) process.exit(1);
