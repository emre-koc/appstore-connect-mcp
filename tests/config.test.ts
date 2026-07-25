import assert from "node:assert/strict";
import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const validKey = "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n";

async function keyFixture(mode = 0o600): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "asc-mcp-config-"));
  const path = join(directory, "AuthKey_TEST.p8");
  await writeFile(path, validKey, { mode });
  await chmod(path, mode);
  return path;
}

test("loads a regular mode-600 key file without exposing its contents", async () => {
  const keyPath = await keyFixture();
  const config = await loadConfig({
    ASC_KEY_ID: "ABC123",
    ASC_ISSUER_ID: "issuer-id",
    ASC_PRIVATE_KEY_PATH: keyPath,
    ASC_ALLOWED_APP_IDS: "111, 222",
  });

  assert.equal(config.keyId, "ABC123");
  assert.equal(config.privateKeyPath, keyPath);
  assert.deepEqual([...config.allowedAppIds], ["111", "222"]);
  assert.equal(config.mutationsEnabled, false);
  assert.equal(JSON.stringify(config).includes("BEGIN PRIVATE KEY"), false);
});

test("rejects key files readable by group or other users", async () => {
  const keyPath = await keyFixture(0o644);
  await assert.rejects(
    loadConfig({ ASC_KEY_ID: "A", ASC_ISSUER_ID: "I", ASC_PRIVATE_KEY_PATH: keyPath }),
    /permissions.*600/i,
  );
});

test("requires exact mode 600", async () => {
  const keyPath = await keyFixture(0o400);
  await assert.rejects(
    loadConfig({ ASC_KEY_ID: "A", ASC_ISSUER_ID: "I", ASC_PRIVATE_KEY_PATH: keyPath }),
    /mode 600/i,
  );
});

test("rejects relative and oversized key files", async () => {
  await assert.rejects(
    loadConfig({ ASC_KEY_ID: "A", ASC_ISSUER_ID: "I", ASC_PRIVATE_KEY_PATH: "./x" }),
    /absolute/i,
  );
  const directory = await mkdtemp(join(tmpdir(), "asc-config-size-"));
  const keyPath = join(directory, "AuthKey_TEST.p8");
  await writeFile(keyPath, "x".repeat(16_385), { mode: 0o600 });
  await chmod(keyPath, 0o600);
  await assert.rejects(
    loadConfig({ ASC_KEY_ID: "A", ASC_ISSUER_ID: "I", ASC_PRIVATE_KEY_PATH: keyPath }),
    /size/i,
  );
});

test("rejects a symlink private-key path", async () => {
  const keyPath = await keyFixture();
  const linkPath = `${keyPath}.link`;
  await symlink(keyPath, linkPath);
  await assert.rejects(
    loadConfig({ ASC_KEY_ID: "A", ASC_ISSUER_ID: "I", ASC_PRIVATE_KEY_PATH: linkPath }),
    /regular file|symbolic link/i,
  );
});

test("enabling mutations requires a nonempty app allowlist", async () => {
  const keyPath = await keyFixture();
  await assert.rejects(
    loadConfig({
      ASC_KEY_ID: "A",
      ASC_ISSUER_ID: "I",
      ASC_PRIVATE_KEY_PATH: keyPath,
      ASC_ENABLE_MUTATIONS: "true",
    }),
    /allowlist/i,
  );
});
