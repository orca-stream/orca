export interface ApiIssue {
  path: string;
  message: string;
}

/** Any failed call: `status` is 0 when the server never answered. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[] | undefined;

  constructor(status: number, code: string, message?: string, issues?: ApiIssue[]) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** The caller handles a 401 itself (a wrong password), so the session is not considered lost. */
  expectUnauthorized?: boolean;
}

export interface ApiClientOptions {
  /** Injected so tests need no network. */
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Called once when the session is lost, until `resetUnauthorized()`. */
  onUnauthorized?: () => void;
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
  /** Re-arms `onUnauthorized` (after a successful sign-in). */
  resetUnauthorized(): void;
}

async function readError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof record.error === "string" ? record.error : "http_error";
  const message = typeof record.message === "string" ? record.message : undefined;
  const issues = Array.isArray(record.issues) ? (record.issues as ApiIssue[]) : undefined;
  return new ApiError(response.status, code, message, issues);
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? "/api";
  let unauthorizedSent = false;

  async function request<T>(
    method: string,
    path: string,
    body: unknown,
    { signal, expectUnauthorized }: RequestOptions = {},
  ): Promise<T> {
    const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const init: RequestInit = { method, credentials: "same-origin", signal: signal ?? null };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, init);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "network", error instanceof Error ? error.message : undefined);
    }

    if (!response.ok) {
      const error = await readError(response);
      if (response.status === 401 && !expectUnauthorized && !unauthorizedSent) {
        unauthorizedSent = true;
        options.onUnauthorized?.();
      }
      throw error;
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  return {
    get: (path, o) => request("GET", path, undefined, o),
    post: (path, body, o) => request("POST", path, body, o),
    put: (path, body, o) => request("PUT", path, body, o),
    patch: (path, body, o) => request("PATCH", path, body, o),
    delete: (path, o) => request("DELETE", path, undefined, o),
    resetUnauthorized() {
      unauthorizedSent = false;
    },
  };
}
