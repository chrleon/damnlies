/**
 * JSON-stat2 Parser
 *
 * Converts the multidimensional JSON-stat2 format returned by SSB
 * into flat, readable table rows that are easy for LLMs to process.
 */

import type { JsonStat2Response } from "./ssb-client.js";

export interface DataRow {
  [key: string]: string | number | null;
}

export interface ParsedTable {
  /** Human-readable title of the dataset */
  label: string;
  /** Data source */
  source: string;
  /** Last updated timestamp */
  updated: string;
  /** Column names in order */
  columns: string[];
  /** Row data as array of objects */
  rows: DataRow[];
  /** Total number of rows (before truncation) */
  totalRows: number;
  /** Whether rows were truncated */
  truncated: boolean;
}

/**
 * Parse a JSON-stat2 response into a flat table.
 *
 * The JSON-stat2 format stores values in a flat array where the position
 * encodes the combination of dimension categories. We unflatten this by
 * computing the cartesian product of all dimension categories.
 */
export function parseJsonStat2(
  data: JsonStat2Response,
  maxRows: number = 50,
): ParsedTable {
  const dimensionIds = data.id;
  const sizes = data.size;
  const totalRows = data.value.length;

  // Build ordered category labels for each dimension
  const dimensions: {
    id: string;
    label: string;
    categories: { code: string; label: string }[];
  }[] = [];

  for (const dimId of dimensionIds) {
    const dim = data.dimension[dimId];
    const catIndex = dim.category.index;
    const catLabel = dim.category.label;

    // index can be either an object { code: position } or an array of codes
    let orderedCodes: string[];
    if (Array.isArray(catIndex)) {
      orderedCodes = catIndex;
    } else {
      orderedCodes = Object.entries(catIndex)
        .sort(([, a], [, b]) => a - b)
        .map(([code]) => code);
    }

    dimensions.push({
      id: dimId,
      label: dim.label,
      categories: orderedCodes.map((code) => ({
        code,
        label: catLabel[code] || code,
      })),
    });
  }

  // Column names: dimension labels + "value"
  const columns = [...dimensions.map((d) => d.label), "Verdi"];

  // Compute strides for index calculation
  // For dimensions [A, B, C] with sizes [sA, sB, sC]:
  // stride[0] = sB * sC, stride[1] = sC, stride[2] = 1
  const strides: number[] = new Array(sizes.length);
  strides[sizes.length - 1] = 1;
  for (let i = sizes.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * sizes[i + 1];
  }

  // Generate rows by iterating through the flat value array
  const rows: DataRow[] = [];
  const limit = Math.min(totalRows, maxRows);

  for (let flatIdx = 0; flatIdx < limit; flatIdx++) {
    const row: DataRow = {};

    // Decode the flat index into dimension category indices
    let remaining = flatIdx;
    for (let d = 0; d < dimensions.length; d++) {
      const catIdx = Math.floor(remaining / strides[d]);
      remaining = remaining % strides[d];
      const dim = dimensions[d];
      row[dim.label] = dim.categories[catIdx]?.label ?? `Unknown(${catIdx})`;
    }

    row["Verdi"] = data.value[flatIdx];
    rows.push(row);
  }

  return {
    label: data.label,
    source: data.source,
    updated: data.updated,
    columns,
    rows,
    totalRows,
    truncated: totalRows > maxRows,
  };
}

/**
 * Format a parsed table into a readable text representation.
 */
export function formatTable(parsed: ParsedTable): string {
  const lines: string[] = [];

  lines.push(`📊 ${parsed.label}`);
  lines.push(`Kilde: ${parsed.source}`);
  lines.push(`Oppdatert: ${parsed.updated}`);
  lines.push("");

  if (parsed.rows.length === 0) {
    lines.push("Ingen data funnet.");
    return lines.join("\n");
  }

  // Build a markdown-style table
  const headers = parsed.columns;
  const headerLine = "| " + headers.join(" | ") + " |";
  const separatorLine = "| " + headers.map(() => "---").join(" | ") + " |";

  lines.push(headerLine);
  lines.push(separatorLine);

  for (const row of parsed.rows) {
    const cells = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "-";
      if (typeof val === "number") return formatNumber(val);
      return String(val);
    });
    lines.push("| " + cells.join(" | ") + " |");
  }

  if (parsed.truncated) {
    lines.push("");
    lines.push(
      `⚠️ Viser ${parsed.rows.length} av ${parsed.totalRows} rader. Bruk filtre for å begrense resultatet.`,
    );
  }

  return lines.join("\n");
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) {
    return n.toLocaleString("nb-NO");
  }
  return n.toLocaleString("nb-NO", { maximumFractionDigits: 2 });
}