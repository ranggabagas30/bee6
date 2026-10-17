import { z } from "zod";
import { DemoRoleSchema } from "@/lib/demo/contract";
import { DEMO_STATE_KEY } from "@/app/demo/demo-state-key";

/**
 * The judge sandbox's shared browser state (`bee6.demo`: key, expiry, role) in `localStorage`, and the store the
 * UI subscribes to. Pure browser state: no Firebase, no network, no device keys. Split out of demo-client.ts in
 * R-25 so a light client component (the expiry hook in demo-expiry.ts, read by the staff and web top bars, pilot
 * `/pair` and `/capture` included) can read it without pulling Firebase Auth into its bundle
 * (app/demo/import-boundaries.test.ts pins that). demo-client.ts re-exports everything here, so existing
 * importers are unchanged.
 */

export { DEMO_STATE_KEY };
export const DEMO_CHANGE_EVENT = "bee6:demo-change";

/** A sandbox lasts 2 h; an expiry past the year 2100 is not a clock reading anyone wrote. */
export const MAX_EXPIRY_MS = Date.UTC(2100, 0, 1);

// `sandbox_key` is present while the demo is live and dropped once it has ended: an ended record only needs
// to say "this browser's demo is over" (the bar and /sign-in read that), and a dead sandbox's key has no
// reason to stay in storage.
export const DemoStateSchema = z
  .object({
    sandbox_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
    // A real date, and nothing absurd: a safe integer past the JS Date range (8.64e15) would make every
    // time formatter print NaN, so such a record is treated as tampered, like any other bad shape.
    expires_at_ms: z
      .number()
      .int()
      .positive()
      .max(MAX_EXPIRY_MS)
      .refine((ms) => Number.isFinite(new Date(ms).getTime())),
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

