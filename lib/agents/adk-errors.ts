/**
 * R-24 (D17): classify an ADK error EVENT (`ev.errorCode` / `ev.errorMessage`) by fixed ADK literals only.
 * Pure: no `@google/adk` import. The message is only matched, NEVER returned, logged or stored (a Vertex HTTP
 * error's message is the API's own text). The v3 runner keeps its own gap and is not changed to use this.
 */

/** `invocation_context.js:25` in `@google/adk` 2.2.1 (pinned): `Max number of llm calls limit of N exceeded`. */
export const ADK_LIMIT_PREFIX = "Max number of llm calls limit";

export interface AdkErrorClass {
  ended_by: "limit" | "timeout" | "error";
  error_class: "limit" | "timeout" | `adk_${string}`;
}

/** `[a-z0-9_]`, max 40 chars: a stable, loggable error class from an arbitrary ADK errorCode string. */
export function sanitizeAdkErrorCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 40);
}

export function classifyAdkErrorEvent(errorCode: string, errorMessage: string | undefined): AdkErrorClass {
  if (typeof errorMessage === "string") {
    if (errorMessage.startsWith(ADK_LIMIT_PREFIX)) return { ended_by: "limit", error_class: "limit" };
    // undici's AbortError text ("This operation was aborted") when generateContentConfig.abortSignal fires.
    if (/aborted/i.test(errorMessage)) return { ended_by: "timeout", error_class: "timeout" };
  }
  return { ended_by: "error", error_class: `adk_${sanitizeAdkErrorCode(errorCode)}` };
}
