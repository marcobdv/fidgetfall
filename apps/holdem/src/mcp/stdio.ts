#!/usr/bin/env node
/**
 * The stdio MCP entrypoint.
 *
 * An agent host (Claude Code, Claude Desktop, anything speaking MCP over stdio)
 * runs this as a subprocess; it forwards every tool call to a table server over
 * HTTP. Point it at a server with HOLDEM_SERVER, or pass the URL as the first
 * argument:
 *
 *     holdem-mcp http://localhost:8787
 *
 * Nothing is ever written to stdout except MCP traffic — stdout is the
 * protocol channel, so diagnostics go to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HttpRoomClient } from "./httpClient.js";
import { buildMcpServer } from "./tools.js";

const DEFAULT_SERVER = "http://localhost:8787";

async function main(): Promise<void> {
  const baseUrl = process.argv[2] ?? process.env.HOLDEM_SERVER ?? DEFAULT_SERVER;
  process.stderr.write(`[holdem-mcp] talking to table server at ${baseUrl}\n`);

  const server = buildMcpServer(new HttpRoomClient(baseUrl));
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`[holdem-mcp] failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
