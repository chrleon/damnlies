/**
 * SSB (Statistics Norway) PxWeb API Client
 *
 * Wraps the public API at https://data.ssb.no/api/v0/
 * Supports browsing, metadata retrieval, data queries, and search.
 */

export type Language = "no" | "en";

/** A folder node in the SSB table hierarchy */
export interface FolderNode {
  type: "l"; // "l" for level/folder
  id: string;
  text: string;
}

/** A table node in the SSB table hierarchy */
export interface TableNode {
  type: "t"; // "t" for table
  id: string;
  text: string;
  updated: string;
  firstPeriod?: string;
  lastPeriod?: string;
  category?: string;
  variables?: string[];
}

export type NavigationNode = FolderNode | TableNode;

/** A search result from the SSB search API (different format from browse) */
export interface SearchResult {
  id: string;
  path: string;
  title: string;
  score: number;
  published: string;
}

/** A variable/dimension in a table */
export interface TableVariable {
  code: string;
  text: string;
  values: string[];
  valueTexts: string[];
  elimination?: boolean;
  time?: boolean;
}

/** Table metadata returned by the API */
export interface TableMetadata {
  title: string;
  variables: TableVariable[];
}

/** Filter selection for a variable in a query */
export interface VariableSelection {
  filter: "item" | "all" | "top" | "agg";
  values: string[];
}

/** A query filter for one variable */
export interface QueryFilter {
  code: string;
  selection: VariableSelection;
}

/** The full POST body for a data query */
export interface DataQuery {
  query: QueryFilter[];
  response: {
    format: "json-stat2" | "csv" | "px";
  };
}

/** JSON-stat2 dimension category */
export interface JsonStat2Category {
  index: Record<string, number> | string[];
  label: Record<string, string>;
  unit?: Record<string, { base: string; decimals: number }>;
}

/** JSON-stat2 dimension */
export interface JsonStat2Dimension {
  label: string;
  category: JsonStat2Category;
}

/** JSON-stat2 dataset response from SSB */
export interface JsonStat2Response {
  version: string;
  class: string;
  label: string;
  source: string;
  updated: string;
  id: string[];
  size: number[];
  dimension: Record<string, JsonStat2Dimension>;
  value: (number | null)[];
  status?: Record<string, string>;
  role?: {
    time?: string[];
    geo?: string[];
    metric?: string[];
  };
}

const BASE_URL = "https://data.ssb.no/api/v0";

class SSBApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "SSBApiError";
  }
}

export class SSBClient {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Browse the SSB table hierarchy.
   * With no path segments, returns the root categories.
   * With path segments, drills into sub-categories or lists tables.
   */
  async browse(
    path: string[] = [],
    lang: Language = "no",
  ): Promise<NavigationNode[]> {
    const pathStr = path.length > 0 ? path.join("/") + "/" : "";
    const url = `${this.baseUrl}/${lang}/table/${pathStr}`;
    const response = await this.fetchJson<NavigationNode[]>(url);
    return response;
  }

  /**
   * Get metadata for a specific table, including all variables and their possible values.
   */
  async getTableMetadata(
    tableId: string,
    lang: Language = "no",
  ): Promise<TableMetadata> {
    const url = `${this.baseUrl}/${lang}/table/${tableId}`;
    const response = await this.fetchJson<TableMetadata>(url);
    return response;
  }

  /**
   * Query data from a specific table. Returns JSON-stat2 format.
   */
  async queryTable(
    tableId: string,
    filters: QueryFilter[],
    lang: Language = "no",
  ): Promise<JsonStat2Response> {
    const url = `${this.baseUrl}/${lang}/table/${tableId}`;
    const body: DataQuery = {
      query: filters,
      response: { format: "json-stat2" },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SSBApiError(
        response.status,
        `SSB API error (${response.status}): ${errorText}`,
      );
    }

    return (await response.json()) as JsonStat2Response;
  }

  /**
   * Search for tables matching a text query.
   * Note: The search endpoint returns a different format than browse.
   */
  async search(
    query: string,
    lang: Language = "no",
  ): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/${lang}/table/?query=${encodeURIComponent(query)}`;
    const response = await this.fetchJson<SearchResult[]>(url);
    return response;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new SSBApiError(
        response.status,
        `SSB API error (${response.status}): ${errorText}`,
      );
    }

    return (await response.json()) as T;
  }
}