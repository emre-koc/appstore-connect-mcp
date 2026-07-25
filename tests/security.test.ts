import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAllowedApp,
  assertAppleApiUrl,
  assertMutationAllowed,
  redactSensitive,
} from "../src/security.js";

const config = {
  mutationsEnabled: true,
  allowedAppIds: new Set(["123"]),
};

test("allows only HTTPS requests to Apple's exact App Store Connect API host", () => {
  assert.doesNotThrow(() => assertAppleApiUrl(new URL("https://api.appstoreconnect.apple.com/v1/apps")));
  assert.throws(() => assertAppleApiUrl(new URL("http://api.appstoreconnect.apple.com/v1/apps")), /HTTPS/i);
  assert.throws(() => assertAppleApiUrl(new URL("https://api.appstoreconnect.apple.com.evil.test/v1/apps")), /host/i);
  assert.throws(() => assertAppleApiUrl(new URL("https://example.com/")), /host/i);
  assert.throws(() => assertAppleApiUrl(new URL("https://user:pass@api.appstoreconnect.apple.com/v1/apps")), /credentials/i);
});

test("enforces app allowlisting for every scoped operation", () => {
  assert.doesNotThrow(() => assertAllowedApp("123", config.allowedAppIds));
  assert.throws(() => assertAllowedApp("999", config.allowedAppIds), /allowlist/i);
});

test("mutations require global enablement and exact operation confirmation", () => {
  assert.throws(
    () => assertMutationAllowed({ mutationsEnabled: false, allowedAppIds: new Set(["123"]) }, "create_iap", "123", "EXECUTE create_iap FOR 123"),
    /disabled/i,
  );
  assert.throws(() => assertMutationAllowed(config, "create_iap", "123", true), /confirmation/i);
  assert.doesNotThrow(() => assertMutationAllowed(config, "create_iap", "123", "EXECUTE create_iap FOR 123"));
});

test("redacts PEM keys, JWTs, authorization headers, and credential fields", () => {
  const input = "Authorization: Bearer aaa.bbb.ccc APPLE_PRIVATE_KEY=secret -----BEGIN PRIVATE KEY----- hidden -----END PRIVATE KEY-----";
  const output = redactSensitive(input);
  assert.equal(output.includes("aaa.bbb.ccc"), false);
  assert.equal(output.includes("secret"), false);
  assert.equal(output.includes("hidden"), false);
  assert.match(output, /\[REDACTED\]/);
});
