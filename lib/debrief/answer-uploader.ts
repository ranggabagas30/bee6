import { deviceAuthHeaders, type DeviceAuth } from "@/lib/capture/browser/client";
import { purgeNow, readCache, removeEntry } from "@/lib/debrief/answer-cache";
import type { AnswerCacheEntry } from "@/lib/debrief/contract";

/**
 * Phone answer uploader (R-07 Task 6, `docs/tasks/R-07-plan.md`). Flushes the
 * answer cache to `POST /api/v1/questions/{id}/answer` one entry at a time,
 * oldest first, stopping at the first retryable failure. Every disposition
 * is driven only by the HTTP status (or its absence on a network error) —
 * never by the reason text, which this module never reads or logs (hard
 * rule #3; see `docs/tasks/R-07-plan.md` Review focus item 3).
 */

export type Disposition = "removed_ok" | "removed_refused" | "kept_retry" | "kept_offline";

/**
 * 2xx -> removed_ok (uploaded). 400/404/422 -> removed_refused (the server
 * will never accept this entry as-is; it is discarded, not retried).
 * 401/403/409/429/>=500 -> kept_retry (transient — the device token may have
 * lapsed, redaction may be down, a race lost). "network" -> kept_offline.
 */
export function dispositionFor(status: number | "network"): Disposition {
  if (status === "network") return "kept_offline";
  if (status >= 200 && status < 300) return "removed_ok";
  if (status === 400 || status === 404 || status === 422) return "removed_refused";
  return "kept_retry";
}

export interface AnswerUploader {
  flush(): Promise<{ last: Disposition | null; pending: number }>;
}

export interface AnswerUploaderDeps {
  storage: Storage;
  fetchFn: typeof fetch;
  auth: DeviceAuth;
  now: () => number;
  /** Outcome-only (question_id + the refusing status) — never the reason (hard rule #3). */
  devLog: (e: { kind: "answer_refused"; question_id: string; status: number }) => void;
}

function answerUrl(question_id: string): string {
  return `/api/v1/questions/${encodeURIComponent(question_id)}/answer`;
}

async function sendOne(
  deps: AnswerUploaderDeps,
  entry: AnswerCacheEntry,
): Promise<{ disposition: Disposition; status: number | "network" }> {
  try {
    // Called bare (never `deps.fetchFn(...)`): the browser's fetch throws "Illegal invocation" when its `this`
    // is anything but window, which silently kept every answer offline.
    const { fetchFn } = deps;
    const res = await fetchFn(answerUrl(entry.question_id), {
      method: "POST",
      headers: { ...deviceAuthHeaders(deps.auth), "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    return { disposition: dispositionFor(res.status), status: res.status };
  } catch {
    return { disposition: "kept_offline", status: "network" };
  }
}

/**
 * Creates the uploader. `flush()` is single-flight: a call made while one is
 * already running returns that same pending promise instead of starting a
 * second pass over the cache.
 */
export function createAnswerUploader(deps: AnswerUploaderDeps): AnswerUploader {
  let inFlight: Promise<{ last: Disposition | null; pending: number }> | null = null;

  async function doFlush(): Promise<{ last: Disposition | null; pending: number }> {
    purgeNow(deps.storage, deps.now());
    const entries = readCache(deps.storage)
      .slice()
      .sort((a, b) => a.answered_at_ms - b.answered_at_ms);

    let last: Disposition | null = null;
    for (const entry of entries) {
      const { disposition, status } = await sendOne(deps, entry);
      last = disposition;
      if (disposition === "removed_ok" || disposition === "removed_refused") {
        removeEntry(deps.storage, entry.question_id);
        if (disposition === "removed_refused" && typeof status === "number") {
          deps.devLog({ kind: "answer_refused", question_id: entry.question_id, status });
        }
      } else {
        // kept_retry / kept_offline: the rest would fail the same way right now.
        break;
      }
    }
    return { last, pending: readCache(deps.storage).length };
  }

  return {
    flush() {
      if (inFlight) return inFlight;
      const running = doFlush().finally(() => {
        if (inFlight === running) inFlight = null;
      });
      inFlight = running;
      return running;
    },
  };
}
