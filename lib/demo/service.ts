import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { generateDeviceToken, hashDeviceToken } from "@/lib/auth/pairing";
import type { CustomClaims } from "@/lib/auth/roles";
import { AppError, ConflictError, LockedError, NotFoundError } from "@/lib/http/errors";
import { cloneTemplate, judgeDeviceIdOf, sandboxIds } from "@/lib/demo/clone";
import {
  CLEANUP_PER_CREATE,
  COUNTER_TTL_MS,
  SANDBOX_DAILY,
  SANDBOX_IP_DAILY,
  SANDBOX_TTL_MS,
  SWITCH_IP_DAILY,
  SWITCHES_PER_SANDBOX,
} from "@/lib/demo/constants";
import { DemoSessionResponseSchema, type DemoRole, type DemoSessionBody, type DemoSessionResponse } from "@/lib/demo/contract";
import { ipBucketKey, secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";
import { TemplateTooLargeError, type DemoStore } from "@/lib/demo/store-types";

/**
 * Demo session service (R-12 Task 6.3). Pure orchestration over an injected `DemoStore`, so every
 * rule is tested without Firestore or Firebase. Demo project only: the first thing every entry
 * point checks is `demoMode` (DEMO_MODE === "true"); off means 404 before any read.
 *
 * Never logged or stored: a raw IP, the sandbox key, a token, a hash (only `key_sha256` on the
 * sandbox outlet and `token_hash` on the judge device are stored, as hashes).
 */

export interface DemoDeps {
  /** Firebase custom token for owner/supervisor (the existing `mintCustomToken`). */
  mintToken: (uid: string, claims: CustomClaims) => Promise<string>;
  randomBytes?: (n: number) => Buffer;
  generateToken?: () => string;
  hashToken?: (token: string) => Promise<string>;
  /** Overrides for the daily caps (env DEMO_SANDBOX_DAILY_CAP / DEMO_SWITCH_IP_CAP). */
  caps?: { sandboxDaily?: number; switchIpDaily?: number };
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface IssueInput {
  body: DemoSessionBody;
  ip: string;
  now_ms: number;
  demoMode: boolean;
  /** DEMO_IP_SALT. Empty means the demo is not ready (never an unsalted hash). */
  salt: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const defaultLog = (event: string, fields: Record<string, unknown>) => console.info(`[demo] ${event}`, fields);
const notReady = () => new AppError("The demo is not ready", "demo_not_ready", 503);

const LANDING: Record<"owner" | "supervisor", string> = { owner: "/home", supervisor: "/day" };

/** Starts a visit (no key: a fresh sandbox) or switches role inside one (key given). */
export async function issueDemoSession(store: DemoStore, deps: DemoDeps, input: IssueInput): Promise<DemoSessionResponse> {
  const log = deps.log ?? defaultLog;
  if (!input.demoMode) throw new NotFoundError("route", "route"); // before any read, never logged
  if (input.salt.length === 0) throw notReady(); // both paths hash the IP: never unsalted, never a store call
  try {
    return input.body.sandbox_key !== undefined
      ? await switchRole(store, deps, input, input.body.sandbox_key, input.body.role)
      : await createSandbox(store, deps, input, input.body.role);
  } catch (error) {
    if (error instanceof AppError) log("refused", { code: error.code });
    throw error;
  }
}

async function createSandbox(store: DemoStore, deps: DemoDeps, input: IssueInput, role: DemoRole): Promise<DemoSessionResponse> {
  const log = deps.log ?? defaultLog;
  const { now_ms } = input;

  let tpl;
  try {
    tpl = await store.readTemplate();
  } catch (error) {
    if (error instanceof TemplateTooLargeError) throw new AppError("The demo is not ready", "template_too_large", 503);
    throw error;
  }
  if (tpl === null) throw notReady();
  if (tpl.outlet.project_kind !== "demo") throw new NotFoundError("route", "route");

  // Limits come before any write. A day already at its cap is refused by a read-only check, so a
  // flood after the cap writes nothing (M2). Then the per-IP counter is bumped first so a refused IP
  // does not burn the day's cap.
  const day = utcDay(now_ms);
  const counterExpiry = new Date(now_ms + COUNTER_TTL_MS).toISOString();
  const retry = secondsToUtcMidnight(now_ms);
  const dayCap = deps.caps?.sandboxDaily ?? SANDBOX_DAILY;
  const dayCounterId = `sandbox_day:${day}`;
  const dayRefused = () => new LockedError(retry, "The demo has reached today's limit", "demo_daily_cap");
  if ((await store.readCounter(dayCounterId)) >= dayCap) throw dayRefused();
  if (!(await store.bumpCounter(ipBucketKey(input.ip, day, input.salt), "sandbox_ip", day, SANDBOX_IP_DAILY, counterExpiry))) {
    throw new LockedError(retry, "Too many demo sessions from this network today", "rate_limited");
  }
  if (!(await store.bumpCounter(dayCounterId, "sandbox_day", day, dayCap, counterExpiry))) throw dayRefused();

  await cleanupExpired(store, deps, now_ms);

  const random = deps.randomBytes ?? nodeRandomBytes;
  const key = random(32).toString("base64url");
  const hex = random(6).toString("hex");
  const ids = sandboxIds(hex, hex); // same hex: the judge device is found from the outlet id alone
  const deviceToken = (deps.generateToken ?? generateDeviceToken)();
  const tokenHash = await (deps.hashToken ?? hashDeviceToken)(deviceToken);

  let docs;
  try {
    docs = cloneTemplate({ tpl, ids, now_ms, key_sha256: sha256(key), device_token_hash: tokenHash });
  } catch {
    throw notReady(); // e.g. a template with no ended debrief: a template bug, not the caller's
  }
  try {
    await store.writeSandbox(docs);
  } catch (error) {
    await removeHalfBuilt(store, deps, ids.outlet_id, sha256(key));
    throw error;
  }
  log("sandbox_created", { sandbox: ids.outlet_id });

  return credentials(store, deps, {
    outlet_id: ids.outlet_id,
    role,
    key,
    expires_at_ms: now_ms + SANDBOX_TTL_MS,
    device: { token: deviceToken },
  });
}

/**
 * Lazy cleanup of old sandboxes: best effort, never fails the request. Each sandbox is deleted in its
 * own try/catch; one that fails is quarantined (moved behind the rest of the list) so a single broken
 * sandbox cannot block the head of the list forever. Logs only the sandbox id and the error class.
 * Follow-up (not now): move cleanup to a Cloud Tasks job so it does not ride on a judge's request.
 */
async function cleanupExpired(store: DemoStore, deps: DemoDeps, now_ms: number): Promise<void> {
  const log = deps.log ?? defaultLog;
  let ids: string[];
  try {
    ids = await store.listExpiredSandboxes(now_ms, CLEANUP_PER_CREATE);
  } catch (error) {
    log("cleanup_failed", { error_class: errorClass(error) });
    return;
  }
  for (const id of ids) {
    try {
      await store.deleteSandbox(id);
    } catch (error) {
      log("cleanup_failed", { sandbox: id, error_class: errorClass(error) });
      try {
        await store.deferSandboxCleanup(id, now_ms);
      } catch (deferError) {
        log("cleanup_defer_failed", { sandbox: id, error_class: errorClass(deferError) });
      }
    }
  }
}

/**
 * After a failed write, best-effort removal of OUR half-built sandbox, and only ours: an id collision
 * (create() on a taken id) must never delete another visitor's sandbox, so the outlet found under the id
 * has to carry this request's key hash. Anything else (no outlet, another key, a read failure) skips the
 * delete; an orphan of ours is found later through its expiry.
 */
async function removeHalfBuilt(store: DemoStore, deps: DemoDeps, outletId: string, keySha256: string): Promise<void> {
  const log = deps.log ?? defaultLog;
  try {
    const existing = await store.getOutlet(outletId);
    if (existing?.sandbox?.key_sha256 !== keySha256) return;
    await store.deleteSandbox(outletId);
  } catch (error) {
    log("cleanup_failed", { sandbox: outletId, error_class: errorClass(error) });
  }
}

const errorClass = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

async function switchRole(
  store: DemoStore,
  deps: DemoDeps,
  input: IssueInput,
  key: string,
  role: DemoRole,
): Promise<DemoSessionResponse> {
  const { now_ms } = input;
  const day = utcDay(now_ms);

  // Per-IP bucket BEFORE the key lookup: a bogus key costs a Firestore query, so the guess rate is bounded (M1).
  // The id is prefixed so it never shares a doc with the sandbox-creation counter of the same IP and day.
  const ipAllowed = await store.bumpCounter(
    `switch_ip:${ipBucketKey(input.ip, day, input.salt)}`,
    "switch_ip",
    day,
    deps.caps?.switchIpDaily ?? SWITCH_IP_DAILY,
    new Date(now_ms + COUNTER_TTL_MS).toISOString(),
  );
  if (!ipAllowed) throw new LockedError(secondsToUtcMidnight(now_ms), "Too many demo sessions from this network today", "rate_limited");

  const outlet = await store.findSandboxByKey(sha256(key));
  if (!outlet?.sandbox) throw new NotFoundError("route", "route");
  const expires = outlet.sandbox.expires_at_ms;
  if (now_ms >= expires) throw new ConflictError("Sandbox expired", "SANDBOX_EXPIRED");

  const allowed = await store.bumpCounter(
    `switch:${outlet.outlet_id}`,
    "switch_sandbox",
    day,
    SWITCHES_PER_SANDBOX,
    new Date(now_ms + COUNTER_TTL_MS).toISOString(),
  );
  if (!allowed) {
    throw new LockedError(Math.max(1, Math.ceil((expires - now_ms) / 1000)), "Too many role switches", "rate_limited");
  }
  return credentials(store, deps, { outlet_id: outlet.outlet_id, role, key, expires_at_ms: expires });
}

async function credentials(
  store: DemoStore,
  deps: DemoDeps,
  c: { outlet_id: string; role: DemoRole; key: string; expires_at_ms: number; device?: { token: string } },
): Promise<DemoSessionResponse> {
  const log = deps.log ?? defaultLog;
  if (c.role === "staff") {
    const device_id = judgeDeviceIdOf(c.outlet_id);
    let token = c.device?.token;
    if (token === undefined) {
      // A role switch back to staff: a sandbox has one judge, so rotating the token strands no one.
      token = (deps.generateToken ?? generateDeviceToken)();
      const hash = await (deps.hashToken ?? hashDeviceToken)(token);
      await store.rotateDeviceToken(c.outlet_id, device_id, hash, c.expires_at_ms);
    }
    log("role_issued", { sandbox: c.outlet_id, role: c.role });
    return DemoSessionResponseSchema.parse({
      kind: "device",
      role: "staff",
      device_id,
      device_token: token,
      sandbox_key: c.key,
      expires_at_ms: c.expires_at_ms,
      landing_path: "/capture",
    });
  }
  const custom_token = await deps.mintToken(`demo-${c.role}-${c.outlet_id}`, {
    outlet_id: c.outlet_id,
    role: c.role,
    demo_exp_ms: c.expires_at_ms,
  });
  log("role_issued", { sandbox: c.outlet_id, role: c.role });
  return DemoSessionResponseSchema.parse({
    kind: "web",
    role: c.role,
    custom_token,
    sandbox_key: c.key,
    expires_at_ms: c.expires_at_ms,
    landing_path: LANDING[c.role],
  });
}
