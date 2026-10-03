import { OAuth2Client } from "google-auth-library";
import { UnauthorizedError } from "@/lib/http/errors";

/**
 * OIDC verification for internal (Cloud Scheduler-triggered) routes
 * (R-05b Task 6; global constraint in `docs/tasks/R-05b.md`). Every
 * internal route verifies the caller via `google-auth-library`'s
 * `verifyIdToken`, with:
 *  - audience = `PIPELINE_TICK_AUDIENCE` (the tick route's own public URL,
 *    configured as an env var — what Cloud Scheduler's own job config
 *    must also be set to). **Never derived from the request** (`req.url`,
 *    `Host`, `x-forwarded-host`, ...) — on Cloud Run, `req.url` is built
 *    from `HOSTNAME`/port, never the public URL, so every real Scheduler
 *    tick would 401 if the audience were derived from the request; worse,
 *    any request header is caller-controlled, so deriving the audience
 *    from one would let a caller pick its own audience and always pass.
 *    Fails closed (401) if `PIPELINE_TICK_AUDIENCE` itself isn't
 *    configured — same discipline as the `TASKS_INVOKER_SA` check below
 *    (tech-lead review round 2, finding 1);
 *  - issuer email = `TASKS_INVOKER_SA` (the service account Cloud
 *    Scheduler's job is configured to run as).
 *
 * Never trusts a bare request (hard rule #6's spirit, applied to
 * service-to-service calls) — a missing token, a bad signature, an
 * audience mismatch, or an issuer-email mismatch are all a 401, never a
 * silent pass.
 */

export interface OidcPayload {
  email?: string;
  email_verified?: boolean;
}

export interface VerifyOidcDeps {
  /** Test seam: the real default calls `OAuth2Client#verifyIdToken`. */
  verifyIdToken?: (params: { idToken: string; audience: string }) => Promise<OidcPayload>;
}

export interface MinimalRequest {
  headers: { get(name: string): string | null };
}

let cachedClient: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!cachedClient) cachedClient = new OAuth2Client();
  return cachedClient;
}

async function defaultVerifyIdToken(params: { idToken: string; audience: string }): Promise<OidcPayload> {
  const ticket = await getClient().verifyIdToken(params);
  const payload = ticket.getPayload();
  return { email: payload?.email, email_verified: payload?.email_verified };
}

function extractBearerToken(req: MinimalRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * Verifies the OIDC bearer token on an internal request. Resolves on
 * success; throws `UnauthorizedError` (401) on any failure — missing
 * token, invalid/expired token, wrong audience (checked by
 * `verifyIdToken` itself), an issuer email that doesn't match
 * `issuerEmail` (`TASKS_INVOKER_SA`), or `audience` itself not configured.
 */
export async function verifyInternalOidcToken(
  req: MinimalRequest,
  opts: { issuerEmail: string; audience: string },
  deps: VerifyOidcDeps = {},
): Promise<void> {
  if (!opts.issuerEmail) {
    throw new UnauthorizedError("TASKS_INVOKER_SA is not configured");
  }
  if (!opts.audience) {
    throw new UnauthorizedError("PIPELINE_TICK_AUDIENCE is not configured");
  }

  const token = extractBearerToken(req);
  if (!token) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const audience = opts.audience;
  const verify = deps.verifyIdToken ?? defaultVerifyIdToken;

  let payload: OidcPayload;
  try {
    payload = await verify({ idToken: token, audience });
  } catch {
    throw new UnauthorizedError("Invalid OIDC token");
  }

  if (!payload.email || payload.email !== opts.issuerEmail) {
    throw new UnauthorizedError("OIDC token issuer mismatch");
  }
}
