import type { NextRequest } from "next/server";
import {
  BadRequestError,
  UnauthorizedError,
  handleApiError,
} from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { HeartbeatRequestSchema } from "@/lib/capture/contract";
import { recordHeartbeat } from "@/lib/capture/services";
import { firestoreCaptureStore } from "@/lib/firestore/stores";

/**
 * POST /api/v1/heartbeat (web spec §4.1, §5 step 6).
 * The shop device reports health every ~60 s. Authenticated by the device token
 * (requireDevice); outlet_id + device_id come only from the device principal,
 * never the body. No audio is ever part of a heartbeat.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const device = await requireDevice(req);
    if (!device.device_id) {
      throw new UnauthorizedError("Device session missing device id");
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const request = HeartbeatRequestSchema.parse(raw);

    await recordHeartbeat(firestoreCaptureStore(), {
      request,
      claims: { outlet_id: device.outlet_id, device_id: device.device_id },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
