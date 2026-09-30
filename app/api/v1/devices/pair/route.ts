import type { NextRequest } from "next/server";
import { z } from "zod";
import { BadRequestError, handleApiError } from "@/lib/http/errors";
import { jsonOk } from "@/lib/http/respond";
import { pairDevice } from "@/lib/auth/services";
import { firestoreDeviceStore } from "@/lib/firestore/stores";

/**
 * POST /api/v1/devices/pair (web spec §6.2).
 * The shop phone swaps a 6-digit pairing code (from the seed script, valid
 * 10 min) for a long-lived device token. The code is itself the credential, so
 * this route is unauthenticated; the code is single-use and outlet-scoped by the
 * device record it matches.
 */

// The pipeline handlers run on Node (Firestore Admin SDK), not the Edge runtime.
export const runtime = "nodejs";

const BodySchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

export async function POST(req: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BadRequestError("Body must be JSON");
    }
    const { code } = BodySchema.parse(raw);

    const result = await pairDevice(
      { devices: firestoreDeviceStore() },
      { code },
    );

    return jsonOk(
      {
        device_id: result.device_id,
        outlet_id: result.outlet_id,
        device_token: result.device_token,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
