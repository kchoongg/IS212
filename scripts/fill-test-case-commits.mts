/**
 * Fills the Commit row of new execution blocks in the test case workbooks with
 * `git rev-parse --short HEAD`, so a tester does not have to type it.
 *
 * It runs by itself: the pre-commit hook (.githooks/pre-commit) calls it with
 * --staged whenever a commit includes a workbook, and adds the filled-in file
 * to that commit. To run it by hand:
 *
 *   npm run test-cases:commit                 every workbook changed since the last commit
 *   npm run test-cases:commit -- SPM-35       one story's workbook
 *
 * A Commit cell is filled only when it is blank and its block's result is new
 * since the last commit - the block, or its result, is not in HEAD's copy of
 * the workbook. So a block already committed is never touched, and the hash is
 * the build that was checked out while the results were typed in.
 *
 * Only the Commit cells change: the sheet XML is edited in place and every
 * other part of the .xlsx is copied byte for byte, so formatting is kept.
 * Runs with plain `node` (Node 24 strips the types).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { lastRow, readWorkbook, type Workbook } from "./lib/xlsx.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const lines = (out: string) => out.split("\n").filter(Boolean);
const isWorkbook = (f: string) => /^docs\/test-cases\/SPM-\d+_Test_Cases\.xlsx$/.test(f);

const args = process.argv.slice(2);
const staged = args.includes("--staged");
const names = args.filter((a) => !a.startsWith("--"));

// A merge commit brings in other people's blocks, run on other builds.
let merging = true;
try {
  git("rev-parse", "-q", "--verify", "MERGE_HEAD");
} catch {
  merging = false;
}
if (merging) process.exit(0);

/** Repo-relative paths, with forward slashes. */
const files = staged
  ? lines(git("diff", "--cached", "--name-only", "--diff-filter=AM")).filter(isWorkbook)
  : names.length
    ? names.map((a) =>
        /\.xlsx$/i.test(a) ? path.relative(ROOT, path.resolve(a)).replace(/\/g, "/") : `docs/test-cases/${a.toUpperCase()}_Test_Cases.xlsx`,
      )
    : [...lines(git("diff", "--name-only", "HEAD", "--", "docs/test-cases")), ...lines(git("ls-files", "--others", "--exclude-standard", "--", "docs/test-cases"))].filter(isWorkbook);
if (!files.length) process.exit(0);

const commit = git("rev-parse", "--short", "HEAD");
// Uncommitted app changes mean the hash does not fully describe what was tested.
const dirty = lines(git("status", "--porcelain", "--", "src", "prisma"));
if (dirty.length) {
  console.warn(`Warning: ${dirty.length} uncommitted change(s) under src/ or prisma/, so ${commit} is not exactly the build you tested. Say so in Remarks.`);
}

// ---------------------------------------------------------------- zip

type Entry = { name: string; method: number; time: number; date: number; crc: number; data: Buffer; size: number };

function readZip(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const compressed = buf.readUInt32LE(p + 20);
    entries.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      time: buf.readUInt16LE(p + 12),
      date: buf.readUInt16LE(p + 14),
      crc: buf.readUInt32LE(p + 16),
      data: Buffer.from(buf.subarray(dataStart, dataStart + compressed)),
      size: buf.readUInt32LE(p + 24),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

const contents = (e: Entry) => (e.method === 8 ? inflateRawSync(e.data) : e.data);

function replaceContents(e: Entry, text: string) {
  const raw = Buffer.from(text, "utf8");
  e.method = 8;
  e.data = deflateRawSync(raw);
  e.crc = crc32(raw);
  e.size = raw.length;
}

function writeZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const header = (central: boolean) => {
      const h = Buffer.alloc(central ? 46 : 30);
      let i = 0;
      h.writeUInt32LE(central ? 0x02014b50 : 0x04034b50, i);
      i += 4;
      if (central) {
        h.writeUInt16LE(20, i); // version made by
        i += 2;
      }
      h.writeUInt16LE(20, i); // version needed
      h.writeUInt16LE(0x0800, i + 2); // flags: UTF-8 names, sizes in the header
      h.writeUInt16LE(e.method, i + 4);
      h.writeUInt16LE(e.time, i + 6);
      h.writeUInt16LE(e.date, i + 8);
      h.writeUInt32LE(e.crc, i + 10);
      h.writeUInt32LE(e.data.length, i + 14);
      h.writeUInt32LE(e.size, i + 18);
      h.writeUInt16LE(name.length, i + 22);
      if (central) h.writeUInt32LE(offset, 42); // extra, comment, disk, attributes stay 0
      return h;
    };
    centrals.push(header(true), name);
    const local = header(false);
    locals.push(local, name, e.data);
    offset += local.length + name.length + e.data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

// ---------------------------------------------------------------- sheets

/** Sheet name -> its part in the zip, e.g. "xl/worksheets/sheet3.xml". */
function sheetParts(entries: Entry[]): Map<string, string> {
  const xml = (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? contents(e).toString("utf8") : "";
  };
  const rels = new Map<string, string>();
  for (const m of xml("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const parts = new Map<string, string>();
  for (const m of xml("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1] ?? "";
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const part = rels.get(rid);
    // Names are compared as readWorkbook returns them (unescaped).
    if (part) parts.set(name.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"), part);
  }
  return parts;
}

/** Sets cell `ref` (in row `row`) to an inline string, keeping its style. */
function setCell(sheetXml: string, row: number, ref: string, text: string): string {
  const value = `<is><t>${text}</t></is>`;
  const rowRe = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*>[\\s\\S]*?</row>`);
  const rowXml = rowRe.exec(sheetXml)?.[0];
  if (!rowXml) throw new Error(`row ${row} not found`);
  const cellRe = new RegExp(`<c\\b([^>]*?\\br="${ref}"[^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  let next: string;
  if (cellRe.test(rowXml)) {
    next = rowXml.replace(cellRe, (_, attrs: string) => `<c${attrs.replace(/\s+t="[^"]*"/, "")} t="inlineStr">${value}</c>`);
  } else {
    // No B cell yet: put it straight after the A cell (the row's label).
    const a = new RegExp(`<c\\b[^>]*?\\br="A${row}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(rowXml);
    if (!a) throw new Error(`row ${row} has no label cell`);
    const at = a.index + a[0].length;
    next = `${rowXml.slice(0, at)}<c r="${ref}" t="inlineStr">${value}</c>${rowXml.slice(at)}`;
  }
  return sheetXml.replace(rowXml, next);
}

// ---------------------------------------------------------------- main

type Block = { key: string; sheet: string; result: string; commitRow: number; commitBlank: boolean };

/** Every execution block: one per "Pass/Fail/..." row, numbered within its sheet. */
function blocks(wb: Workbook): Block[] {
  const out: Block[] = [];
  for (const [sheet, cells] of wb.cells) {
    let current: Block | null = null;
    let n = 0;
    for (let row = 1; row <= lastRow(cells) + 1; row++) {
      const label = String(cells.get(`A${row}`) ?? "").trim();
      const value = String(cells.get(`B${row}`) ?? "").trim();
      if (/^Pass\/Fail/i.test(label)) {
        current = { key: `${sheet}#${++n}`, sheet, result: value, commitRow: 0, commitBlank: false };
        out.push(current);
      }
      if (current && /^Commit$/i.test(label)) {
        current.commitRow = row;
        current.commitBlank = value === "";
      }
    }
  }
  return out;
}

/** Keys of the blocks that already had a result in HEAD's copy of the workbook. */
function committedResults(rel: string): Set<string> {
  let buf: Buffer;
  try {
    buf = execFileSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return new Set(); // a new workbook: every block is new
  }
  return new Set(blocks(readWorkbook(buf)).filter((b) => b.result).map((b) => b.key));
}

for (const rel of files) {
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) {
    console.error(`${rel} does not exist.`);
    process.exitCode = 1;
    continue;
  }
  // The hook adds the file back to the commit, so it must not sweep in edits
  // that were left out of it on purpose.
  if (staged && lines(git("diff", "--name-only", "--", rel)).length) {
    console.log(`${rel} has changes that are not staged, so its Commit cells were left alone. Fill them with npm run test-cases:commit.`);
    continue;
  }
  const before = committedResults(rel);
  const todo = new Map<string, number[]>();
  for (const b of blocks(readWorkbook(file))) {
    if (b.result && b.commitRow && b.commitBlank && !before.has(b.key)) todo.set(b.sheet, [...(todo.get(b.sheet) ?? []), b.commitRow]);
  }
  if (!todo.size) continue;

  const entries = readZip(readFileSync(file));
  const parts = sheetParts(entries);
  const done: string[] = [];
  for (const [sheetName, rows] of todo) {
    const entry = entries.find((e) => e.name === parts.get(sheetName));
    if (!entry) throw new Error(`${rel}: no sheet part for "${sheetName}"`);
    let xml = contents(entry).toString("utf8");
    for (const row of rows) xml = setCell(xml, row, `B${row}`, commit);
    replaceContents(entry, xml);
    done.push(`${sheetName} (row ${rows.join(", ")})`);
  }
  try {
    writeFileSync(file, writeZip(entries));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM") {
      console.error(`${rel} is open in another program. Close it in Excel and run npm run test-cases:commit.`);
      process.exitCode = 1;
      continue;
    }
    throw err;
  }
  if (staged) git("add", "--", rel);
  console.log(`${rel}: Commit ${commit} written to ${done.join("; ")}`);
}
