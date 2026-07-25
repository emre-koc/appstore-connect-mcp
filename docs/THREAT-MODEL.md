# Threat Model

## Assets

- App Store Connect `.p8` private key and generated JWTs.
- Production app metadata, builds, IAPs, pricing, availability, TestFlight groups/testers, and review submissions.
- Unpublished product information and tester personal data.

## Trust boundaries

Trusted:

- the local OS account running the MCP client;
- the reviewed local MCP build;
- Apple's TLS endpoint `api.appstoreconnect.apple.com`;
- the private credential file and its parent directory.

Untrusted:

- model-generated tool arguments;
- prompts, web pages, issue text, build metadata, and other content an LLM may read;
- arbitrary network hosts;
- packages or builds not represented by the reviewed lockfile;
- stdout outside MCP protocol messages.

## Threats and controls

| Threat | Control |
|---|---|
| LAN/Internet access to privileged tools | stdio transport only; no socket/listener dependency or code path |
| Credential exfiltration | `O_NOFOLLOW` key loading with descriptor checks, exact mode `600`, current-user ownership, short-lived JWT, redaction, no telemetry |
| SSRF or bearer-token forwarding | fixed HTTPS origin and exact host validation in every authenticated request and pagination link |
| Prompt-driven destructive action | mutations off by default, mandatory app allowlist, exact operation confirmation, truthful MCP annotations |
| Cross-app resource-ID substitution | verify each version/build/IAP/group/submission through the allowlisted app relationship before mutation |
| Unbounded API activity | bounded 5 MiB response bodies, pages/items, request timeout, read-only retries, capped Retry-After |
| Supply-chain compromise | exact dependency pins, lockfile, ignored lifecycle scripts during documented install, audit and pack checks |
| Secret-bearing errors | structured Apple error parsing plus PEM/JWT/Authorization/credential redaction |
| Accidental publication | `.env`, `.p8`, logs, builds, and local config ignored; sanitized examples only |

## Residual risks

- An App Store Connect API key can perform everything Apple allows for its assigned role. Use a dedicated least-privileged key.
- A local MCP client can invoke enabled mutation tools. Confirmation phrases reduce accidents but do not defend against a malicious local process or fully compromised agent.
- Apple can change API schemas or authorization requirements. Run the official OpenAPI compatibility check and integration tests before releases.
- Review asset upload is intentionally not implemented yet; it should not be added until Apple-issued upload URL handling and local path containment have dedicated tests.
