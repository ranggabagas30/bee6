import type { NextRequest } from "next/server";
import { UnauthorizedError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { getCaptureConfig } from "@/lib/capture/services";
import { firestoreCaptureStore } from "@/lib/firestore/stores";

/**
 * GET /api/v1/capture/config (web spec §6.6.2). The shop device fetches its outlet's
 * timezone, resolved weekly hours and this device's own `last_ended`, without touching
 * Firestore directly (hard rule #6). Authenticated by the device token; the outlet and
 * device come from the verified principal only. Returns a strict allowlist, never the
 * whole outlet or device doc.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return jsonOk(config);
  } catch (error) {
    return handleApiError(error);
  }
}
