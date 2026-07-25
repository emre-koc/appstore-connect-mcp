import { assertAppleApiUrl, redactSensitive } from "./security.js";
import type { TokenProvider } from "./jwt.js";

const API_ORIGIN = "https://api.appstoreconnect.apple.com";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type QueryValue = string | number | boolean | readonly string[] | undefined;
export type Query = Readonly<Record<string, QueryValue>>;

export interface JsonApiResource {
  readonly type: string;
  readonly id: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly relationships?: Readonly<Record<string, unknown>>;
}

export interface JsonApiDocument<T = JsonApiResource | readonly JsonApiResource[] | null> {
  readonly data: T;
  readonly included?: readonly JsonApiResource[];
  readonly links?: { readonly self?: string; readonly next?: string };
  readonly meta?: Readonly<Record<string, unknown>>;
}

interface ClientOptions {
  readonly tokenProvider: TokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
}

export class AppStoreConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(redactSensitive(message));
    this.name = "AppStoreConnectError";
  }
}

function assertRelativeApiPath(path: string): void {
  if (!/^\/v[12]\/[A-Za-z0-9][A-Za-z0-9/_-]*(?:\?.*)?$/.test(path)) {
    throw new Error("A relative API path beginning with /v1/ or /v2/ is required");
  }
}

function makeUrl(path: string, query?: Query): URL {
  assertRelativeApiPath(path);
  const url = new URL(path, API_ORIGIN);
  assertAppleApiUrl(url);
  if (query) {
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(name, Array.isArray(value) ? value.join(",") : String(value));
    }
  }
  return url;
}

function retryDelay(response: Response, attempt: number): number {
  const rawRetryAfter = response.headers.get("retry-after");
  if (rawRetryAfter !== null) {
    const seconds = Number(rawRetryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 10_000);
    const date = Date.parse(rawRetryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10_000);
  }
  return Math.min(250 * 2 ** attempt, 2_000);
}

function appleError(body: unknown, status: number): AppStoreConnectError {
  const first = body && typeof body === "object" && "errors" in body && Array.isArray(body.errors)
    ? body.errors[0]
    : undefined;
  if (first && typeof first === "object") {
    const record = first as Record<string, unknown>;
    const pieces = [record.title, record.detail].filter((value): value is string => typeof value === "string");
    return new AppStoreConnectError(pieces.join(": ") || `Apple API request failed with HTTP ${status}`, status, typeof record.code === "string" ? record.code : undefined);
  }
  return new AppStoreConnectError(`Apple API request failed with HTTP ${status}`, status);
}

async function readJsonBounded(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new AppStoreConnectError("Apple API response exceeded the 5 MiB limit", response.status);
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new AppStoreConnectError("Apple API response exceeded the 5 MiB limit", response.status);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}

export class AppStoreConnectClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async get<T = JsonApiResource | readonly JsonApiResource[]>(path: string, query?: Query): Promise<JsonApiDocument<T>> {
    return this.request<T>("GET", makeUrl(path, query));
  }

  async post<T = JsonApiResource>(path: string, body: unknown): Promise<JsonApiDocument<T>> {
    return this.request<T>("POST", makeUrl(path), body);
  }

  async patch<T = JsonApiResource>(path: string, body: unknown): Promise<JsonApiDocument<T>> {
    return this.request<T>("PATCH", makeUrl(path), body);
  }

  async delete(path: string): Promise<void> {
    await this.request<null>("DELETE", makeUrl(path));
  }

  async getAll(
    path: string,
    query?: Query,
    limits: { maxPages?: number; maxItems?: number } = {},
  ): Promise<JsonApiDocument<readonly JsonApiResource[]>> {
    const maxPages = Math.min(Math.max(limits.maxPages ?? 5, 1), 20);
    const maxItems = Math.min(Math.max(limits.maxItems ?? 200, 1), 1_000);
    let url = makeUrl(path, query);
    const data: JsonApiResource[] = [];
    let last: JsonApiDocument<readonly JsonApiResource[]> | undefined;

    for (let page = 0; page < maxPages && data.length < maxItems; page += 1) {
      last = await this.request<readonly JsonApiResource[]>("GET", url);
      data.push(...last.data.slice(0, maxItems - data.length));
      const next = last.links?.next;
      if (!next) break;
      url = new URL(next);
      assertAppleApiUrl(url);
    }
    return { data, ...(last?.meta ? { meta: last.meta } : {}) };
  }

  private async request<T>(method: string, url: URL, body?: unknown): Promise<JsonApiDocument<T>> {
    assertAppleApiUrl(url);
    const mayRetry = method === "GET";
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const token = await this.options.tokenProvider();
      const headers = new Headers({
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "appstore-connect-mcp/0.1.0",
      });
      const init: RequestInit = {
        method,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      };
      if (body !== undefined) {
        headers.set("content-type", "application/json");
        init.body = JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (error) {
        if (!mayRetry || attempt + 1 >= this.maxAttempts) throw new AppStoreConnectError(`Apple API network request failed: ${redactSensitive(error)}`, 0);
        await this.sleep(Math.min(250 * 2 ** attempt, 2_000));
        continue;
      }
      if (response.ok) {
        if (response.status === 204) return { data: null as T };
        return await readJsonBounded(response) as JsonApiDocument<T>;
      }
      let errorBody: unknown;
      try { errorBody = await readJsonBounded(response); } catch { errorBody = undefined; }
      if (mayRetry && RETRYABLE.has(response.status) && attempt + 1 < this.maxAttempts) {
        await this.sleep(retryDelay(response, attempt));
        continue;
      }
      throw appleError(errorBody, response.status);
    }
    throw new AppStoreConnectError("Apple API request exhausted retries", 0);
  }
}
