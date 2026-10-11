import type { CustomClaims } from "@/lib/auth/roles";
import {
  startSession,
  endSession,
  discardSession,
  SessionEndBodySchema,
  SessionDiscardBodySchema,
  SessionIdSchema,
  SessionStartBodySchema,
  type CalendarCtx,
  type CaptureSessionStore,
} from "@/lib/capture/session-service";
import { hasDemoProfile, resolveWeeklyHours } from "@/lib/capture/contract";
import type { DeviceReader, OutletReader } from "@/lib/capture/services";
import { DEMO_SESSION_MAX_MS } from "@/lib/demo/constants";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/lib/http/errors";

/**
 * Route-facing orchestration for the capture session routes (web spec §6.6.3 to
 * §6.6.5). Each function: checks the principal is a paired device (403 otherwise),
 * validates the path id and body (zod, strict; 422 through handleApiError), loads the
 * outlet's calendar, and calls the service. `outlet_id` and `device_id` come only from
 * the verified claims; `now_ms` is passed in so the routes own the clock.
 */

export interface SessionApiDeps {
  sessions: CaptureSessionStore;
  /** The outlet and (only for a sandbox outlet on a demo deployment) the device doc, for the shared demo predicate. */
  outlets: OutletReader & DeviceReader;
  /** The route's `process.env.DEMO_MODE === "true"` (R-18). With a sandbox outlet it sets the 5 min hard stop. */
  demoMode?: boolean;
}

/** The principal must be a paired device. Any other role is 403 (web spec §6.6.1). */
export function devicePrincipal(claims: CustomClaims): { outlet_id: string; device_id: string } {
  if (claims.role !== "device" || !claims.device_id) {
    throw new ForbiddenError("Only a paired device can manage capture sessions");
  }
  return { outlet_id: claims.outlet_id, device_id: claims.device_id };
}

async function calendarFor(
  deps: SessionApiDeps,
  outletId: string,
  deviceId: string,
): Promise<{ cal: CalendarCtx; demo_max_ms?: number }> {
  const outlet = await deps.outlets.getOutlet(outletId);
  if (!outlet) throw new NotFoundError("Outlet", outletId);
  const cal = { weekly: resolveWeeklyHours(outlet), tz: outlet.timezone };
  // Same predicate as the capture config (hasDemoProfile). The device is read only when the two cheap
  // conditions already hold, so a pilot request makes no extra read.
  const sandboxHere = deps.demoMode === true && outlet.sandbox !== undefined;
  const device = sandboxHere ? await deps.outlets.getDevice(outletId, deviceId) : null;
  return hasDemoProfile({ demoMode: deps.demoMode === true, outlet, device })
    ? { cal, demo_max_ms: DEMO_SESSION_MAX_MS }
    : { cal };
}

/** Reads a JSON body. Unparseable JSON is 400; a bad shape is 422 (zod, in the callers). */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("Body must be JSON");
  }
}

export async function startCaptureSession(
  deps: SessionApiDeps,
  claims: CustomClaims,
  rawBody: unknown,
  now_ms: number,
): Promise<{ ok: true }> {
  const p = devicePrincipal(claims);
  const body = SessionStartBodySchema.parse(rawBody);
  await startSession(deps.sessions, {
    ...p,
    session_id: SessionIdSchema.parse(body.session_id),
    started_at_ms: body.started_at_ms,
    ...(await calendarFor(deps, p.outlet_id, p.device_id)),
    now_ms,
  });
  return { ok: true };
}

export async function endCaptureSession(
  deps: SessionApiDeps,
  claims: CustomClaims,
  sessionId: string,
  rawBody: unknown,
  now_ms: number,
): Promise<{ ok: true }> {
  const p = devicePrincipal(claims);
  const session_id = SessionIdSchema.parse(sessionId);
  const body = SessionEndBodySchema.parse(rawBody);
  await endSession(deps.sessions, {
    ...p,
    session_id,
    ...body,
    ...(await calendarFor(deps, p.outlet_id, p.device_id)),
    now_ms,
  });
  return { ok: true };
}

export async function discardCaptureSession(
  deps: SessionApiDeps,
  claims: CustomClaims,
  sessionId: string,
  rawBody: unknown,
  now_ms: number,
): Promise<{ ok: true; cleanup: "pending" }> {
  const p = devicePrincipal(claims);
  const session_id = SessionIdSchema.parse(sessionId);
  const body = SessionDiscardBodySchema.parse(rawBody);
  return discardSession(deps.sessions, {
    ...p,
    session_id,
    ...body,
    ...(await calendarFor(deps, p.outlet_id, p.device_id)),
    now_ms,
  });
}
