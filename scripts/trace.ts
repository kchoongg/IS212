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
  author: string;
  /** Who merged it ("" without gh). */
  mergedBy: string;
  /** Who reviewed it, the author left out; bots are marked "(bot)". "" when nobody else did; "n/a (no gh)" without gh. */
  reviewers: string;
  ci: string;
  /** Paths the PR changed. */
  files: string[];
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
    // teammate without gh and CI produce the same file.
    if (/PR data: git log/.test(readFileSync(MD, "utf8"))) return "git";
  }
  return run("gh", ["auth", "status"]) !== null ? "gh" : "git";
}

function loadPullRequests(source: "gh" | "git"): PullRequest[] {
  if (source === "gh") {
    const json = run("gh", ["pr", "list", "--state", "merged", "--limit", "500", "--json", "number,title,headRefName,mergedAt,author,mergedBy,reviews,files"]);
    if (json) {
      type GhPr = { number: number; title: string; headRefName: string; mergedAt: string; author: { login: string }; mergedBy: { login: string } | null; reviews: { author: { login: string } }[]; files: { path: string }[] };
      return (JSON.parse(json) as GhPr[])
        .map((p) => {
          // The CI run of the PR's last commit on its branch.
          const runs = run("gh", ["run", "list", "--branch", p.headRefName, "--workflow", "CI", "--limit", "1", "--json", "url"]);
          const ci = runs ? ((JSON.parse(runs) as { url: string }[])[0]?.url ?? "") : "";
          const reviewers = [...new Set(p.reviews.map((r) => r.author.login))]
            .filter((l) => l !== p.author.login)
            .sort()
            .map((l) => (/(^copilot|\[bot\]$|-bot$)/i.test(l) ? `${l} (bot)` : l))
            .join(", ");
          const mergedBy = p.mergedBy?.login ?? "";
          return { number: p.number, title: p.title, branch: p.headRefName, merged: p.mergedAt.slice(0, 10), author: p.author.login, mergedBy, reviewers, ci, files: p.files.map((f) => f.path) };
        })
        .sort((a, b) => a.number - b.number);
    }
  }
  // Every PR merged on GitHub leaves a merge commit reachable from main: "Merge pull request #N
  // from owner/branch", with the PR's title as the body.
  const log = run("git", ["log", "origin/main", "--merges", "--format=%H%x1f%ad%x1f%s%x1f%b%x1e", "--date=short"]) ?? "";
  const prs: PullRequest[] = [];
  for (const entry of log.split("\x1e")) {
    const [hash, date, subject, body] = entry.trim().split("\x1f");
    const m = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(subject ?? "");
    if (!m || prs.some((p) => p.number === Number(m[1]))) continue;
    prs.push({
      number: Number(m[1]),
      title: (body ?? "").trim().split("\n")[0] ?? "",
      branch: m[2],
      merged: date,
      author: "",
      mergedBy: "",
      reviewers: "n/a (no gh)",
      ci: repoUrl ? `${repoUrl}/pull/${m[1]}/checks` : "",
      files: (run("git", ["diff", "--name-only", `${hash}^1`, hash]) ?? "").split("\n").filter(Boolean),
    });
  }
  return prs.sort((a, b) => a.number - b.number);
}

/** Jira issue type of every Bug and Task in SPM (stories come from loadStories). */
async function loadOtherIssueTypes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await jira<{ issues: { key: string; fields: { issuetype: { name: string } } }[]; nextPageToken?: string }>(
      "/rest/api/3/search/jql?jql=" + encodeURIComponent("project = SPM AND issuetype in (Bug, Task) ORDER BY key") +
        "&fields=issuetype&maxResults=100" + (token ? `&nextPageToken=${encodeURIComponent(token)}` : "")
    );
    for (const i of page.issues) out.set(i.key, i.fields.issuetype.name);
    token = page.nextPageToken;
  } while (token);
  return out;
}

export type PrType = "Story" | "Bug" | "Test" | "Docs" | "Chore" | "Setup";

/** What kind of file a path is, for classifying a PR. */
function fileKind(f: string): "docs" | "test" | "app" | "tooling" {
  // Verification and fixture scripts are test code too.
  if (/(^|\/)__tests__\/|\.(test|spec)\.(ts|tsx)$|^(e2e|integration|tests)\/|^src\/test\/|^scripts\/(verify|seed)-/.test(f)) return "test";
  if (/\.(md|xlsx|docx|drawio|puml|dsl|pdf)$/i.test(f) || /^(docs|design)\//.test(f) || /(^|\/)~\$/.test(f)) return "docs";
  if (/^(src|prisma)\//.test(f) || /^(neon|next-env\.d)\.ts$/.test(f)) return "app";
  return "tooling";
}

/**
 * A PR's type. Story or Bug when its own key - the one its branch starts with,
 * else the first in its branch, else the first in its title ("SPM-47" or
 * "Spm 47") - is an SPM story or bug.
 * Otherwise (including a Task) by what it changed: only docs files → Docs;
 * mostly tests, or a test/ branch → Test; any other app code (src/, prisma/) →
 * Setup; only tooling and config → Chore.
 */
function classifyPr(pr: PullRequest, storyKeys: Set<string>, otherTypes: Map<string, string>): { type: PrType; code: boolean } {
  const kinds = pr.files.map(fileKind);
  const n = (k: string) => kinds.filter((x) => x === k).length;
  const code = n("app") + n("test") > 0;
  const own = /^SPM-(\d+)/i.exec(pr.branch) ?? /SPM-(\d+)/i.exec(pr.branch) ?? /SPM[- ](\d+)/i.exec(pr.title);
  const key = own ? `SPM-${own[1]}` : "";
  if (storyKeys.has(key)) return { type: "Story", code };
  if (otherTypes.get(key) === "Bug") return { type: "Bug", code };
  if (!pr.files.length || n("docs") === pr.files.length) return { type: "Docs", code };
  if (n("test") > 0 && (n("test") >= n("app") || /^test\//i.test(pr.branch))) return { type: "Test", code };
  if (n("app") > 0) return { type: "Setup", code };
  return { type: "Chore", code };
}

/** docs/traceability/review-evidence.csv: PR,evidence link,note - for reviews held outside GitHub (e.g. a recording). */
function loadReviewOverrides(): Map<number, { link: string; note: string }> {
  const out = new Map<number, { link: string; note: string }>();
  const file = path.join(OUT_DIR, "review-evidence.csv");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n").slice(1)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    const pr = Number(cells[0].replace(/^#/, "").trim());
    if (pr) out.set(pr, { link: (cells[1] ?? "").trim(), note: (cells[2] ?? "").trim() });
  }
  return out;
}

const mentions = (text: string, key: string) => new RegExp(`(^|[^A-Za-z0-9])${key}(?![0-9])`, "i").test(text);

// ---------------------------------------------------------------- test case workbooks

interface TestCases {
  file: string;
  active: number;
  retired: number;
  latest: string;
  /** ACs named in the Linked AC column of an Active or Updated case. */
  acs: Set<number>;
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
  let acCol = "D";
  for (const col of "ABCDEFGHIJKL") {
    const h = String(summary.get(`${col}${header}`) ?? "").trim();
    if (h === "Status") statusCol = col;
    if (h === "Linked AC") acCol = col;
  }

  let active = 0;
  let retired = 0;
  const acs = new Set<number>();
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
    for (const m of String(summary.get(`${acCol}${r}`) ?? "").matchAll(/AC(\d+)/g)) acs.add(Number(m[1]));
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
  return { file: rel, active, retired, acs, latest: summaryText ? `${summaryText}${newest ? ` (${newest})` : ""}` : "not run" };
}

// ---------------------------------------------------------------- superseded ACs

/**
 * ACs a requirement change replaced, from the "Superseded acceptance criteria"
 * table in docs/CHANGES.md: | Story | AC | Replaced by | Change |. Such an AC is
 * shown as Superseded, never as a gap.
 */
function loadSuperseded(): Map<string, string> {
  const out = new Map<string, string>();
  const file = path.join(ROOT, "docs/CHANGES.md");
  if (!existsSync(file)) return out;
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("## Superseded acceptance criteria");
  if (start < 0) return out;
  for (const line of text.slice(start).split("\n").slice(1)) {
    if (line.startsWith("## ")) break;
    const cells = line.split("|").map((c) => c.trim());
    const story = /^SPM-\d+$/.exec(cells[1] ?? "")?.[0];
    if (!story) continue;
    for (const m of (cells[2] ?? "").matchAll(/AC(\d+)/g)) out.set(`${story} AC${m[1]}`, `${cells[3]} (${cells[4]})`);
  }
  return out;
}

// ---------------------------------------------------------------- code with no story

/**
 * Features in the code that no Jira story asks for. Their tests are tagged
 * [UNTRACED]. Each stays until the team decides to remove it or back it with
 * a story; nothing here is deleted.
 */
const UNTRACED_FEATURES: { name: string; why: string; files: string[]; tests: RegExp }[] = [
  {
    name: "Self-registration (Create an account)",
    why:
      "No story covers it. SPM-21 User Login has no registration criterion. Built in the project setup (2026-09-06/09), " +
      "before the backlog. Only the Organiser and Attendee roles can be chosen.",
    files: [
      "src/app/register/page.tsx",
      "src/app/api/auth/register/route.ts",
      "src/lib/validation/auth.ts (registerSchema)",
      "src/lib/roles.ts (SELF_REGISTERABLE_ROLES, isSelfRegisterableRole)",
      "src/app/page.tsx (the Home page's Register link)",
    ],
    tests: /public-pages|auth\.test|validation\.test|edgeCases/,
  },
  {
    name: "Adding an item to the equipment catalogue (POST /api/equipment)",
    why:
      "No story covers creating equipment items, and no screen calls this endpoint. Built in the project setup (2026-09-06). " +
      "Viewing the catalogue (GET) and recording units out of service are SPM-48 and SPM-55.",
    files: ["src/app/api/equipment/route.ts (POST)", "src/lib/validation/equipment.ts (createEquipmentSchema)"],
    tests: /api\/__tests__\/equipment\.test/,
  },
];

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

type Coverage = "Automated" | "Manual only" | "Superseded" | "None";
const SHORT: Record<Coverage, string> = { Automated: "A", "Manual only": "M", Superseded: "S", None: "N" };

async function main() {
  const source = prSource();
  const [stories, prs] = [await loadStories(), loadPullRequests(source)];
  const { tests } = findTests(ROOT);
  const superseded = loadSuperseded();
  const otherTypes = await loadOtherIssueTypes();
  const storyKeys = new Set(stories.map((s) => s.key));
  const overrides = loadReviewOverrides();
  const prType = new Map(prs.map((p) => [p.number, classifyPr(p, storyKeys, otherTypes)]));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

  const byStory = new Map<string, FoundTest[]>();
  for (const t of tests) for (const tag of t.tags) {
    const list = byStory.get(tag.story) ?? [];
    if (!list.includes(t)) list.push(t);
    byStory.set(tag.story, list);
  }

  const relevant = (s: Story) => s.status === "Done" || s.sprintState === "active";
  // Research and design stories (Sprint 1): their tests are setup, not feature coverage.
  const isResearch = (s: Story) => /^\[(Research|FE)\]/.test(s.title);
  const gapsNone: string[] = [];
  const gapsNoPr: string[] = [];
  const gapsNoTc: string[] = [];
  const storyOnly: string[] = [];

  const rows = stories.map((s) => {
    const ts = byStory.get(s.key) ?? [];
    const automated = new Set<number>();
    for (const t of ts) for (const tag of t.tags) if (tag.story === s.key) tag.acs.forEach((a) => automated.add(a));
    const count = (level: FoundTest["level"]) => ts.filter((t) => t.level === level).length;
    const myPrs = prs.filter((p) => mentions(p.title, s.key) || mentions(p.branch, s.key));
    const tc = loadTestCases(s.key);
    const research = isResearch(s);

    // Each AC's coverage: Superseded (docs/CHANGES.md) > Automated (a tagged test) > Manual only (an Active or Updated case) > None.
    const coverage: Coverage[] = s.acs.map((_, i) => {
      const n = i + 1;
      if (superseded.has(`${s.key} AC${n}`)) return "Superseded";
      if (automated.has(n)) return "Automated";
      if (tc?.acs.has(n)) return "Manual only";
      return "None";
    });
    const none = coverage.map((c, i) => (c === "None" ? i + 1 : 0)).filter(Boolean);
    const coverageText = research
      ? "Setup / research"
      : coverage.map((c, i) => `AC${i + 1} ${SHORT[c]}`).join(", ");

    // Tests of the bugs linked to this story, by the [BUG-n] in their tags.
    const bugTests = new Map<string, number>();
    for (const t of ts) for (const tag of t.tags) if (tag.story === s.key) for (const b of tag.bugs) bugTests.set(b, (bugTests.get(b) ?? 0) + 1);
    const bugs = [...new Set([...s.bugs, ...bugTests.keys()])].sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));

    const gaps: string[] = [];
    if (relevant(s) && !research) {
      if (none.length) {
        gaps.push(`no coverage: ${none.map((n) => `AC${n}`).join(", ")}`);
        gapsNone.push(`${s.key} ${s.title} (${s.status}): ${none.map((n) => `AC${n}`).join(", ")}`);
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
      if (own.length && own.every((tag) => !tag.acs.length)) storyOnly.push(`${s.key}\t${t.file}:${t.line}\t${t.name.replace(/\[SPM-\d+\](\[(AC\d+|BUG-\d+)\])*\s*/g, "")}`);
    }

    return {
      story: s,
      research,
      unit: count("unit"),
      route: count("route"),
      integration: count("integration"),
      e2e: count("e2e"),
      coveredText: research || !s.acs.length ? "" : `${s.acs.length - coverage.filter((c) => c !== "Automated").length}/${s.acs.length}`,
      coverageText,
      coverage,
      tc,
      prs: myPrs,
      design: designElement(s),
      bugs,
      bugTests,
      gaps,
    };
  });

  const unitText = (r: (typeof rows)[number]) =>
    r.research ? (r.unit + r.route ? `${r.unit + r.route} setup / research` : "") : `${r.unit} unit, ${r.route} route`;
  const bugText = (r: (typeof rows)[number], link: (k: string) => string) =>
    r.bugs.map((b) => (r.bugTests.get(b) ? `${link(b)} (${r.bugTests.get(b)} tests)` : link(b))).join(", ");
  // No GitHub review: say who merged it, which shows whether a second person was involved.
  const reviewerText = (p: PullRequest) =>
    p.reviewers !== "" ? p.reviewers : p.mergedBy === p.author ? `none recorded (merged by its author, ${p.author})` : `none recorded (merged by ${p.mergedBy})`;
  const humanReview = (p: PullRequest) => p.reviewers.split(", ").some((r) => r && !r.endsWith("(bot)"));
  // Review evidence: an override in review-evidence.csv, else a GitHub review by someone else,
  // else who merged it when that was not the author, else none recorded.
  const evidence = (p: PullRequest, link: (url: string, text: string) => string): string => {
    const o = overrides.get(p.number);
    if (o) return [o.link ? link(o.link, "Recorded review") : "Recorded review", o.note].filter(Boolean).join(": ");
    if (source !== "gh") return "n/a (no gh)";
    if (humanReview(p)) return "GitHub review";
    if (p.mergedBy && p.mergedBy !== p.author) return `Merged by ${p.mergedBy}`;
    return "none recorded";
  };

  // ---- CSV
  const csvCell = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Story", "Title", "Epic", "Source", "Sprint", "Points", "Estimate rationale", "# ACs", "ACs with automated coverage", "AC coverage type",
    "TC file", "Active TCs", "Retired TCs", "Latest manual result + date", "Unit", "Integration", "E2E", "Design element",
    "PR(s)", "Reviewer", "Review evidence", "CI run", "Linked bugs", "Status", "Gaps",
  ];
  const csv = [header.join(",")];
  for (const r of rows) {
    const s = r.story;
    csv.push(
      [
        s.key, s.title, s.epic, s.source, s.sprints.join(" > ") || "Backlog", s.points ?? "", s.estimate, s.acs.length, r.coveredText,
        r.research ? "Setup / research" : r.coverage.map((c, i) => `AC${i + 1} ${c}`).join("; "),
        r.tc?.file ?? "", r.tc?.active ?? "", r.tc?.retired ?? "", r.tc?.latest ?? "",
        unitText(r), r.integration, r.e2e, r.design,
        r.prs.map((p) => `#${p.number} (${p.merged})`).join("; "), r.prs.map(reviewerText).join("; "), r.prs.map((p) => `#${p.number}: ${evidence(p, (u, t) => `${t} ${u}`)}`).join("; "), r.prs.map((p) => p.ci).join("; "),
        bugText(r, (k) => k), s.status, r.gaps.join("; "),
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
    "Column notes:",
    "",
    "- **AC coverage type**, per AC: **A** Automated (a test is tagged with it), **M** Manual only (an Active or Updated test case links it, no automated test), " +
      "**S** Superseded (replaced by a change; see [CHANGES.md](../CHANGES.md#superseded-acceptance-criteria)), **N** None. Only None is a gap.",
    "- **Unit** counts unit tests and mocked-route tests (`src/app/api/__tests__`) separately. For the Sprint 1 research and design stories it reads " +
      "**setup / research**: those tests check shared setup (formatting, components, the database client), not a feature.",
    "- **Latest manual result** is the newest execution block of each Active test case, counted by result, with the newest date. Retired test cases are listed in " +
      "[DECOMMISSIONED.md](../test-cases/DECOMMISSIONED.md).",
    "- **Reviewer** is who submitted a GitHub review of the PR, other than its author; \"none recorded\" means nobody did, and says who merged it. **Linked bugs** are the Jira bugs linked to the story, " +
      "and the tests tagged `[BUG-n]` under it.",
    "- **Review evidence**, per PR: a link from [review-evidence.csv](review-evidence.csv) (for a review held outside GitHub, e.g. a recording), " +
      "else **GitHub review** (someone other than the author submitted one), else **Merged by <name>** (someone other than the author merged it), else **none recorded**.",
    "- Gaps are only checked for stories that are Done or in the active sprint.",
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
          esc(short(s.estimate, 160)), String(s.acs.length), r.coveredText, r.coverageText,
          tcLink, r.tc ? String(r.tc.active) : "", retired, r.tc?.latest ?? "",
          unitText(r), String(r.integration), String(r.e2e), esc(r.design),
          r.prs.map((p) => (repoUrl ? `[#${p.number}](${repoUrl}/pull/${p.number})` : `#${p.number}`) + ` ${p.merged}`).join("<br>"),
          r.prs.map((p) => esc(reviewerText(p))).join("<br>"),
          r.prs.map((p) => evidence(p, (u, t) => `[${t}](${u})`).replace(/\|/g, "\\|")).join("<br>"),
          r.prs.map((p) => (p.ci ? `[run](${p.ci})` : "")).join("<br>"),
          bugText(r, jiraLink), s.status, esc(r.gaps.join("; ")),
        ].join(" | ") +
        " |"
    );
  }
  const list = (title: string, items: string[], intro?: string) => {
    md.push("", `## ${title}`, "");
    if (intro) md.push(intro, "");
    md.push(...(items.length ? items.map((i) => `- ${i}`) : ["- none"]));
  };
  list("ACs with no coverage", gapsNone, "Current ACs with no automated test, no Active or Updated test case, and not superseded by a change.");
  list("Stories with no PR", gapsNoPr);
  list("Stories with no TC file", gapsNoTc);

  const codeTypes: PrType[] = ["Story", "Bug", "Test", "Setup"];
  const unreviewed = prs.filter((p) => source === "gh" && codeTypes.includes(prType.get(p.number)!.type) && prType.get(p.number)!.code && !humanReview(p) && !overrides.has(p.number));
  md.push("", "## Code or test PRs with no GitHub review", "");
  md.push(
    source === "gh"
      ? "Merged PRs of type Story, Bug, Test or Setup that change app code or tests, with no GitHub review by anyone but the author and no entry in " +
          `[review-evidence.csv](review-evidence.csv). ${unreviewed.length} PRs; ${unreviewed.filter((p) => p.mergedBy === p.author).length} were merged by their author.`
      : "Needs gh: without it, reviews are not read.",
    ""
  );
  if (unreviewed.length) {
    md.push("| PR | Title | Type | Author | Merged by | Merged | Review evidence |", "|---|---|---|---|---|---|---|");
    for (const p of unreviewed)
      md.push(`| [#${p.number}](${repoUrl}/pull/${p.number}) | ${esc(p.title)} | ${prType.get(p.number)!.type} | ${p.author} | ${p.mergedBy === p.author ? `**${p.mergedBy}** (author)` : p.mergedBy} | ${p.merged} | ${evidence(p, (u, t) => `[${t}](${u})`)} |`);
  }

  md.push("", "## Pull requests by type", "");
  md.push(
    "Every merged PR. **Story** or **Bug**: its title or branch names an SPM story or bug. Otherwise by what it changed: **Docs** only docs " +
      "(`.md`, `.xlsx`, `.docx`, diagrams, `docs/`, `design/`); **Test** mostly tests; **Setup** other app code (`src/`, `prisma/`) with no story; " +
      "**Chore** tooling and config only. **Code** says whether it changed app code or tests.",
    ""
  );
  md.push("| PR | Title | Type | Code | Author | Merged by | Merged | Review evidence |", "|---|---|---|---|---|---|---|---|");
  for (const p of prs) {
    const t = prType.get(p.number)!;
    md.push(`| [#${p.number}](${repoUrl}/pull/${p.number}) | ${esc(p.title)} | ${t.type} | ${t.code ? "yes" : "no"} | ${p.author || "n/a"} | ${p.mergedBy || "n/a"} | ${p.merged} | ${evidence(p, (u, x) => `[${x}](${u})`)} |`);
  }

  md.push("", "## Code with no story", "");
  md.push(
    "Features in the code that no Jira story asks for. Their tests are tagged `[UNTRACED]`. Nothing here is deleted: each needs a decision to remove it " +
      "or to back it with a story.",
    ""
  );
  const untraced = tests.filter((t) => t.untraced);
  for (const f of UNTRACED_FEATURES) {
    const mine = untraced.filter((t) => f.tests.test(t.file) && !(f.name.startsWith("Self") && /api\/__tests__\/equipment/.test(t.file)));
    md.push(`### ${f.name}`, "", f.why, "", "Files:", "", ...f.files.map((x) => `- \`${x}\``), "", `Tests (${mine.length}):`, "");
    md.push(...mine.map((t) => `- \`${t.file}:${t.line}\` ${esc(t.name.replace(/^\[UNTRACED\]\s*/, ""))}`), "");
  }
  const claimed = new Set(UNTRACED_FEATURES.flatMap((f) => untraced.filter((t) => f.tests.test(t.file))));
  const loose = untraced.filter((t) => !claimed.has(t));
  if (loose.length) md.push("### Other [UNTRACED] tests", "", ...loose.map((t) => `- \`${t.file}:${t.line}\` ${esc(t.name)}`), "");

  md.push("## Tests tagged with a story but no single AC", "");
  md.push(
    "These tests name the story they belong to but check something no one AC states (a load error, an empty state, a helper, a bug's fix). " +
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
