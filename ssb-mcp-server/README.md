# Damnlies - SSB MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants query and explore data from **Statistics Norway (SSB)** - Norway's central statistics bureau.

Built entirely with **Claude Opus 4.6** through conversational pair-programming. Every line of code, from the SSB API client to the JSON-stat parser, was written by Claude in collaboration with a human.

## What it does
This server gives your AI assistant direct access to SSB's public statistical database - over 6,000 tables covering everything from population and employment to prices, trade, and beyond. No API key needed!

It exposes five tools:

| Tool | What it does |
|------|-------------|
| ssb_browse | Navigate the SSB table hierarchy by subject area |
| ssb_search | Search for tables by keyword |
| ssb_table_info | Get detailed metadata for a table (variables, dimensions, time periods) |
| ssb_query | Run a query against a table and get formatted results |
| ssb_query_builder | Generate a ready-to-use query template for any table |

## Getting started

### Prerequisites

- **Node.js** (v18 or later)
- **VS Code** with GitHub Copilot (or any MCP-compatible client)

### Install and build

\`\`\`bash
cd ssb-mcp-server
npm install
npm run build
\`\`\`

### Configure in VS Code

The repo includes a .vscode/mcp.json that wires everything up automatically:

\`\`\`json
{
  "servers": {
    "ssb-statistics": {
      "command": "node",
      "args": ["\${workspaceFolder}/ssb-mcp-server/dist/index.js"],
      "type": "stdio"
    }
  }
}
\`\`\`

Just open this folder in VS Code and the SSB server will be available in Copilot Chat.

### Using with other MCP clients

You can use this server with any MCP-compatible client by running:

\`\`\`bash
node ssb-mcp-server/dist/index.js
\`\`\`

It communicates over **stdio** using the standard MCP protocol.

## Example questions you can ask

- "What was Norway's population in 2024?"
- "Show me unemployment rates by county over the last 5 years"
- "How many people have the name Ola in Norway?"
- "What are the most popular baby names in 2025?"
- "Compare GDP growth across Nordic countries"
- "What is the average house price in Oslo?"

The AI will use the tools to browse, search, and query SSB's data to answer your questions.

## How it was made

This entire project - the TypeScript MCP server, the SSB PxWeb API client, the JSON-stat2 response parser - was built through a conversation with Claude Opus 4.6. No code was hand-written. Just vibes.

## License

MIT
