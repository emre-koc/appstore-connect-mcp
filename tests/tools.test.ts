import assert from "node:assert/strict";
import test from "node:test";

import type { JsonApiDocument, JsonApiResource, Query } from "../src/client.js";
import { AppStoreConnectTools } from "../src/tools.js";

class FakeClient {
  readonly calls: Array<{ method: string; path: string; body?: unknown; query?: Query }> = [];
  responses: JsonApiDocument<unknown>[] = [];

  async get(path: string, query?: Query): Promise<JsonApiDocument<any>> {
    this.calls.push({ method: "GET", path, ...(query ? { query } : {}) });
    return this.responses.shift() ?? { data: [] };
  }
  async getAll(path: string, query?: Query): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    this.calls.push({ method: "GET_ALL", path, ...(query ? { query } : {}) });
    return (this.responses.shift() as JsonApiDocument<readonly JsonApiResource[]>) ?? { data: [] };
  }
  async post(path: string, body: unknown): Promise<JsonApiDocument<any>> {
    this.calls.push({ method: "POST", path, body });
    return this.responses.shift() ?? { data: { type: "result", id: "new" } };
  }
  async patch(path: string, body: unknown): Promise<JsonApiDocument<any>> {
    this.calls.push({ method: "PATCH", path, body });
    return this.responses.shift() ?? { data: { type: "result", id: "updated" } };
  }
  async delete(path: string): Promise<void> {
    this.calls.push({ method: "DELETE", path });
  }
}

const enabledConfig = {
  keyId: "K",
  issuerId: "I",
  privateKeyPath: "/private/key.p8",
  allowedAppIds: new Set(["app-1"]),
  mutationsEnabled: true,
};

test("listApps never returns apps outside the configured allowlist", async () => {
  const client = new FakeClient();
  client.responses.push({ data: [
    { type: "apps", id: "app-1", attributes: { name: "Allowed" } },
    { type: "apps", id: "app-2", attributes: { name: "Hidden" } },
  ] });
  const tools = new AppStoreConnectTools(enabledConfig, client);
  const result = await tools.listApps();
  assert.deepEqual(result.data.map((item) => item.id), ["app-1"]);
});

test("app-scoped reads reject an app outside the allowlist before network access", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await assert.rejects(tools.listInAppPurchases("app-2"), /allowlist/i);
  assert.equal(client.calls.length, 0);
});

test("createInAppPurchaseV2 emits the official V2 JSON:API request after exact confirmation", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.createInAppPurchaseV2({
    appId: "app-1",
    name: "Lifetime Access",
    productId: "com.example.lifetime",
    inAppPurchaseType: "NON_CONSUMABLE",
    familySharable: true,
    confirmation: "EXECUTE create_in_app_purchase_v2 FOR app-1",
  });
  assert.deepEqual(client.calls, [{
    method: "POST",
    path: "/v2/inAppPurchases",
    body: {
      data: {
        type: "inAppPurchases",
        attributes: {
          name: "Lifetime Access",
          productId: "com.example.lifetime",
          inAppPurchaseType: "NON_CONSUMABLE",
          familySharable: true,
        },
        relationships: { app: { data: { type: "apps", id: "app-1" } } },
      },
    },
  }]);
});

test("mutations are blocked before network access when disabled", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools({ ...enabledConfig, mutationsEnabled: false }, client);
  await assert.rejects(
    tools.createAppStoreVersion({
      appId: "app-1",
      platform: "IOS",
      versionString: "1.0.0",
      confirmation: "EXECUTE create_app_store_version FOR app-1",
    }),
    /disabled/i,
  );
  assert.equal(client.calls.length, 0);
});

test("updating an IAP verifies that the resource belongs to the allowed app", async () => {
  const client = new FakeClient();
  client.responses.push({ data: [{ type: "inAppPurchases", id: "iap-other" }] });
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await assert.rejects(
    tools.updateInAppPurchaseV2({
      appId: "app-1",
      inAppPurchaseId: "iap-1",
      name: "Updated",
      confirmation: "EXECUTE update_in_app_purchase_v2 FOR app-1",
    }),
    /does not belong/i,
  );
  assert.equal(client.calls.some((call) => call.method === "PATCH"), false);
});

test("creates a TestFlight beta group with the official app relationship", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.createBetaGroup({
    appId: "app-1",
    name: "Internal QA",
    isInternalGroup: true,
    confirmation: "EXECUTE create_beta_group FOR app-1",
  });
  assert.deepEqual(client.calls[0], {
    method: "POST",
    path: "/v1/betaGroups",
    body: {
      data: {
        type: "betaGroups",
        attributes: { name: "Internal QA", isInternalGroup: true },
        relationships: { app: { data: { type: "apps", id: "app-1" } } },
      },
    },
  });
});

test("submitting an App Review submission verifies app ownership before setting submitted", async () => {
  const client = new FakeClient();
  client.responses.push({ data: [{ type: "reviewSubmissions", id: "review-1" }] });
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.submitReviewSubmission({
    appId: "app-1",
    reviewSubmissionId: "review-1",
    confirmation: "EXECUTE submit_review_submission FOR app-1",
  });
  assert.equal(client.calls[0]!.path, "/v1/apps/app-1/reviewSubmissions");
  assert.deepEqual(client.calls[1], {
    method: "PATCH",
    path: "/v1/reviewSubmissions/review-1",
    body: { data: { type: "reviewSubmissions", id: "review-1", attributes: { submitted: true } } },
  });
});

test("read tools map to the documented app-related endpoints", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.getApp("app-1");
  await tools.listBuilds("app-1");
  await tools.listAppStoreVersions("app-1", "IOS");
  await tools.listInAppPurchases("app-1");
  await tools.listTerritories();
  await tools.listBetaGroups("app-1");
  await tools.listReviewSubmissions("app-1");
  assert.deepEqual(client.calls.map((call) => call.path), [
    "/v1/apps/app-1",
    "/v1/apps/app-1/builds",
    "/v1/apps/app-1/appStoreVersions",
    "/v1/apps/app-1/inAppPurchasesV2",
    "/v1/territories",
    "/v1/apps/app-1/betaGroups",
    "/v1/apps/app-1/reviewSubmissions",
  ]);
});

test("IAP read tools verify ownership before current V2 relationships", async () => {
  const methods = [
    ["getInAppPurchase", "/v2/inAppPurchases/iap-1"],
    ["listInAppPurchaseVersions", "/v2/inAppPurchases/iap-1/versions"],
    ["listInAppPurchasePricePoints", "/v2/inAppPurchases/iap-1/pricePoints"],
    ["getInAppPurchasePriceSchedule", "/v2/inAppPurchases/iap-1/iapPriceSchedule"],
    ["getInAppPurchaseAvailability", "/v2/inAppPurchases/iap-1/inAppPurchaseAvailability"],
  ] as const;
  for (const [method, expectedPath] of methods) {
    const client = new FakeClient();
    client.responses.push({ data: [{ type: "inAppPurchases", id: "iap-1" }] }, { data: [] });
    const tools = new AppStoreConnectTools(enabledConfig, client);
    await (tools[method] as (app: string, iap: string) => Promise<unknown>)("app-1", "iap-1");
    assert.equal(client.calls.at(-1)!.path, expectedPath);
  }
});

test("lists IAP localizations through the current version-scoped endpoint", async () => {
  const client = new FakeClient();
  client.responses.push(
    { data: [{ type: "inAppPurchases", id: "iap-1" }] },
    { data: [{ type: "inAppPurchaseVersions", id: "version-1" }] },
    { data: [] },
  );
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.listInAppPurchaseVersionLocalizations("app-1", "iap-1", "version-1");
  assert.equal(client.calls.at(-1)!.path, "/v1/inAppPurchaseVersions/version-1/localizations");
});

test("IAP setup mutations emit current Apple resource types", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.createAppStoreVersion({ appId: "app-1", platform: "IOS", versionString: "2.0", confirmation: "EXECUTE create_app_store_version FOR app-1" });
  client.responses.push({ data: [{ type: "inAppPurchases", id: "iap-1" }] });
  await tools.createInAppPurchaseAvailability({ appId: "app-1", inAppPurchaseId: "iap-1", territoryIds: ["USA"], availableInNewTerritories: true, confirmation: "EXECUTE create_in_app_purchase_availability FOR app-1" });
  client.responses.push(
    { data: [{ type: "inAppPurchases", id: "iap-1" }] },
    { data: [{ type: "inAppPurchasePricePoints", id: "price-1" }] },
  );
  await tools.createInAppPurchasePriceSchedule({ appId: "app-1", inAppPurchaseId: "iap-1", baseTerritoryId: "USA", pricePointId: "price-1", confirmation: "EXECUTE create_in_app_purchase_price_schedule FOR app-1" });
  assert.equal((client.calls[0]!.body as any).data.type, "appStoreVersions");
  assert.equal(client.calls.some((call) => call.path === "/v1/inAppPurchaseAvailabilities"), true);
  assert.equal(client.calls.some((call) => call.path === "/v1/inAppPurchasePriceSchedules"), true);
});

test("creates a current unified review item for a verified IAP version", async () => {
  const client = new FakeClient();
  client.responses.push(
    { data: [{ type: "inAppPurchases", id: "iap-1" }] },
    { data: [{ type: "inAppPurchaseVersions", id: "version-1" }] },
    { data: [{ type: "reviewSubmissions", id: "review-1" }] },
  );
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.createInAppPurchaseReviewItem({ appId: "app-1", inAppPurchaseId: "iap-1", versionId: "version-1", reviewSubmissionId: "review-1", confirmation: "EXECUTE create_in_app_purchase_review_item FOR app-1" });
  assert.deepEqual(client.calls.at(-1), {
    method: "POST",
    path: "/v1/reviewSubmissionItems",
    body: { data: { type: "reviewSubmissionItems", relationships: {
      reviewSubmission: { data: { type: "reviewSubmissions", id: "review-1" } },
      inAppPurchaseVersion: { data: { type: "inAppPurchaseVersions", id: "version-1" } },
    } } },
  });
});

test("price schedules reject price points outside the verified IAP", async () => {
  const client = new FakeClient();
  client.responses.push({ data: [{ type: "inAppPurchases", id: "iap-1" }] }, { data: [] });
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await assert.rejects(
    tools.createInAppPurchasePriceSchedule({ appId: "app-1", inAppPurchaseId: "iap-1", baseTerritoryId: "USA", pricePointId: "other-price", confirmation: "EXECUTE create_in_app_purchase_price_schedule FOR app-1" }),
    /price point other-price does not belong/,
  );
  assert.equal(client.calls.some((call) => call.method === "POST"), false);
});

test("ownership checks avoid unsupported filter[id] relationship queries", async () => {
  const client = new FakeClient();
  client.responses.push({ data: [{ type: "builds", id: "build-1" }] });
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.getBuild("app-1", "build-1");
  assert.equal(Object.hasOwn(client.calls[0]!.query ?? {}, "filter[id]"), false);
});

test("build listing sends only OpenAPI-supported relationship parameters", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.listBuilds("app-1");
  assert.deepEqual(client.calls[0]!.query, { limit: 200 });
});

test("TestFlight relationship mutations verify groups and builds", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  client.responses.push({ data: [{ type: "betaGroups", id: "group-1" }] });
  await tools.createBetaTester({ appId: "app-1", email: "tester@example.com", betaGroupIds: ["group-1"], confirmation: "EXECUTE create_beta_tester FOR app-1" });
  client.responses.push({ data: [{ type: "betaGroups", id: "group-1" }] });
  await tools.addBetaTestersToGroup({ appId: "app-1", betaGroupId: "group-1", betaTesterIds: ["tester-1"], confirmation: "EXECUTE add_beta_testers_to_group FOR app-1" });
  client.responses.push({ data: [{ type: "betaGroups", id: "group-1" }] }, { data: [{ type: "builds", id: "build-1" }] });
  await tools.addBuildsToBetaGroup({ appId: "app-1", betaGroupId: "group-1", buildIds: ["build-1"], confirmation: "EXECUTE add_builds_to_beta_group FOR app-1" });
  assert.equal(client.calls.some((call) => call.path.endsWith("/relationships/betaTesters")), true);
  assert.equal(client.calls.some((call) => call.path.endsWith("/relationships/builds")), true);
});

test("creates review submissions with the official app relationship", async () => {
  const client = new FakeClient();
  const tools = new AppStoreConnectTools(enabledConfig, client);
  await tools.createReviewSubmission({ appId: "app-1", platform: "IOS", confirmation: "EXECUTE create_review_submission FOR app-1" });
  assert.deepEqual(client.calls[0], {
    method: "POST",
    path: "/v1/reviewSubmissions",
    body: { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: "app-1" } } } } },
  });
});
