// Shared REST client. Centralizes the API base URL, cookie credentials, and
// error handling so pages don't repeat the fetch + res.ok + res.json dance.

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error(
    "VITE_API_URL is not set — define it in your environment (.env) before starting the app.",
  );
}

// Error payloads the backend sends alongside non-2xx statuses.
interface ApiErrorBody {
  error?: string;
  activeRoomCode?: string;
  [key: string]: unknown;
}

// Thrown on any non-2xx response. `body` carries the parsed JSON body when
// available so callers can read fields beyond `message` (e.g. activeRoomCode).
export class ApiError extends Error {
  status: number;
  body?: ApiErrorBody;

  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const parsed = (await parseBody(res)) as ApiErrorBody | undefined;

  if (!res.ok) {
    const message = parsed?.error ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, parsed);
  }

  return parsed as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}
