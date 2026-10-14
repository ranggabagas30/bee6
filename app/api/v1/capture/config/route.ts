import type { NextRequest } from "next/server";
import { UnauthorizedError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { getCaptureConfig } from "@/lib/capture/services";
import { withDemoDay, type CaptureConfigResponse } from "@/lib/capture/contract";
import { businessDateOf } from "@/lib/capture/calendar";
import { firestoreCaptureStore } from "@/lib/firestore/stores";
import { firestoreNextDayStore } from "@/lib/firestore/demo-store";
import { nextDayEligibility } from "@/lib/demo/next-day";

/**
 * GET /api/v1/capture/config (web spec §6.6.2). The shop device fetches its outlet's
 * timezone, resolved weekly hours and this device's own `last_ended`, without touching
 * Firestore directly (hard rule #6). Authenticated by the device token; the outlet and
 * device come from the verified principal only. Returns a strict allowlist, never the
 * whole outlet or device doc.
 *
 * R-19 PR-2: when the response carries `demo_session` (a demo deployment, a sandbox outlet, a judge device:
 * `hasDemoProfile`), `day`, `days_done` and `next_day` are filled from the sandbox's `next_day_count` and the
 * same server-side guards the next-day route applies (read-only). The pilot path never builds the demo store.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function withSandboxDay(config: CaptureConfigResponse, claims: { outlet_id: string; device_id: string }): Promise<CaptureConfigResponse> {
  if (config.demo_session === undefined) return config;
  const now_ms = Date.now();
  const store = firestoreNextDayStore();
  const outlet = await store.getOutlet(claims.outlet_id);
  const guard = await store.readGuardState(claims.outlet_id, claims.device_id, now_ms);
  const next_day_count = outlet?.sandbox?.next_day_count;
  return withDemoDay(config, {
    next_day_count,
    last_ended: guard.last_ended,
    today: businessDateOf(now_ms, config.timezone),
    next_day: nextDayEligibility({ ...guard, now_ms, tz: config.timezone, next_day_count: next_day_count ?? 0 }),
  });
}

export async function GET(req: NextRequest) {
  try {
    const device = await requireDevice(req);
    if (!device.device_id) {
      throw new UnauthorizedError("Device session missing device id");
    }
    const config = await getCaptureConfig(firestoreCaptureStore(), {
      outlet_id: device.outlet_id,
      device_id: device.device_id,
      demo_mode: process.env.DEMO_MODE === "true",
    });
    return jsonOk(await withSandboxDay(config, { outlet_id: device.outlet_id, device_id: device.device_id }));
  } catch (error) {
    return handleApiError(error);
  }
}
