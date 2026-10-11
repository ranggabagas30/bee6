import { z } from "zod";
import { DemoRoleSchema, DemoSessionResponseSchema, type DemoRole, type DemoSessionResponse } from "@/lib/demo/contract";
import { signInWithCustomToken, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { DEVICE_ID_KEY, DEVICE_TOKEN_KEY } from "@/lib/capture/browser/client";

/**
 * Browser side of the R-12 judge sign-in (plan Task 8.2). Talks only to
 * `POST /api/v1/demo/session`; no Firestore, no server module (see
 * import-boundaries.test.ts).
 *
 * The sandbox key lives in `sessionStorage`, per tab: closing the tab ends the
 * visit on this side, and a key never reaches `localStorage`. The only things
 * written to `localStorage` are the judge phone's `bee6.device_*` pair, because
 * `/capture` reads exactly those keys (the same ones `/pair` writes). Tokens and
 * keys are never logged and never put in a URL.
 */

export const DEMO_STATE_KEY = "bee6.demo";
const DEMO_CHANGE_EVENT = "bee6:demo-change";
const SESSION_PATH = "/api/v1/demo/session";

const DemoStateSchema = z
  .object({
    sandbox_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expires_at_ms: z.number().int().positive(),
    role: DemoRoleSchema,
  })
  .strict();
export type DemoState = z.infer<typeof DemoStateSchema>;

// ── per-tab state ─────────────────────────────────────────────────────────

export function parseDemoState(raw: string | null): DemoState | null {
  if (raw === null) return null;
  try {
    const parsed = DemoStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(DEMO_STATE_KEY);
  } catch {
    return null;
  }
}

export function readDemoState(): DemoState | null {
  return parseDemoState(readRaw());
}

function notifyChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DEMO_CHANGE_EVENT));
}

/** Tells every `subscribeDemoState` listener to re-read (also used by the bar's expiry timer). */
export function notifyDemoChange(): void {
  notifyChange();
}

export function writeDemoState(state: DemoState): void {
  try {
    window.sessionStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the visit still works, the bar just has nothing to show.
  }
  notifyChange();
}

function removeDeviceKeys(): void {
  try {
    window.localStorage.removeItem(DEVICE_TOKEN_KEY);
    window.localStorage.removeItem(DEVICE_ID_KEY);
  } catch {
    // Best effort.
  }
}

/** Forgets the sandbox in this tab and the judge phone's device keys. The sandbox itself expires on the server. */
export function clearDemoState(): void {
  try {
    window.sessionStorage.removeItem(DEMO_STATE_KEY);
  } catch {
    // Best effort.
  }
  removeDeviceKeys();
  notifyChange();
}

export function isDemoExpired(state: DemoState, nowMs: number): boolean {
  return nowMs >= state.expires_at_ms;
}

/**
 * A primitive snapshot for `useSyncExternalStore`: "" when there is no valid state, the stored string when
 * live, and the same string with an "|expired" suffix once the clock passes the expiry. Primitive, so React
 * compares by value and never loops.
 */
export function demoSnapshot(nowMs: number = Date.now()): string {
  const raw = readRaw();
  const state = parseDemoState(raw);
  if (raw === null || state === null) return "";
  return isDemoExpired(state, nowMs) ? `${raw}|expired` : raw;
}

export function viewFromSnapshot(snapshot: string): { state: DemoState; expired: boolean } | null {
  if (snapshot === "") return null;
  const expired = snapshot.endsWith("|expired");
  const state = parseDemoState(expired ? snapshot.slice(0, -"|expired".length) : snapshot);
  return state ? { state, expired } : null;
}

export function subscribeDemoState(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(DEMO_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(DEMO_CHANGE_EVENT, onChange);
}

// ── the request ───────────────────────────────────────────────────────────

/** Every refusal the screens handle. `off` means the server says demo mode is not on (404 with no key). */
export type DemoRefusal =
  | { kind: "rate_limited"; retryAfterSeconds: number | null }
  | { kind: "daily_cap"; retryAfterSeconds: number | null }
  | { kind: "busy"; retryAfterSeconds: number | null }
  | { kind: "not_ready" }
  | { kind: "sandbox_expired" }
  | { kind: "off" }
  | { kind: "error" };

export type DemoSessionOutcome = { kind: "ok"; data: DemoSessionResponse } | DemoRefusal;

/** The 429 codes `POST /api/v1/demo/session` answers with, each mapped to a refusal kind (exhaustive). */
const RATE_CODES: Record<string, "rate_limited" | "daily_cap" | "busy"> = {
  rate_limited: "rate_limited",
  demo_daily_cap: "daily_cap",
  demo_busy: "busy",
};

function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const inner = (body as { error?: unknown }).error;
  if (typeof inner !== "object" || inner === null || !("code" in inner)) return null;
  const code = (inner as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function retryAfter(res: Response): number | null {
  const raw = res.headers.get("Retry-After");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

async function bodyOrNull(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** One POST; never throws. Plain `fetch`: this route is the sign-in, so it carries no credentials. */
export async function requestDemoSession(
  role: DemoRole,
  sandboxKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<DemoSessionOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(SESSION_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(sandboxKey === undefined ? { role } : { role, sandbox_key: sandboxKey }),
    });
  } catch {
    return { kind: "error" };
  }

  if (res.status === 200) {
    const body = await bodyOrNull(res);
    const parsed = DemoSessionResponseSchema.safeParse((body as { data?: unknown } | null)?.data);
    return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "error" };
  }
  // 404 with a key = the sandbox is gone (deleted or never ours); 404 with no key = demo mode is not on here.
  if (res.status === 404) return sandboxKey === undefined ? { kind: "off" } : { kind: "sandbox_expired" };
  if (res.status === 409) {
    return errorCode(await bodyOrNull(res)) === "SANDBOX_EXPIRED" ? { kind: "sandbox_expired" } : { kind: "error" };
  }
  if (res.status === 429) {
    const code = errorCode(await bodyOrNull(res));
    if (code !== null && Object.hasOwn(RATE_CODES, code)) {
      return { kind: RATE_CODES[code]!, retryAfterSeconds: retryAfter(res) };
    }
    return { kind: "error" };
  }
  if (res.status === 503) return { kind: "not_ready" };
  return { kind: "error" };
}

// ── start / switch ────────────────────────────────────────────────────────

export interface StartDemoOptions {
  /** Browser Firebase Auth; null when the server has no web config (web roles then fail before any request). */
  auth: Auth | null;
  navigate: (path: string) => void;
  /**
   * What a 409 SANDBOX_EXPIRED (or an unknown key) means. "restart": the visitor tapped a Try-as button, so
   * clear and retry once with no key (a new sandbox). "stop": the visitor tapped a bar switch, so clear and
   * report it; the bar then offers "Start a new demo" and never creates a sandbox behind their back.
   */
  onExpired: "restart" | "stop";
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type StartDemoResult = { kind: "started" } | DemoRefusal;

const LANDING_ALLOWED: Record<DemoRole, readonly string[]> = {
  owner: ["/home"],
  supervisor: ["/day"],
  staff: ["/capture"],
};
const LANDING_DEFAULT: Record<DemoRole, string> = { owner: "/home", supervisor: "/day", staff: "/capture" };

function landingFor(role: DemoRole, serverPath: string): string {
  return LANDING_ALLOWED[role].includes(serverPath) ? serverPath : LANDING_DEFAULT[role];
}

async function signOutQuietly(auth: Auth | null): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    // Offline or already signed out: the next sign-in replaces the user anyway.
  }
}

/** Applies a successful response in the browser. Local state is written only after the credential took. */
async function applyCredentials(data: DemoSessionResponse, auth: Auth | null, navigate: (path: string) => void): Promise<boolean> {
  const state: DemoState = { sandbox_key: data.sandbox_key, expires_at_ms: data.expires_at_ms, role: data.role };
  if (data.kind === "web") {
    if (!auth) return false;
    try {
      await signOutQuietly(auth);
      await signInWithCustomToken(auth, data.custom_token);
    } catch {
      return false;
    }
    removeDeviceKeys();
    writeDemoState(state);
    navigate(landingFor(data.role, data.landing_path));
    return true;
  }
  try {
    window.localStorage.setItem(DEVICE_TOKEN_KEY, data.device_token);
    window.localStorage.setItem(DEVICE_ID_KEY, data.device_id);
  } catch {
    removeDeviceKeys();
    return false;
  }
  await signOutQuietly(auth);
  writeDemoState(state);
  navigate("/capture");
  return true;
}

/** Start a visit (no usable key) or switch role in the current sandbox (key stored and unexpired). Never throws. */
export async function startDemo(role: DemoRole, options: StartDemoOptions): Promise<StartDemoResult> {
  const { auth, navigate, onExpired, fetchImpl, now = Date.now } = options;
  if (role !== "staff" && !auth) return { kind: "error" };

  const stored = readDemoState();
  const key = stored && !isDemoExpired(stored, now()) ? stored.sandbox_key : undefined;

  let outcome = await requestDemoSession(role, key, fetchImpl);
  if (outcome.kind === "sandbox_expired") {
    clearDemoState();
    if (onExpired === "stop") return { kind: "sandbox_expired" };
    outcome = await requestDemoSession(role, undefined, fetchImpl);
  }
  if (outcome.kind !== "ok") return outcome;

  return (await applyCredentials(outcome.data, auth, navigate)) ? { kind: "started" } : { kind: "error" };
}
