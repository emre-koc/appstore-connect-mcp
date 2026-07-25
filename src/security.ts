export interface SecurityConfig {
  readonly mutationsEnabled: boolean;
  readonly allowedAppIds: ReadonlySet<string>;
}

const APP_STORE_CONNECT_HOST = "api.appstoreconnect.apple.com";

export function assertAppleApiUrl(url: URL): void {
  if (url.protocol !== "https:") throw new Error("App Store Connect requests require HTTPS");
  if (url.hostname !== APP_STORE_CONNECT_HOST) throw new Error("App Store Connect request host is not allowlisted");
  if (url.username || url.password) throw new Error("Credentials are forbidden in App Store Connect URLs");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is allowed");
}

export function assertAllowedApp(appId: string, allowedAppIds: ReadonlySet<string>): void {
  if (allowedAppIds.size > 0 && !allowedAppIds.has(appId)) {
    throw new Error(`App ID ${appId} is not in the configured allowlist`);
  }
}

export function mutationConfirmation(operation: string, scopeId: string): string {
  return `EXECUTE ${operation} FOR ${scopeId}`;
}

export function assertMutationAllowed(
  config: SecurityConfig,
  operation: string,
  scopeId: string,
  confirmation: unknown,
): void {
  if (!config.mutationsEnabled) throw new Error("Mutation tools are disabled by local configuration");
  assertAllowedApp(scopeId, config.allowedAppIds);
  const expected = mutationConfirmation(operation, scopeId);
  if (confirmation !== expected) {
    throw new Error(`Mutation confirmation mismatch. Exact confirmation required: ${expected}`);
  }
}

export function redactSensitive(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value);
  text = text.replace(/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/gi, "[REDACTED]");
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
  text = text.replace(/(Authorization\s*:\s*Bearer\s+)[^\s]+/gi, "$1[REDACTED]");
  text = text.replace(/((?:APPLE|ASC)_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)|PRIVATE_KEY|PASSWORD)\s*=\s*[^\s]+/gi, "$1=[REDACTED]");
  return text;
}
