import type { CaptureStatus } from "@/lib/capture/browser/engine";

interface BilingualLine {
  id: string;
  en: string;
}

/**
 * Upload status, shown as a second line under the capture banner (presentation
 * only). It is separate from the headline: green "Listening" still means capture
 * is running, and this line says what the uploads are doing.
 *
 * Derived ONLY from engine status fields: `state`, `queuedCount`,
 * `lastUploadHttpStatus`, `lostSinceSuccess` and `headFailedAttempts`.
 * "Uploading" is inferred from `queuedCount > 0` while the engine's connection
 * is OK (the head segment is in flight until it is confirmed or dropped).
 *
 * Block order (UX-03 §5.7): the lost line (row L) comes first when a dropped
 * segment has not been cleared by a 2xx; the retry/uploading/succeeded row
 * follows. The succeeded row is hidden while the lost line is up (row 3).
 * The headline never reads any of this.
 */

export type UploadView =
  | { phase: "uploading" }
  | { phase: "retrying"; failedAttempts?: number }
  | { phase: "succeeded" };

export type UploadSource = Pick<CaptureStatus, "state" | "queuedCount" | "lastUploadHttpStatus"> &
  Partial<Pick<CaptureStatus, "lostSinceSuccess" | "headFailedAttempts">>;

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
  if (status.state === "offline") {
    const failed = status.headFailedAttempts ?? 0;
    return failed > 0 ? { phase: "retrying", failedAttempts: failed } : { phase: "retrying" };
  }
  if (status.queuedCount > 0) return { phase: "uploading" };
  if (isHttpSuccess(status.lastUploadHttpStatus)) return { phase: "succeeded" };
  return null;
}

const COPY: Record<UploadView["phase"], BilingualLine> = {
  uploading: { id: "Mengunggah", en: "Uploading" },
  retrying: { id: "Gagal unggah, coba ulang", en: "Upload failed, retrying" },
  succeeded: { id: "Unggah berhasil", en: "Upload succeeded" },
};

/**
 * True while a dropped segment has not been cleared by a 2xx upload (row L).
 * Independent of the upload view: it stays up in every mode the block shows.
 */
export function deriveLostLine(status: UploadSource | null | undefined): boolean {
  return status?.lostSinceSuccess === true;
}

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

/** Warning amber for the lost line (row L: warn ▲, bold). */
const LOST_COLOR = "#8d6e00";
const LOST_LINE: BilingualLine = {
  id: "Sebagian suara tidak tercatat",
  en: "Some speech was not captured",
};

/**
 * Connectivity detail for a retrying upload. navigator.onLine is only a hint, so
 * "Tidak ada internet" is shown only when the browser itself reports no
 * connection; otherwise the server is the likely cause, so say that instead.
 * This moved here from the big banner, which stays green while uploads fail.
 */
const RETRY_DETAIL: Record<"online" | "offline", BilingualLine> = {
  online: { id: "Server sibuk, mencoba lagi", en: "Server busy, retrying" },
  offline: { id: "Tidak ada internet", en: "No internet" },
};

/**
 * `online` is the navigator.onLine hint. Omit it to show no connectivity detail.
 * `lost` shows the lost line (row L) first, and hides the succeeded row while it is up.
 */
export function UploadStatusLine({
  view,
  online,
  lost = false,
}: {
  view: UploadView | null;
  online?: boolean;
  lost?: boolean;
}) {
  if (!view && !lost) return null;
  const showView = view !== null && !(lost && view.phase === "succeeded");
  const detail =
    showView && view.phase === "retrying" && online !== undefined
      ? RETRY_DETAIL[online ? "online" : "offline"]
      : null;
  const color = showView ? COLOR[view.phase] : "#444";
  return (
    <div data-testid="upload-status" style={{ marginTop: 12, fontSize: 14, color }}>
      {lost ? (
        <>
          <p style={{ margin: 0, fontWeight: 600, color: LOST_COLOR }}>
            <span aria-hidden="true">▲ </span>
            {LOST_LINE.id}
          </p>
          <p style={{ margin: "2px 0 0", color: LOST_COLOR }}>{LOST_LINE.en}</p>
        </>
      ) : null}
      {showView ? (
        <>
          <p style={{ margin: lost ? "8px 0 0" : 0, fontWeight: 600 }}>{uploadLines(view).id}</p>
          <p style={{ margin: "2px 0 0" }}>{uploadLines(view).en}</p>
        </>
      ) : null}
      {detail ? (
        <>
          <p style={{ margin: "2px 0 0" }}>{detail.id}</p>
          <p style={{ margin: "2px 0 0" }}>{detail.en}</p>
        </>
      ) : null}
    </div>
  );
}
