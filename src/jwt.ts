import { createPrivateKey, sign } from "node:crypto";

import { readPrivateKeyFile } from "./key-file.js";

export interface AppleJwtConfig {
  readonly keyId: string;
  readonly issuerId: string;
  readonly privateKeyPath: string;
}

export type TokenProvider = () => Promise<string>;

type Clock = () => number;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppleJwtProvider(config: AppleJwtConfig, clock: Clock = () => Math.floor(Date.now() / 1_000)): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  let keyPromise: ReturnType<typeof loadSigningKey> | undefined;

  async function loadSigningKey() {
    const bytes = await readPrivateKeyFile(config.privateKeyPath);
    try {
      const key = createPrivateKey(bytes);
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
        throw new Error("ASC private key must be an EC P-256 private key");
      }
      return key;
    } finally {
      bytes.fill(0);
    }
  }

  return async () => {
    const now = clock();
    if (cached && cached.expiresAt - now > 60) return cached.token;

    keyPromise ??= loadSigningKey();
    const key = await keyPromise;

    const expiresAt = now + 1_140;
    const encodedHeader = base64urlJson({ alg: "ES256", kid: config.keyId, typ: "JWT" });
    const encodedPayload = base64urlJson({
      iss: config.issuerId,
      iat: now,
      exp: expiresAt,
      aud: "appstoreconnect-v1",
    });
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = sign("sha256", Buffer.from(signingInput), {
      key,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const token = `${signingInput}.${signature}`;
    cached = { token, expiresAt };
    return token;
  };
}
