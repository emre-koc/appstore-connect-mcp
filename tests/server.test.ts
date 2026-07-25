import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../src/server.js";
import { AppStoreConnectTools } from "../src/tools.js";

const config = {
  keyId: "K",
  issuerId: "I",
  privateKeyPath: "/private/key.p8",
  allowedAppIds: new Set(["app-1"]),
  mutationsEnabled: false,
};

const fakeClient = {
  async get() { return { data: null }; },
  async getAll() { return { data: [] }; },
  async post() { return { data: null }; },
  async patch() { return { data: null }; },
  async delete() {},
};

test("registers curated read and mutation tools with truthful safety annotations", async (t) => {
  const server = createMcpServer(new AppStoreConnectTools(config, fakeClient));
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name);
  for (const expected of [
    "asc_status",
    "list_apps",
    "list_builds",
    "list_app_store_versions",
    "list_in_app_purchases_v2",
    "list_in_app_purchase_price_points",
    "create_app_store_version",
    "create_in_app_purchase_v2",
    "create_in_app_purchase_price_schedule",
    "create_in_app_purchase_review_item",
    "create_beta_group",
    "create_beta_tester",
    "add_beta_testers_to_group",
    "add_builds_to_beta_group",
    "create_review_submission",
    "submit_review_submission",
  ]) assert.equal(names.includes(expected), true, `missing ${expected}`);

  const read = result.tools.find((tool) => tool.name === "list_apps")!;
  assert.equal(read.annotations?.readOnlyHint, true);
  const write = result.tools.find((tool) => tool.name === "create_in_app_purchase_v2")!;
  assert.equal(write.annotations?.readOnlyHint, false);
  const submit = result.tools.find((tool) => tool.name === "create_in_app_purchase_review_item")!;
  assert.equal(submit.annotations?.destructiveHint, true);
  const betaTester = result.tools.find((tool) => tool.name === "create_beta_tester")!;
  assert.equal((betaTester.inputSchema.required as string[]).includes("betaGroupIds"), true);
});

test("returns configuration status without credential values", async (t) => {
  const server = createMcpServer(new AppStoreConnectTools(config, fakeClient));
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "asc_status", arguments: {} });
  const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
  assert.match(text, /"transport": "stdio"/);
  assert.equal(text.includes("private\/key"), false);
  assert.equal(text.includes('"keyId"'), false);
});
