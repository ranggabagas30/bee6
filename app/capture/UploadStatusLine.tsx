"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptureStatus } from "@/lib/capture/browser/engine";
import { t, type DictKey } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";

/**
 * Upload status, shown as a second line under the capture banner (presentation
 * only). It is separate from the headline: the headline still means capture is
 * running, and this block says what the uploads are doing. The headline never
 * reads any of this.
 *
 * Derived ONLY from engine status fields: `state`, `queuedCount`,
 * `lastUploadHttpStatus`, `lostSinceSuccess` and `headFailedAttempts`.
 * "Uploading" is inferred from `queuedCount > 0` while the connection is OK.
 *
 * Block order (UX-03 §5.7): the lost notice (row L) first while a dropped segment
 * has not been dismissed (R-23 L-3: sticky until Dismiss or the next Start, not
 * cleared by a 2xx); then its Dismiss button; then the retry / uploading /
 * succeeded row, which is shown under the notice so later uploads stay visible.
 * Every string comes from the copy dictionary in the one language the page is in
 * (no stacked pairs).
 */

export type UploadView =
  | { phase: "uploading" }
  | { phase: "retrying"; failedAttempts?: number }
  | { phase: "succeeded" };

export type UploadSource = Pick<CaptureStatus, "state" | "queuedCount" | "lastUploadHttpStatus"> &
  Partial<Pick<CaptureStatus, "lostSinceSuccess" | "headFailedAttempts" | "droppedCount">>;

function isHttpSuccess(httpStatus: number | null | undefined): boolean {
  return typeof httpStatus === "number" && httpStatus >= 200 && httpStatus < 300;
}

/**
 * Maps the engine status to the upload line, or null for "show nothing"
 * (no running session, or nothing to report yet).
 *
 * - `offline` (uploads failing, connection not OK, segments queued) → retrying.
 * - `mic_error` → null. The mic line already carries the problem.
 * - queued segments while the connection is OK → uploading (inferred).
 * - empty queue and the last upload returned 2xx → succeeded.
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

/** True while a dropped segment has not been cleared by a 2xx upload (row L). */
export function deriveLostLine(status: UploadSource | null | undefined): boolean {
  return status?.lostSinceSuccess === true;
}

/**
 * R-23 L-3: the sticky "Some speech was not captured" notice. True while the
 * running engine's drop count is above the count the user dismissed. A later 2xx
 * does not clear it; Dismiss (which records the current count) or a new Start (a
 * fresh engine starts at 0 drops, and the page resets `dismissedAtDrops`) does.
 */
export function deriveLostNotice(status: UploadSource | null | undefined, dismissedAtDrops: number): boolean {
  return (status?.droppedCount ?? 0) > dismissedAtDrops;
}

/**
 * The view to keep after a session stops (UX-03 §5.7: the lost line and the
 * retry row survive a stop until the next 2xx). Only a retry row is carried.
 */
export function deriveRetainedUploadView(status: UploadSource | null | undefined): UploadView | null {
  const view = deriveUploadView(status);
  return view?.phase === "retrying" ? view : null;
}

/**
 * True only for a real server-side refusal: 5xx, or 429 (rate limited). A network
 * failure has no HTTP status, and 401/403 are auth problems. None of those shows
 * "Server busy" (UX-03 §5.7 row 1a).
 */
export function isServerBusyStatus(httpStatus: number | null | undefined): boolean {
  return typeof httpStatus === "number" && ((httpStatus >= 500 && httpStatus < 600) || httpStatus === 429);
}

/** UX-03 §2 `--warn` token (light theme). Used by the retry row and the lost row (§5.7). */
export const WARN_TOKEN = "#7A4F00";

// Neutral text colours on purpose: green is reserved for the headline's
// "capture is running" meaning. Retrying uses the --warn token, as does the lost line.
const COLOR: Record<UploadView["phase"], string> = {
  uploading: "#444",
  retrying: WARN_TOKEN,
  succeeded: "#444",
};

const PHASE_KEY: Record<UploadView["phase"], DictKey> = {
  uploading: "C-u-up",
  retrying: "C-u-retry",
  succeeded: "C-u-ok",
};

/** C-u-toast is shown once, for 3 s, when an upload recovers from a failure (§5.7). */
export const UPLOAD_TOAST_MS = 3000;

/**
 * True for UPLOAD_TOAST_MS after a success row that follows a failure: a retry
 * row or a raised loss. Dismissing the sticky lost notice is not a recovery.
 * The failure flag survives the "uploading" phase in between, so
 * retry → uploading → succeeded still toasts.
 */
function useRecoveryToast(phase: UploadView["phase"] | undefined, lost: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const failedSinceSuccessRef = useRef(false);
  const wasLostRef = useRef(lost);
  const succeededShown = phase === "succeeded";

  useEffect(() => {
    // R-23: the notice is sticky, so only the moment it is RAISED counts as a failure; otherwise every
    // later routine success under it would toast "Upload working again" again.
    const lossRaised = !wasLostRef.current && lost;
    wasLostRef.current = lost;
    if (phase === "retrying" || lossRaised) failedSinceSuccessRef.current = true;
    if (succeededShown && failedSinceSuccessRef.current) {
      failedSinceSuccessRef.current = false;
      setVisible(true);
    }
  }, [phase, lost, succeededShown]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), UPLOAD_TOAST_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  return visible;
}

/**
 * `online` is the navigator.onLine hint. Omit it to show no connectivity detail.
 * `lost` shows the lost notice (row L) first; the succeeded row stays visible under it.
 * `onDismissLost` adds the Dismiss button to the notice (R-23 L-3).
 */
export function UploadStatusLine({
  view,
  online,
  httpStatus,
  lost = false,
  onDismissLost,
}: {
  view: UploadView | null;
  online?: boolean;
  /** HTTP status of the most recent upload, or null for a network failure. */
  httpStatus?: number | null;
  lost?: boolean;
  /** Renders a Dismiss button under the lost notice; the page records the drop count it hides. */
  onDismissLost?: () => void;
}) {
  const { lang } = useLang();
  const toastVisible = useRecoveryToast(view?.phase, lost);
  const hasContent = Boolean(view || lost);
  const showView = view !== null;
  const regionRef = useRef<HTMLDivElement>(null);
  const color = showView ? COLOR[view.phase] : "#444";
  const retryCount =
    showView && view.phase === "retrying" && view.failedAttempts !== undefined
      ? t(lang, "C-u-count", { N: view.failedAttempts })
      : null;
  // Offline shows the no-internet detail. Online shows "Server busy" only for a
  // real server error (5xx or 429), never for a network failure or 401/403.
  const detailKey: DictKey | null =
    showView && view.phase === "retrying" && online !== undefined
      ? online
        ? isServerBusyStatus(httpStatus)
          ? "C-u-server"
          : null
        : "C-u-inet"
      : null;
  // One live region for the whole upload block, mounted once (UX-03 §5.7): the
  // lost value, its helper and the retry / uploading / succeeded row are read
  // together, in visual order (notice, helper, Dismiss, row). The helper is not aria-hidden. The "(Nx)" count
  // is aria-hidden so count growth is never read. The toast is a sibling outside
  // the block, with its own role="status".
  return (
    <>
      <div
        ref={regionRef}
        data-testid="upload-status"
        role="status"
        aria-live="polite"
        // Focus parks here after Dismiss removes the button the user was on.
        tabIndex={-1}
        style={hasContent ? { marginTop: 12, fontSize: 14, outline: "none" } : { outline: "none" }}
      >
        {lost ? (
          <p style={{ margin: 0, fontWeight: 600, color: WARN_TOKEN }}>
            <span aria-hidden="true">▲ </span>
            {t(lang, "C-u-lost")}
          </p>
        ) : null}
        {lost ? <p style={{ margin: "2px 0 0" }}>{t(lang, "C-u-lost-help")}</p> : null}
        {lost && onDismissLost ? (
          <button
            type="button"
            onClick={() => {
              onDismissLost();
              regionRef.current?.focus();
            }}
            style={{
              display: "block",
              minHeight: 44,
              padding: "10px 0",
              margin: 0,
              background: "none",
              border: "none",
              font: "inherit",
              fontWeight: 600,
              color: WARN_TOKEN,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {t(lang, "C-u-lost-dismiss")}
          </button>
        ) : null}
        {showView ? (
          <p style={{ margin: lost ? "8px 0 0" : 0, fontWeight: 600, color }}>
            {t(lang, PHASE_KEY[view.phase])}
            {retryCount !== null ? (
              <span aria-hidden="true"> {retryCount}</span>
            ) : null}
          </p>
        ) : null}
        {detailKey ? <p style={{ margin: "2px 0 0", color }}>{t(lang, detailKey)}</p> : null}
      </div>
      {toastVisible ? (
        <div
          data-testid="upload-toast"
          role="status"
          aria-live="polite"
          style={{ marginTop: 8, fontSize: 14 }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>{t(lang, "C-u-toast")}</p>
        </div>
      ) : null}
    </>
  );
}
