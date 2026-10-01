/**
 * The DLP region -> endpoint/parent mapping, shared by the real redactor
 * (`lib/redact/dlp.ts`) and the region probe (`scripts/probe.ts`), so the
 * two can never drift apart and silently disagree about how a region is
 * reached (hard rule #5 — no literal region string, and no second copy
 * of the mapping to go stale).
 *
 * "global" has no `<region>.rep.` regional endpoint of its own — it is
 * reached through the DLP client's plain default host, so
 * `dlpApiEndpointFor` returns `undefined` (no `apiEndpoint` override) for
 * it. Every other region gets the regional override.
 */

/** The `apiEndpoint` override for a region, or `undefined` for "global" (use the client default). */
export function dlpApiEndpointFor(region: string): string | undefined {
  if (region === "global") return undefined;
  return `dlp.${region}.rep.googleapis.com`;
}

/** The `parent` resource name for a `deidentifyContent`/probe request. */
export function dlpParentFor(project: string, region: string): string {
  return `projects/${project}/locations/${region}`;
}
