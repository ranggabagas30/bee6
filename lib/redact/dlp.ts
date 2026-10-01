import { DlpServiceClient, type protos } from "@google-cloud/dlp";
import { ServiceUnavailableError } from "@/lib/http/errors";
import { redactIndonesianPhones } from "@/lib/redact/indonesian-phone";
import type { Redactor } from "@/lib/redact/types";

/**
 * Sensitive Data Protection implementation of the Redactor (R-04, slice 2).
 *
 * Hard rules honoured here:
 *  - #1: Google Cloud service only (`@google-cloud/dlp`, ADC — no API key).
 *  - #3: this is the redaction that MUST run before any transcript text is
 *    stored. It replaces phone numbers, emails, person names and street
 *    addresses with bracketed labels.
 *  - FAIL CLOSED: any error (DLP down, timeout, a response with no usable text)
 *    throws `ServiceUnavailableError` (503) and returns nothing, so unredacted
 *    text can never reach the store. The input text is never interpolated into an
 *    Error, so a transcript line cannot leak through a failure path.
 *
 * A pure Indonesian-phone regex pass runs first as a deterministic supplement.
 */

type IDeidentifyContentRequest =
  protos.google.privacy.dlp.v2.IDeidentifyContentRequest;
type IDeidentifyContentResponse =
  protos.google.privacy.dlp.v2.IDeidentifyContentResponse;

/** Info types redacted, in a fixed order (also the order of bracketed labels). */
export const DLP_INFO_TYPES = [
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "PERSON_NAME",
  "STREET_ADDRESS",
] as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_REGION = "asia-southeast2";

/**
 * Test seam: performs one `deidentifyContent` call. The default implementation
 * builds a regional DLP client; unit tests inject a fake so no real call is made.
 */
export type Deidentify = (
  request: IDeidentifyContentRequest,
  options: { timeout: number },
) => Promise<IDeidentifyContentResponse>;

export interface DlpRedactorDeps {
  deidentify?: Deidentify;
  /** GCP project id. Defaults to `process.env.GOOGLE_CLOUD_PROJECT`. */
  project?: string;
  /** DLP region. Defaults to `process.env.APP_REGION` then asia-southeast2. */
  region?: string;
  /** Server-side timeout in ms. Defaults to 30 s. */
  timeoutMs?: number;
  /** Run the Indonesian phone regex pass in addition to DLP. Default true. */
  regexPass?: boolean;
}

/** The default caller: a regional DLP client (ADC), one `deidentifyContent`. */
function makeDlpDeidentify(region: string): Deidentify {
  // Regional endpoint per the DLP docs (data stays in-region, hard rule #5).
  const client = new DlpServiceClient({
    apiEndpoint: `dlp.${region}.rep.googleapis.com`,
  });
  return async (request, options) => {
    const [response] = await client.deidentifyContent(request, options);
    return response;
  };
}

function buildRequest(
  project: string,
  region: string,
  text: string,
): IDeidentifyContentRequest {
  return {
    parent: `projects/${project}/locations/${region}`,
    item: { value: text },
    inspectConfig: {
      infoTypes: DLP_INFO_TYPES.map((name) => ({ name })),
    },
    deidentifyConfig: {
      infoTypeTransformations: {
        // One transformation per info type so each gets its own bracketed label.
        transformations: DLP_INFO_TYPES.map((name) => ({
          infoTypes: [{ name }],
          primitiveTransformation: {
            replaceConfig: { newValue: { stringValue: `[${name}]` } },
          },
        })),
      },
    },
  };
}

export function dlpRedactor(deps: DlpRedactorDeps = {}): Redactor {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const region = deps.region ?? process.env.APP_REGION ?? DEFAULT_REGION;
  const useRegex = deps.regexPass ?? true;
  const deidentify = deps.deidentify ?? makeDlpDeidentify(region);

  return {
    async redact(text: string): Promise<string> {
      // Empty text short-circuits without a call (nothing to redact).
      if (!text) return "";

      const project = deps.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
      const pre = useRegex ? redactIndonesianPhones(text) : text;
      const request = buildRequest(project, region, pre);

      let response: IDeidentifyContentResponse;
      try {
        response = await deidentify(request, { timeout: timeoutMs });
      } catch (error) {
        // Sanitised: never interpolate the DLP error or the input text.
        // Extract upstream status code or timeout signal without message text.
        let upstream: number | "timeout" | "unknown" = "unknown";
        // Check for timeout first (highest priority)
        if (error instanceof Error) {
          if (error.name === "AbortError" || error.message.includes("timeout")) {
            upstream = "timeout";
          } else if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            typeof (error as { code?: unknown }).code === "number"
          ) {
            upstream = (error as { code?: unknown }).code as number;
          }
        } else if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "number"
        ) {
          upstream = (error as { code?: unknown }).code as number;
        }
        throw new ServiceUnavailableError("Redaction upstream unavailable", "redact", upstream);
      }

      const value = response.item?.value;
      if (typeof value !== "string") {
        // Fail closed: no usable output → do NOT return the unredacted input.
        throw new ServiceUnavailableError("Redaction returned no content", "redact", "unknown");
      }
      return value;
    },
  };
}
