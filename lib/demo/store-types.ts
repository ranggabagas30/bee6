import type { DemoCounterKind, Outlet } from "@/lib/firestore/schema";
import type { ClonedDoc, TemplateSet } from "@/lib/demo/clone";

/**
 * The demo store seam (R-12 Task 5): the Firestore implementation lives in
 * lib/firestore/demo-store.ts; the service (lib/demo/service.ts) is tested against an in-memory
 * fake. Same split as the proposal and review stores.
 */
export class TemplateTooLargeError extends Error {
  constructor() {
    super("Demo template is larger than the allowed size");
    this.name = "TemplateTooLargeError";
  }
}

export interface DemoStore {
  /** `outlet_id == TEMPLATE_OUTLET_ID` reads; null when missing or malformed (logged); throws TemplateTooLargeError over TEMPLATE_DOC_MAX docs. */
  readTemplate(): Promise<TemplateSet | null>;
  /** Writes in batches of WRITE_BATCH_MAX, in order, with create() so an id collision fails loudly. */
  writeSandbox(docs: ClonedDoc[]): Promise<void>;
  /** Outlet whose `sandbox.key_sha256` matches; only outlets WITH a sandbox object can match. More than one match throws. */
  findSandboxByKey(keySha256: string): Promise<Outlet | null>;
  /** Replaces token_hash (and re-asserts expires_at_ms) on a device that belongs to a sandbox outlet; refuses anything else. */
  rotateDeviceToken(outletId: string, deviceId: string, tokenHash: string, expiresAtMs: number): Promise<void>;
  /** Transaction: at/over the limit returns false and writes nothing; else count + 1 and true. */
  bumpCounter(counterId: string, kind: DemoCounterKind, day: string, limit: number, expiresAtIso: string): Promise<boolean>;
  /**
   * R-23: a transaction like bumpCounter, but returns the NEW count (1 for the first bump), or null when the limit
   * refused it or the doc is damaged (fail closed). Same ABORTED -> LockedError(demo_busy) mapping as bumpCounter.
   */
  bumpCounterCount(counterId: string, kind: DemoCounterKind, day: string, limit: number, expiresAtIso: string): Promise<number | null>;
  /** Read-only: the current count of a counter (0 when absent). A damaged counter reads as "at every limit" (fail closed). */
  readCounter(counterId: string): Promise<number>;
  /** Sandbox outlet ids whose expiry passed more than CLEANUP_GRACE_MS ago. */
  listExpiredSandboxes(nowMs: number, limit: number): Promise<string[]>;
  /**
   * Poison-pill quarantine for cleanup: sets the sandbox's `expires_at_ms` to the newest instant that
   * is still cleanup-eligible (`nowMs - CLEANUP_GRACE_MS`) so a sandbox that cannot be deleted sorts
   * behind every older one and the head of `listExpiredSandboxes` moves on. Never extends a live session
   * (it only ever lowers a value that is already past). Refuses anything that is not a sandbox outlet.
   */
  deferSandboxCleanup(outletId: string, nowMs: number): Promise<void>;
  /** Deletes every doc of one sandbox outlet; throws unless the outlet doc has a sandbox object and an sbx- id. */
  deleteSandbox(outletId: string): Promise<void>;
  /** Plain outlet read (used by the generate cap). */
  getOutlet(outletId: string): Promise<Outlet | null>;
}
