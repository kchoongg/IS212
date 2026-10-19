/**
 * Rebuilds the traceability matrix: every user story in Jira project SPM,
 * from estimate to Done, with its acceptance criteria, test cases, design
 * element, code, pull requests and automated tests.
 *
 *   npm run trace                    writes docs/traceability/TRACEABILITY.md and .csv
 *   npm run trace -- --check         writes nothing; exits 1 if the committed files are out of date
 *   npm run trace -- --pr-source=git ignore gh even when it is installed (CI uses the mode
 *                                    recorded in the committed matrix, so both agree)
 *
 * Reads, never writes:
 *   - Jira (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env): GET requests only.
 *   - git, and gh when it is installed and signed in: merged pull requests whose
 *     title or branch names the story. Without gh, the reviewer is "n/a (no gh)".
 *   - the automated tests: the [SPM-xx][ACn] tags in their names (scripts/lib/testTags.ts).
 *   - docs/test-cases/SPM-<n>_Test_Cases.xlsx: Active and Retired cases, and each
 *     Active case's newest execution block.
 *
 * How to read the result, and how to trace a story by hand: docs/START_HERE.md.
 */

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findTests, type FoundTest } from "./lib/testTags";
import { asDate, lastRow, readWorkbook } from "./lib/xlsx";

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs/traceability");
const MD = path.join(OUT_DIR, "TRACEABILITY.md");
const CSV = path.join(OUT_DIR, "TRACEABILITY.csv");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");

// ---------------------------------------------------------------- Jira (read-only)

const JIRA = (process.env.JIRA_BASE_URL ?? "").replace(/\/$/, "");
if (!JIRA || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
  console.error("npm run trace needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env (see .env.example).");
  process.exit(2);
}
const AUTH = "Basic " + Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");

async function jira<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(JIRA + pathAndQuery, { method: "GET", headers: { Authorization: AUTH, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Jira ${res.status} on GET ${pathAndQuery}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

/** Atlassian Document Format to plain text, keeping list items on their own "- " lines. */
function adf(node: AdfNode | null | undefined): string {
  if (!node) return "";
  const kids = (node.content ?? []).map(adf);
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "paragraph":
    case "heading":
      return kids.join("") + "\n";
    case "bulletList":
    case "orderedList":
      return (node.content ?? []).map((li) => "- " + adf(li).trim().replace(/\n/g, " ")).join("\n") + "\n";
    case "mention":
      return String(node.attrs?.text ?? "");
    case "inlineCard":
    case "blockCard":
      return String(node.attrs?.url ?? "");
    default:
      return kids.join("");
  }
}

/** The bullets under "Acceptance Criteria", numbered by position as the team numbers them. */
function acceptanceCriteria(description: string): string[] {
  const acs: string[] = [];
  let inside = false;
  for (const line of description.split("\n")) {
    if (!inside) {
      if (/^\s*#*\s*Acceptance Criteria:?\s*$/i.test(line)) inside = true;
      continue;
    }
    if (line.startsWith("- ")) acs.push(line.slice(2).trim());
    else if (line.trim() === "") continue;
    else break;
  }
  return acs;
}

interface Story {
  key: string;
  num: number;
  title: string;
  epic: string;
  sprints: string[];
  sprintState: string;
  points: number | null;
  status: string;
  source: string;
  estimate: string;
  acs: string[];
  bugs: string[];
}

async function loadStories(): Promise<Story[]> {
  const fields = await jira<{ id: string; name: string }[]>("/rest/api/3/field");
  const fieldId = (name: string) => fields.find((f) => f.name === name)?.id;
  const sprintField = fieldId("Sprint");
  const pointsField = fieldId("Story point estimate") ?? fieldId("Story Points");
  const want = ["summary", "status", "parent", "description", "issuelinks", sprintField, pointsField].filter(Boolean).join(",");

  type Issue = { key: string; fields: Record<string, any> };
  const issues: Issue[] = [];
  let token: string | undefined;
  do {
    const page = await jira<{ issues: Issue[]; nextPageToken?: string }>(
      "/rest/api/3/search/jql?jql=" +
        encodeURIComponent("project = SPM AND issuetype = Story ORDER BY key") +
        `&fields=${want}&maxResults=100` +
        (token ? `&nextPageToken=${encodeURIComponent(token)}` : "")
    );
    issues.push(...page.issues);
    token = page.nextPageToken;
  } while (token);

  const stories: Story[] = [];
  for (const issue of issues) {
    const f = issue.fields;
    const description = adf(f.description);
    const comments = await jira<{ comments: { created: string; body: AdfNode }[] }>(
      `/rest/api/3/issue/${issue.key}/comment?maxResults=200&orderBy=created`
    );
    // The estimate rationale is the newest comment that starts "Estimate" (or "Estimation").
    const estimate = comments.comments
      .map((c) => adf(c.body).trim())
      .filter((t) => /^Estimat(e|ion)/i.test(t))
      .pop();
    const sprints = ((sprintField && f[sprintField]) || []) as { name: string; state: string; startDate?: string }[];
    sprints.sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
    const bugs: string[] = [];
    for (const link of f.issuelinks ?? []) {
      const other = link.outwardIssue ?? link.inwardIssue;
      if (other?.fields?.issuetype?.name === "Bug") bugs.push(other.key);
    }
    stories.push({
      key: issue.key,
      num: Number(issue.key.split("-")[1]),
      title: String(f.summary).trim(),
      epic: f.parent ? `${f.parent.key} ${f.parent.fields?.summary ?? ""}`.trim() : "",
      sprints: sprints.map((s) => s.name.replace(/^SPM\s+/, "")),
      sprintState: sprints.at(-1)?.state ?? "",
      points: pointsField ? (f[pointsField] ?? null) : null,
      status: f.status?.name ?? "",
      source: description.split("\n").find((l) => /^\s*Source:/i.test(l))?.trim() ?? "",
      estimate: (estimate ?? "").replace(/\s+/g, " "),
      acs: acceptanceCriteria(description),
      bugs: [...new Set(bugs)].sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1])),
    });
  }
  return stories.sort((a, b) => a.num - b.num);
}

// ---------------------------------------------------------------- pull requests

interface PullRequest {
  number: number;
  title: string;
  branch: string;
  merged: string;
  reviewers: string;
  ci: string;
}

function run(cmd: string, argv: string[]): string | null {
  try {
    return execFileSync(cmd, argv, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
  } catch {
    return null;
  }
}

const repoUrl = (() => {
  const origin = (run("git", ["remote", "get-url", "origin"]) ?? "").trim();
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(origin);
  return m ? `https://github.com/${m[1]}` : "";
})();

function prSource(): "gh" | "git" {
  const forced = args.find((a) => a.startsWith("--pr-source="))?.split("=")[1];
  if (forced === "gh" || forced === "git") return forced;
  if (CHECK && existsSync(MD)) {
    // Regenerate with the source the committed matrix was made with, so a
    // teammate without gh and CI (which has it) produce the same file.
    if (/PR data: git log/.test(readFileSync(MD, "utf8"))) return "git";
  }
  return run("gh", ["auth", "status"]) !== null ? "gh" : "git";
}

function loadPullRequests(source: "gh" | "git"): PullRequest[] {
  if (source === "gh") {
    const json = run("gh", ["pr", "list", "--state", "merged", "--limit", "500", "--json", "number,title,headRefName,mergedAt,reviews,url"]);
    if (json) {
      const prs = JSON.parse(json) as { number: number; title: string; headRefName: string; mergedAt: string; reviews: { author: { login: string } }[]; url: string }[];
      return prs.map((p) => {
        const runs = run("gh", ["run", "list", "--branch", p.headRefName, "--workflow", "CI", "--limit", "1", "--json", "url"]);
        const ci = runs ? ((JSON.parse(runs) as { url: string }[])[0]?.url ?? "") : "";
        const reviewers = [...new Set(p.reviews.map((r) => r.author.login))].sort().join(", ");
        return { number: p.number, title: p.title, branch: p.headRefName, merged: p.mergedAt.slice(0, 10), reviewers: reviewers || "none recorded", ci };
      });
    }
  }
  // Every PR merged on GitHub leaves a merge commit reachable from main: "Merge pull request #N
  // from owner/branch", with the PR's title as the body.
  const log = run("git", ["log", "origin/main", "--merges", "--format=%H%x1f%ad%x1f%s%x1f%b%x1e", "--date=short"]) ?? "";
  const prs: PullRequest[] = [];
  for (const entry of log.split("\x1e")) {
    const [, date, subject, body] = entry.trim().split("\x1f");
    const m = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(subject ?? "");
    if (!m || prs.some((p) => p.number === Number(m[1]))) continue;
    prs.push({
      number: Number(m[1]),
      title: (body ?? "").trim().split("\n")[0] ?? "",
      branch: m[2],
      merged: date,
      reviewers: "n/a (no gh)",
      ci: repoUrl ? `${repoUrl}/pull/${m[1]}/checks` : "",
    });
  }
  return prs.sort((a, b) => a.number - b.number);
}

const mentions = (text: string, key: string) => new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, "i").test(text);

// ---------------------------------------------------------------- test case workbooks

interface TestCases {
  file: string;
  active: number;
  retired: number;
  latest: string;
}

function loadTestCases(key: string): TestCases | null {
  const rel = `docs/test-cases/${key}_Test_Cases.xlsx`;
  if (!existsSync(path.join(ROOT, rel))) return null;
  const wb = readWorkbook(path.join(ROOT, rel));
  const summary = wb.cells.get("Summary") ?? new Map();
  // The case table's header row is the one whose column B reads "Test Case ID".
  let header = 0;
  for (let r = 1; r <= 10; r++) if (String(summary.get(`B${r}`) ?? "").trim() === "Test Case ID") header = r;
  let statusCol = "";
  for (const col of "ABCDEFGHIJKL") if (String(summary.get(`${col}${header}`) ?? "").trim() === "Status") statusCol = col;

  let active = 0;
  let retired = 0;
  const results = new Map<string, number>();
  let newest = "";
  for (let r = header + 1; r <= lastRow(summary); r++) {
    const id = String(summary.get(`B${r}`) ?? "").trim();
    if (!/^SPM-\d+-TC\d+/.test(id)) {
      if (id === "" && String(summary.get(`A${r}`) ?? "").trim() === "") break;
      continue;
    }
    const status = statusCol ? String(summary.get(`${statusCol}${r}`) ?? "Active").trim() : "Active";
    if (/^retired$/i.test(status)) {
      retired++;
      continue;
    }
    active++;
    // The newest execution block on the case's own sheet (blocks are added below each other).
    const sheetName = String(summary.get(`A${r}`) ?? "").trim();
    const sheet = wb.cells.get(sheetName);
    if (!sheet) continue;
    let result = "";
    let date = "";
    for (let row = 1; row <= lastRow(sheet); row++) {
      const label = String(sheet.get(`A${row}`) ?? "").trim();
      if (/^Pass\/Fail/i.test(label) && sheet.get(`B${row}`) !== undefined) {
        result = String(sheet.get(`B${row}`)).trim();
        date = "";
      }
      if (/^Date of Execution/i.test(label)) date = asDate(sheet.get(`B${row}`));
    }
    if (!result) continue;
    results.set(result, (results.get(result) ?? 0) + 1);
    if (date > newest) newest = date;
  }
  const order = ["Pass", "Fail", "Blocked", "Not Executed"];
  const summaryText = [...results.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 10) % 14 - (order.indexOf(b[0]) + 10) % 14 || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return { file: rel, active, retired, latest: summaryText ? `${summaryText}${newest ? ` (${newest})` : ""}` : "not run" };
}

// ---------------------------------------------------------------- design element

/**
 * The C4 element in docs/architecture/connectsphere.dsl that each story's work
 * lives in, by epic. Blank where the model has no element for it: the
 * Notification System, and the Week 7 roles (Safety Officer, Event Coordinator
 * Lead) the diagram predates.
 */
const DESIGN_BY_EPIC: Record<string, string> = {
  "SPM-11": "Web Application › Auth API",
  "SPM-12": "Web Application › Events API",
  "SPM-14": "Web Application › Events API",
  "SPM-15": "Web Application › Events API",
  "SPM-16": "Web Application › Events API",
  "SPM-13": "Web Application › Venues API",
  "SPM-17": "Web Application › Venues API",
  "SPM-18": "Web Application › Equipment API",
  "SPM-19": "Web Application › Registrations API",
};
const DESIGN_BY_STORY: Record<string, string> = {
  "SPM-2": "System Context and Containers views",
  "SPM-3": "Container › Database",
  "SPM-4": "Web Application › Auth API",
  "SPM-10": "Containers view (Web Application ↔ Database)",
  "SPM-84": "",
  "SPM-85": "",
  "SPM-86": "",
  "SPM-87": "",
  "SPM-88": "",
};
const designElement = (s: Story) => (s.key in DESIGN_BY_STORY ? DESIGN_BY_STORY[s.key] : (DESIGN_BY_EPIC[s.epic.split(" ")[0]] ?? ""));

// ---------------------------------------------------------------- build

async function main() {
  const source = prSource();
  const [stories, prs] = [await loadStories(), loadPullRequests(source)];
  const { tests } = findTests(ROOT);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

  const byStory = new Map<string, FoundTest[]>();
  for (const t of tests) for (const tag of t.tags) {
    const list = byStory.get(tag.story) ?? [];
    if (!list.includes(t)) list.push(t);
    byStory.set(tag.story, list);
  }

  const relevant = (s: Story) => s.status === "Done" || s.sprintState === "active";
  const gapsNoTest: string[] = [];
  const gapsNoPr: string[] = [];
  const gapsNoTc: string[] = [];
  const storyOnly: string[] = [];

  const rows = stories.map((s) => {
    const ts = byStory.get(s.key) ?? [];
    const covered = new Set<number>();
    for (const t of ts) for (const tag of t.tags) if (tag.story === s.key) tag.acs.forEach((a) => covered.add(a));
    const count = (level: FoundTest["level"]) => ts.filter((t) => t.level === level).length;
    const unit = count("unit");
    const route = count("route");
    const uncovered = s.acs.map((_, i) => i + 1).filter((n) => !covered.has(n));
    const myPrs = prs.filter((p) => mentions(p.title, s.key) || mentions(p.branch, s.key));
    const tc = loadTestCases(s.key);
    const isResearch = /^\[Research\]|^\[FE\]/.test(s.title);

    const gaps: string[] = [];
    if (relevant(s) && !isResearch) {
      if (uncovered.length && s.acs.length) {
        gaps.push(`no test: ${uncovered.map((n) => `AC${n}`).join(", ")}`);
        gapsNoTest.push(`${s.key} ${s.title}: ${uncovered.map((n) => `AC${n}`).join(", ")}`);
      }
      if (!myPrs.length && s.status === "Done") {
        gaps.push("no PR");
        gapsNoPr.push(`${s.key} ${s.title}`);
      }
      if (!tc) {
        gaps.push("no TC file");
        gapsNoTc.push(`${s.key} ${s.title} (${s.status})`);
      }
    }
    if (!s.estimate && s.points !== null) gaps.push("no estimate comment");
    for (const t of ts) {
      const own = t.tags.filter((tag) => tag.story === s.key);
      if (own.length && own.every((tag) => !tag.acs.length)) storyOnly.push(`${s.key}\t${t.file}:${t.line}\t${t.name.replace(/\[SPM-\d+\](\[AC\d+\])*\s*/g, "")}`);
    }

    return {
      story: s,
      unit,
      route,
      integration: count("integration"),
      e2e: count("e2e"),
      coveredText: s.acs.length ? `${s.acs.length - uncovered.length}/${s.acs.length}` : "",
      tc,
      prs: myPrs,
      design: designElement(s),
      gaps,
    };
  });

  // ---- CSV
  const csvCell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Story", "Title", "Epic", "Source", "Sprint", "Points", "Estimate rationale", "# ACs", "ACs with automated coverage",
    "TC file", "Active TCs", "Retired TCs", "Latest manual result + date", "Unit", "Integration", "E2E", "Design element",
    "PR(s)", "Reviewer", "CI run", "Linked bugs", "Status", "Gaps",
  ];
  const csv = [header.join(",")];
  for (const r of rows) {
    const s = r.story;
    csv.push(
      [
        s.key, s.title, s.epic, s.source, s.sprints.join(" > ") || "Backlog", s.points ?? "", s.estimate, s.acs.length, r.coveredText,
        r.tc?.file ?? "", r.tc?.active ?? "", r.tc?.retired ?? "", r.tc?.latest ?? "",
        `${r.unit} unit, ${r.route} route`, r.integration, r.e2e, r.design,
        r.prs.map((p) => `#${p.number} (${p.merged})`).join("; "), r.prs.map((p) => p.reviewers).join("; "), r.prs.map((p) => p.ci).join("; "),
        s.bugs.join("; "), s.status, r.gaps.join("; "),
      ].map(csvCell).join(",")
    );
  }

  // ---- Markdown
  const esc = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const short = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1).trimEnd() + "…" : v);
  const jiraLink = (key: string) => `[${key}](${JIRA}/browse/${key})`;
  const md: string[] = [];
  md.push("# Traceability matrix", "");
  md.push(`Generated by npm run trace on ${today} – do not edit by hand.`, "");
  md.push(
    `Every user story in Jira project SPM, from estimate to Done. Sources: Jira (read-only), merged pull requests (PR data: ${source === "gh" ? "gh" : "git log"}), ` +
      "the `[SPM-xx][ACn]` tags on the automated tests, and the workbooks in [docs/test-cases](../test-cases/README.md). " +
      "How to read it and trace a story by hand: [START_HERE.md](../START_HERE.md). The same data as a spreadsheet: [TRACEABILITY.csv](TRACEABILITY.csv).",
    ""
  );
  md.push(
    "Column notes: **Unit** counts unit tests and mocked-route tests (`src/app/api/__tests__`) separately. **Latest manual result** is the newest " +
      "execution block of each Active test case, counted by result, with the newest date. Retired test cases are listed in " +
      "[DECOMMISSIONED.md](../test-cases/DECOMMISSIONED.md). Gaps are only checked for stories that are Done or in the active sprint.",
    ""
  );
  md.push("| " + header.join(" | ") + " |");
  md.push("|" + header.map(() => "---").join("|") + "|");
  for (const r of rows) {
    const s = r.story;
    const tcLink = r.tc ? `[xlsx](../test-cases/${path.basename(r.tc.file)})` : "";
    const retired = r.tc ? (r.tc.retired ? `[${r.tc.retired}](../test-cases/DECOMMISSIONED.md)` : "0") : "";
    md.push(
      "| " +
        [
          jiraLink(s.key), esc(s.title), esc(s.epic), esc(short(s.source, 140)), s.sprints.join(" → ") || "Backlog", String(s.points ?? ""),
          esc(short(s.estimate, 160)), String(s.acs.length), r.coveredText, tcLink, r.tc ? String(r.tc.active) : "", retired, r.tc?.latest ?? "",
          `${r.unit} unit, ${r.route} route`, String(r.integration), String(r.e2e), esc(r.design),
          r.prs.map((p) => (repoUrl ? `[#${p.number}](${repoUrl}/pull/${p.number})` : `#${p.number}`) + ` ${p.merged}`).join("<br>"),
          r.prs.map((p) => esc(p.reviewers)).join("<br>"),
          r.prs.map((p) => (p.ci ? `[run](${p.ci})` : "")).join("<br>"),
          s.bugs.map(jiraLink).join(", "), s.status, esc(r.gaps.join("; ")),
        ].join(" | ") +
        " |"
    );
  }
  const list = (title: string, items: string[]) => {
    md.push("", `## ${title}`, "");
    md.push(...(items.length ? items.map((i) => `- ${i}`) : ["- none"]));
  };
  list("ACs with no test", gapsNoTest);
  list("Stories with no PR", gapsNoPr);
  list("Stories with no TC file", gapsNoTc);
  md.push("", "## Tests tagged with a story but no single AC", "");
  md.push(
    "These tests name the story they belong to but check something no one AC states (a load error, an empty state, a helper). " +
      `${storyOnly.length} tests:`,
    ""
  );
  md.push("<details><summary>Show the list</summary>", "", "| Story | Test | Name |", "|---|---|---|");
  for (const line of storyOnly.sort()) {
    const [k, where, name] = line.split("\t");
    md.push(`| ${k} | ${where} | ${esc(name)} |`);
  }
  md.push("", "</details>", "");

  const outputs: [string, string][] = [
    [MD, md.join("\n")],
    [CSV, csv.join("\n") + "\n"],
  ];
  if (CHECK) {
    const strip = (t: string) => t.replace(/^Generated by npm run trace on .*$/m, "").replace(/\r\n/g, "\n");
    const stale = outputs.filter(([file, text]) => !existsSync(file) || strip(readFileSync(file, "utf8")) !== strip(text));
    if (stale.length) {
      console.error(`Out of date: ${stale.map(([f]) => path.relative(ROOT, f)).join(", ")}. Run npm run trace and commit the result.`);
      process.exit(1);
    }
    console.log("The traceability matrix is up to date.");
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, text] of outputs) writeFileSync(file, text);
  console.log(`Wrote ${path.relative(ROOT, MD)} and ${path.relative(ROOT, CSV)}: ${rows.length} stories, ${tests.length} tests, PR data from ${source}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
