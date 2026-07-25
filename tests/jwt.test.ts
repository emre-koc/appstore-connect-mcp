import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppleJwtProvider } from "../src/jwt.js";

function decodePart(token: string, index: number): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[index]!, "base64url").toString("utf8"));
}

test("creates a short-lived ES256 App Store Connect JWT with Apple-required claims", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const directory = await mkdtemp(join(tmpdir(), "asc-mcp-jwt-"));
  const path = join(directory, "key.p8");
  await writeFile(path, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  await chmod(path, 0o600);

  const now = 1_800_000_000;
  const token = await createAppleJwtProvider({ keyId: "KEY123", issuerId: "ISSUER", privateKeyPath: path }, () => now)();
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(decodePart(token, 0), { alg: "ES256", kid: "KEY123", typ: "JWT" });
  const payload = decodePart(token, 1);
  assert.equal(payload.iss, "ISSUER");
  assert.equal(payload.aud, "appstoreconnect-v1");
  assert.equal(payload.iat, now);
  assert.equal(payload.exp, now + 1_140);
});

test("rejects a non-P256 private key", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const directory = await mkdtemp(join(tmpdir(), "asc-mcp-jwt-bad-"));
  const path = join(directory, "key.p8");
  await writeFile(path, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  await assert.rejects(
    createAppleJwtProvider({ keyId: "K", issuerId: "I", privateKeyPath: path })(),
    /P-256|EC private key/i,
  );
});

test("refuses a key path swapped to a symlink before first use", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const directory = await mkdtemp(join(tmpdir(), "asc-jwt-swap-"));
  const keyPath = join(directory, "AuthKey_TEST.p8");
  const movedPath = join(directory, "moved.p8");
  await writeFile(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  await chmod(keyPath, 0o600);
  await rename(keyPath, movedPath);
  await symlink(movedPath, keyPath);
  const provider = createAppleJwtProvider({ keyId: "KEY", issuerId: "ISSUER", privateKeyPath: keyPath });
  await assert.rejects(provider(), /symbolic link|regular file/i);
});
