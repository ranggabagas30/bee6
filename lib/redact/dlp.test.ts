import { describe, expect, it } from "vitest";
import type { protos } from "@google-cloud/dlp";
import {
  DLP_INFO_TYPES,
  dlpRedactor,
  type Deidentify,
} from "@/lib/redact/dlp";
import { PHONE_LABEL } from "@/lib/redact/indonesian-phone";
import { ServiceUnavailableError } from "@/lib/http/errors";

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
});
