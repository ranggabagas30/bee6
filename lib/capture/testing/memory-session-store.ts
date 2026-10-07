import type {
  AuditDraft,
  CaptureSessionStore,
  SessionTxState,
} from "@/lib/capture/session-service";
import type { CaptureSession, LastEnded } from "@/lib/firestore/schema";

/**
 * In-memory CaptureSessionStore for route and service tests. It applies each
 * transaction's write set the same way the Firestore store does (writes only when
 * the callback returns normally) and records every audit it would have created.
 * Test-only: nothing in the app imports it.
 */
export function memorySessionStore(seed: {
  session?: CaptureSession | null;
  last_ended?: LastEnded | null;
} = {}) {
  const state: SessionTxState & { audits: AuditDraft[]; segments_deleted: number } = {
    session: seed.session ?? null,
    last_ended: seed.last_ended ?? null,
    audits: [],
    segments_deleted: 0,
  };
  const store: CaptureSessionStore = {
    async transact(_key, fn) {
      const out = fn({ session: state.session, last_ended: state.last_ended });
      if (out.write?.session) state.session = out.write.session;
      if (out.write && out.write.last_ended !== undefined) state.last_ended = out.write.last_ended;
      state.audits.push(...(out.audits ?? []), ...(out.fixed_audits ?? []).map((a) => a.entry));
      return out.result;
    },
    async deleteSegments() {
      return 0;
    },
  };
  return { store, state };
}
