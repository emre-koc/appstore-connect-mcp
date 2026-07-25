# Contributing

## Rules

- Never commit real App Store Connect IDs, keys, JWTs, tester data, request dumps, `.env` files, or `.p8` files.
- Add behavior through test-driven development: failing test, minimal implementation, refactor with green tests.
- Use Apple's official documentation and current OpenAPI specification as the endpoint/schema authority.
- Do not add HTTP listeners, OAuth providers, telemetry, arbitrary URL requests, generic API proxy tools, shell execution, or server-side sampling.
- Keep reads and writes narrow. Every app-scoped resource mutation must verify ownership through an allowlisted app relationship.
- Mutation tools must remain globally disabled by default and have truthful MCP safety annotations.

## Verification

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run test:coverage
npm run build
npm audit --omit=dev
npm pack --dry-run
```

Inspect the package tarball contents and Git diff before opening a pull request.
