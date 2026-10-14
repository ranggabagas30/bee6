import { SessionIdSchema } from "@/lib/capture/session-service";
import {
  ClosingRefusalDetailsSchema,
  DemoClosingResponseSchema,
  type DemoClosingResponse,
} from "@/lib/demo/contract";
import type { CaptureSession } from "@/lib/firestore/schema";
import { ConflictError } from "@/lib/http/errors";

/**
 * "Jump to closing time" (R-19 PR-4a, plan section 5.4). Demo sandbox only; the route 404s elsewhere. Plain code,
 * no model (hard rule #10): the caller's own open session gets `demo_closing_at_ms = now` once Bee6 has heard at
 * least CLOSING_REQUIRED_LINES transcribed lines in it. It counts captured speech only and never measures elapsed
 * time. The service reads counts, never a transcript, and nothing here can carry audio or text.
 *
 * Until PR-5 lands `requiredLines(day)` (script v2: 5 cards x CARD_MIN_LINES = 5), the need is this constant.
 */
export const CLOSING_REQUIRED_LINES = 5;

export interface ClosingSessionKey {
  device_id: string;
  session_id: string;
}

export interface ClosingStore {
  /** The session doc at `{device_id}:{session_id}`, or null. */
  getSession(key: ClosingSessionKey): Promise<CaptureSession | null>;
  /** Sum of `lines.length` over this device session's segment docs (counts only; no text is read back). */
  countLines(key: ClosingSessionKey & { outlet_id: string }): Promise<number>;
  /** Sets `demo_closing_at_ms = at_ms` on the session if it is still open and unmarked. */
  markClosing(key: ClosingSessionKey, at_ms: number): Promise<void>;
}

export interface JumpToClosingInput {
  /** From the verified device claims only, never the body. */
  outlet_id: string;
  device_id: string;
  session_id: string;
  now_ms: number;
}

function isOpenOwnSession(session: CaptureSession | null, input: JumpToClosingInput): session is CaptureSession {
  return (
    session !== null &&
    session.outlet_id === input.outlet_id &&
    session.device_id === input.device_id &&
    session.ended_at_ms === null &&
    session.end_reason === null
  );
}

export async function jumpToClosing(store: ClosingStore, input: JumpToClosingInput): Promise<DemoClosingResponse> {
  const session_id = SessionIdSchema.parse(input.session_id);
  const key = { device_id: input.device_id, session_id };
  const session = await store.getSession(key);
  if (!isOpenOwnSession(session, input)) {
    throw new ConflictError("session_not_open", "session_not_open");
  }
  const reached = DemoClosingResponseSchema.parse({ closing_reached: true });
  // Idempotent: a double tap or a retry after a lost response changes nothing.
  if (session.demo_closing_at_ms !== undefined) return reached;

  const have = await store.countLines({ ...key, outlet_id: input.outlet_id });
  const need = CLOSING_REQUIRED_LINES;
  if (have < need) {
    throw new ConflictError("not_enough_speech", "not_enough_speech", ClosingRefusalDetailsSchema.parse({ have, need }));
  }
  await store.markClosing(key, input.now_ms);
  return reached;
}
