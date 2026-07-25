import { isAbsolute } from "node:path";

import { validatePrivateKeyFile } from "./key-file.js";

export interface AppStoreConnectConfig {
  readonly keyId: string;
  readonly issuerId: string;
  readonly privateKeyPath: string;
  readonly allowedAppIds: ReadonlySet<string>;
  readonly mutationsEnabled: boolean;
  readonly vendorNumber?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseAllowedApps(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<AppStoreConnectConfig> {
  const privateKeyPath = required(env, "ASC_PRIVATE_KEY_PATH");
  if (!isAbsolute(privateKeyPath)) throw new Error("ASC_PRIVATE_KEY_PATH must be an absolute path");
  await validatePrivateKeyFile(privateKeyPath);

  const allowedAppIds = parseAllowedApps(env.ASC_ALLOWED_APP_IDS);
  const mutationsEnabled = parseBoolean(env.ASC_ENABLE_MUTATIONS);
  if (mutationsEnabled && allowedAppIds.size === 0) {
    throw new Error("ASC_ENABLE_MUTATIONS requires a nonempty ASC_ALLOWED_APP_IDS allowlist");
  }

  const vendorNumber = env.ASC_VENDOR_NUMBER?.trim();
  return {
    keyId: required(env, "ASC_KEY_ID"),
    issuerId: required(env, "ASC_ISSUER_ID"),
    privateKeyPath,
    allowedAppIds,
    mutationsEnabled,
    ...(vendorNumber ? { vendorNumber } : {}),
  };
}
