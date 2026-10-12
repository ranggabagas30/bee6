import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as storesModule from "@/lib/firestore/stores";

vi.mock("@/lib/firestore/stores");

/** web spec §6.2 + R-18 2.T2: the reserved demo staff code never reaches the store. */

const findByPairingCode = vi.fn();
const savePairing = vi.fn();

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/v1/devices/pair", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  findByPairingCode.mockReset().mockResolvedValue(null);
  savePairing.mockReset();
  vi.mocked(storesModule.firestoreDeviceStore).mockReturnValue({
    findByPairingCode,
    findById: vi.fn(),
    savePairing,
  } as never);
});

describe("POST /api/v1/devices/pair", () => {
  it("2.T2 000000 answers like an unknown code and makes zero store calls", async () => {
    const reserved = await post({ code: "000000" });
    const unknown = await post({ code: "123456" });
    expect(reserved.status).toBe(401);
    expect(await reserved.json()).toEqual(await unknown.json());
    expect(findByPairingCode).toHaveBeenCalledTimes(1); // the unknown code only
    expect(findByPairingCode).not.toHaveBeenCalledWith("000000");
    expect(savePairing).not.toHaveBeenCalled();
  });
});
