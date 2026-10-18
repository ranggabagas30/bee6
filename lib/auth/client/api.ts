import type { Auth, User } from "firebase/auth";
import type { z } from "zod";

/**
 * Browser API client (R-06 Task 4.3). Every owner/supervisor call goes
 * through `authedGetJson` / `authedPostJson`, which attach the Firebase ID
 * token as a bearer, retry once on 401 (the token may have expired — a single
 * forced refresh covers that), and never log the token or the response body.
 */

export type AuthedResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "signed_out" } // no user, or 401 after one forced refresh
  | { kind: "forbidden" } // 403
  | { kind: "invalid" } // 422 (bad or future date)
  | { kind: "conflict"; code: string } // 409 (PR-5: NOT_REVIEWABLE, GATE_BLOCKED)
  | { kind: "error"; code?: string }; // 5xx, network, non-JSON, or schema mismatch; `code` only on a 429 that names one (a demo cap)

interface ErrorBody {
  error?: { code?: unknown };
}

function conflictCode(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ErrorBody).error === "object" &&
    (body as ErrorBody).error !== null &&
    typeof (body as ErrorBody).error?.code === "string"
  ) {
    return (body as ErrorBody).error!.code as string;
  }
  return "CONFLICT";
}

async function readJsonBody(res: Response): Promise<unknown> {
  // `Response.json()` throws on a non-JSON body; the caller treats that as
  // the generic "error" result, same as any other parse failure.
  return res.json();
}

interface AuthedFetchInit {
  method: "GET" | "POST";
  body?: unknown;
}

async function authedFetchOnce(
  token: string,
  path: string,
  init: AuthedFetchInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.method === "POST") headers["Content-Type"] = "application/json";
  return fetchImpl(path, {
    method: init.method,
    headers,
    cache: "no-store",
    ...(init.method === "POST" ? { body: JSON.stringify(init.body) } : {}),
  });
}

/**
 * Shared request path for `authedGetJson` / `authedPostJson`. No current user
 * → `signed_out`, no fetch at all. Any thrown fetch, or `getIdToken` throwing,
 * → `error`. A 401 triggers exactly one forced token refresh and retry; a
 * second 401 → `signed_out`.
 */
async function authedRequest<T>(
  auth: Auth,
  path: string,
  init: AuthedFetchInit,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<AuthedResult<T>> {
  const user: User | null = auth.currentUser;
  if (!user) return { kind: "signed_out" };

  let res: Response;
  try {
    const token = await user.getIdToken();
    res = await authedFetchOnce(token, path, init, fetchImpl);
    if (res.status === 401) {
      const freshToken = await user.getIdToken(true);
      res = await authedFetchOnce(freshToken, path, init, fetchImpl);
      if (res.status === 401) return { kind: "signed_out" };
    }
  } catch {
    return { kind: "error" };
  }

  if (res.status === 403) return { kind: "forbidden" };
  if (res.status === 422) return { kind: "invalid" };
  if (res.status === 429) {
    // A cap or a lockout: still the plain error for every caller, but it names the server's code when there is one,
    // so a caller that wants to say "limit reached" can (demo feedback 2 item 18).
    try {
      const code = conflictCode(await readJsonBody(res));
      return code === "CONFLICT" ? { kind: "error" } : { kind: "error", code };
    } catch {
      return { kind: "error" };
    }
  }
  if (res.status === 409) {
    try {
      const body = await readJsonBody(res);
      return { kind: "conflict", code: conflictCode(body) };
    } catch {
      return { kind: "conflict", code: "CONFLICT" };
    }
  }
  // 201 means a route created a new resource (e.g. POST /proposals/generate
  // on a fresh proposal); 200 covers both GETs and a POST that reused an
  // existing resource. Both are success; anything else here is "error".
  if (res.status !== 200 && res.status !== 201) return { kind: "error" };

  try {
    const body = await readJsonBody(res);
    const data = (body as { data?: unknown })?.data;
    const parsed = schema.safeParse(data);
    return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export async function authedGetJson<T>(
  auth: Auth,
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthedResult<T>> {
  return authedRequest(auth, path, { method: "GET" }, schema, fetchImpl);
}

export async function authedPostJson<T>(
  auth: Auth,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthedResult<T>> {
  return authedRequest(auth, path, { method: "POST", body }, schema, fetchImpl);
}

export type SessionResult = "ok" | "denied" | "network" | "error";

/**
 * POST /api/v1/auth/session with the fresh ID token (web spec §3). On 200,
 * force-refreshes the token so the browser's next request carries the new
 * `{ outlet_id, role }` claims. Runs on every sign-in — idempotent, so
 * re-running the seed script or changing a role is picked up immediately.
 */
export async function postAuthSession(
  user: User,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionResult> {
  let res: Response;
  try {
    const token = await user.getIdToken();
    res = await fetchImpl("/api/v1/auth/session", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return "network";
  }

  if (res.status === 200) {
    try {
      await user.getIdToken(true);
    } catch {
      return "error";
    }
    return "ok";
  }
  if (res.status === 401 || res.status === 403) return "denied";
  return "error";
}
