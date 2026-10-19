/**
 * Finds every automated test and reads its traceability tag: the story and
 * acceptance criteria it checks, written at the start of its name.
 *
 *   it("[SPM-43][AC3] approving a request books the room", ...)
 *   it("[SPM-43][AC3][AC7] ...")                   several ACs
 *   it("[SPM-43][AC3] [SPM-44][AC6] ...")          several stories
 *   it("[SPM-43] ...")                             story only: no single AC fits
 *
 * A test also takes the tags of the describe blocks around it, so a tag on a
 * describe covers every test inside it.
 *
 * Used by `npm run trace` (scripts/trace.ts) and the CI "Traceability" job
 * (scripts/check-test-tags.ts). Parses with the TypeScript compiler rather
 * than a regex, so template-literal names, it.each and test.describe are read
 * exactly as Vitest and Playwright read them.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type TestLevel = "unit" | "route" | "integration" | "e2e";

export interface StoryTag {
  story: string;
  acs: number[];
}

export interface FoundTest {
  file: string;
  line: number;
  level: TestLevel;
  /** The test's own name, as written (template literals keep their ${...}). */
  name: string;
  describePath: string[];
  /** Tags on the test's own name. */
  ownTags: StoryTag[];
  /** Own tags plus those of every enclosing describe. */
  tags: StoryTag[];
  /** Offset of the first character inside the name's quotes. */
  nameStart: number;
}

/** Folders that hold tests, relative to the repo root. tests/archive/ is never read. */
export const TEST_ROOTS = ["src", "integration", "e2e"];
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const TAG = /\[(SPM-\d+)\]((?:\[AC\d+\])*)/g;

export function levelOf(file: string): TestLevel {
  const f = file.replace(/\\/g, "/");
  if (f.startsWith("integration/")) return "integration";
  if (f.startsWith("e2e/")) return "e2e";
  if (f.startsWith("src/app/api/")) return "route";
  return "unit";
}

export function parseTags(text: string): StoryTag[] {
  const tags: StoryTag[] = [];
  for (const m of text.matchAll(TAG)) {
    const acs = [...m[2].matchAll(/\[AC(\d+)\]/g)].map((a) => Number(a[1]));
    tags.push({ story: m[1], acs });
  }
  return tags;
}

export function findTestFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || rel.startsWith("tests/archive")) continue;
        walk(rel);
      } else if (TEST_FILE.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  for (const root of TEST_ROOTS) walk(root);
  return out.sort();
}

const TEST_FNS = new Set(["it", "test"]);
const SUITE_FNS = new Set(["describe"]);
// it.skip, it.only, it.each(...), test.describe, test.describe.serial, ...
const MODIFIERS = new Set(["skip", "only", "todo", "concurrent", "sequential", "fails", "serial", "parallel", "fixme", "each", "for", "runIf", "skipIf"]);

/** "it" / "test" / "describe" for a call that defines one, else null. */
function callKind(callee: ts.Expression): "test" | "suite" | null {
  // it.each([...])("name", ...) - the callee is itself a call.
  if (ts.isCallExpression(callee)) return callKind(callee.expression);
  if (ts.isIdentifier(callee)) {
    if (TEST_FNS.has(callee.text)) return "test";
    if (SUITE_FNS.has(callee.text)) return "suite";
    return null;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const prop = callee.name.text;
    if (prop === "describe") return "suite"; // test.describe(...)
    if (MODIFIERS.has(prop)) return callKind(callee.expression);
  }
  return null;
}

function nameOf(arg: ts.Expression | undefined, source: ts.SourceFile): { name: string; start: number } | null {
  if (!arg) return null;
  if (ts.isParenthesizedExpression(arg)) return nameOf(arg.expression, source);
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg)) {
    const text = arg.getText(source);
    return { name: text.slice(1, -1), start: arg.getStart(source) + 1 };
  }
  // A long name split over lines: "first part " + "second part". The tag
  // goes in the first part.
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = nameOf(arg.left, source);
    const right = nameOf(arg.right, source);
    if (left && right) return { name: left.name + right.name, start: left.start };
  }
  return null;
}

export function parseTestFile(repoRoot: string, file: string): { tests: FoundTest[]; unnamed: { line: number }[] } {
  const text = readFileSync(path.join(repoRoot, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const tests: FoundTest[] = [];
  const unnamed: { line: number }[] = [];
  const level = levelOf(file);

  const visit = (node: ts.Node, suites: { name: string; tags: StoryTag[] }[]) => {
    if (ts.isCallExpression(node)) {
      const kind = callKind(node.expression);
      if (kind) {
        const named = nameOf(node.arguments[0], source);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (kind === "suite") {
          const inner = [...suites, { name: named?.name ?? "", tags: named ? parseTags(named.name) : [] }];
          node.arguments.forEach((a) => visit(a, inner));
          return;
        }
        if (!named) {
          unnamed.push({ line });
        } else {
          const ownTags = parseTags(named.name);
          tests.push({
            file,
            line,
            level,
            name: named.name,
            describePath: suites.map((s) => s.name),
            ownTags,
            tags: [...suites.flatMap((s) => s.tags), ...ownTags],
            nameStart: named.start,
          });
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, suites));
  };
  visit(source, []);
  return { tests, unnamed };
}

export function findTests(repoRoot: string): { tests: FoundTest[]; unnamed: { file: string; line: number }[] } {
  const tests: FoundTest[] = [];
  const unnamed: { file: string; line: number }[] = [];
  for (const file of findTestFiles(repoRoot)) {
    const parsed = parseTestFile(repoRoot, file);
    tests.push(...parsed.tests);
    unnamed.push(...parsed.unnamed.map((u) => ({ file, line: u.line })));
  }
  return { tests, unnamed };
}
