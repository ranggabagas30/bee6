import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { protos } from "@google-cloud/dlp";
import {
  DLP_INFO_TYPES,
  dlpRedactor,
  type Deidentify,
} from "@/lib/redact/dlp";
import { PHONE_LABEL } from "@/lib/redact/indonesian-phone";
import { ServiceUnavailableError } from "@/lib/http/errors";
import * as regions from "@/config/regions";

type Request = protos.google.privacy.dlp.v2.IDeidentifyContentRequest;
type Response = protos.google.privacy.dlp.v2.IDeidentifyContentResponse;

/** A fake DLP that records the request and echoes the input as "redacted". */
function recordingDeidentify(overrideValue?: string | null) {
  const seen: { request?: Request; options?: { timeout: number } } = {};
  const deidentify: Deidentify = async (request, options) => {
    seen.request = request;
    seen.options = options;
    const value =
      overrideValue === undefined ? request.item?.value ?? "" : overrideValue;
    return { item: { value } } as Response;
  };
  return { deidentify, seen };
}

const baseDeps = {
  project: "proj-1",
  region: "asia-southeast2",
  regexPass: false as const,
};

describe("dlpRedactor.redact", () => {
  it("short-circuits empty text without calling DLP", async () => {
    let called = false;
    const deidentify: Deidentify = async () => {
      called = true;
      return { item: { value: "" } } as Response;
    };
    const out = await dlpRedactor({ ...baseDeps, deidentify }).redact("");
    expect(out).toBe("");
    expect(called).toBe(false);
  });

  it("targets the regional parent for the outlet's APP_REGION", async () => {
    const { deidentify, seen } = recordingDeidentify();
    await dlpRedactor({ ...baseDeps, deidentify }).redact("hello");
    expect(seen.request?.parent).toBe(
      "projects/proj-1/locations/asia-southeast2",
    );
  });

  it("inspects the four required info types and replaces each with a bracketed label", async () => {
    const { deidentify, seen } = recordingDeidentify();
    await dlpRedactor({ ...baseDeps, deidentify }).redact("hello");

    const inspected = (seen.request?.inspectConfig?.infoTypes ?? []).map(
      (t) => t.name,
    );
    expect(inspected).toEqual([...DLP_INFO_TYPES]);
    expect([...DLP_INFO_TYPES]).toEqual([
      "PHONE_NUMBER",
      "EMAIL_ADDRESS",
      "PERSON_NAME",
      "STREET_ADDRESS",
    ]);

    const transforms =
      seen.request?.deidentifyConfig?.infoTypeTransformations?.transformations ??
      [];
    const labels = transforms.map(
      (t) => t.primitiveTransformation?.replaceConfig?.newValue?.stringValue,
    );
    expect(labels).toEqual([
      "[PHONE_NUMBER]",
      "[EMAIL_ADDRESS]",
      "[PERSON_NAME]",
      "[STREET_ADDRESS]",
    ]);
  });

  it("returns the redacted value from the DLP response", async () => {
    const { deidentify } = recordingDeidentify("hi [PERSON_NAME]");
    const out = await dlpRedactor({ ...baseDeps, deidentify }).redact(
      "hi Budi",
    );
    expect(out).toBe("hi [PERSON_NAME]");
  });

  it("passes a server-side timeout to the DLP call", async () => {
    const { deidentify, seen } = recordingDeidentify();
    await dlpRedactor({ ...baseDeps, deidentify, timeoutMs: 30_000 }).redact(
      "hello",
    );
    expect(seen.options?.timeout).toBe(30_000);
  });

  it("runs the Indonesian phone regex pass before DLP when enabled", async () => {
    const { deidentify, seen } = recordingDeidentify();
    await dlpRedactor({
      project: "proj-1",
      region: "asia-southeast2",
      regexPass: true,
      deidentify,
    }).redact("call 081234567890");
    // DLP receives text with the local number already masked.
    expect(seen.request?.item?.value).toBe(`call ${PHONE_LABEL}`);
  });

  it("FAILS CLOSED: a DLP error throws ServiceUnavailableError and returns nothing", async () => {
    const deidentify: Deidentify = async () => {
      throw new Error("DLP 500 backend error");
    };
    await expect(
      dlpRedactor({ ...baseDeps, deidentify }).redact("secret text"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("FAILS CLOSED: a response with no usable value throws instead of returning input", async () => {
    const deidentify: Deidentify = async () => ({ item: {} } as Response);
    await expect(
      dlpRedactor({ ...baseDeps, deidentify }).redact("secret text"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("does not leak the input text in a fail-closed error", async () => {
    const secret = "Budi lives at Jl. Merdeka 10";
    const deidentify: Deidentify = async () => {
      throw new Error(secret);
    };
    let caught: unknown;
    try {
      await dlpRedactor({ ...baseDeps, deidentify }).redact(secret);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).not.toContain(secret);
  });

  it("sets stage='redact' on ServiceUnavailableError for DLP failure", async () => {
    const deidentify: Deidentify = async () => {
      throw new Error("DLP 500");
    };
    try {
      await dlpRedactor({ ...baseDeps, deidentify }).redact("text");
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceUnavailableError);
      expect((e as ServiceUnavailableError).stage).toBe("redact");
      expect((e as ServiceUnavailableError).upstream).toBeDefined();
    }
  });

  it("extracts numeric code to upstream field from gRPC error", async () => {
    const deidentify: Deidentify = async () => {
      const err = new Error("DLP error");
      (err as { code?: number }).code = 14; // UNAVAILABLE gRPC status
      throw err;
    };
    try {
      await dlpRedactor({ ...baseDeps, deidentify }).redact("text");
    } catch (e) {
      expect((e as ServiceUnavailableError).upstream).toBe(14);
    }
  });

  it("sets upstream='timeout' for timeout/abort errors", async () => {
    const deidentify: Deidentify = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    try {
      await dlpRedactor({ ...baseDeps, deidentify }).redact("text");
    } catch (e) {
      expect((e as ServiceUnavailableError).upstream).toBe("timeout");
    }
  });

  it("resolves its default region via getServiceLocation('dlp'), not a hardcoded literal (hard rule #5)", async () => {
    const spy = vi
      .spyOn(regions, "getServiceLocation")
      .mockReturnValue({
        location: "asia-southeast1",
        latency_ms: 42,
        probed_at: "2026-10-01T00:00:00.000Z",
        error: null,
      });
    const { deidentify, seen } = recordingDeidentify();

    // No `region` override — exercises the default-resolution path.
    await dlpRedactor({ project: "proj-1", deidentify }).redact("hello");

    expect(spy).toHaveBeenCalledWith("dlp");
    expect(seen.request?.parent).toBe("projects/proj-1/locations/asia-southeast1");
    spy.mockRestore();
  });

  it("uses the plain global DLP endpoint (no '.rep.' regional suffix) when the resolved region is 'global'", async () => {
    // `dlp.global.rep.googleapis.com` does not exist — DLP's global
    // endpoint is the bare `dlp.googleapis.com` host, reached by omitting
    // apiEndpoint entirely, not by templating "global" into the regional
    // pattern used for an actual region like "asia-southeast1".
    const seenEndpoints: (string | undefined)[] = [];
    vi.doMock("@google-cloud/dlp", () => ({
      DlpServiceClient: vi.fn().mockImplementation((opts?: { apiEndpoint?: string }) => {
        seenEndpoints.push(opts?.apiEndpoint);
        return {
          deidentifyContent: vi.fn().mockResolvedValue([{ item: { value: "ok" } }]),
        };
      }),
    }));
    vi.resetModules();
    const { dlpRedactor: freshDlpRedactor } = await import("@/lib/redact/dlp");

    await freshDlpRedactor({ project: "proj-1", region: "global" }).redact("hello");

    expect(seenEndpoints).toHaveLength(1);
    expect(seenEndpoints[0]).toBeUndefined();
    vi.doUnmock("@google-cloud/dlp");
    vi.resetModules();
  });

  it("never hardcodes asia-southeast2 (or any literal region) in lib/redact/dlp.ts", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/redact/dlp.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/asia-southeast2/);
    expect(source).not.toMatch(/process\.env\.APP_REGION/);
  });

  it("sets stage='redact' and upstream on no-content response", async () => {
    const deidentify: Deidentify = async () => ({ item: {} } as Response);
    try {
      await dlpRedactor({ ...baseDeps, deidentify }).redact("text");
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceUnavailableError);
      expect((e as ServiceUnavailableError).stage).toBe("redact");
      expect((e as ServiceUnavailableError).upstream).toBe("unknown");
    }
  });
});
