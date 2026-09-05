#!/usr/bin/env node
/**
 * A one-shot MCP client for the table server.
 *
 *     node tools/mcp-cli.mjs <tool> '<json args>'
 *     node tools/mcp-cli.mjs list_tables
 *     node tools/mcp-cli.mjs join_table '{"tableId":"bd7k2p","name":"Ada"}'
 *     node tools/mcp-cli.mjs act '{"token":"...","action":"raise","amount":80}'
 *
 * It connects over streamable HTTP to /mcp, calls one tool, prints the text the
 * tool returned, and exits — so it is the real MCP surface, not a shortcut past
 * it to the REST API underneath.
 *
 * Useful for poking at the server by hand, and for letting an agent host that
 * cannot mount an MCP server (a shell, a CI job) still play a hand.
 *
 * Server address: first argument after the tool's, or $HOLDEM_SERVER, default
 * http://localhost:8787. Exits non-zero when the tool reports an error.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [toolName, rawArgs] = process.argv.slice(2);
const server = process.env.HOLDEM_SERVER ?? "http://localhost:8787";

if (!toolName || toolName === "--help" || toolName === "-h") {
  process.stdout.write(
    "usage: node tools/mcp-cli.mjs <tool> '<json args>'\n" +
      "       HOLDEM_SERVER=http://host:port to point elsewhere\n" +
      "       node tools/mcp-cli.mjs tools    to list the available tools\n",
  );
  process.exit(toolName ? 0 : 2);
}

let args = {};
if (rawArgs) {
  try {
    args = JSON.parse(rawArgs);
  } catch (error) {
    process.stderr.write(`arguments must be a JSON object: ${error.message}\n`);
    process.exit(2);
  }
}

const client = new Client({ name: "holdem-cli", version: "0.1.0" });

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server}/mcp`)));
} catch (error) {
  process.stderr.write(`cannot reach the MCP endpoint at ${server}/mcp — is the server running?\n`);
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

try {
  if (toolName === "tools") {
    const { tools } = await client.listTools();
    for (const tool of tools) process.stdout.write(`${tool.name.padEnd(16)}${tool.description}\n`);
  } else {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = (result.content ?? [])
      .map((part) => part.text ?? "")
      .join("\n")
      .trim();
    process.stdout.write(`${text}\n`);
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await client.close();
}
