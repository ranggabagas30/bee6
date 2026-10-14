import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { ZodError } from "zod";
import { generateDeviceToken, hashDeviceToken } from "@/lib/auth/pairing";
import { businessDateOf } from "@/lib/capture/calendar";
import type { CustomClaims } from "@/lib/auth/roles";
import { AppError, ConflictError, ForbiddenError, LockedError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { cloneTemplate, judgeDeviceIdOf, sandboxIds } from "@/lib/demo/clone";
import {
  CLEANUP_PER_CREATE,
  COUNTER_TTL_MS,
  IP_SALT_MIN_LENGTH,
  RESET_PER_SANDBOX,
  SANDBOX_DAILY,
  SANDBOX_OUTLET_PREFIX,
  SANDBOX_IP_DAILY,
  SANDBOX_TTL_MS,
  SWITCH_IP_DAILY,
  SWITCHES_PER_SANDBOX,
} from "@/lib/demo/constants";
import {
  DemoResetBodySchema,
  DemoResetResponseSchema,
  DemoSessionResponseSchema,
  type DemoResetResponse,
  type DemoRole,
  type DemoSessionBody,
  type DemoSessionResponse,
} from "@/lib/demo/contract";
import { ipBucketKey, secondsToUtcMidnight, utcDay } from "@/lib/demo/limits";
import { SHIFT_MARKER_STALE_MS } from "@/lib/demo/next-day";
import { runCheck } from "@/lib/demo/redact-cap";
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
  /** DEMO_IP_SALT. Empty or shorter than IP_SALT_MIN_LENGTH means the demo is not ready (never an unsalted hash). */
  salt: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const defaultLog = (event: string, fields: Record<string, unknown>) => console.info(`[demo] ${event}`, fields);
const notReady = () => new AppError("The demo is not ready", "demo_not_ready", 503);

/** Clone error message prefix -> stable code. Codes carry no id, date or path. */
const CLONE_FAILURE_CODES: readonly (readonly [string, string])[] = [
  ["cloneTemplate: template has no ended debrief", "no_ended_debrief"],
  ["cloneTemplate: negative shift", "negative_shift"],
  ["cloneTemplate: the shift would change the local clock time", "dst_guard"],
  ["cloneTemplate: template free text contains a template id token", "template_id_token"],
  ["cloneTemplate: template has no ended session", "missing_session_day"],
  ["cloneTemplate: a template session starts after now", "session_after_now"],
  ["cloneTemplate: expiry", "bad_expiry"],
];

/** The only thing logged about a failed clone: a fixed code, never the error message. */
export function cloneFailureReason(error: unknown): string {
  if (error instanceof ZodError) return "invalid_template_doc";
  if (!(error instanceof Error)) return "unknown";
  if (error.message.startsWith("cloneTemplate:")) {
    return CLONE_FAILURE_CODES.find(([prefix]) => error.message.startsWith(prefix))?.[1] ?? "other";
  }
  return error.name;
}

const LANDING: Record<"owner" | "supervisor", string> = { owner: "/home", supervisor: "/day" };

/** Starts a visit (no key: a fresh sandbox) or switches role inside one (key given). */
export async function issueDemoSession(store: DemoStore, deps: DemoDeps, raw: IssueInput): Promise<DemoSessionResponse> {
  const log = deps.log ?? defaultLog;
  if (!raw.demoMode) throw new NotFoundError("route", "route"); // before any read, never logged
  // The salt is trimmed once, here: a secret often ends in a newline, and whitespace must not count towards the minimum length.
  const input: IssueInput = { ...raw, salt: raw.salt.trim() };
  if (input.salt.length < IP_SALT_MIN_LENGTH) throw notReady(); // both paths hash the IP: never unsalted or weakly salted, never a store call
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
    docs = cloneTemplate({
      tpl,
      ids,
      now_ms,
      key_sha256: sha256(key),
      device_token_hash: tokenHash,
      // R-18: the template's days move so the last one is yesterday's business date in the OUTLET's timezone
      anchor_business_date: businessDateOf(now_ms, tpl.outlet.timezone),
    });
  } catch (error) {
    // e.g. a template with no ended debrief, or one that cannot be shifted: a template bug, not the caller's.
    // Only a fixed reason code is logged: some clone messages interpolate a thread id or a business date and a
    // ZodError message lists paths and values, so the message itself is never printed.
    log("clone_failed", { reason: cloneFailureReason(error) });
    throw notReady();
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

// ── R-19 PR-7: owner reset of the demo sandbox (docs/tasks/R-19-demo-v2.md section 8.4) ─────────────────────────

/** How long the reset holds the judge device's pipeline lease (the tick and a next-day shift skip the device meanwhile). */
export const RESET_LEASE_MS = 120_000;

/**
 * The store seam of the reset: the `DemoStore` calls it needs plus four narrow ones. Firestore implementation:
 * `firestoreResetStore` in lib/firestore/demo-reset-store.ts.
 */
export interface ResetStore extends Pick<DemoStore, "readTemplate" | "writeSandbox" | "deleteSandbox" | "getOutlet" | "bumpCounter" | "readCounter"> {
  /** The judge device's stored token hash; null when the device doc is missing, belongs to another outlet or has no hash. */
  readJudgeTokenHash(outletId: string, deviceId: string): Promise<string | null>;
  /** `proposal_locks/{outlet}` exists with `expires_at_ms > nowMs` (a proposal is being generated). */
  proposalLockLive(outletId: string, nowMs: number): Promise<boolean>;
  /** The device's pipeline lease (the tick store's); null when held. */
  acquireLease(outletId: string, deviceId: string, nowMs: number, ttlMs: number): Promise<number | null>;
  releaseLease(outletId: string, deviceId: string, token: number): Promise<void>;
}

export interface ResetDeps {
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface ResetInput {
  /** The verified claims: the outlet comes from here and only from here, never from the request. */
  claims: Pick<CustomClaims, "outlet_id" | "role">;
  now_ms: number;
  /** The route's `DEMO_MODE === "true"`. */
  demoMode: boolean;
  /** Reads the request body. Called only after the sandbox gate and the owner check, so a caller who fails either never reaches body handling. */
  body: () => Promise<unknown>;
}

const busy = () => new ConflictError("The demo is busy, try again shortly", "busy");

/**
 * `POST /api/v1/demo/reset`: wipes ONE sandbox back to the template (day 1, original SOP, no proposals, no staff
 * answers), keeping its key, its 2-hour expiry, its judge device and that device's token (the paired phone and the
 * signed-in owner keep working). Demo project only.
 *
 * Order (nothing destructive happens before step 8; every refusal before it spends no cap slot):
 *  1. DEMO_MODE off -> 404, before any read.   2. The caller's outlet is a sandbox (id prefix, then the outlet doc
 *  with `project_kind` "demo" and a `sandbox` object) else the same 404.   3. role === "owner" else 403.
 *  4. Strict body `{ confirm: "reset" }`.   5. The sandbox is not expired (409 SANDBOX_EXPIRED).
 *  6. Cap pre-check, read-only (429).   7. Refuse while a fresh shift marker, a live proposal lock or a held pipeline
 *  lease says something is writing to the sandbox (409 busy); a marker older than SHIFT_MARKER_STALE_MS is a crashed
 *  shift and does not block (the reset is its recovery). The re-clone is built in memory FIRST (a broken template
 *  never destroys a sandbox), then the lease is taken, then the cap slot is charged.
 *  8. `deleteSandbox`, then `writeSandbox` of the re-clone with the SAME ids, key hash, token hash and expiry.
 * A failure from step 8 on is a 503 `reset_failed`: the half-built sandbox expires and is cleaned up like any other.
 * A next-day shift that was in flight cannot finish against the new sandbox: it needs the lease or the marker count.
 *
 * Nothing is logged but fixed codes, the sandbox id and an error class. No key, hash, token, text or device id.
 */
export async function resetSandbox(store: ResetStore, deps: ResetDeps, input: ResetInput): Promise<DemoResetResponse> {
  const log = deps.log ?? defaultLog;
  const { now_ms } = input;
  if (!input.demoMode) throw new NotFoundError("route", "route"); // before any read, never logged
  const outletId = input.claims.outlet_id;
  if (!outletId.startsWith(SANDBOX_OUTLET_PREFIX)) throw new NotFoundError("route", "route");
  const outlet = await store.getOutlet(outletId);
  if (!outlet || outlet.project_kind !== "demo" || !outlet.sandbox) throw new NotFoundError("route", "route");
  if (input.claims.role !== "owner") throw new ForbiddenError("Only the owner can reset the demo");

  const parsed = DemoResetBodySchema.safeParse(await input.body());
  if (!parsed.success) {
    throw new ValidationError(
      "invalid_body",
      parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.code })),
    );
  }

  const expires = outlet.sandbox.expires_at_ms;
  if (now_ms >= expires) throw new ConflictError("Sandbox expired", "SANDBOX_EXPIRED");

  // The cap: a read-only look now (a refused or busy reset costs no slot), the charge right before the wipe.
  const counterId = `reset_sandbox:${outletId}`;
  const capRefused = () =>
    new LockedError(Math.max(1, Math.ceil((expires - now_ms) / 1000)), "This demo has reached its reset limit", "demo_reset_cap");
  await runCheck(async () => {
    if ((await store.readCounter(counterId)) >= RESET_PER_SANDBOX) throw capRefused();
  });

  const marker = outlet.sandbox.shift_started_at_ms ?? null;
  if (marker !== null && now_ms - marker <= SHIFT_MARKER_STALE_MS) throw busy();
  if (await store.proposalLockLive(outletId, now_ms)) throw busy();

  const deviceId = judgeDeviceIdOf(outletId);
  const tokenHash = await store.readJudgeTokenHash(outletId, deviceId);
  if (!tokenHash) throw notReady();

  let tpl;
  try {
    tpl = await store.readTemplate();
  } catch (error) {
    if (error instanceof TemplateTooLargeError) throw new AppError("The demo is not ready", "template_too_large", 503);
    throw error;
  }
  if (tpl === null || tpl.outlet.project_kind !== "demo") throw notReady();
  let docs;
  try {
    docs = cloneTemplate({
      tpl,
      ids: { outlet_id: outletId, device_id: deviceId },
      now_ms,
      key_sha256: outlet.sandbox.key_sha256,
      device_token_hash: tokenHash,
      anchor_business_date: businessDateOf(now_ms, tpl.outlet.timezone),
      expires_at_ms: expires, // a reset never extends the 2-hour copy
    });
  } catch (error) {
    log("clone_failed", { reason: cloneFailureReason(error) });
    throw notReady();
  }

  const lease = await store.acquireLease(outletId, deviceId, now_ms, RESET_LEASE_MS);
  if (lease === null) throw busy();
  try {
    await runCheck(async () => {
      if (!(await store.bumpCounter(counterId, "reset_sandbox", utcDay(now_ms), RESET_PER_SANDBOX, new Date(now_ms + COUNTER_TTL_MS).toISOString()))) {
        throw capRefused();
      }
    });
    let stage: "delete" | "write" = "delete";
    try {
      await store.deleteSandbox(outletId);
      stage = "write";
      await store.writeSandbox(docs);
    } catch (error) {
      log("reset_failed", { sandbox: outletId, stage, error_class: errorClass(error) });
      throw new AppError("The reset did not finish", "reset_failed", 503);
    }
    log("sandbox_reset", { sandbox: outletId });
    return DemoResetResponseSchema.parse({ reset: true });
  } finally {
    // The wipe also removed the lease doc, so this is normally a no-op. Never rethrow: it must not mask the result.
    try {
      await store.releaseLease(outletId, deviceId, lease);
    } catch (error) {
      log("reset_release_failed", { sandbox: outletId, error_class: errorClass(error) });
    }
  }
}
