"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { reduceDebrief, type DebriefState } from "@/lib/debrief/flow";
import { DebriefListResponseSchema } from "@/lib/debrief/contract";
import { appendAnswer, CacheWriteError, cachedIds, pendingSummary, purgeNow, readCache } from "@/lib/debrief/answer-cache";
import { createAnswerUploader, type AnswerUploader, type Disposition } from "@/lib/debrief/answer-uploader";
import { ANSWER_PURGE_INTERVAL_MS, ANSWER_RETRY_MS } from "@/lib/debrief/constants";
import { deviceAuthHeaders, type DeviceAuth } from "@/lib/capture/browser/client";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { QuestionScreen } from "@/app/capture/debrief/QuestionScreen";
import { DebriefEntryCard } from "@/app/capture/debrief/DebriefEntryCard";
import { DebriefDone, DebriefEmpty } from "@/app/capture/debrief/DebriefDone";
import { DebriefTimeout } from "@/app/capture/debrief/DebriefTimeout";

/**
 * The debrief container (R-07 Task 7.5): owns the reducer, the fetch-on-OPEN
 * effect, the phone answer cache and uploader lifecycle, and the exact Lanjut
 * commit order (cache write, then COMMITTED, then a fire-and-forget flush).
 * The caller (`/capture`) mounts one of these per debrief — give it a fresh
 * `key={endsAtMs}` so a later debrief on the same page gets a clean state
 * machine instead of reusing a finished one.
 */

export interface DebriefFlowProps {
  auth: DeviceAuth;
  endsAtMs: number;
  /** The page's own ticked clock (30s / visibilitychange), so the entry card counts down without a private timer. */
  nowMs: number;
  tz: string;
  nextMulaiText: { day: string; hm: string } | null;
  /** Test seam only; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** Test seam only; defaults to window.localStorage. */
  storage?: Storage;
}

function uploadNoteFor(disposition: Disposition | null): "offline" | "refused" | null {
  if (disposition === "kept_offline") return "offline";
  if (disposition === "kept_retry") return "refused";
  return null;
}

export function DebriefFlow({ auth, endsAtMs, nowMs, tz, nextMulaiText, fetchFn, storage }: DebriefFlowProps) {
  const { lang } = useLang();
  const effectiveFetch = fetchFn ?? fetch;
  const effectiveStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);

  const [state, dispatch] = useReducer(
    reduceDebrief,
    { view: { kind: "closed" }, ends_at_ms: endsAtMs, business_date: null } satisfies DebriefState,
  );
  const [uploadNote, setUploadNote] = useState<"offline" | "refused" | null>(null);

  // Created once per mount (a stable singleton, not recreated on a prop
  // change this component never expects mid-debrief), via a lazy useState
  // initializer rather than a ref write during render.
  const [uploader] = useState<AnswerUploader | null>(() =>
    effectiveStorage
      ? createAnswerUploader({
          storage: effectiveStorage,
          fetchFn: effectiveFetch,
          auth,
          now: Date.now,
          devLog: () => {
            // Outcome-only logging (question_id + status) belongs to a future
            // dev readout; nothing about the reason is ever available here.
          },
        })
      : null,
  );

  // Derived only when the done screen is actually showing; a storage read is
  // deliberately not a render-time dependency of the "question" view path.
  const pendingCount = useMemo(() => {
    if (state.view.kind !== "done" || !effectiveStorage) return 0;
    return pendingSummary(readCache(effectiveStorage)).count;
  }, [state.view.kind, effectiveStorage]);

  async function flushNow() {
    if (!uploader) return;
    const result = await uploader.flush();
    setUploadNote(uploadNoteFor(result.last));
  }

  // Uploader lifecycle (R-07 Task 7.5): flush on mount, on `online`, every
  // ANSWER_RETRY_MS, and purge every ANSWER_PURGE_INTERVAL_MS. Runs for the
  // lifetime of this component, independent of which view is showing, so a
  // cache entry left over from a previous reload still drains.
  useEffect(() => {
    if (!effectiveStorage) return;
    // flushNow() is async; any setState it does happens later, inside its
    // own awaited callback (synchronizing with the uploader's result), not
    // synchronously in this effect body — the documented "fetch on mount"
    // shape. The lint rule can't see across the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void flushNow();
    const onOnline = () => void flushNow();
    window.addEventListener("online", onOnline);
    const retryId = setInterval(() => void flushNow(), ANSWER_RETRY_MS);
    const purgeId = setInterval(() => purgeNow(effectiveStorage, Date.now()), ANSWER_PURGE_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(retryId);
      clearInterval(purgeId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once lifecycle
  }, []);

  // The page's own 30s/visibilitychange tick (and the mount-time read).
  useEffect(() => {
    dispatch({ type: "TICK", now_ms: nowMs });
  }, [nowMs]);

  // A faster 1s tick only while a question is on screen, so the timeout
  // closes the screen on time instead of waiting for the next 30s tick.
  useEffect(() => {
    if (state.view.kind !== "question") return;
    const id = setInterval(() => dispatch({ type: "TICK", now_ms: Date.now() }), 1_000);
    return () => clearInterval(id);
  }, [state.view.kind]);

  async function loadQuestions() {
    try {
      const res = await effectiveFetch("/api/v1/questions", { headers: deviceAuthHeaders(auth) });
      if (!res.ok) {
        dispatch({ type: "LOAD_FAILED" });
        return;
      }
      const payload: unknown = await res.json();
      const parsed = DebriefListResponseSchema.safeParse((payload as { data?: unknown } | null)?.data);
      if (!parsed.success || parsed.data.debrief === null) {
        dispatch({ type: "LOAD_FAILED" });
        return;
      }
      const cached = effectiveStorage ? cachedIds(effectiveStorage, Date.now()) : new Set<string>();
      dispatch({
        type: "LOADED",
        questions: parsed.data.questions,
        business_date: parsed.data.debrief.business_date,
        cached,
      });
    } catch {
      dispatch({ type: "LOAD_FAILED" });
    }
  }

  function handleOpen() {
    if (effectiveStorage) purgeNow(effectiveStorage, Date.now());
    dispatch({ type: "OPEN" });
    void loadQuestions();
  }

  function handleRetry() {
    dispatch({ type: "RETRY" });
    void loadQuestions();
  }

  function handleBack() {
    dispatch({ type: "BACK" });
  }

  function handleLanjut() {
    if (state.view.kind !== "question") return;
    const now = Date.now();
    if (now >= state.ends_at_ms) {
      dispatch({ type: "TICK", now_ms: now });
      return;
    }
    const question = state.view.list[state.view.index];
    if (!question || state.view.choice === null || !effectiveStorage) return;
    const entry = {
      question_id: question.question_id,
      debrief_business_date: state.business_date ?? "",
      answer: state.view.choice,
      reason: state.view.reason.trim(),
      answered_at_ms: now,
    };
    try {
      appendAnswer(effectiveStorage, entry, now);
    } catch (err) {
      if (err instanceof CacheWriteError) {
        dispatch({ type: "COMMIT_FAILED" });
        return;
      }
      throw err;
    }
    dispatch({ type: "COMMITTED" });
    void flushNow();
  }

  function handleLewati() {
    dispatch({ type: "SKIP" });
  }

  switch (state.view.kind) {
    case "closed":
      if (nowMs >= endsAtMs) return null;
      return (
        <DebriefEntryCard endsAtMs={endsAtMs} nowMs={nowMs} nextMulaiText={nextMulaiText} onOpen={handleOpen} />
      );

    case "loading":
      return (
        <section aria-busy="true">
          <p style={{ margin: 0 }}>{t(lang, "C-d-load")}</p>
          <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-load-2")}</p>
        </section>
      );

    case "load_error":
      return (
        <section role="alert">
          <p style={{ margin: 0 }}>{t(lang, "C-d-err")}</p>
          <p style={{ margin: "2px 0 0" }}>{t(lang, "C-d-err-2")}</p>
          <button type="button" style={{ minHeight: 48, marginTop: 12 }} onClick={handleRetry}>
            {t(lang, "C-b-coba")}
          </button>
        </section>
      );

    case "empty":
      return <DebriefEmpty onBack={handleBack} />;

    case "question":
      return (
        <QuestionScreen
          view={state.view}
          lang={lang}
          uploadNote={uploadNote}
          onChoose={(answer) => dispatch({ type: "CHOOSE", answer })}
          onTypeReason={(reason) => dispatch({ type: "TYPE", reason })}
          onLanjut={handleLanjut}
          onLewati={handleLewati}
        />
      );

    case "done":
      return (
        <DebriefDone
          pending={pendingCount}
          skipped={state.view.skipped}
          endsAtMs={endsAtMs}
          tz={tz}
          nextMulaiText={nextMulaiText}
          onBack={handleBack}
        />
      );

    case "timed_out":
      return <DebriefTimeout endedAtMs={state.view.ended_at_ms} tz={tz} onBack={handleBack} />;
  }
}
