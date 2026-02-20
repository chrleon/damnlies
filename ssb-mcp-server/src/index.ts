#!/usr/bin/env node

/**
 * SSB MCP Server
 *
 * Model Context Protocol server for Statistics Norway (SSB) API.
 * Provides tools to browse, search, inspect, and query Norwegian statistical data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SSBClient } from "./ssb-client.js";
import type {
  NavigationNode,
  TableNode,
  FolderNode,
  SearchResult,
  QueryFilter,
  TableVariable,
} from "./ssb-client.js";
import { parseJsonStat2, formatTable } from "./json-stat-parser.js";

const client = new SSBClient();

const server = new McpServer({
  name: "ssb-statistics",
  version: "1.0.0",
});

// ─── Tool: ssb_browse ────────────────────────────────────────────────────────

server.tool(
  "ssb_browse",
  "Browse the SSB (Statistics Norway) table hierarchy. Returns categories and tables. " +
    "Call with no path to see top-level subject areas. Provide path segments to drill deeper.",
  {
    path: z
      .array(z.string())
      .optional()
      .describe(
        'Path segments to browse, e.g. ["06"] for subject 06 (Næringsliv). Empty or omitted for root.',
      ),
    language: z
      .enum(["no", "en"])
      .optional()
      .describe('Language: "no" (Norwegian, default) or "en" (English)'),
  },
  async ({ path, language }) => {
    try {
      const lang = language ?? "no";
      const nodes = await client.browse(path ?? [], lang);

      const formatted = nodes
        .map((node: NavigationNode) => {
          if (node.type === "l") {
            const folder = node as FolderNode;
            return `📁 [${folder.id}] ${folder.text}`;
          } else {
            const table = node as TableNode;
            const vars = table.variables
              ? ` (${table.variables.join(", ")})`
              : "";
            const period =
              table.firstPeriod && table.lastPeriod
                ? ` | ${table.firstPeriod}–${table.lastPeriod}`
                : "";
            return `📊 [${table.id}] ${table.text}${period}${vars}\n   Oppdatert: ${table.updated}`;
          }
        })
        .join("\n\n");

      const pathStr =
        path && path.length > 0 ? path.join("/") : "(root)";
      return {
        content: [
          {
            type: "text" as const,
            text: `SSB tabell-hierarki: ${pathStr}\n${"─".repeat(50)}\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ─── Tool: ssb_search ────────────────────────────────────────────────────────

server.tool(
  "ssb_search",
  "Search for SSB tables by keywords. Returns matching tables with IDs that can be used with ssb_table_info and ssb_query.",
  {
    query: z
      .string()
      .describe(
        'Search query, e.g. "befolkning oslo" or "unemployment rate"',
      ),
    language: z
      .enum(["no", "en"])
      .optional()
      .describe('Language: "no" (Norwegian, default) or "en" (English)'),
  },
  async ({ query, language }) => {
    try {
      const lang = language ?? "no";
      const results = await client.search(query, lang);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Ingen tabeller funnet for søk: "${query}"`,
            },
          ],
        };
      }

      let text = `Søkeresultater for "${query}" (${results.length} treff)\n${"─".repeat(50)}\n\n`;

      text += results
        .map((r: SearchResult) => {
          return `  📊 [${r.id}] ${r.title}\n     Publisert: ${r.published}\n     Sti: ${r.path}`;
        })
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ─── Tool: ssb_table_info ────────────────────────────────────────────────────

server.tool(
  "ssb_table_info",
  "Get detailed metadata for an SSB table, including all variables/dimensions and their possible values. " +
    "Use this before ssb_query to understand what filters are available.",
  {
    tableId: z.string().describe('Table ID, e.g. "07241" or "11342"'),
    language: z
      .enum(["no", "en"])
      .optional()
      .describe('Language: "no" (Norwegian, default) or "en" (English)'),
  },
  async ({ tableId, language }) => {
    try {
      const lang = language ?? "no";
      const metadata = await client.getTableMetadata(tableId, lang);

      let text = `📊 Tabell ${tableId}: ${metadata.title}\n${"─".repeat(50)}\n\n`;
      text += "Variabler / dimensjoner:\n\n";

      for (const v of metadata.variables) {
        const isTime = v.time ? " ⏱️ (tid)" : "";
        const isElim = v.elimination ? " (kan utelates)" : "";
        text += `▸ ${v.text} (kode: "${v.code}")${isTime}${isElim}\n`;

        // Show values - truncate if there are too many
        const maxValuesToShow = 20;
        const valueCount = v.values.length;

        if (valueCount <= maxValuesToShow) {
          for (let i = 0; i < valueCount; i++) {
            text += `    "${v.values[i]}" = ${v.valueTexts[i]}\n`;
          }
        } else {
          for (let i = 0; i < 10; i++) {
            text += `    "${v.values[i]}" = ${v.valueTexts[i]}\n`;
          }
          text += `    ... (${valueCount - 20} verdier utelatt) ...\n`;
          for (let i = valueCount - 10; i < valueCount; i++) {
            text += `    "${v.values[i]}" = ${v.valueTexts[i]}\n`;
          }
        }
        text += "\n";
      }

      // Add a query example
      text += buildQueryExample(tableId, metadata.variables);

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ─── Tool: ssb_query ─────────────────────────────────────────────────────────

server.tool(
  "ssb_query",
  "Query statistical data from an SSB table. Returns formatted data. " +
    "Use ssb_table_info first to see available variables and value codes. " +
    "Filters specify which values to include for each variable dimension. " +
    'Use filter type "item" with specific value codes, "top" with ["N"] for last N time periods, ' +
    'or "all" with ["*"] for all values.',
  {
    tableId: z.string().describe('Table ID, e.g. "07241"'),
    filters: z
      .array(
        z.object({
          code: z
            .string()
            .describe("Variable code from table metadata"),
          filter: z
            .enum(["item", "all", "top", "agg"])
            .describe(
              'Filter type: "item" for specific values, "all" for everything, "top" for last N, "agg" for aggregation',
            ),
          values: z
            .array(z.string())
            .describe(
              'Value codes to include. For "item": specific codes. For "top": ["N"]. For "all": ["*"]',
            ),
        }),
      )
      .describe(
        "Array of variable filters. Each variable in the table should have a filter.",
      ),
    language: z
      .enum(["no", "en"])
      .optional()
      .describe('Language: "no" (Norwegian, default) or "en" (English)'),
    maxRows: z
      .number()
      .optional()
      .describe(
        "Maximum rows to return (default: 50). Use smaller values for large tables.",
      ),
  },
  async ({ tableId, filters, language, maxRows }) => {
    try {
      const lang = language ?? "no";
      const limit = maxRows ?? 50;

      const queryFilters: QueryFilter[] = filters.map((f) => ({
        code: f.code,
        selection: {
          filter: f.filter,
          values: f.values,
        },
      }));

      const jsonStat = await client.queryTable(
        tableId,
        queryFilters,
        lang,
      );
      const parsed = parseJsonStat2(jsonStat, limit);
      const formatted = formatTable(parsed);

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ─── Tool: ssb_query_builder ─────────────────────────────────────────────────

server.tool(
  "ssb_query_builder",
  "Generate a ready-to-use query template for an SSB table. " +
    "Returns a JSON query with the last 5 time periods and first value for other dimensions. " +
    "Useful as a starting point that you can modify.",
  {
    tableId: z.string().describe('Table ID, e.g. "07241"'),
    language: z
      .enum(["no", "en"])
      .optional()
      .describe('Language: "no" (Norwegian, default) or "en" (English)'),
  },
  async ({ tableId, language }) => {
    try {
      const lang = language ?? "no";
      const metadata = await client.getTableMetadata(tableId, lang);

      const filters = metadata.variables.map((v: TableVariable) => {
        if (v.time) {
          return {
            code: v.code,
            filter: "top" as const,
            values: ["5"],
            _comment: `Siste 5 perioder av "${v.text}"`,
          };
        }
        // For non-time variables, pick the first value as default
        return {
          code: v.code,
          filter: "item" as const,
          values: [v.values[0]],
          _comment: `"${v.text}": ${v.valueTexts[0]} (${v.values.length} mulige verdier)`,
        };
      });

      let text = `Mal for spørring mot tabell ${tableId}: ${metadata.title}\n${"─".repeat(50)}\n\n`;
      text += "Bruk denne malen med ssb_query-verktøyet:\n\n";
      text += "```json\n";
      text += JSON.stringify(
        {
          tableId,
          filters: filters.map(
            ({ _comment, ...rest }: { _comment: string; code: string; filter: string; values: string[] }) => rest,
          ),
        },
        null,
        2,
      );
      text += "\n```\n\n";

      text += "Forklaring:\n";
      for (const f of filters) {
        text += `  • ${f.code}: ${f._comment}\n`;
      }

      text += "\nTips:\n";
      text +=
        '  • Endre filter til "all" med values ["*"] for å hente alle verdier i en dimensjon\n';
      text +=
        '  • Endre filter til "top" med values ["10"] for siste 10 perioder\n';
      text +=
        "  • Legg til flere verdier i values-arrayen for å hente flere kombinasjoner\n";

      return {
        content: [{ type: "text" as const, text }],
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildQueryExample(
  tableId: string,
  variables: TableVariable[],
): string {
  let text = "Eksempel på spørring med ssb_query:\n\n";

  const exampleFilters = variables.map((v) => {
    if (v.time) {
      return `  { "code": "${v.code}", "filter": "top", "values": ["5"] }`;
    }
    const sampleValues = v.values
      .slice(0, 2)
      .map((val) => `"${val}"`);
    return `  { "code": "${v.code}", "filter": "item", "values": [${sampleValues.join(", ")}] }`;
  });

  text += `tableId: "${tableId}"\n`;
  text += `filters:\n[\n${exampleFilters.join(",\n")}\n]\n`;

  return text;
}

function errorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text" as const,
        text: `Feil: ${message}`,
      },
    ],
    isError: true,
  };
}

// ─── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SSB MCP Server started (stdio transport)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});