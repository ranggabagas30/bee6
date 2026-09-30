import type { NextRequest } from "next/server";
import { handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { getCaptureConfig } from "@/lib/capture/services";
import { firestoreCaptureStore } from "@/lib/firestore/stores";

/**
 * GET /api/v1/capture/config (web spec §4.1).
 * The shop device fetches the outlet's consent flag + opening/closing hours +
 * timezone to gate capture, without ever touching Firestore directly (hard rule
 * #6). Authenticated by the device token; the outlet comes from the device
 * principal, so a device can only read its own outlet's config. Returns a strict
 * allowlist subset — never the whole outlet doc.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const device = await requireDevice(req);
    const config = await getCaptureConfig(firestoreCaptureStore(), {
      outlet_id: device.outlet_id,
    });
    return jsonOk(config);
  } catch (error) {
    return handleApiError(error);
  }
}
