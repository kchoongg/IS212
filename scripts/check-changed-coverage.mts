/**
 * Fails when a line this branch adds or changes under src/ never runs in a
 * test. The coverage minimums in vitest.config.mts are for the whole app, so
 * a story could add untested code and still pass them; this looks only at
 * the story's own lines.
 *
 *   npm run test:coverage        (writes coverage/coverage-final.json)
 *   npm run coverage:changed     (compares against origin/main)
 *
 * CI runs it on every pull request, against the PR's base commit (BASE_SHA).
 * Each untested line is printed with its file and line number, and in CI it
 * is also marked on the PR's diff.
 *
 * A line no test can reach - a guard TypeScript needs, a fallback for a value
 * the server always sends - is marked in the source instead, with the reason:
 *
 *   // v8 ignore next -- the dialog is always mounted
 *
 * The coverage tool then leaves it out, and the reviewer sees why in the diff.
 *
 * Runs with plain `node` (Node 24 strips the types), so it imports nothing
 * outside Node itself.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface Location {
  start: { line: number | null };
  end: { line: number | null };
}

/// The parts of Istanbul's coverage-final.json this script reads.
interface FileCoverage {
  statementMap: Record<string, Location>;
  s: Record<string, number>;
  fnMap: Record<string, { name: string; decl: Location }>;
  f: Record<string, number>;
  branchMap: Record<string, { type: string; loc: Location; locations: Location[] }>;
  b: Record<string, number[]>;
}

const COVERAGE_FILE = "coverage/coverage-final.json";
const root = process.cwd();
const inCi = process.env.GITHUB_ACTIONS === "true";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/// The commit to compare against: the PR's base in CI, otherwise where this
/// branch left origin/main.
function baseCommit(): string {
  if (process.env.BASE_SHA) return process.env.BASE_SHA;
  return git("merge-base", "origin/main", "HEAD").trim();
}

/// Lines added or changed under src/, by file, as the working tree has them.
function changedLines(base: string): Map<string, Set<number>> {
  const diff = git("diff", "--unified=0", "--no-color", "--diff-filter=AMR", base, "--", "src");
  const changed = new Map<string, Set<number>>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice("+++ b/".length);
      continue;
    }
    // "@@ -12,3 +14,5 @@": five lines from line 14. A count of 0 is a deletion.
    const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const lines = changed.get(file) ?? new Set<number>();
      for (let n = start; n < start + count; n++) lines.add(n);
      changed.set(file, lines);
    }
  }
  return changed;
}

/// What on each line never ran: "statement", "branch" or "function".
function untestedByLine(file: FileCoverage): Map<number, Set<string>> {
  const missed = new Map<number, Set<string>>();
  const mark = (line: number | null, what: string) => {
    if (line === null) return;
    const kinds = missed.get(line) ?? new Set<string>();
    kinds.add(what);
    missed.set(line, kinds);
  };
  for (const [id, count] of Object.entries(file.s)) {
    if (count === 0) mark(file.statementMap[id].start.line, "statement");
  }
  for (const [id, count] of Object.entries(file.f)) {
    if (count === 0) mark(file.fnMap[id].decl.start.line, "function");
  }
  for (const [id, counts] of Object.entries(file.b)) {
    const branch = file.branchMap[id];
    counts.forEach((count, i) => {
      if (count > 0) return;
      // An `if` with no `else` has no location of its own for the path that
      // skips it; that path is reported on the `if` line.
      const at = branch.locations[i]?.start.line ?? branch.loc.start.line;
      mark(at, "branch");
    });
  }
  return missed;
}

function main(): number {
  if (!existsSync(COVERAGE_FILE)) {
    console.error(`${COVERAGE_FILE} not found. Run \`npm run test:coverage\` first.`);
    return 1;
  }
  const coverage: Record<string, FileCoverage> = JSON.parse(readFileSync(COVERAGE_FILE, "utf8"));
  // Keyed by absolute path, with the platform's separators.
  const byFile = new Map(
    Object.entries(coverage).map(([abs, data]) => [path.relative(root, abs).split(path.sep).join("/"), data])
  );

  const base = baseCommit();
  const changed = changedLines(base);
  const findings: { file: string; line: number; what: string[] }[] = [];
  let checkedLines = 0;

  for (const [file, lines] of changed) {
    // Tests, type declarations and test helpers are not in the coverage
    // report (see coverage.exclude in vitest.config.mts), so are not checked.
    const data = byFile.get(file);
    if (!data) continue;
    const missed = untestedByLine(data);
    for (const line of [...lines].sort((a, b) => a - b)) {
      checkedLines++;
      const kinds = missed.get(line);
      if (kinds) findings.push({ file, line, what: [...kinds].sort() });
    }
  }

  const summary: string[] = ["## Coverage of changed lines", ""];
  if (findings.length === 0) {
    const message = `Every changed line under src/ runs in a test (${checkedLines} lines checked against ${base.slice(0, 7)}).`;
    console.log(message);
    summary.push(message);
  } else {
    console.log(`${findings.length} changed line(s) never run in a test (compared with ${base.slice(0, 7)}):\n`);
    summary.push(
      `${findings.length} changed line(s) never run in a test. Add a test that runs each, or, for a line no test can reach, ` +
        "mark it `// v8 ignore next -- <why>`.",
      "",
      "| File | Line | Not run |",
      "| --- | --- | --- |"
    );
    for (const { file, line, what } of findings) {
      console.log(`  ${file}:${line}  (${what.join(", ")})`);
      summary.push(`| \`${file}\` | ${line} | ${what.join(", ")} |`);
      if (inCi) console.log(`::error file=${file},line=${line}::This changed line never runs in a test (${what.join(", ")}).`);
    }
    console.log("\nAdd a test that runs each one, or, for a line no test can reach, mark it `// v8 ignore next -- <why>`.");
  }

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  return findings.length === 0 ? 0 : 1;
}

process.exit(main());
