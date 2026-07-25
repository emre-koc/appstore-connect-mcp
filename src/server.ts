import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AppStoreConnectTools, InAppPurchaseType, Platform } from "./tools.js";
import { redactSensitive } from "./security.js";

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { result: value },
  };
}

function safeHandler<T extends Record<string, unknown>>(handler: (args: T) => Promise<unknown> | unknown) {
  return async (args: T) => {
    try {
      return result(await handler(args));
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: redactSensitive(error) }] };
    }
  };
}

const appId = z.string().min(1).describe("App Store Connect app resource ID; must be locally allowlisted");
const resourceId = z.string().min(1);
const confirmation = z.string().min(1).describe("Exact confirmation phrase reported by asc_status/tool error, for example EXECUTE operation FOR app-id");
const platform = z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]);
const iapType = z.enum(["CONSUMABLE", "NON_CONSUMABLE", "NON_RENEWING_SUBSCRIPTION"]);

export function createMcpServer(tools: AppStoreConnectTools): McpServer {
  const server = new McpServer({ name: "appstore-connect-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.registerTool("asc_status", {
    description: "Show safe local server status, app allowlist, transport, and whether mutations are enabled. Never returns credentials.",
    inputSchema: {}, annotations: readAnnotations,
  }, safeHandler(() => tools.status()));

  server.registerTool("list_apps", {
    description: "List App Store Connect apps, constrained by ASC_ALLOWED_APP_IDS when configured.",
    inputSchema: { bundleId: z.string().optional(), name: z.string().optional() }, annotations: readAnnotations,
  }, safeHandler((args) => tools.listApps(args)));

  server.registerTool("get_app", {
    description: "Get one allowlisted App Store Connect app.",
    inputSchema: { appId }, annotations: readAnnotations,
  }, safeHandler(({ appId }) => tools.getApp(appId)));

  server.registerTool("list_builds", {
    description: "List builds for an allowlisted app.",
    inputSchema: { appId }, annotations: readAnnotations,
  }, safeHandler(({ appId }) => tools.listBuilds(appId)));

  server.registerTool("get_build", {
    description: "Get a build after verifying it belongs to the allowlisted app.",
    inputSchema: { appId, buildId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, buildId }) => tools.getBuild(appId, buildId)));

  server.registerTool("list_app_store_versions", {
    description: "List App Store versions for an allowlisted app.",
    inputSchema: { appId, platform: platform.optional() }, annotations: readAnnotations,
  }, safeHandler(({ appId, platform }) => tools.listAppStoreVersions(appId, platform as Platform | undefined)));

  server.registerTool("get_app_store_version", {
    description: "Get an App Store version after app ownership verification.",
    inputSchema: { appId, versionId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, versionId }) => tools.getAppStoreVersion(appId, versionId)));

  server.registerTool("list_version_localizations", {
    description: "List metadata localizations for an App Store version.",
    inputSchema: { appId, versionId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, versionId }) => tools.listVersionLocalizations(appId, versionId)));

  server.registerTool("list_in_app_purchases_v2", {
    description: "List V2 in-app purchases for an allowlisted app.",
    inputSchema: { appId }, annotations: readAnnotations,
  }, safeHandler(({ appId }) => tools.listInAppPurchases(appId)));

  server.registerTool("get_in_app_purchase_v2", {
    description: "Get one V2 in-app purchase after app ownership verification.",
    inputSchema: { appId, inAppPurchaseId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, inAppPurchaseId }) => tools.getInAppPurchase(appId, inAppPurchaseId)));

  server.registerTool("list_in_app_purchase_versions", {
    description: "List versions for a V2 in-app purchase.",
    inputSchema: { appId, inAppPurchaseId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, inAppPurchaseId }) => tools.listInAppPurchaseVersions(appId, inAppPurchaseId)));

  server.registerTool("list_in_app_purchase_version_localizations", {
    description: "List current V2 localizations through a verified IAP version (App Store Connect API 4.4.1).",
    inputSchema: { appId, inAppPurchaseId: resourceId, versionId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, inAppPurchaseId, versionId }) => tools.listInAppPurchaseVersionLocalizations(appId, inAppPurchaseId, versionId)));

  server.registerTool("list_in_app_purchase_price_points", {
    description: "List valid Apple price points for an in-app purchase, optionally filtered by territory ID.",
    inputSchema: { appId, inAppPurchaseId: resourceId, territory: z.string().optional() }, annotations: readAnnotations,
  }, safeHandler(({ appId, inAppPurchaseId, territory }) => tools.listInAppPurchasePricePoints(appId, inAppPurchaseId, territory)));

  server.registerTool("get_in_app_purchase_price_schedule", {
    description: "Get the current manual and automatic price schedule for an in-app purchase.",
    inputSchema: { appId, inAppPurchaseId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, inAppPurchaseId }) => tools.getInAppPurchasePriceSchedule(appId, inAppPurchaseId)));

  server.registerTool("get_in_app_purchase_availability", {
    description: "Get territory availability for an in-app purchase.",
    inputSchema: { appId, inAppPurchaseId: resourceId }, annotations: readAnnotations,
  }, safeHandler(({ appId, inAppPurchaseId }) => tools.getInAppPurchaseAvailability(appId, inAppPurchaseId)));

  server.registerTool("list_territories", {
    description: "List Apple territory IDs and currencies used by availability and pricing operations.",
    inputSchema: {}, annotations: readAnnotations,
  }, safeHandler(() => tools.listTerritories()));

  server.registerTool("list_beta_groups", {
    description: "List TestFlight beta groups for an allowlisted app.",
    inputSchema: { appId }, annotations: readAnnotations,
  }, safeHandler(({ appId }) => tools.listBetaGroups(appId)));

  server.registerTool("list_review_submissions", {
    description: "List App Review submissions for an allowlisted app.",
    inputSchema: { appId }, annotations: readAnnotations,
  }, safeHandler(({ appId }) => tools.listReviewSubmissions(appId)));

  server.registerTool("create_app_store_version", {
    description: "Create an App Store version. Disabled unless ASC_ENABLE_MUTATIONS=true; requires exact confirmation EXECUTE create_app_store_version FOR <appId>.",
    inputSchema: { appId, platform, versionString: z.string().min(1), copyright: z.string().optional(), releaseType: z.enum(["MANUAL", "AFTER_APPROVAL", "SCHEDULED"]).optional(), earliestReleaseDate: z.iso.datetime().optional(), confirmation },
    annotations: writeAnnotations,
  }, safeHandler((args) => tools.createAppStoreVersion({ ...args, platform: args.platform as Platform })));

  server.registerTool("update_app_store_version", {
    description: "Update a verified App Store version. Requires enabled mutations and exact confirmation EXECUTE update_app_store_version FOR <appId>.",
    inputSchema: { appId, versionId: resourceId, copyright: z.string().optional(), releaseType: z.enum(["MANUAL", "AFTER_APPROVAL", "SCHEDULED"]).optional(), earliestReleaseDate: z.iso.datetime().nullable().optional(), confirmation },
    annotations: writeAnnotations,
  }, safeHandler((args) => tools.updateAppStoreVersion(args)));

  server.registerTool("attach_build_to_version", {
    description: "Attach a build to an App Store version after verifying both belong to the app. Requires exact confirmation EXECUTE attach_build_to_version FOR <appId>.",
    inputSchema: { appId, versionId: resourceId, buildId: resourceId, confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.attachBuildToVersion(args)));

  const localizationFields = {
    description: z.string().optional(), keywords: z.string().optional(), marketingUrl: z.url().optional(), promotionalText: z.string().optional(), supportUrl: z.url().optional(), whatsNew: z.string().optional(),
  };
  server.registerTool("create_version_localization", {
    description: "Create localized App Store metadata. Requires exact confirmation EXECUTE create_version_localization FOR <appId>.",
    inputSchema: { appId, versionId: resourceId, locale: z.string().min(2), ...localizationFields, confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createVersionLocalization(args)));

  server.registerTool("update_version_localization", {
    description: "Update verified localized App Store metadata. Requires exact confirmation EXECUTE update_version_localization FOR <appId>.",
    inputSchema: { appId, versionId: resourceId, localizationId: resourceId, ...localizationFields, confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.updateVersionLocalization(args)));

  server.registerTool("create_in_app_purchase_v2", {
    description: "Create a V2 in-app purchase using Apple's current API. Requires exact confirmation EXECUTE create_in_app_purchase_v2 FOR <appId>.",
    inputSchema: { appId, name: z.string().min(1), productId: z.string().min(1), inAppPurchaseType: iapType, reviewNote: z.string().optional(), familySharable: z.boolean().optional(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createInAppPurchaseV2({ ...args, inAppPurchaseType: args.inAppPurchaseType as InAppPurchaseType })));

  server.registerTool("update_in_app_purchase_v2", {
    description: "Update a verified V2 in-app purchase. Requires exact confirmation EXECUTE update_in_app_purchase_v2 FOR <appId>.",
    inputSchema: { appId, inAppPurchaseId: resourceId, name: z.string().optional(), reviewNote: z.string().optional(), familySharable: z.boolean().optional(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.updateInAppPurchaseV2(args)));

  server.registerTool("create_in_app_purchase_version", {
    description: "Create an IAP version needed for V2 localizations. Requires exact confirmation EXECUTE create_in_app_purchase_version FOR <appId>.",
    inputSchema: { appId, inAppPurchaseId: resourceId, confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createInAppPurchaseVersion(args)));

  server.registerTool("create_in_app_purchase_localization_v2", {
    description: "Create a V2 IAP localization attached to an IAP version. Requires exact confirmation EXECUTE create_in_app_purchase_localization_v2 FOR <appId>.",
    inputSchema: { appId, inAppPurchaseId: resourceId, versionId: resourceId, locale: z.string().min(2), name: z.string().min(1), description: z.string().optional(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createInAppPurchaseLocalization(args)));

  server.registerTool("create_in_app_purchase_availability", {
    description: "Set initial territory availability for a verified IAP. Requires exact confirmation EXECUTE create_in_app_purchase_availability FOR <appId>.",
    inputSchema: { appId, inAppPurchaseId: resourceId, territoryIds: z.array(z.string().min(2)).min(1).max(200), availableInNewTerritories: z.boolean(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createInAppPurchaseAvailability(args)));

  server.registerTool("create_in_app_purchase_price_schedule", {
    description: "Create an IAP price schedule from an Apple price-point ID and base territory. Requires exact confirmation EXECUTE create_in_app_purchase_price_schedule FOR <appId>.",
    inputSchema: { appId, inAppPurchaseId: resourceId, baseTerritoryId: z.string().min(2), pricePointId: resourceId, startDate: z.iso.date().optional(), endDate: z.iso.date().optional(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createInAppPurchasePriceSchedule(args)));

  server.registerTool("create_in_app_purchase_review_item", {
    description: "Add a verified IAP version to a verified unified review submission. Requires exact confirmation EXECUTE create_in_app_purchase_review_item FOR <appId>.",
    inputSchema: { appId, inAppPurchaseId: resourceId, versionId: resourceId, reviewSubmissionId: resourceId, confirmation }, annotations: destructiveAnnotations,
  }, safeHandler((args) => tools.createInAppPurchaseReviewItem(args)));

  server.registerTool("create_beta_group", {
    description: "Create a TestFlight beta group for an allowlisted app. Requires exact confirmation EXECUTE create_beta_group FOR <appId>.",
    inputSchema: { appId, name: z.string().min(1), isInternalGroup: z.boolean().optional(), hasAccessToAllBuilds: z.boolean().optional(), feedbackEnabled: z.boolean().optional(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createBetaGroup(args)));

  server.registerTool("create_beta_tester", {
    description: "Create a TestFlight beta tester, optionally in verified groups. Requires exact confirmation EXECUTE create_beta_tester FOR <appId>.",
    inputSchema: { appId, email: z.email(), firstName: z.string().optional(), lastName: z.string().optional(), betaGroupIds: z.array(resourceId).min(1).max(50), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createBetaTester(args)));

  server.registerTool("add_beta_testers_to_group", {
    description: "Add existing beta testers to a verified app beta group. Requires exact confirmation EXECUTE add_beta_testers_to_group FOR <appId>.",
    inputSchema: { appId, betaGroupId: resourceId, betaTesterIds: z.array(resourceId).min(1).max(200), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.addBetaTestersToGroup(args)));

  server.registerTool("add_builds_to_beta_group", {
    description: "Add verified app builds to a verified beta group. Requires exact confirmation EXECUTE add_builds_to_beta_group FOR <appId>.",
    inputSchema: { appId, betaGroupId: resourceId, buildIds: z.array(resourceId).min(1).max(100), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.addBuildsToBetaGroup(args)));

  server.registerTool("create_review_submission", {
    description: "Create an App Review submission container. Requires exact confirmation EXECUTE create_review_submission FOR <appId>.",
    inputSchema: { appId, platform: platform.optional(), confirmation }, annotations: writeAnnotations,
  }, safeHandler((args) => tools.createReviewSubmission({ ...args, platform: args.platform as Platform | undefined })));

  server.registerTool("submit_review_submission", {
    description: "Submit a verified review submission to Apple. Requires exact confirmation EXECUTE submit_review_submission FOR <appId>.",
    inputSchema: { appId, reviewSubmissionId: resourceId, confirmation }, annotations: destructiveAnnotations,
  }, safeHandler((args) => tools.submitReviewSubmission(args)));

  return server;
}
