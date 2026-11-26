import { stripAnsi } from "@/lib/ansi";
import { zip } from "./zip";

/**
 * A table of values written as a CSV file or as an XLSX workbook, in the browser.
 *
 * Cells hold the values as the API gave them — a status code, a size in bytes, a
 * date as the collector writes it — not the way the interface shows them: an
 * export is made to be sorted, filtered and computed on elsewhere.
 */
export interface ExportTable {
  headers: string[];
  rows: unknown[][];
}

export type ExportFormat = "csv" | "xlsx";

/**
 * A cell as text; an object, which a few props hold, as JSON. The terminal escapes of
 * the agent outputs are dropped: a spreadsheet would show them as noise.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return stripAnsi(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return JSON.stringify(value);
}

/**
 * A text a spreadsheet would run as a formula when opening a CSV file is given a
 * leading apostrophe: the collector stores names and descriptions typed by anyone.
 * A negative number is left alone.
 */
function defused(text: string): string {
  if (/^[=+@\t\r]/.test(text)) return `'${text}`;
  if (text.startsWith("-") && !/^-\d+([.,]\d+)?$/.test(text)) return `'${text}`;
  return text;
}

function csvField(value: unknown): string {
  const text = typeof value === "string" ? defused(cellText(value)) : cellText(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The table as CSV (RFC 4180): comma-separated, CRLF line ends, UTF-8 with a byte
 * order mark so that Excel reads the accents.
 */
export function toCsv(table: ExportTable): Blob {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvField).join(","));
  return new Blob(["﻿", lines.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" });
}

function xmlText(text: string): string {
  return (
    text
      // Characters XML 1.0 does not allow, which a log line may carry.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  );
}

/** A1, B1… AA1: the reference of a cell. */
function cellRef(column: number, row: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${String(row)}`;
}

/** Excel refuses a longer text in a cell. */
const CELL_MAX = 32767;

function xlsxCell(value: unknown, column: number, row: number, style: number): string {
  const ref = cellRef(column, row);
  const s = style === 0 ? "" : ` s="${String(style)}"`;
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value))
    return `<c r="${ref}"${s}><v>${String(value)}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? "1" : "0"}</v></c>`;
  const text = xmlText(cellText(value).slice(0, CELL_MAX));
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * The table as an XLSX workbook of one sheet: a bold header row that stays in view
 * and carries the filter buttons, numbers as numbers, everything else as text.
 * Written by hand — a workbook is a few XML files in a ZIP — rather than with a
 * library weighing more than the rest of the interface.
 */
export async function toXlsx(table: ExportTable, sheetName: string): Promise<Blob> {
  const rows = [
    `<row r="1">${table.headers.map((header, column) => xlsxCell(header, column, 1, 1)).join("")}</row>`,
    ...table.rows.map(
      (row, index) =>
        `<row r="${String(index + 2)}">${row.map((value, column) => xlsxCell(value, column, index + 2, 0)).join("")}</row>`,
    ),
  ];
  const last = cellRef(Math.max(table.headers.length - 1, 0), table.rows.length + 1);
  const sheet =
    `${XML}<worksheet xmlns="${MAIN}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `</worksheet>`;
  // A sheet name holds 31 characters at most, and none of these.
  const name = xmlText(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1").replaceAll(
    '"',
    "&quot;",
  );
  const files: Record<string, string> = {
    "[Content_Types].xml":
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `${XML}<Relationships xmlns="${RELS}">` +
      `<Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${OFFICE}">` +
      `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      `${XML}<Relationships xmlns="${RELS}">` +
      `<Relationship Id="rId1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${OFFICE}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    // Two cell formats: the default one, and the bold of the header row.
    "xl/styles.xml":
      `${XML}<styleSheet xmlns="${MAIN}">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`,
    "xl/worksheets/sheet1.xml": sheet,
  };
  const encoder = new TextEncoder();
  const archive = await zip(
    Object.entries(files).map(([name, content]) => ({ name, data: encoder.encode(content) })),
  );
  return new Blob([archive], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Hands a file to the browser, as a download. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Once the download has started: the URL holds the whole file in memory. A
  // browser may read it once the user confirmed the download, after the click.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30000);
}
