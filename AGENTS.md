# AGENTS.md

Instructions for coding agents and contributors working in this repository.

## Project purpose

This project is a local-only, stdio Model Context Protocol server for Apple's App Store Connect API. It handles privileged credentials and exposes both read-only and mutation-capable tools. Security boundaries are part of the product contract, not optional implementation details.

## Repository map

- `src/index.ts` — process entry point and stdio transport
- `src/config.ts` — environment parsing and startup validation
- `src/key-file.ts` — private-key file containment and permission checks
- `src/jwt.ts` — short-lived ES256 App Store Connect JWT generation
- `src/client.ts` — fixed-origin Apple API client, retries, and response limits
- `src/security.ts` — URL checks, allowlisting, confirmation gates, and redaction
- `src/tools.ts` — App Store Connect operations and ownership verification
- `src/server.ts` — MCP schemas, annotations, and safe error handling
- `tests/` — unit and stdio integration tests
- `docs/THREAT-MODEL.md` — assets, trust boundaries, controls, and residual risks
- `docs/API-COVERAGE.md` — implemented API coverage and official schema baseline

## Non-negotiable security rules

1. Keep transport stdio-only. Do not add HTTP listeners, hosted relays, OAuth providers, server-side sampling, or telemetry.
2. Authenticated requests may only target `https://api.appstoreconnect.apple.com` on standard HTTPS. Validate pagination URLs before reuse.
3. Never log, return, fixture, or commit private keys, JWTs, credentials, real app/account IDs, tester data, or unpublished metadata.
4. Keep `.p8` loading resistant to symlinks and TOCTOU issues. Require an absolute path, current-user ownership, a regular file, bounded size, and exact mode `600`.
5. Mutations must remain disabled by default. Every mutation requires a nonempty app allowlist, ownership verification for related resources, and the exact operation-specific confirmation phrase.
6. MCP annotations must describe real behavior. Submission/destructive operations must not be labeled read-only or harmless.
7. Do not add a generic API proxy, arbitrary URL fetcher, shell execution, unconstrained filesystem access, or dynamic code evaluation.
8. Redact credential-like material from every user-visible and stderr error path.

## Development workflow

Use Node.js 22 or newer. Install exactly from the lockfile without dependency lifecycle scripts:

```bash
npm ci --ignore-scripts
```

Develop test-first for behavior and security controls:

1. Add or update a failing test.
2. Make the smallest implementation change.
3. Run focused tests, then the full verification suite.
4. Inspect the complete diff and package contents.

Required verification before commit or pull request:

```bash
npm run check
npm test
npm run test:coverage
npm run build
npm run test:dist
npm audit
npm pack --dry-run
```

If `gitleaks` is installed, also run:

```bash
gitleaks git --redact --no-banner .
```

## API implementation rules

- Treat Apple's current official App Store Connect OpenAPI specification and documentation as authoritative.
- Use explicit schemas and narrow methods; do not expose arbitrary paths or request bodies.
- Validate input lengths/counts and bound pagination, response size, retries, and timeouts.
- Retry only safe read operations unless Apple documents an idempotency mechanism and tests cover it.
- For every app-scoped child resource used by a mutation, prove its relationship to the allowlisted app before writing.
- Add tests for success, Apple errors, malformed responses, cross-app substitution, disabled mutations, incorrect confirmations, and redaction.
- Update `docs/API-COVERAGE.md` and README tool lists when API coverage changes.

## Dependency and release hygiene

- Keep direct dependencies and GitHub Actions pinned to exact versions or commit SHAs.
- Review lockfile source URLs and lifecycle scripts after dependency changes.
- Do not commit `node_modules/`, `dist/`, coverage output, logs, `.env` files, or `.p8` files.
- Inspect `npm pack --dry-run` output; only intended runtime files and public documentation may ship.
- Never publish or push until tests, type checks, dependency audit, secret scan, and independent review are clean.

## Commit and review expectations

- Keep changes focused and explain security impact in the pull request.
- Include tests for all behavior changes.
- Document any new credential, network, filesystem, or mutation capability in the threat model.
- Report vulnerabilities privately through GitHub Security Advisories as described in `SECURITY.md`.