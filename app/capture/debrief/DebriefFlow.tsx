"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { actedIds, canCommit, reduceDebrief, type DebriefState } from "@/lib/debrief/flow";
import { DebriefListResponseSchema } from "@/lib/debrief/contract";
import { appendAnswer, CacheWriteError, cachedIds, pendingSummary, purgeNow, readCache } from "@/lib/debrief/answer-cache";
import { createAnswerUploader, type AnswerUploader, type Disposition } from "@/lib/debrief/answer-uploader";
import { readDoneFlag, readProgress, writeDoneFlag, writeProgress, type DoneSummary } from "@/lib/debrief/done-flag";
import { publishDebriefView } from "@/lib/debrief/view-signal";
import {
  ANSWER_PURGE_INTERVAL_MS,
  ANSWER_RETRY_MS,
  REFRESH_MIN_INTERVAL_MS,
  REFRESH_POLL_MS_DEMO,
} from "@/lib/debrief/constants";
import { deviceAuthHeaders, type DeviceAuth } from "@/lib/capture/browser/client";
import { t } from "@/lib/i18n/dict";
import { useLang } from "@/lib/i18n/context";
import { QuestionScreen } from "@/app/capture/debrief/QuestionScreen";
import { DebriefEntryCard } from "@/app/capture/debrief/DebriefEntryCard";
import { DebriefDone, DebriefEmpty } from "@/app/capture/debrief/DebriefDone";
import { DebriefPreparing, DebriefWaitingMore } from "@/app/capture/debrief/DebriefPreparing";
import { DebriefTimeout } from "@/app/capture/debrief/DebriefTimeout";

/**
 * The debrief container (R-07 Task 7.5): owns the reducer, the fetch-on-OPEN
 * effect, the phone answer cache and uploader lifecycle, and the exact Lanjut
 * commit order (cache write, then COMMITTED, then a fire-and-forget flush).
 * The caller (`/capture`) mounts one of these per debrief — give it a fresh
 * `key={endsAtMs}` so a later debrief on the same page gets a clean state
 * machine instead of reusing a finished one.
 *
 * R-19 PR-3 (`docs/tasks/R-19-demo-v2.md` §6.3), sandbox judge devices only (`demo`): the server labels the
 * judge's moments 2-4 min after End, so the debrief opens itself on mount, shows "Preparing your questions"
 * while the server says `preparing`, re-fetches every REFRESH_POLL_MS_DEMO until the debrief's end, never ends
 * on a Yes (`waiting_more`), and its done screen is terminal: no Back, and a completion flag in localStorage
 * (`lib/debrief/done-flag.ts`) restores the summary after a reload inside the hour. A pilot phone never
 * passes `demo`: one fetch per tap on the entry card, no poll, no flag, every screen as before.
 */

export interface DebriefFlowProps {
  auth: DeviceAuth;
  endsAtMs: number;
  /** The page's own ticked clock (30s / visibilitychange), so the entry card counts down without a private timer. */
  nowMs: number;
  tz: string;
  nextMulaiText: { day: string; hm: string } | null;
  /**
   * The StatusBanner headline, rendered above the card (`closed`) or the
   * timeout block (`timed_out`) — never alongside loading/load_error/empty/
   * question/done, which replace the idle section entirely (tech-lead
   * ruling, UX-03 §5.8: one screen at a time, no Mulai underneath an open
   * question).
   */
  headline?: ReactNode;
  /**
   * The Mulai button + its help line + any Mulai error, rendered below the card or the timeout block only (see
   * `headline`). On a sandbox it is also rendered under the terminal done summary (the Start-locked line, §5.6).
   */
  primary?: ReactNode;
  /**
   * R-19, sandbox judge devices only (the page passes the capture config's `demo_session`). Absent on the
   * pilot: no auto-open, no poll, no preparing/waiting screens, no completion flag.
   */
  demo?: boolean;
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

export function DebriefFlow({
  auth,
  endsAtMs,
  nowMs,
  tz,
  nextMulaiText,
  headline,
  primary,
  demo = false,
  fetchFn,
  storage,
}: DebriefFlowProps) {
  const { lang } = useLang();
  // Wrapped, not the bare global: window.fetch throws "Illegal invocation" when it is stored in an object and
  // called as a method of it (the answer uploader's deps).
  const effectiveFetch: typeof fetch = fetchFn ?? ((input, init) => fetch(input, init));
  const effectiveStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);

  const [state, dispatch] = useReducer(
    reduceDebrief,
    {
      view: { kind: "closed" },
      ends_at_ms: endsAtMs,
      business_date: null,
      seen: new Set(),
      demo,
      preparing: false,
    } satisfies DebriefState,
  );
  const [uploadNote, setUploadNote] = useState<"offline" | "refused" | null>(null);
  // The done screen's unsent-answer count. Seeded in `handleLanjut` right
  // after the cache write (so it is correct on the very first render of
  // "done"), then kept current by every `flushNow()` — never a one-shot
  // read on entry to "done", or a later flush finishing online would leave
  // a stale "N answers not sent yet." showing forever.
  const [pendingCount, setPendingCount] = useState(0);

  // R-19 (demo): this debrief's completion flag, read once at mount. Non-null means the done screen was already
  // reached (a reload inside the hour): the summary shows instead of the entry card and nothing auto-opens.
  const [restoredDone] = useState<DoneSummary | null>(() =>
    demo && effectiveStorage ? readDoneFlag(effectiveStorage, endsAtMs) : null,
  );

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

  async function flushNow() {
    if (!uploader) return;
    let result = await uploader.flush();
    setUploadNote(uploadNoteFor(result.last));
    setPendingCount(result.pending);
    // A commit that lands mid-flush (its cache write happens after this
    // flush already read the cache) would otherwise wait the full
    // ANSWER_RETRY_MS retry interval before it is picked up.
    if (result.pending > 0 && result.last === "removed_ok") {
      result = await uploader.flush();
      setUploadNote(uploadNoteFor(result.last));
      setPendingCount(result.pending);
    }
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

  const refreshInFlightRef = useRef(false);
  const [checking, setChecking] = useState(false);

  // The questions route is shared by every sandbox device, so a manual tap closer than REFRESH_MIN_INTERVAL_MS
  // to the last check does nothing (the answer on screen is at most 5 s old). A failed check (429, 503, any
  // non-2xx, a network error) just leaves the screen as it is: nothing here retries, the next poll tick or tap
  // is the only retry.
  const lastCheckAtRef = useRef(0);
  async function refreshQuestions(manual: boolean) {
    if (refreshInFlightRef.current) return;
    const started = Date.now();
    if (manual && started - lastCheckAtRef.current < REFRESH_MIN_INTERVAL_MS) return;
    lastCheckAtRef.current = started;
    refreshInFlightRef.current = true;
    if (manual) setChecking(true);
    try {
      const res = await effectiveFetch("/api/v1/questions", { headers: deviceAuthHeaders(auth) });
      if (!res.ok) return; // a failed check never replaces the screen the judge is on
      const payload: unknown = await res.json();
      const parsed = DebriefListResponseSchema.safeParse((payload as { data?: unknown } | null)?.data);
      if (!parsed.success || parsed.data.debrief === null) return;
      const cached = effectiveStorage ? cachedIds(effectiveStorage, Date.now()) : new Set<string>();
      dispatch({ type: "REFRESHED", questions: parsed.data.questions, cached, preparing: parsed.data.preparing });
    } catch {
      // network failure: keep the screen as it is
    } finally {
      refreshInFlightRef.current = false;
      if (manual) setChecking(false);
    }
  }

  // R-19 (demo): the poll runs only on a sandbox device, only while `preparing` or `waiting_more` is on screen
  // (or a question is, and the server last said it is still preparing), and stops at the debrief's end. Once the
  // server stops preparing nothing new can arrive, so a question on screen is not polled any more (this bounds
  // the polls to about PREPARING_MAX_MS / REFRESH_POLL_MS_DEMO per debrief). The latest closure is read through a ref so the interval is
  // created once per "polling view" span.
  const refreshRef = useRef(refreshQuestions);
  useEffect(() => {
    refreshRef.current = refreshQuestions;
  });
  const polling =
    state.view.kind === "preparing" ||
    state.view.kind === "waiting_more" ||
    (state.view.kind === "question" && state.preparing);
  useEffect(() => {
    if (!demo || !polling) return;
    const id = setInterval(() => {
      if (Date.now() >= endsAtMs) {
        clearInterval(id);
        return;
      }
      void refreshRef.current(false);
    }, REFRESH_POLL_MS_DEMO);
    return () => clearInterval(id);
  }, [demo, polling, endsAtMs]);

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
        preparing: parsed.data.preparing,
        ...(demo && effectiveStorage ? { progress: readProgress(effectiveStorage, endsAtMs) ?? undefined } : {}),
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

  // R-19 (demo): the entry card never shows on a sandbox. The debrief opens itself once at mount, unless this
  // debrief's done screen was already reached (the flag) or its hour is already over.
  useEffect(() => {
    if (!demo || restoredDone !== null || Date.now() >= endsAtMs) return;
    handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once auto-open
  }, []);

  // R-19 PR-5 (demo): tell the judge-guide bridge which screen is up, the moment it changes (round-4 D2).
  const viewKind = state.view.kind;
  useEffect(() => {
    if (demo) publishDebriefView(viewKind);
  }, [demo, viewKind]);
  useEffect(() => () => publishDebriefView(null), []);

  // R-19 (demo): entering `done` writes the completion flag, so a reload inside the hour restores this summary.
  const doneCounts = state.view.kind === "done" ? state.view : null;
  useEffect(() => {
    if (!demo || !doneCounts || !effectiveStorage) return;
    writeDoneFlag(effectiveStorage, endsAtMs, { answered: doneCounts.answered, skipped: doneCounts.skipped });
  }, [demo, doneCounts, effectiveStorage, endsAtMs]);

  // R-19 (demo): the counts and the ids acted on so far, written after every answer or skip, so a reload before
  // `done` resumes with the right numbers and neither re-offers a skipped question nor lifts the cap of 5. Counts
  // and opaque question ids only; not terminal (the completion flag above is the only terminal marker).
  const progressCounts =
    state.view.kind === "question" || state.view.kind === "waiting_more" || state.view.kind === "done"
      ? { answered: state.view.answered, skipped: state.view.skipped }
      : null;
  const progressAnswered = progressCounts?.answered ?? null;
  const progressSkipped = progressCounts?.skipped ?? null;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  useEffect(() => {
    if (!demo || !effectiveStorage || progressAnswered === null || progressSkipped === null) return;
    writeProgress(effectiveStorage, endsAtMs, {
      answered: progressAnswered,
      skipped: progressSkipped,
      seen: actedIds(stateRef.current),
    });
  }, [demo, effectiveStorage, endsAtMs, progressAnswered, progressSkipped]);

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
    // Defensive: the disabled Lanjut button is the only UI guard against an
    // incomplete answer; this stops a stray call (e.g. a test or a future
    // caller) from committing one regardless.
    if (!canCommit(state.view)) return;
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
    // Seed the done-screen count from the cache as it stands right after
    // this write, so "done" never renders a 0 for a beat before the async
    // flush below reports in.
    setPendingCount(pendingSummary(readCache(effectiveStorage)).count);
    dispatch({ type: "COMMITTED" });
    void flushNow();
  }

  function handleLewati() {
    dispatch({ type: "SKIP" });
  }

  function demoDone(answered: number, skipped: number, pending: number) {
    return (
      <>
        <DebriefDone
          demo
          pending={pending}
          answered={answered}
          skipped={skipped}
          endsAtMs={endsAtMs}
          tz={tz}
          nextMulaiText={nextMulaiText}
          onBack={handleBack}
        />
        {primary}
      </>
    );
  }

  switch (state.view.kind) {
    case "closed": {
      // Past `endsAtMs` with the flow never opened: the card itself
      // disappears silently (there is nothing to resume), but the headline
      // and the Mulai section are not this component's to hide — they stay.
      const expired = nowMs >= endsAtMs;
      if (demo && restoredDone) return demoDone(restoredDone.answered, restoredDone.skipped, pendingCount);
      if (demo && !expired) {
        // The auto-open effect is about to dispatch OPEN; never flash the entry card on a sandbox.
        return (
          <section aria-busy="true">
            <p style={{ margin: 0 }}>{t(lang, "C-d-load")}</p>
          </section>
        );
      }
      return (
        <>
          {headline}
          {!expired ? (
            <DebriefEntryCard endsAtMs={endsAtMs} nowMs={nowMs} nextMulaiText={nextMulaiText} onOpen={handleOpen} />
          ) : null}
          {primary}
        </>
      );
    }

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

    case "preparing":
      return <DebriefPreparing />;

    case "waiting_more":
      return <DebriefWaitingMore />;

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
          onCheck={demo ? () => void refreshQuestions(true) : undefined}
          checking={checking}
          debriefDate={state.business_date}
        />
      );

    case "done":
      if (demo) return demoDone(state.view.answered, state.view.skipped, pendingCount);
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
      // Shown inline on /capture in place of the card (plan §7.5), not as a
      // replacement for the whole idle section — the headline and Mulai
      // stay, same placement as `closed`.
      return (
        <>
          {headline}
          <DebriefTimeout endedAtMs={state.view.ended_at_ms} tz={tz} onBack={handleBack} demo={demo} />
          {primary}
        </>
      );
  }
}
