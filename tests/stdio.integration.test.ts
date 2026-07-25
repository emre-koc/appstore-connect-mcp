import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

test("real stdio entrypoint completes MCP discovery without opening HTTP", async (t) => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const directory = await mkdtemp(join(tmpdir(), "asc-mcp-stdio-"));
  const keyPath = join(directory, "AuthKey_TEST.p8");
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  await chmod(keyPath, 0o600);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts"],
    cwd: new URL("..", import.meta.url).pathname,
    stderr: "pipe",
    env: {
      ...getDefaultEnvironment(),
      ASC_KEY_ID: "TESTKEY",
      ASC_ISSUER_ID: "00000000-0000-0000-0000-000000000000",
      ASC_PRIVATE_KEY_PATH: keyPath,
      ASC_ALLOWED_APP_IDS: "app-1",
      ASC_ENABLE_MUTATIONS: "false",
    },
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: "stdio-integration-test", version: "1" });
  await client.connect(transport);
  t.after(async () => { await client.close(); });

  const listed = await client.listTools();
  assert.equal(listed.tools.length >= 20, true);
  const status = await client.callTool({ name: "asc_status", arguments: {} });
  const text = (status.content as Array<{ type: string; text: string }>)[0]!.text;
  assert.match(text, /"transport": "stdio"/);
  assert.equal(stderr, "");
});
