/**
 * Entry point for the table server. Starts HTTP, WebSocket and MCP on one port.
 */

import { startServer } from "./http.js";

const running = await startServer();
const shown = process.env.HOST && process.env.HOST !== "0.0.0.0" ? process.env.HOST : "localhost";

console.log(`Fidgetfall Hold'em`);
console.log(`  table + browser client  http://${shown}:${running.port}`);
console.log(`  MCP endpoint (agents)   http://${shown}:${running.port}/mcp`);
console.log(`  stdio MCP entrypoint    node dist/mcp/stdio.js http://${shown}:${running.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}
