#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AppStoreConnectClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createAppleJwtProvider } from "./jwt.js";
import { createMcpServer } from "./server.js";
import { redactSensitive } from "./security.js";
import { AppStoreConnectTools } from "./tools.js";

async function main(): Promise<void> {
  process.umask(0o077);
  const config = await loadConfig();
  const tokenProvider = createAppleJwtProvider(config);
  const client = new AppStoreConnectClient({ tokenProvider });
  const server = createMcpServer(new AppStoreConnectTools(config, client));
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });

  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`appstore-connect-mcp failed: ${redactSensitive(error)}\n`);
  process.exitCode = 1;
});
