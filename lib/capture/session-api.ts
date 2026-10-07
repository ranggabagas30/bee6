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
import { resolveWeeklyHours } from "@/lib/capture/contract";
import type { OutletReader } from "@/lib/capture/services";
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
  outlets: OutletReader;
}

/** The principal must be a paired device. Any other role is 403 (web spec §6.6.1). */
export function devicePrincipal(claims: CustomClaims): { outlet_id: string; device_id: string } {
  if (claims.role !== "device" || !claims.device_id) {
    throw new ForbiddenError("Only a paired device can manage capture sessions");
  }
  return { outlet_id: claims.outlet_id, device_id: claims.device_id };
}

async function calendarFor(outlets: OutletReader, outletId: string): Promise<CalendarCtx> {
  const outlet = await outlets.getOutlet(outletId);
  if (!outlet) throw new NotFoundError("Outlet", outletId);
  return { weekly: resolveWeeklyHours(outlet), tz: outlet.timezone };
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
    cal: await calendarFor(deps.outlets, p.outlet_id),
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
    cal: await calendarFor(deps.outlets, p.outlet_id),
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
    cal: await calendarFor(deps.outlets, p.outlet_id),
    now_ms,
  });
}
