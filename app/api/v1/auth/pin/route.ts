import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  BadRequestError,
  UnauthorizedError,
  handleApiError,
} from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { requireDevice } from "@/lib/http/guard";
import { staffPinLogin } from "@/lib/auth/services";
import { firestoreStaffStore } from "@/lib/firestore/stores";
import { mintCustomToken } from "@/lib/firebase/admin";

/**
 * POST /api/v1/auth/pin (web spec §3, §6.2).
 * Name + 4-digit PIN on the paired shop device → a staff session (Firebase
 * custom token). The device is authenticated first via its device token, so the
 * PIN screen only works on a paired phone; outlet + device come from the device
 * principal, never from the request body. 5 wrong PINs → locked 15 min.
 */

export const runtime = "nodejs";

const BodySchema = z
  .object({ name: z.string().min(1), pin: z.string() })
  .strict();

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
    const { name, pin } = BodySchema.parse(raw);

    const result = await staffPinLogin(
      { staff: firestoreStaffStore(), mintToken: mintCustomToken },
      {
        outlet_id: device.outlet_id,
        device_id: device.device_id,
        name,
        pin,
      },
    );

    return jsonOk({
      custom_token: result.custom_token,
      staff_id: result.staff_id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
