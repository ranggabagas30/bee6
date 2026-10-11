import type { DemoCounterKind, Outlet } from "@/lib/firestore/schema";
import { AppError, LockedError } from "@/lib/http/errors";
import {
  COUNTER_TTL_MS,
  FAST_FORWARD_PER_SANDBOX,
  GENERATE_DAILY,
  GENERATE_PER_SANDBOX,
  MODEL_DAILY,
  REDACT_PER_SANDBOX,
  SEGMENT_DAILY,
  SANDBOX_DAILY,
  SEGMENT_PER_SANDBOX,
} from "@/lib/demo/constants";
import { secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";
import type { DemoStore } from "@/lib/demo/store-types";
import { OUTLETS_READ_MAX } from "@/lib/reviews/constants";

/**
 * Spend caps for the public demo (R-12 H2). A judge in a sandbox can reach routes that call Gemini or
 * Sensitive Data Protection (segment upload, proposal generation, rejection reasons, answers,
 * constraints), so every such path takes one generic check here, built on the same demo_counters
 * mechanism as the sign-in limits:
 *
 *   1. a per-sandbox cap for the path (id `<kind>:<sandbox outlet id>`; Retry-After to the sandbox expiry),
 *   2. the path's own daily cap across all sandboxes, if it has one (id `<kind>:<UTC day>`),
 *   3. the shared model-call ceiling for the day (`model_day:<UTC day>`), for paths that call a model.
 *
 * Narrow to wide, so a refused sandbox does not burn the day's counters. An outlet without a `sandbox`
 * object fails closed (503 demo_not_ready); the pilot and the shared demo outlet never get here because
 * the route helper only calls this for an sbx- outlet id. The check belongs AFTER
 * authentication, permission and body validation and BEFORE the first model or SDP call, so only an
 * authorised, well-formed request spends a cap and a capped one spends nothing downstream.
 */

export type DemoCapKey = "segment" | "generate" | "fast_forward" | "redact";

export interface DemoCapSpec {
  /** Per-sandbox counter kind. */
  sandboxKind: DemoCounterKind;
  sandboxLimit: number;
  /** Error code of the per-sandbox 429. */
  code: string;
  message: string;
  /** The path's own daily cap across all sandboxes. */
  daily?: { kind: DemoCounterKind; limit: number };
  /** Does the path call a model (counts toward the shared ceiling)? */
  model: boolean;
}

export type CapEnv = Record<string, string | undefined>;

/**
 * No cap override may exceed this (security L3): a typo such as 3000000 for 3000 would otherwise silently
 * raise the spend ceiling a thousandfold. A value above it falls back to the default, like any bad value.
 * The largest default is 5000 (DEMO_MODEL_DAILY_CAP), so this leaves 20x room.
 */
export const CAP_SANITY_MAX = 100_000;

let sanityWarned = false;
function warnCapAboveSanityBound(): void {
  if (sanityWarned) return;
  sanityWarned = true;
  // Never the value or the variable's content: only that some override was ignored.
  console.error("[demo] a DEMO_* cap override is above the sanity bound; using the default", { error_class: "InvalidEnv" });
}

/**
 * A positive-integer env override, else the default ("0" is NOT accepted here; see killableCapFromEnv).
 * The value is trimmed first: a Secret Manager secret often carries a trailing newline.
 */
export function capFromEnv(value: string | undefined, fallback: number): number {
  const v = value?.trim();
  if (v === undefined || !/^\d+$/.test(v)) return fallback;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) return fallback;
  if (n > CAP_SANITY_MAX) {
    warnCapAboveSanityBound();
    return fallback;
  }
  return n;
}

/**
 * Like capFromEnv, but "0" (after trimming, so "0\n" from Secret Manager works) is an explicit kill switch
 * (refuse everything). Garbage (including "00", "0x0", "-1") is NOT a kill switch: it falls back to the
 * default like any other bad value.
 *
 * Killable (a value of 0 refuses): DEMO_MODEL_DAILY_CAP, DEMO_SEGMENT_SANDBOX_CAP, DEMO_SEGMENT_DAILY_CAP,
 * DEMO_GENERATE_SANDBOX_CAP, DEMO_GENERATE_DAILY_CAP, DEMO_REDACT_SANDBOX_CAP.
 * NOT killable (0 falls back to the default, they use capFromEnv): DEMO_FAST_FORWARD_SANDBOX_CAP (no model
 * spend), DEMO_SANDBOX_DAILY_CAP (sandbox creation, bounded by the outlet-read rule below) and
 * DEMO_SWITCH_IP_CAP (the per-IP switch limit). To stop the demo, turn DEMO_MODE off instead.
 */
export function killableCapFromEnv(value: string | undefined, fallback: number): number {
  return value?.trim() === "0" ? 0 : capFromEnv(value, fallback);
}

export function capSpec(key: DemoCapKey, env: CapEnv = process.env): DemoCapSpec {
  switch (key) {
    case "segment":
      return {
        sandboxKind: "segment_sandbox",
        sandboxLimit: killableCapFromEnv(env.DEMO_SEGMENT_SANDBOX_CAP, SEGMENT_PER_SANDBOX),
        code: "demo_segment_cap",
        message: "This demo shop has reached its recording limit",
        daily: { kind: "segment_day", limit: killableCapFromEnv(env.DEMO_SEGMENT_DAILY_CAP, SEGMENT_DAILY) },
        model: true,
      };
    case "generate":
      return {
        sandboxKind: "generate_sandbox",
        sandboxLimit: killableCapFromEnv(env.DEMO_GENERATE_SANDBOX_CAP, GENERATE_PER_SANDBOX),
        code: "demo_generate_cap",
        message: "This demo shop has reached its proposal limit",
        daily: { kind: "generate_day", limit: killableCapFromEnv(env.DEMO_GENERATE_DAILY_CAP, GENERATE_DAILY) },
        model: true,
      };
    case "fast_forward":
      return {
        sandboxKind: "fast_forward_sandbox",
        sandboxLimit: capFromEnv(env.DEMO_FAST_FORWARD_SANDBOX_CAP, FAST_FORWARD_PER_SANDBOX),
        code: "demo_fast_forward_cap",
        message: "This demo shop has reached its time-skip limit",
        model: false,
      };
    case "redact":
      return {
        sandboxKind: "redact_sandbox",
        sandboxLimit: killableCapFromEnv(env.DEMO_REDACT_SANDBOX_CAP, REDACT_PER_SANDBOX),
        code: "demo_redact_cap",
        message: "This demo shop has reached its text-entry limit",
        model: true,
      };
  }
}

let sandboxCapWarned = false;

/**
 * The effective per-day sandbox-creation cap (DEMO_SANDBOX_DAILY_CAP, default 300). Sandboxes are outlets
 * too, and the daily review run reads at most OUTLETS_READ_MAX outlets. A sandbox is live for at least 26 h, so
 * two UTC days of sandboxes can coexist: 2 * cap + 50 (room for real outlets) must stay below the read or the
 * demo could crowd real outlets out of it. A value that breaks this falls back to the default and is logged once.
 */
export function sandboxDailyLimit(env: CapEnv = process.env): number {
  const n = capFromEnv(env.DEMO_SANDBOX_DAILY_CAP, SANDBOX_DAILY);
  if (2 * n + 50 < OUTLETS_READ_MAX) return n;
  if (!sandboxCapWarned) {
    sandboxCapWarned = true;
    console.error("[demo] DEMO_SANDBOX_DAILY_CAP is too high for the review run's outlet read (2 * cap + 50 must fit); using the default", {
      error_class: "InvalidEnv",
    });
  }
  return SANDBOX_DAILY;
}

export function modelDailyLimit(env: CapEnv = process.env): number {
  return killableCapFromEnv(env.DEMO_MODEL_DAILY_CAP, MODEL_DAILY);
}

/**
 * "charge" (default) counts the request against every cap that applies. "check" only LOOKS: same kill
 * switches, same refusals, but no counter is written. Fast-forward uses check before the review is written
 * and charge only after it was really created, so a skip that is refused or loses a race costs nothing (R-12
 * QA D1). Under a race several skips can pass the check before the first charge lands, so the cap can be
 * overshot by the number of concurrent skips; fast-forward calls no model, so that is acceptable.
 */
export type CapMode = "charge" | "check";

export async function enforceDemoCaps(
  store: DemoStore,
  input: { outlet: Outlet; now_ms: number; key: DemoCapKey; env?: CapEnv; mode?: CapMode },
): Promise<void> {
  const { outlet, now_ms } = input;
  // Callers only reach here for an sbx- outlet; one with no sandbox object is a broken doc: fail closed, never uncapped.
  if (!outlet.sandbox) throw new AppError("The demo is not ready", "demo_not_ready", 503);
  const spec = capSpec(input.key, input.env);
  const day = utcDay(now_ms);
  const expiry = new Date(now_ms + COUNTER_TTL_MS).toISOString();
  const midnight = secondsToUtcMidnight(now_ms);
  const count = (counterId: string, kind: DemoCounterKind, limit: number): Promise<boolean> =>
    input.mode === "check"
      ? store.readCounter(counterId).then((n) => n < limit)
      : store.bumpCounter(counterId, kind, day, limit, expiry);

  // Kill switches (a cap set to exactly 0): refuse before any counter is touched.
  if (spec.sandboxLimit === 0) {
    throw new LockedError(Math.max(1, Math.ceil((outlet.sandbox.expires_at_ms - now_ms) / 1000)), spec.message, spec.code);
  }
  if (spec.daily?.limit === 0) throw new LockedError(midnight, "The demo has reached today's limit", "demo_daily_cap");
  if (spec.model && modelDailyLimit(input.env) === 0) {
    throw new LockedError(midnight, "The demo has reached today's usage limit", "demo_model_cap");
  }

  if (!(await count(`${spec.sandboxKind}:${outlet.outlet_id}`, spec.sandboxKind, spec.sandboxLimit))) {
    throw new LockedError(Math.max(1, Math.ceil((outlet.sandbox.expires_at_ms - now_ms) / 1000)), spec.message, spec.code);
  }
  if (spec.daily && !(await count(`${spec.daily.kind}:${day}`, spec.daily.kind, spec.daily.limit))) {
    throw new LockedError(midnight, "The demo has reached today's limit", "demo_daily_cap");
  }
  if (spec.model && !(await count(`model_day:${day}`, "model_day", modelDailyLimit(input.env)))) {
    throw new LockedError(midnight, "The demo has reached today's usage limit", "demo_model_cap");
  }
}
