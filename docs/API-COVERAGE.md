# App Store Connect API coverage

Validated against Apple's official App Store Connect OpenAPI specification:

- OpenAPI: `3.0.1`
- Specification version: `4.4.1`
- Retrieved: `2026-07-26`
- Source: <https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip>

## Covered resources

| Area | Official operations used |
|---|---|
| Apps | `apps_getCollection`, `apps_getInstance` |
| Builds | `apps_builds_getToManyRelated`, `builds_getInstance` |
| App Store versions | `apps_appStoreVersions_getToManyRelated`, create/update, build relationship |
| Version localizations | list/create/update App Store version localizations |
| IAP V2 | list/get/create/update `/v2/inAppPurchases` |
| IAP versions | list/create `/v1/inAppPurchaseVersions` |
| IAP localizations V2 | version-scoped list `/v1/inAppPurchaseVersions/{id}/localizations`; create `/v2/inAppPurchaseLocalizations` |
| IAP pricing | price points via V2 relationship; price schedules via current V1 create/read operations |
| IAP availability | V2 read relationship; current V1 availability create operation |
| IAP review | unified `/v1/reviewSubmissionItems` relationship to `inAppPurchaseVersion` |
| TestFlight | app beta groups, create group/tester, group tester/build relationships |
| App Review | app review submissions list/create/update-submitted |
| Territories | `territories_getCollection` |

## Deliberately excluded

- Generic arbitrary-path/request tools.
- Users-and-Access administration.
- Certificates, devices, profiles, Merchant IDs, and signing mutations.
- Sales/finance and analytics downloads.
- Asset uploads and upload-operation URLs.
- Subscription management.
- Deprecated parent-scoped IAP localization and standalone IAP-submission operations.
- HTTP/SSE transports, OAuth, dynamic client registration, telemetry, and hosted deployment.

Exclusions reduce privilege and prevent this server becoming a generic bearer-token proxy. Additions require official-schema evidence, a narrow tool contract, ownership checks, and failing security tests before implementation.

## Compatibility policy

Before a release:

1. Download Apple's current official OpenAPI specification.
2. Record its `info.version` here.
3. Confirm every path and operation used by `src/tools.ts` still exists.
4. Compare required request fields and enum values.
5. Run unit, MCP protocol, mock-Apple integration, build, audit, and package-content checks.
6. Run read-only calls with a dedicated least-privileged key.
7. Test mutations only against an explicitly selected app and only with user approval.
