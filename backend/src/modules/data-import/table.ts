import { inflateRawSync } from "node:zlib";

import { badRequest } from "../../core/errors.js";
import { parseCsv } from "../../platform/transfer/csv.js";
import type { UploadedTable } from "./data-import.types.js";

/** Most bytes one uploaded file may have, and most it may unpack to. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

/**
 * Reads an uploaded CSV or Excel workbook (.xlsx) into rows of text: the
 * first non-blank row is the headings. A workbook's first sheet is read;
 * dates become `YYYY-MM-DD` (and `HH:MM:SS` when they have a time), which is
 * what iTop takes. No library: an .xlsx is a zip of XML.
 */
export function readTable(fileName: string, content: Buffer): UploadedTable {
  if (content.length === 0) throw badRequest("The file is empty.");
  if (content.length > MAX_UPLOAD_BYTES) {
    throw badRequest(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  const isZip = content[0] === 0x50 && content[1] === 0x4b;
  if (/\.xls$/i.test(fileName) && !isZip) {
    throw badRequest("Old .xls workbooks are not read; save it as .xlsx or CSV.");
  }
  const { sheet, rows } = isZip ? readXlsx(content) : { sheet: undefined, rows: readCsvText(content) };
  const firstUsed = rows.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (firstUsed < 0) throw badRequest("The file has no rows.");
  const [header = [], ...body] = rows.slice(firstUsed);
  const width = header.length;
  return {
    fileName,
    ...(sheet ? { sheet } : {}),
    headings: header.map((h) => h.trim()),
    rows: body
      .filter((r) => r.some((c) => c.trim() !== ""))
      .map((r) => Array.from({ length: Math.max(width, r.length) }, (_, i) => r[i] ?? "").slice(0, width)),
  };
}

/** CSV in UTF-8 (a BOM is dropped); the separator is guessed from the header line. */
function readCsvText(content: Buffer): string[][] {
  const text = content.toString("utf8").replace(/^﻿/, "");
  return parseCsv(text, guessSeparator(text), '"');
}

/** Comma, semicolon or tab: whichever the first line holds most of, outside quotes. */
export function guessSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const unquoted = firstLine.replace(/"[^"]*"/g, "");
  const counts = [",", ";", "\t"].map((s) => ({ s, n: unquoted.split(s).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.s : ",";
}

// ---------------------------------------------------------------------------
// .xlsx
// ---------------------------------------------------------------------------

/** The entries of a zip archive, by name, unpacked on demand. */
function unzip(buf: Buffer): Map<string, () => Buffer> {
  // End of central directory: the last "PK\x05\x06" (a comment may follow it).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw badRequest("The file is not a readable .xlsx workbook.");
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, () => Buffer>();
  let unpacked = 0;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const fullSize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    entries.set(name, () => {
      if (local + 30 > buf.length) throw badRequest("The workbook is damaged.");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      unpacked += fullSize;
      if (unpacked > MAX_UNPACKED_BYTES) throw badRequest("The workbook unpacks to too much data.");
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_UNPACKED_BYTES });
      throw badRequest("The workbook uses a compression this reader does not support.");
    });
  }
  return entries;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function xmlText(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/** Excel's built-in date formats (ECMA-376 18.8.30). */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Style index -> true when the cell shows a date. */
function dateStyles(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) {
    custom.set(Number(attr(m[0], "numFmtId")), xmlText(attr(m[0], "formatCode") ?? ""));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (DATE_FORMAT_IDS.has(id)) return true;
    const code = custom.get(id);
    // A date/time format has d, m, y, h or s outside quoted text and [colour].
    return code !== undefined && /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, ""));
  });
}

/** An Excel serial date as iTop's text: days since 1899-12-30. */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return time === "00:00:00" ? date : `${date} ${time}`;
}

/** "AB12" -> 27 (zero-based column). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf: Buffer): { sheet: string; rows: string[][] } {
  const zip = unzip(buf);
  const read = (name: string) => zip.get(name)?.().toString("utf8");

  const workbook = read("xl/workbook.xml");
  if (!workbook) throw badRequest("The file is not a readable .xlsx workbook.");
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  if (!firstSheet) throw badRequest("The workbook has no sheets.");
  const sheetName = xmlText(attr(firstSheet, "name") ?? "Sheet1");
  const relId = attr(firstSheet, "r:id");
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  let target = "worksheets/sheet1.xml";
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attr(m[0], "Id") === relId) target = attr(m[0], "Target") ?? target;
  }
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheetXml = read(sheetPath);
  if (!sheetXml) throw badRequest(`The workbook's sheet "${sheetName}" could not be read.`);

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]!)).join(""),
  );
  const isDate = dateStyles(read("xl/styles.xml"));

  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const index = Number(attr(rowMatch[1] ?? rowMatch[3] ?? "", "r") ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = c[1] ?? "";
      const inner = c[2] ?? "";
      const col = columnIndex(attr(head, "r") ?? "");
      const type = attr(head, "t");
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]!)).join("");
      else if (type === "b") value = v === "1" ? "1" : "0";
      else if (type === "str" || type === "e") value = xmlText(v ?? "");
      else if (v !== undefined) {
        const style = Number(attr(head, "s") ?? 0);
        const n = Number(v);
        value = isDate[style] && Number.isFinite(n) ? excelDate(n) : v;
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  return { sheet: sheetName, rows };
}
