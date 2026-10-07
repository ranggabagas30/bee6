import { NotFoundError } from "@/lib/http/errors";
import type { CustomClaims } from "@/lib/auth/roles";
import type { Device, Heartbeat, Outlet } from "@/lib/firestore/schema";
import {
  toCaptureConfig,
  toHeartbeat,
  type CaptureConfigResponse,
  type HeartbeatRequest,
} from "@/lib/capture/contract";

/**
 * Pure capture service logic (web spec §6). Firestore access is injected as
 * small store interfaces so the decisions are unit-tested with in-memory fakes;
 * the real implementations live in lib/firestore/stores.ts. Every write/read is
 * scoped to the authenticated principal's outlet — the route never trusts the
 * client for outlet_id/device_id.
 */

export interface OutletReader {
  getOutlet(outletId: string): Promise<Outlet | null>;
}

export interface DeviceReader {
  getDevice(outletId: string, deviceId: string): Promise<Device | null>;
}

export interface HeartbeatWriter {
  saveHeartbeat(heartbeat: Heartbeat): Promise<void>;
}

/**
 * Returns the capture-config allowlist for the device's outlet and this device's
 * `last_ended` (web spec §6.6.2). Throws 404 if the outlet or the device doc is
 * missing. Both reads are scoped to the authenticated outlet and device.
 */
export async function getCaptureConfig(
  store: OutletReader & DeviceReader,
  params: { outlet_id: string; device_id: string },
): Promise<CaptureConfigResponse> {
  const outlet = await store.getOutlet(params.outlet_id);
  if (!outlet) throw new NotFoundError("Outlet", params.outlet_id);
  const device = await store.getDevice(params.outlet_id, params.device_id);
  if (!device) throw new NotFoundError("Device", params.device_id);
  return toCaptureConfig(outlet, device.last_ended ?? null);
}

/**
 * Validates + stores a heartbeat. `outlet_id`/`device_id` come only from the
 * authenticated device claims (via `toHeartbeat`), never the request body.
 */
export async function recordHeartbeat(
  store: HeartbeatWriter,
  params: {
    request: HeartbeatRequest;
    claims: Pick<CustomClaims, "outlet_id" | "device_id">;
  },
): Promise<Heartbeat> {
  const heartbeat = toHeartbeat(params.request, params.claims);
  await store.saveHeartbeat(heartbeat);
  return heartbeat;
}
