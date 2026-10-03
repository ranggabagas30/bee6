import type { CaptureStatus } from "@/lib/capture/browser/engine";

/**
 * Upload status, shown as a second line under the capture banner (presentation
 * only). It is separate from the headline: green "Listening" still means capture
 * is running, and this line says what the uploads are doing.
 *
 * Derived ONLY from fields the engine already exposes: `state`, `queuedCount`
 * and `lastUploadHttpStatus`. Two things are not exposed yet, so they are not
 * guessed here:
 *  - an explicit "upload in progress" flag. "Uploading" is inferred from
 *    `queuedCount > 0` while the engine's connection is OK (the head segment
 *    is in flight until it is confirmed or dropped).
 *  - the retry count. The "(Nx)" suffix is shown only when a caller supplies
 *    `failedAttempts`; the page does not, so it reads "coba ulang" without a count.
 * See the commit message / report for the proposed read-only engine addition.
 */

export type UploadView =
  | { phase: "uploading" }
  | { phase: "retrying"; failedAttempts?: number }
  | { phase: "succeeded" };

export type UploadSource = Pick<CaptureStatus, "state" | "queuedCount" | "lastUploadHttpStatus">;

function isHttpSuccess(httpStatus: number | null | undefined): boolean {
  return typeof httpStatus === "number" && httpStatus >= 200 && httpStatus < 300;
}

/**
 * Maps the engine status to the upload line, or null for "show nothing"
 * (no running session, or nothing to report yet).
 *
 * - `offline` (engine: uploads failing, connection not OK, segments queued) →
 *   retrying. The engine only reports `offline` while queued segments exist.
 * - `mic_error` → null. The engine hides its connection flag in that state, so an
 *   upload line would be a guess. The mic line already carries the problem.
 * - queued segments while the connection is OK → uploading (inferred, see above).
 * - empty queue and the last upload returned 2xx → succeeded. The line stays
 *   until the queue or the engine state changes.
 */
export function deriveUploadView(status: UploadSource | null | undefined): UploadView | null {
  if (!status) return null;
  if (status.state === "mic_error") return null;
  if (status.state === "offline") return { phase: "retrying" };
  if (status.queuedCount > 0) return { phase: "uploading" };
  if (isHttpSuccess(status.lastUploadHttpStatus)) return { phase: "succeeded" };
  return null;
}

interface BilingualLine {
  id: string;
  en: string;
}

const COPY: Record<UploadView["phase"], BilingualLine> = {
  uploading: { id: "Mengunggah", en: "Uploading" },
  retrying: { id: "Gagal unggah, coba ulang", en: "Upload failed, retrying" },
  succeeded: { id: "Unggah berhasil", en: "Upload succeeded" },
};

/** Exact bilingual strings for a view, including the "(Nx)" suffix when known. */
export function uploadLines(view: UploadView): BilingualLine {
  const base = COPY[view.phase];
  if (view.phase === "retrying" && view.failedAttempts !== undefined) {
    const suffix = ` (${view.failedAttempts}x)`;
    return { id: base.id + suffix, en: base.en + suffix };
  }
  return base;
}

// Neutral text colours on purpose: green is reserved for the headline's
// "capture is running" meaning. Retrying uses the same amber as the offline
// headline, so "uploads waiting" reads the same in both places.
const COLOR: Record<UploadView["phase"], string> = {
  uploading: "#444",
  retrying: "#8d6e00",
  succeeded: "#444",
};

export function UploadStatusLine({ view }: { view: UploadView | null }) {
  if (!view) return null;
  const { id, en } = uploadLines(view);
  return (
    <div
      data-testid="upload-status"
      style={{ marginTop: 12, fontSize: 14, color: COLOR[view.phase] }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>{id}</p>
      <p style={{ margin: "2px 0 0" }}>{en}</p>
    </div>
  );
}
