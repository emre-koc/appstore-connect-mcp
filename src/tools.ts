import type { AppStoreConnectConfig } from "./config.js";
import type { JsonApiDocument, JsonApiResource, Query } from "./client.js";
import { assertAllowedApp, assertMutationAllowed } from "./security.js";

export interface AppStoreConnectClientLike {
  get(path: string, query?: Query): Promise<JsonApiDocument<any>>;
  getAll(path: string, query?: Query, limits?: { maxPages?: number; maxItems?: number }): Promise<JsonApiDocument<readonly JsonApiResource[]>>;
  post(path: string, body: unknown): Promise<JsonApiDocument<any>>;
  patch(path: string, body: unknown): Promise<JsonApiDocument<any>>;
  delete(path: string): Promise<void>;
}

export type Platform = "IOS" | "MAC_OS" | "TV_OS" | "VISION_OS";
export type InAppPurchaseType = "CONSUMABLE" | "NON_CONSUMABLE" | "NON_RENEWING_SUBSCRIPTION";

interface MutationBase {
  readonly appId: string;
  readonly confirmation: string;
}

function compactAttributes<T extends Record<string, unknown>>(attributes: T): Partial<T> {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export class AppStoreConnectTools {
  constructor(
    private readonly config: AppStoreConnectConfig,
    private readonly client: AppStoreConnectClientLike,
  ) {}

  status(): Record<string, unknown> {
    return {
      transport: "stdio",
      appleApiOrigin: "https://api.appstoreconnect.apple.com",
      mutationsEnabled: this.config.mutationsEnabled,
      allowedAppIds: [...this.config.allowedAppIds],
      credentialMode: "private-key-file",
    };
  }

  async listApps(filters: { bundleId?: string | undefined; name?: string | undefined } = {}): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    const query: Query = compactAttributes({
      "filter[id]": this.config.allowedAppIds.size ? [...this.config.allowedAppIds] : undefined,
      "filter[bundleId]": filters.bundleId,
      "filter[name]": filters.name,
      limit: 200,
    });
    const result = await this.client.getAll("/v1/apps", query);
    if (this.config.allowedAppIds.size === 0) return result;
    return { ...result, data: result.data.filter((app) => this.config.allowedAppIds.has(app.id)) };
  }

  async getApp(appId: string): Promise<JsonApiDocument> {
    this.assertApp(appId);
    return this.client.get(`/v1/apps/${appId}`);
  }

  async listBuilds(appId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    this.assertApp(appId);
    return this.client.getAll(`/v1/apps/${appId}/builds`, { limit: 200 });
  }

  async getBuild(appId: string, buildId: string): Promise<JsonApiDocument> {
    await this.assertResource(`/v1/apps/${appId}/builds`, appId, buildId, "build");
    return this.client.get(`/v1/builds/${buildId}`);
  }

  async listAppStoreVersions(appId: string, platform?: Platform | undefined): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    this.assertApp(appId);
    return this.client.getAll(`/v1/apps/${appId}/appStoreVersions`, compactAttributes({ "filter[platform]": platform, limit: 200 }));
  }

  async getAppStoreVersion(appId: string, versionId: string): Promise<JsonApiDocument> {
    await this.assertVersion(appId, versionId);
    return this.client.get(`/v1/appStoreVersions/${versionId}`);
  }

  async listVersionLocalizations(appId: string, versionId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    await this.assertVersion(appId, versionId);
    return this.client.getAll(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`, { limit: 200 });
  }

  async listInAppPurchases(appId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    this.assertApp(appId);
    return this.client.getAll(`/v1/apps/${appId}/inAppPurchasesV2`, { limit: 200 });
  }

  async getInAppPurchase(appId: string, inAppPurchaseId: string): Promise<JsonApiDocument> {
    await this.assertIap(appId, inAppPurchaseId);
    return this.client.get(`/v2/inAppPurchases/${inAppPurchaseId}`);
  }

  async listInAppPurchaseVersions(appId: string, inAppPurchaseId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    await this.assertIap(appId, inAppPurchaseId);
    return this.client.getAll(`/v2/inAppPurchases/${inAppPurchaseId}/versions`, { limit: 200 });
  }

  async listInAppPurchaseVersionLocalizations(appId: string, inAppPurchaseId: string, versionId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    await this.assertIapVersion(appId, inAppPurchaseId, versionId);
    return this.client.getAll(`/v1/inAppPurchaseVersions/${versionId}/localizations`, { limit: 200 });
  }

  async listInAppPurchasePricePoints(appId: string, inAppPurchaseId: string, territory?: string | undefined): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    await this.assertIap(appId, inAppPurchaseId);
    return this.client.getAll(`/v2/inAppPurchases/${inAppPurchaseId}/pricePoints`, compactAttributes({ "filter[territory]": territory, limit: 200 }));
  }

  async getInAppPurchasePriceSchedule(appId: string, inAppPurchaseId: string): Promise<JsonApiDocument> {
    await this.assertIap(appId, inAppPurchaseId);
    return this.client.get(`/v2/inAppPurchases/${inAppPurchaseId}/iapPriceSchedule`, { include: ["baseTerritory", "manualPrices", "automaticPrices"] });
  }

  async getInAppPurchaseAvailability(appId: string, inAppPurchaseId: string): Promise<JsonApiDocument> {
    await this.assertIap(appId, inAppPurchaseId);
    return this.client.get(`/v2/inAppPurchases/${inAppPurchaseId}/inAppPurchaseAvailability`, { include: ["availableTerritories"] });
  }

  async listTerritories(): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    return this.client.getAll("/v1/territories", { limit: 200 });
  }

  async listBetaGroups(appId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    this.assertApp(appId);
    return this.client.getAll(`/v1/apps/${appId}/betaGroups`, { limit: 200 });
  }

  async listReviewSubmissions(appId: string): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    this.assertApp(appId);
    return this.client.getAll(`/v1/apps/${appId}/reviewSubmissions`, { limit: 200 });
  }

  async createAppStoreVersion(args: MutationBase & {
    platform: Platform;
    versionString: string;
    copyright?: string | undefined;
    releaseType?: "MANUAL" | "AFTER_APPROVAL" | "SCHEDULED" | undefined;
    earliestReleaseDate?: string | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_app_store_version", args);
    return this.client.post("/v1/appStoreVersions", {
      data: {
        type: "appStoreVersions",
        attributes: compactAttributes({
          platform: args.platform,
          versionString: args.versionString,
          copyright: args.copyright,
          releaseType: args.releaseType,
          earliestReleaseDate: args.earliestReleaseDate,
        }),
        relationships: { app: { data: { type: "apps", id: args.appId } } },
      },
    });
  }

  async updateAppStoreVersion(args: MutationBase & {
    versionId: string;
    copyright?: string | undefined;
    releaseType?: "MANUAL" | "AFTER_APPROVAL" | "SCHEDULED" | undefined;
    earliestReleaseDate?: string | null | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("update_app_store_version", args);
    await this.assertVersion(args.appId, args.versionId);
    return this.client.patch(`/v1/appStoreVersions/${args.versionId}`, {
      data: {
        type: "appStoreVersions",
        id: args.versionId,
        attributes: compactAttributes({ copyright: args.copyright, releaseType: args.releaseType, earliestReleaseDate: args.earliestReleaseDate }),
      },
    });
  }

  async attachBuildToVersion(args: MutationBase & { versionId: string; buildId: string }): Promise<JsonApiDocument> {
    this.authorizeMutation("attach_build_to_version", args);
    await Promise.all([this.assertVersion(args.appId, args.versionId), this.assertResource(`/v1/apps/${args.appId}/builds`, args.appId, args.buildId, "build")]);
    return this.client.patch(`/v1/appStoreVersions/${args.versionId}/relationships/build`, {
      data: { type: "builds", id: args.buildId },
    });
  }

  async createVersionLocalization(args: MutationBase & {
    versionId: string;
    locale: string;
    description?: string | undefined;
    keywords?: string | undefined;
    marketingUrl?: string | undefined;
    promotionalText?: string | undefined;
    supportUrl?: string | undefined;
    whatsNew?: string | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_version_localization", args);
    await this.assertVersion(args.appId, args.versionId);
    return this.client.post("/v1/appStoreVersionLocalizations", {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: compactAttributes({ locale: args.locale, description: args.description, keywords: args.keywords, marketingUrl: args.marketingUrl, promotionalText: args.promotionalText, supportUrl: args.supportUrl, whatsNew: args.whatsNew }),
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: args.versionId } } },
      },
    });
  }

  async updateVersionLocalization(args: MutationBase & {
    versionId: string;
    localizationId: string;
    description?: string | undefined;
    keywords?: string | undefined;
    marketingUrl?: string | undefined;
    promotionalText?: string | undefined;
    supportUrl?: string | undefined;
    whatsNew?: string | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("update_version_localization", args);
    await this.assertNestedResource(`/v1/appStoreVersions/${args.versionId}/appStoreVersionLocalizations`, args.appId, args.versionId, args.localizationId, "localization");
    return this.client.patch(`/v1/appStoreVersionLocalizations/${args.localizationId}`, {
      data: { type: "appStoreVersionLocalizations", id: args.localizationId, attributes: compactAttributes({ description: args.description, keywords: args.keywords, marketingUrl: args.marketingUrl, promotionalText: args.promotionalText, supportUrl: args.supportUrl, whatsNew: args.whatsNew }) },
    });
  }

  async createInAppPurchaseV2(args: MutationBase & {
    name: string;
    productId: string;
    inAppPurchaseType: InAppPurchaseType;
    reviewNote?: string | undefined;
    familySharable?: boolean | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_in_app_purchase_v2", args);
    return this.client.post("/v2/inAppPurchases", {
      data: {
        type: "inAppPurchases",
        attributes: compactAttributes({ name: args.name, productId: args.productId, inAppPurchaseType: args.inAppPurchaseType, reviewNote: args.reviewNote, familySharable: args.familySharable }),
        relationships: { app: { data: { type: "apps", id: args.appId } } },
      },
    });
  }

  async updateInAppPurchaseV2(args: MutationBase & {
    inAppPurchaseId: string;
    name?: string | undefined;
    reviewNote?: string | undefined;
    familySharable?: boolean | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("update_in_app_purchase_v2", args);
    await this.assertIap(args.appId, args.inAppPurchaseId);
    return this.client.patch(`/v2/inAppPurchases/${args.inAppPurchaseId}`, {
      data: { type: "inAppPurchases", id: args.inAppPurchaseId, attributes: compactAttributes({ name: args.name, reviewNote: args.reviewNote, familySharable: args.familySharable }) },
    });
  }

  async createInAppPurchaseVersion(args: MutationBase & { inAppPurchaseId: string }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_in_app_purchase_version", args);
    await this.assertIap(args.appId, args.inAppPurchaseId);
    return this.client.post("/v1/inAppPurchaseVersions", {
      data: { type: "inAppPurchaseVersions", relationships: { inAppPurchase: { data: { type: "inAppPurchases", id: args.inAppPurchaseId } } } },
    });
  }

  async createInAppPurchaseLocalization(args: MutationBase & {
    inAppPurchaseId: string;
    versionId: string;
    locale: string;
    name: string;
    description?: string | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_in_app_purchase_localization_v2", args);
    await this.assertIapVersion(args.appId, args.inAppPurchaseId, args.versionId);
    return this.client.post("/v2/inAppPurchaseLocalizations", {
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: compactAttributes({ locale: args.locale, name: args.name, description: args.description }),
        relationships: { version: { data: { type: "inAppPurchaseVersions", id: args.versionId } } },
      },
    });
  }

  async createInAppPurchaseAvailability(args: MutationBase & {
    inAppPurchaseId: string;
    territoryIds: readonly string[];
    availableInNewTerritories: boolean;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_in_app_purchase_availability", args);
    await this.assertIap(args.appId, args.inAppPurchaseId);
    return this.client.post("/v1/inAppPurchaseAvailabilities", {
      data: {
        type: "inAppPurchaseAvailabilities",
        attributes: { availableInNewTerritories: args.availableInNewTerritories },
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: args.inAppPurchaseId } },
          availableTerritories: { data: args.territoryIds.map((id) => ({ type: "territories", id })) },
        },
      },
    });
  }

  async createInAppPurchasePriceSchedule(args: MutationBase & {
    inAppPurchaseId: string;
    baseTerritoryId: string;
    pricePointId: string;
    startDate?: string | undefined;
    endDate?: string | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_in_app_purchase_price_schedule", args);
    await this.assertIap(args.appId, args.inAppPurchaseId);
    await this.assertResource(`/v2/inAppPurchases/${args.inAppPurchaseId}/pricePoints`, args.appId, args.pricePointId, "price point");
    const manualPriceId = "manual-price-1";
    return this.client.post("/v1/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: args.inAppPurchaseId } },
          baseTerritory: { data: { type: "territories", id: args.baseTerritoryId } },
          manualPrices: { data: [{ type: "inAppPurchasePrices", id: manualPriceId }] },
        },
      },
      included: [{
        type: "inAppPurchasePrices",
        id: manualPriceId,
        attributes: compactAttributes({ startDate: args.startDate, endDate: args.endDate }),
        relationships: {
          inAppPurchaseV2: { data: { type: "inAppPurchases", id: args.inAppPurchaseId } },
          inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: args.pricePointId } },
        },
      }],
    });
  }

  async createInAppPurchaseReviewItem(args: MutationBase & { inAppPurchaseId: string; versionId: string; reviewSubmissionId: string }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_in_app_purchase_review_item", args);
    await this.assertIapVersion(args.appId, args.inAppPurchaseId, args.versionId);
    await this.assertResource(`/v1/apps/${args.appId}/reviewSubmissions`, args.appId, args.reviewSubmissionId, "review submission");
    return this.client.post("/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: args.reviewSubmissionId } },
          inAppPurchaseVersion: { data: { type: "inAppPurchaseVersions", id: args.versionId } },
        },
      },
    });
  }

  async createBetaGroup(args: MutationBase & {
    name: string;
    isInternalGroup?: boolean | undefined;
    hasAccessToAllBuilds?: boolean | undefined;
    feedbackEnabled?: boolean | undefined;
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_beta_group", args);
    return this.client.post("/v1/betaGroups", {
      data: {
        type: "betaGroups",
        attributes: compactAttributes({ name: args.name, isInternalGroup: args.isInternalGroup, hasAccessToAllBuilds: args.hasAccessToAllBuilds, feedbackEnabled: args.feedbackEnabled }),
        relationships: { app: { data: { type: "apps", id: args.appId } } },
      },
    });
  }

  async createBetaTester(args: MutationBase & {
    email: string;
    firstName?: string | undefined;
    lastName?: string | undefined;
    betaGroupIds: readonly string[];
  }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_beta_tester", args);
    if (args.betaGroupIds.length === 0) throw new Error("create_beta_tester requires at least one verified beta group");
    for (const groupId of args.betaGroupIds) await this.assertBetaGroup(args.appId, groupId);
    return this.client.post("/v1/betaTesters", {
      data: {
        type: "betaTesters",
        attributes: compactAttributes({ email: args.email, firstName: args.firstName, lastName: args.lastName }),
        relationships: { betaGroups: { data: args.betaGroupIds.map((id) => ({ type: "betaGroups", id })) } },
      },
    });
  }

  async addBetaTestersToGroup(args: MutationBase & { betaGroupId: string; betaTesterIds: readonly string[] }): Promise<JsonApiDocument> {
    this.authorizeMutation("add_beta_testers_to_group", args);
    await this.assertBetaGroup(args.appId, args.betaGroupId);
    return this.client.post(`/v1/betaGroups/${args.betaGroupId}/relationships/betaTesters`, {
      data: args.betaTesterIds.map((id) => ({ type: "betaTesters", id })),
    });
  }

  async addBuildsToBetaGroup(args: MutationBase & { betaGroupId: string; buildIds: readonly string[] }): Promise<JsonApiDocument> {
    this.authorizeMutation("add_builds_to_beta_group", args);
    await this.assertBetaGroup(args.appId, args.betaGroupId);
    for (const buildId of args.buildIds) await this.assertResource(`/v1/apps/${args.appId}/builds`, args.appId, buildId, "build");
    return this.client.post(`/v1/betaGroups/${args.betaGroupId}/relationships/builds`, {
      data: args.buildIds.map((id) => ({ type: "builds", id })),
    });
  }

  async createReviewSubmission(args: MutationBase & { platform?: Platform | undefined }): Promise<JsonApiDocument> {
    this.authorizeMutation("create_review_submission", args);
    return this.client.post("/v1/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        ...(args.platform ? { attributes: { platform: args.platform } } : {}),
        relationships: { app: { data: { type: "apps", id: args.appId } } },
      },
    });
  }

  async submitReviewSubmission(args: MutationBase & { reviewSubmissionId: string }): Promise<JsonApiDocument> {
    this.authorizeMutation("submit_review_submission", args);
    await this.assertResource(`/v1/apps/${args.appId}/reviewSubmissions`, args.appId, args.reviewSubmissionId, "review submission");
    return this.client.patch(`/v1/reviewSubmissions/${args.reviewSubmissionId}`, {
      data: { type: "reviewSubmissions", id: args.reviewSubmissionId, attributes: { submitted: true } },
    });
  }

  private assertApp(appId: string): void {
    assertAllowedApp(appId, this.config.allowedAppIds);
  }

  private authorizeMutation(operation: string, args: MutationBase): void {
    assertMutationAllowed(this.config, operation, args.appId, args.confirmation);
  }

  private async assertResource(path: string, appId: string, resourceId: string, label: string): Promise<void> {
    this.assertApp(appId);
    const result = await this.client.getAll(path, { limit: 200 }, { maxPages: 20, maxItems: 1_000 });
    if (!result.data.some((resource) => resource.id === resourceId)) throw new Error(`${label} ${resourceId} does not belong to allowed app ${appId}`);
  }

  private assertVersion(appId: string, versionId: string): Promise<void> {
    return this.assertResource(`/v1/apps/${appId}/appStoreVersions`, appId, versionId, "version");
  }

  private assertIap(appId: string, inAppPurchaseId: string): Promise<void> {
    return this.assertResource(`/v1/apps/${appId}/inAppPurchasesV2`, appId, inAppPurchaseId, "in-app purchase");
  }

  private assertBetaGroup(appId: string, betaGroupId: string): Promise<void> {
    return this.assertResource(`/v1/apps/${appId}/betaGroups`, appId, betaGroupId, "beta group");
  }

  private async assertNestedResource(path: string, appId: string, parentId: string, resourceId: string, label: string): Promise<void> {
    await this.assertVersion(appId, parentId);
    await this.assertResource(path, appId, resourceId, label);
  }

  private async assertIapVersion(appId: string, inAppPurchaseId: string, versionId: string): Promise<void> {
    await this.assertIap(appId, inAppPurchaseId);
    const result = await this.client.getAll(`/v2/inAppPurchases/${inAppPurchaseId}/versions`, { limit: 200 }, { maxPages: 20, maxItems: 1_000 });
    if (!result.data.some((resource) => resource.id === versionId)) throw new Error(`in-app purchase version ${versionId} does not belong to ${inAppPurchaseId}`);
  }
}
