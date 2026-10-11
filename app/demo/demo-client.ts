import { z } from "zod";
import { DemoRoleSchema, DemoSessionResponseSchema, type DemoRole, type DemoSessionResponse } from "@/lib/demo/contract";
import { signInWithCustomToken, signOut, type Auth } from "@/lib/auth/client/firebase-client";
import { DEVICE_ID_KEY, DEVICE_TOKEN_KEY } from "@/lib/capture/browser/client";

/**
 * Browser side of the R-12 judge sign-in (plan Task 8.2). Talks only to
 * `POST /api/v1/demo/session`; no Firestore, no server module (see
 * import-boundaries.test.ts).
 *
 * The sandbox state (`bee6.demo`: key, expiry, role) lives in `localStorage`, shared by every tab of
 * this browser, so a judge who opens a second tab (an emailed link, say) joins the same sandbox instead
 * of taking a second IP slot and signing the first tab out; other tabs hear changes through the
 * `storage` event. Besides that key, the only things written to `localStorage` are the judge phone's
 * `bee6.device_*` pair, because `/capture` reads exactly those keys (the same ones `/pair` writes).
 * Tokens are never stored here and nothing is logged or put in a URL.
 */

export const DEMO_STATE_KEY = "bee6.demo";
const DEMO_CHANGE_EVENT = "bee6:demo-change";
const SESSION_PATH = "/api/v1/demo/session";
/** The uid prefix of every judge web user (`demo-<role>-<sandbox>`). */
const DEMO_UID_PREFIX = "demo-";

// `sandbox_key` is present while the demo is live and dropped once it has ended: an ended record only needs
// to say "this browser's demo is over" (the bar and /sign-in read that), and a dead sandbox's key has no
// reason to stay in storage.
const DemoStateSchema = z
  .object({
    sandbox_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    expires_at_ms: z.number().int().positive(),
    role: DemoRoleSchema,
  })
  .strict();
export type DemoState = z.infer<typeof DemoStateSchema>;

// ── shared state (localStorage) ───────────────────────────────────────────

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
    return window.localStorage.getItem(DEMO_STATE_KEY);
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
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: the visit still works, the bar just has nothing to show.
  }
  notifyChange();
}

/** Removes the judge phone's device keys (the pair `/capture` reads). Best effort. */
export function removeDeviceKeys(): void {
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
    window.localStorage.removeItem(DEMO_STATE_KEY);
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
  // Same-tab changes arrive as our own event; another tab's writes arrive as a `storage` event
  // (key === null means that tab called localStorage.clear()).
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === DEMO_STATE_KEY) onChange();
  };
  window.addEventListener(DEMO_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DEMO_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
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

/**
 * A sandbox lives 2 h. A Date header that leaves more than that plus a 5 min margin, or nothing, is not a
 * clock reading to trust (a wrong or hostile header must not stretch the demo or end it early).
 */
const SANE_REMAINING_MS = 2 * 60 * 60_000 + 5 * 60_000;

/**
 * The server's `expires_at_ms` is on the server's clock. The response's Date header says what that clock
 * read when it answered, so the time left is `expires_at_ms - serverNow`, and the expiry on THIS device's
 * clock is `receivedAt + remaining`. A phone whose clock is hours off then still ends the demo on time and
 * shows the right end time. Without a usable Date header (missing, unreadable, or giving a remaining time
 * that is not plausible) the server's own value is kept.
 */
function skewCorrectedExpiry(res: Response, expiresAtMs: number, receivedAtMs: number): number {
  const header = res.headers.get("Date");
  if (header === null) return expiresAtMs;
  const serverNow = Date.parse(header);
  if (!Number.isFinite(serverNow)) return expiresAtMs;
  const remaining = expiresAtMs - serverNow;
  if (remaining <= 0 || remaining > SANE_REMAINING_MS) return expiresAtMs;
  return receivedAtMs + remaining;
}

/** One POST; never throws. Plain `fetch`: this route is the sign-in, so it carries no credentials. */
export async function requestDemoSession(
  role: DemoRole,
  sandboxKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
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

  const receivedAt = now();
  if (res.status === 200) {
    const body = await bodyOrNull(res);
    const parsed = DemoSessionResponseSchema.safeParse((body as { data?: unknown } | null)?.data);
    if (!parsed.success) return { kind: "error" };
    const expires_at_ms = skewCorrectedExpiry(res, parsed.data.expires_at_ms, receivedAt);
    return { kind: "ok", data: { ...parsed.data, expires_at_ms } };
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
  /**
   * How to go to the landing page. Defaults to a hard navigation (`window.location.assign`), so no page that
   * is still mounted (it may react to the sign-out or the new user by redirecting) can override it.
   */
  navigate?: (path: string) => void;
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

/** A full page load: the old page, its listeners and its pending soft navigations are all discarded. */
function hardNavigate(path: string): void {
  window.location.assign(path);
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Forgets the sandbox, the device keys and the Firebase web user (the visitor chose to start over). Never throws. */
export async function endDemo(auth: Auth | null): Promise<void> {
  clearDemoState();
  await signOutQuietly(auth);
}

/**
 * The demo has ended by the clock or because a switch found the sandbox gone: remove the judge phone's device
 * keys and sign the Firebase web user out, but KEEP the stored (expired) record, so the bar and /sign-in
 * still say "Your demo session has ended." (without the sandbox key, which is of no use any more).
 * Never throws.
 *
 * It acts only when this browser holds a demo record, and signs out only a judge's own user (custom-token
 * uids are `demo-<role>-<sandbox>`, read once Firebase has restored the session). A normal email/password
 * session in a browser that once ran a demo is left alone, so it survives every reload.
 */
export async function closeEndedDemo(auth: Auth | null): Promise<void> {
  const stored = readDemoState();
  if (stored === null) return;
  removeDeviceKeys();
  if (stored.sandbox_key !== undefined) writeDemoState(endedRecord(stored, Date.now())); // drop the dead key
  if (!auth) return;
  try {
    await auth.authStateReady();
  } catch {
    return;
  }
  if (auth.currentUser?.uid.startsWith(DEMO_UID_PREFIX)) await signOutQuietly(auth);
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
      // No signOut first: signing in as the new user replaces the old one in a single auth-state change,
      // so a page that is still mounted never sees "signed out" and redirects to /sign-in.
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
  writeDemoState(state);
  // The old web user must go (the phone is now a staff device), but a mounted web page redirects to
  // /sign-in when it sees that. The hard navigation below is what wins: a later soft navigation cannot
  // cancel it (checked in Chrome). Waiting one macrotask first only lets the page's own reactions run
  // before the load; it is best effort and nothing depends on it.
  await signOutQuietly(auth);
  await nextMacrotask();
  navigate("/capture");
  return true;
}

/** The stored record as an ended one: no sandbox key, and an end time no later than `nowMs`. */
function endedRecord(state: DemoState, nowMs: number): DemoState {
  return { expires_at_ms: Math.min(state.expires_at_ms, nowMs), role: state.role };
}

/**
 * A switch found the sandbox gone (a 409/404, or the stored one already past its end). Keep the record, marked
 * as ended now (or at its own earlier end), so the bar and /sign-in both still say "Your demo session has
 * ended." when the signed-out web page bounces the visitor there; a cleared state would leave /sign-in with
 * nothing to explain. Never throws.
 */
async function endedBySwitch(stored: DemoState | null, auth: Auth | null, now: () => number): Promise<StartDemoResult> {
  if (stored) writeDemoState(endedRecord(stored, now()));
  else notifyChange();
  removeDeviceKeys();
  await signOutQuietly(auth); // do not leave a web user signed in behind a forgotten sandbox
  return { kind: "sandbox_expired" };
}

/** Start a visit (no usable key) or switch role in the current sandbox (key stored and unexpired). Never throws. */
export async function startDemo(role: DemoRole, options: StartDemoOptions): Promise<StartDemoResult> {
  const { auth, navigate = hardNavigate, onExpired, fetchImpl, now = Date.now } = options;
  if (role !== "staff" && !auth) return { kind: "error" };

  const stored = readDemoState();
  const key = stored && !isDemoExpired(stored, now()) ? stored.sandbox_key : undefined;

  // A bar switch works inside the visitor's existing sandbox or not at all. If the stored one has already
  // ended by this clock (the bar's timer has not re-rendered yet) or there is none, report the end without
  // a request: a keyless POST would create a brand-new sandbox behind their back.
  if (onExpired === "stop" && key === undefined) return endedBySwitch(stored, auth, now);

  let outcome = await requestDemoSession(role, key, fetchImpl, now);
  let restarted = false;
  if (outcome.kind === "sandbox_expired") {
    if (onExpired === "stop") return endedBySwitch(stored, auth, now);
    clearDemoState();
    restarted = true;
    outcome = await requestDemoSession(role, undefined, fetchImpl, now);
    // A retry that works replaces the user in one step; one that does not leaves nobody signed in to a dead sandbox.
    if (outcome.kind !== "ok") await signOutQuietly(auth);
  }
  if (outcome.kind !== "ok") return outcome;

  if (await applyCredentials(outcome.data, auth, navigate)) return { kind: "started" };
  // The old sandbox was forgotten above, so a credential that could not be swapped (sign-in threw, storage
  // blocked) must not leave the previous web user signed in to it.
  if (restarted) await signOutQuietly(auth);
  return { kind: "error" };
}
