# App Store Connect MCP

[![npm version](https://img.shields.io/npm/v/@emre-koc/appstore-connect-mcp)](https://www.npmjs.com/package/@emre-koc/appstore-connect-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A secure, local-only Model Context Protocol server for Apple's App Store Connect API.

- **Transport:** stdio only — no HTTP listener, OAuth, Auth0, telemetry, or hosted relay.
- **Credentials:** short-lived ES256 JWTs generated from a local mode-`600` `.p8` file.
- **Network:** authenticated API calls are fixed to `https://api.appstoreconnect.apple.com`.
- **Scope:** optional app-resource-ID allowlist, required whenever mutations are enabled.
- **Mutations:** disabled by default and require an exact operation-specific confirmation phrase.
- **API basis:** Apple App Store Connect OpenAPI specification **4.4.1**, downloaded from Apple's official documentation on 2026-07-26.

> This project is independent and is not affiliated with or endorsed by Apple Inc.

## Quick start

```bash
# Install globally
npm install -g @emre-koc/appstore-connect-mcp

# Or run without installing
npx @emre-koc/appstore-connect-mcp --env-file=~/.config/appstore-connect-mcp/env
```

List your apps (safe read-only call — no mutations):

```bash
npx @emre-koc/appstore-connect-mcp --env-file=~/.config/appstore-connect-mcp/env \
  --tool=list_apps
```

## Requirements

- Node.js 22 or newer
- An App Store Connect API key with only the role needed for the tools you intend to use
- The original `.p8` private key downloaded from App Store Connect

## Security first

This server can access unpublished app data and, when explicitly enabled, change App Store Connect resources. Before using it:

- create a dedicated, least-privileged App Store Connect API key;
- keep the `.p8` key outside the repository with exact mode `600`;
- configure `ASC_ALLOWED_APP_IDS` even for read-only use;
- leave `ASC_ENABLE_MUTATIONS=false` unless performing a planned change;
- review the [threat model](docs/THREAT-MODEL.md) and [security policy](SECURITY.md).

No App Store Connect credentials are needed to build or run the test suite.

## Install from source

```bash
git clone https://github.com/emre-koc/appstore-connect-mcp.git
cd appstore-connect-mcp
npm ci --ignore-scripts
npm run check
npm test
npm run build
```

Dependencies and transitive security overrides are pinned in `package-lock.json`.

## Credentials

Do **not** put credentials in this repository. Create a private configuration directory:

```bash
mkdir -p ~/.config/appstore-connect-mcp
cp /secure/location/AuthKey_EXAMPLE.p8 ~/.config/appstore-connect-mcp/AuthKey_EXAMPLE.p8
chmod 600 ~/.config/appstore-connect-mcp/AuthKey_EXAMPLE.p8
cp .env.example ~/.config/appstore-connect-mcp/env
chmod 600 ~/.config/appstore-connect-mcp/env
```

Edit `~/.config/appstore-connect-mcp/env` locally. Never paste its contents into an issue, commit, chat, or log.

Required variables:

```dotenv
ASC_KEY_ID=YOUR_KEY_ID
ASC_ISSUER_ID=YOUR_ISSUER_ID
ASC_PRIVATE_KEY_PATH=/absolute/path/to/AuthKey_YOUR_KEY_ID.p8
```

Recommended read-only app scoping:

```dotenv
ASC_ALLOWED_APP_IDS=123456789
ASC_ENABLE_MUTATIONS=false
```

`ASC_ALLOWED_APP_IDS` uses App Store Connect **resource IDs**, not bundle IDs or public numeric App Store IDs. Use `list_apps` once with mutations disabled to discover the correct ID.

## Hermes configuration

Use Node's built-in `--env-file` support so credentials stay out of Hermes YAML. Resolve both paths locally with `command -v node` and `pwd`; MCP client configuration requires absolute paths and does not expand `~`:

```yaml
mcp_servers:
  appstore_connect:
    command: "/absolute/path/to/node"
    args:
      - "--env-file=/absolute/path/to/appstore-connect-mcp-env"
      - "/absolute/path/to/appstore-connect-mcp/dist/index.js"
    connect_timeout: 30
    timeout: 120
    sampling:
      enabled: false
```

Restart Hermes after adding the configuration. Tools appear with the `mcp_appstore_connect_` prefix.

## Configuration reference

| Variable | Required | Purpose |
|---|---:|---|
| `ASC_KEY_ID` | Yes | App Store Connect API key ID |
| `ASC_ISSUER_ID` | Yes | App Store Connect API issuer ID |
| `ASC_PRIVATE_KEY_PATH` | Yes | Absolute path to the mode-`600` `.p8` key file |
| `ASC_ALLOWED_APP_IDS` | Recommended | Comma-separated App Store Connect app resource IDs; mandatory for mutations |
| `ASC_ENABLE_MUTATIONS` | No | Defaults to disabled; only the exact string `true` enables writes |
| `ASC_VENDOR_NUMBER` | No | Reserved for future sales/finance report tools |

## Mutation safety

Mutations require all three safeguards:

1. `ASC_ENABLE_MUTATIONS=true` in the private local environment file.
2. A nonempty `ASC_ALLOWED_APP_IDS` allowlist.
3. The exact confirmation phrase in the tool call:

```text
EXECUTE <operation_name> FOR <app_resource_id>
```

Example:

```text
EXECUTE create_in_app_purchase_v2 FOR 123456789
```

Keep mutations disabled for normal inspection. Enable them only for a planned change, restart the MCP process, execute the change, then disable them again.

## Tools

### Read-only

- `asc_status`
- `list_apps`, `get_app`
- `list_builds`, `get_build`
- `list_app_store_versions`, `get_app_store_version`
- `list_version_localizations`
- `list_in_app_purchases_v2`, `get_in_app_purchase_v2`
- `list_in_app_purchase_versions`
- `list_in_app_purchase_version_localizations`
- `list_in_app_purchase_price_points`
- `get_in_app_purchase_price_schedule`
- `get_in_app_purchase_availability`
- `list_territories`
- `list_beta_groups`
- `list_review_submissions`

### Mutating

- `create_app_store_version`, `update_app_store_version`
- `attach_build_to_version`
- `create_version_localization`, `update_version_localization`
- `create_in_app_purchase_v2`, `update_in_app_purchase_v2`
- `create_in_app_purchase_version`
- `create_in_app_purchase_localization_v2`
- `create_in_app_purchase_availability`
- `create_in_app_purchase_price_schedule`
- `create_in_app_purchase_review_item`
- `create_beta_group`, `create_beta_tester`
- `add_beta_testers_to_group`, `add_builds_to_beta_group`
- `create_review_submission`, `submit_review_submission`

## Current IAP workflow

Apple's 4.4.1 API separates the IAP resource, editable version/localizations, availability, pricing, and unified review submission:

1. `list_apps` — obtain and allowlist the app resource ID.
2. `create_in_app_purchase_v2` — create the product (`NON_CONSUMABLE`, `CONSUMABLE`, or `NON_RENEWING_SUBSCRIPTION`).
3. `create_in_app_purchase_version` — create the editable IAP version.
4. `create_in_app_purchase_localization_v2` — attach name/description to that version.
5. `list_in_app_purchase_price_points` — select Apple's price-point resource ID for a territory.
6. `create_in_app_purchase_price_schedule` — set the base territory and manual price.
7. `create_in_app_purchase_availability` — choose territories.
8. Add required review media in App Store Connect until the local asset-upload tool is released.
9. `create_review_submission` — create the app's unified review submission.
10. `create_in_app_purchase_review_item` — add the verified IAP version to that submission.
11. `submit_review_submission` only after reviewing every submission item in App Store Connect.

The server uses V2 IAP creation/update and V2 localization creation. Localization listing is version-scoped through `/v1/inAppPurchaseVersions/{id}/localizations`, and review uses unified `reviewSubmissionItems`; the deprecated parent-scoped localization and standalone IAP-submission workflows are not exposed. Price schedules and availability remain on Apple's current V1 create endpoints because that is what OpenAPI 4.4.1 defines.

## Development

```bash
npm test
npm run test:coverage
npm run check
npm run build
npm audit --omit=dev
npm pack --dry-run
```

See:

- [API coverage](docs/API-COVERAGE.md)
- [Threat model](docs/THREAT-MODEL.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Official sources

- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Official OpenAPI specification](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)
- [Generating tokens for API requests](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)
- [API release notes](https://developer.apple.com/documentation/appstoreconnectapi/app-store-connect-api-release-notes)
- [Identifying rate limits](https://developer.apple.com/documentation/appstoreconnectapi/identifying-rate-limits)

## License

MIT. See [LICENSE](LICENSE).
