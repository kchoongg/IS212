/**
 * Reads the cell values of an .xlsx workbook - just enough for `npm run trace`
 * to read the test case workbooks in docs/test-cases/. No formatting, no
 * formulas (a formula cell gives its cached value), no writing.
 *
 * An .xlsx file is a zip of XML files. This reads the zip's central directory,
 * inflates the parts it needs with Node's zlib, and pulls the cells out of the
 * sheet XML, so the script needs no dependency outside Node.
 */

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export type CellValue = string | number;
/** sheet name -> "A1"-style address -> value */
export type Workbook = { sheets: string[]; cells: Map<string, Map<string, CellValue>> };

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
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
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** The text of every <t> inside a fragment (rich text has several). */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join("");

export function readWorkbook(path: string): Workbook {
  const files = unzip(readFileSync(path));
  const xml = (name: string) => files.get(name)?.toString("utf8") ?? "";

  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rels = new Map<string, string>();
  for (const m of xml("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, ""));
  }

  const sheets: string[] = [];
  const cells = new Map<string, Map<string, CellValue>>();
  for (const m of xml("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(/name="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const sheetXml = xml(`xl/${rels.get(rid)}`);
    const values = new Map<string, CellValue>();
    for (const c of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue | undefined;
      if (type === "s" && v !== undefined) value = shared[Number(v)];
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = v !== undefined ? unescape(v) : undefined;
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = Number(v);
      if (value !== undefined && String(value).trim() !== "") values.set(ref, value);
    }
    sheets.push(name);
    cells.set(name, values);
  }
  return { sheets, cells };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A date cell as YYYY-MM-DD, so dates compare correctly as strings. Reads an
 * Excel date serial (days since 1899-12-30), YYYY-MM-DD, D/M/YYYY (day first,
 * as Singapore writes it; also with - or .) and "3 Oct 2026". Anything else
 * gives "", so a date typed some other way is never compared as text.
 */
export function asDate(value: CellValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  const text = value.trim();
  const ymd = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    // Refuse 31/2/2026 and the like rather than rolling it into March.
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "";
    return date.toISOString().slice(0, 10);
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(text);
  if (m && MONTHS.includes(m[2].toLowerCase())) return ymd(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
  return "";
}

/** The highest row number with a value in the sheet. */
export function lastRow(sheet: Map<string, CellValue>): number {
  let max = 0;
  for (const ref of sheet.keys()) max = Math.max(max, Number(/\d+$/.exec(ref)?.[0]));
  return max;
}
