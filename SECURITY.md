# Security Policy

## Supported versions

Until the first stable release, only the latest commit on `main` is supported.

## Reporting a vulnerability

Do not open a public issue containing credentials, private keys, JWTs, account identifiers, unpublished app metadata, tester information, or exploit details that expose users.

Use GitHub's private security-advisory flow for the repository. Include:

- affected commit/version;
- impact and preconditions;
- minimal reproduction using fake credentials;
- suggested mitigation, if known.

Revoke any App Store Connect key that may have been disclosed before sharing a report.

## Security boundaries

- The server is local stdio only and must never open a network listener.
- The only authenticated network destination is `api.appstoreconnect.apple.com` over HTTPS.
- Private keys are opened with `O_NOFOLLOW`, verified from the opened descriptor as current-user-owned regular files of bounded size and exact mode `600`, then loaded once for JWT signing.
- Key material and JWTs must never be logged or returned in MCP errors.
- Mutations are disabled by default, app-allowlisted, resource-ownership checked, and confirmation-gated.
- MCP client/LLM behavior is not an authorization boundary. The local environment and process owner remain trusted.

## Credential response

If a `.p8` key, JWT, or secret-bearing environment file is committed or disclosed:

1. Revoke the App Store Connect API key immediately.
2. Remove it from current history and rotate it; deletion from the latest commit is insufficient.
3. Review App Store Connect activity and affected app metadata.
4. Publish a security notice if users may be affected.
