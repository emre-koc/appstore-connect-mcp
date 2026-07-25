import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/index.ts", import.meta.url);

test("entrypoint is stdio-only and contains no listening server", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /StdioServerTransport/);
  assert.doesNotMatch(source, /StreamableHTTP|express|\.listen\s*\(|createServer\s*\(/);
  assert.doesNotMatch(source, /console\.log/);
});
