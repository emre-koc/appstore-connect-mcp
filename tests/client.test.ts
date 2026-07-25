import assert from "node:assert/strict";
import test from "node:test";

import { AppStoreConnectClient, AppStoreConnectError } from "../src/client.js";

type FetchCall = { input: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("sends authenticated requests only to Apple's API host", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), ...(init ? { init } : {}) });
    return jsonResponse({ data: [] });
  };
  const client = new AppStoreConnectClient({ tokenProvider: async () => "jwt", fetchImpl });
  await client.get("/v1/apps", { "filter[bundleId]": "com.example.app", limit: 10 });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.input);
  assert.equal(url.origin, "https://api.appstoreconnect.apple.com");
  assert.equal(url.searchParams.get("filter[bundleId]"), "com.example.app");
  assert.equal(calls[0]!.init?.headers instanceof Headers, true);
  assert.equal((calls[0]!.init!.headers as Headers).get("authorization"), "Bearer jwt");
  assert.equal(calls[0]!.init?.redirect, "error");
  await assert.rejects(client.get("https://evil.test/steal"), /relative API path/i);
});

test("follows bounded Apple pagination and combines data", async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    return count === 1
      ? jsonResponse({ data: [{ type: "apps", id: "1" }], links: { next: "https://api.appstoreconnect.apple.com/v1/apps?cursor=next" } })
      : jsonResponse({ data: [{ type: "apps", id: "2" }], links: {} });
  };
  const client = new AppStoreConnectClient({ tokenProvider: async () => "jwt", fetchImpl });
  const result = await client.getAll("/v1/apps", undefined, { maxPages: 2, maxItems: 10 });
  assert.deepEqual(result.data.map((item) => item.id), ["1", "2"]);
  assert.equal(count, 2);
});

test("refuses pagination links that leave Apple's host", async () => {
  const client = new AppStoreConnectClient({
    tokenProvider: async () => "jwt",
    fetchImpl: async () => jsonResponse({ data: [], links: { next: "https://evil.test/collect" } }),
  });
  await assert.rejects(client.getAll("/v1/apps"), /host/i);
});

test("retries rate limits with capped Retry-After and then succeeds", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const client = new AppStoreConnectClient({
    tokenProvider: async () => "jwt",
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? jsonResponse({ errors: [] }, 429, { "retry-after": "2" }) : jsonResponse({ data: [] });
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  await client.get("/v1/apps");
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2_000]);
});

test("uses bounded exponential backoff when Retry-After is absent", async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const client = new AppStoreConnectClient({
    tokenProvider: async () => "jwt",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return jsonResponse({ errors: [{ title: "Unavailable" }] }, 503);
      return jsonResponse({ data: [] });
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  await client.get("/v1/apps");
  assert.deepEqual(sleeps, [250]);
});

test("never retries non-idempotent mutations automatically", async () => {
  let attempts = 0;
  const client = new AppStoreConnectClient({
    tokenProvider: async () => "jwt",
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ errors: [{ title: "Server error" }] }, 500);
    },
    sleep: async () => { throw new Error("must not sleep for a mutation"); },
  });
  await assert.rejects(client.post("/v2/inAppPurchases", { data: {} }), (error: unknown) => {
    assert.equal(error instanceof AppStoreConnectError, true);
    assert.equal((error as AppStoreConnectError).status, 500);
    return true;
  });
  assert.equal(attempts, 1);
});

test("returns sanitized structured Apple errors without authorization material", async () => {
  const client = new AppStoreConnectClient({
    tokenProvider: async () => "secret.jwt.value",
    fetchImpl: async () => jsonResponse({ errors: [{ status: "403", code: "FORBIDDEN", title: "Denied", detail: "Authorization: Bearer secret.jwt.value" }] }, 403),
  });
  await assert.rejects(client.get("/v1/apps"), (error: unknown) => {
    assert.equal(error instanceof AppStoreConnectError, true);
    assert.equal(String(error).includes("secret.jwt.value"), false);
    return true;
  });
});

test("rejects oversized Apple response bodies even without Content-Length", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
      controller.close();
    },
  });
  const client = new AppStoreConnectClient({
    tokenProvider: async () => "jwt",
    fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(client.get("/v1/apps"), /response exceeded.*limit/i);
});
