import {
  AnswerBodySchema,
  DebriefListResponseSchema,
  QuestionIdSchema,
  type AnswerResponse,
  type DebriefListResponse,
  type DebriefQuestionView,
} from "@/lib/debrief/contract";
import {
  ANSWER_FUTURE_TOLERANCE_MS,
  ANSWER_CACHE_MAX_AGE_MS,
  CORRECTION_TEXT_MAX_CHARS,
  QUESTION_LINE_MAX_CHARS,
  QUESTION_LINES_MAX,
} from "@/lib/debrief/constants";
import { checkReason, reasonLength } from "@/lib/debrief/reason";
import { scrubReason } from "@/lib/debrief/scrub";
import { rankQuestions } from "@/lib/debrief/rank";
import {
  planAnswerCommit,
  type AnswerTxSnapshot,
  type AnswerWritePlan,
} from "@/lib/debrief/answer-plan";
import { businessDateOf, localHmOf, DEBRIEF_DURATION_MS } from "@/lib/capture/calendar";
import { computePreparing } from "@/lib/debrief/preparing";
import { AppError, DemoCapError, LockedError, NotFoundError, ServiceUnavailableError } from "@/lib/http/errors";
import type { LastEnded, Question, Thread } from "@/lib/firestore/schema";
import type { WorkCategory } from "@/lib/pipeline/categories";
import type { Redactor } from "@/lib/redact/types";

/**
 * Debrief device-route service (R-07, `docs/tasks/R-07-plan.md` Task 4.2/4.3).
 * Pure orchestration over an injected `DebriefStore` so every rule is tested
 * without Firestore — the store's Firestore implementation lives in
 * `lib/firestore/debrief-store.ts`.
 */

export interface EndedDebrief {
  business_date: string;
  debrief_ends_at_ms: number;
}

export interface DebriefStore {
  /** This device's own latest ended business day (`devices/{id}.last_ended`). */
  getLastEnded(device_id: string): Promise<LastEnded | null>;
  /** `sandbox: true` only for a demo sandbox outlet (R-18); the key is absent on every pilot outlet. */
  getOutletCalendar(): Promise<{ tz: string; retention_days: number; sandbox?: boolean }>;
  /** `outlet_id ==`, `device_id ==`, `status == "open"` — the store scopes by device, the service re-checks outlet too. */
  listOpenQuestions(device_id: string): Promise<Question[]>;
  /** Any outlet/device — the caller (`submitAnswer`) checks scope itself (same 404 for "wrong scope" and "missing"). */
  getQuestion(question_id: string): Promise<Question | null>;
  findEndedDebrief(device_id: string, business_date: string): Promise<EndedDebrief | null>;
  /** Raw `staff.name` values of the outlet, for the scrub (never persisted). */
  listStaffNames(): Promise<string[]>;
  /**
   * demo-feedback-2 item 10 (sandbox only): one thread document by id, or null when missing or malformed. Any
   * outlet/device — the caller re-checks scope itself before using a single character of it.
   */
  getThread(thread_id: string): Promise<Thread | null>;
  transactAnswer(
    question_id: string,
    fn: (s: AnswerTxSnapshot) => AnswerWritePlan,
  ): Promise<AnswerWritePlan["result"]>;
  // ── R-19 PR-3 `preparing` inputs (read on a sandbox outlet only) ──
  /** This device's latest ended (not discarded) capture session of the business date, by `ended_at_ms`. */
  getLatestEndedSession(device_id: string, business_date: string): Promise<EndedSessionRef | null>;
  /** Every transcript line of one session as `${seg_id}#${i}` (the windowing formula) plus whether it still has text. */
  listSessionLines(device_id: string, session_id: string): Promise<SessionLineRef[]>;
  /** Line ids of this device's finished (done or failed) label units — the tick store's own query. */
  listLabelledLineIds(device_id: string): Promise<Set<string>>;
}

export interface EndedSessionRef {
  session_id: string;
  ended_at_ms: number;
}

export interface SessionLineRef {
  line_id: string;
  has_text: boolean;
}

/** Active iff a debrief has ended for this device, wasn't discarded, and the hour hasn't passed. */
function isDebriefActive(last: LastEnded | null, now_ms: number): last is LastEnded & { debrief_ends_at_ms: number } {
  return (
    last !== null &&
    last.end_reason !== "discarded" &&
    last.debrief_ends_at_ms !== null &&
    now_ms < last.debrief_ends_at_ms
  );
}

/**
 * R-18: the window's business date, only when it is strictly BEFORE the debrief's own (see
 * DebriefQuestionViewSchema). A later date (a question at 01:15 next day, a session started 00:56) is not an
 * "earlier day". YYYY-MM-DD strings compare in date order.
 */
function earlierDay(q: Question, debriefDate: string, tz: string): { business_date?: string } {
  const date = businessDateOf(q.window_start_ms, tz);
  return date < debriefDate ? { business_date: date } : {};
}


/** Cuts a line to `QUESTION_LINE_MAX_CHARS` code points, the last one being "…" (same `Array.from` counting as `reasonLength`). */
function truncateLine(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= QUESTION_LINE_MAX_CHARS) return line;
  return `${chars.slice(0, QUESTION_LINE_MAX_CHARS - 1).join("").trimEnd()}…`;
}

/**
 * demo-feedback-2 item 10: up to `QUESTION_LINES_MAX` of the thread's own stored lines for a question. The text is
 * the already-redacted line text; it is scrubbed against the staff names FIRST (a name cut in half by the
 * truncation would otherwise survive as a prefix), then trimmed, blank lines dropped, and truncated. Evidence
 * lines (the ones the gate counted) win; with none usable the thread's first lines stand in. Never persisted.
 */
function pickQuestionLines(thread: Thread, staffNames: readonly string[]): string[] {
  const byStart = (a: { start_ms: number }, b: { start_ms: number }) => a.start_ms - b.start_ms;
  const clean = (candidates: Thread["lines"]): string[] =>
    [...candidates]
      .sort(byStart)
      .map((line) => scrubReason(line.text, staffNames).trim())
      .filter((text) => text.length > 0)
      .slice(0, QUESTION_LINES_MAX)
      .map(truncateLine);
  const evidence = new Set(thread.evidence_line_ids);
  const fromEvidence = clean(thread.lines.filter((line) => evidence.has(line.line_id)));
  return fromEvidence.length > 0 ? fromEvidence : clean(thread.lines);
}

/**
 * Sandbox only. `question_id -> lines` for the gate questions whose own thread can be read and is this device's
 * and outlet's. FAIL CLOSED: if the staff names cannot be read, no thread text is read or returned at all; a
 * thread that cannot be read, is missing, malformed or belongs to another device/outlet gives that question no
 * lines. `log` gets counts and a flag only.
 */
async function loadQuestionLines(
  store: DebriefStore,
  claims: { outlet_id: string; device_id: string },
  ranked: readonly Question[],
  log: (entry: Record<string, unknown>) => void,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const candidates = ranked.filter((q) => q.kind === "gate" && q.thread_id !== null);
  if (candidates.length === 0) return result;

  let staffNames: string[];
  try {
    staffNames = await store.listStaffNames();
  } catch {
    log({ event: "debrief.lines", candidates: candidates.length, shown: 0, degraded: true });
    return result;
  }

  const threadIds = Array.from(new Set(candidates.map((q) => q.thread_id as string)));
  const threads = new Map<string, Thread | null>();
  await Promise.all(
    threadIds.map(async (id) => {
      try {
        threads.set(id, await store.getThread(id));
      } catch {
        threads.set(id, null);
      }
    }),
  );

  for (const q of candidates) {
    const thread = threads.get(q.thread_id as string);
    if (!thread) continue;
    // Scope: this device's own thread of this outlet, and the very thread the question points at.
    if (thread.outlet_id !== claims.outlet_id || thread.device_id !== claims.device_id) continue;
    if (thread.thread_id !== q.thread_id) continue;
    const lines = pickQuestionLines(thread, staffNames);
    if (lines.length > 0) result.set(q.question_id, lines);
  }
  log({ event: "debrief.lines", candidates: candidates.length, shown: result.size, degraded: false });
  return result;
}

/** `GET /api/v1/questions` (device). `log` receives counts only (R-19 `debrief.preparing`), never text or ids. */
export async function listDebriefQuestions(
  store: DebriefStore,
  claims: { outlet_id: string; device_id: string },
  now_ms: number,
  log: (entry: Record<string, unknown>) => void = () => {},
): Promise<DebriefListResponse> {
  const last = await store.getLastEnded(claims.device_id);
  if (!isDebriefActive(last, now_ms)) {
    return DebriefListResponseSchema.parse({ debrief: null, questions: [] });
  }

  const qs = await store.listOpenQuestions(claims.device_id);
  // Defensive re-scope (the store already filters by device_id; outlet_id too, belt and suspenders).
  const scoped = qs.filter((q) => q.device_id === claims.device_id && q.outlet_id === claims.outlet_id);
  const ranked = rankQuestions(scoped);

  const calendar = await store.getOutletCalendar();
  // demo-feedback-2 item 10, sandbox only: a pilot response never carries `lines` (and costs no extra read).
  const quoted = calendar.sandbox === true ? await loadQuestionLines(store, claims, ranked, log) : new Map<string, string[]>();
  const questions: DebriefQuestionView[] = ranked.map((q) => ({
    question_id: q.question_id,
    kind: q.kind,
    category:
      q.kind === "gate" && q.category !== null && q.category !== "NON_WORK"
        ? (q.category as WorkCategory)
        : null,
    start_hm: localHmOf(q.window_start_ms, calendar.tz),
    end_hm: localHmOf(q.window_end_ms, calendar.tz),
    // R-18 sandbox only: a pilot response never carries business_date.
    ...(calendar.sandbox === true ? earlierDay(q, last.business_date, calendar.tz) : {}),
    ...(quoted.has(q.question_id) ? { lines: quoted.get(q.question_id) } : {}),
  }));

  // R-19 PR-3, sandbox only: a pilot response never carries the key (and costs no extra read).
  let preparingField: { preparing: boolean } | Record<string, never> = {};
  if (calendar.sandbox === true) {
    const { pending, preparing } = await computePreparing(store, claims.device_id, last, now_ms);
    log({ event: "debrief.preparing", pending, preparing });
    preparingField = { preparing };
  }

  return DebriefListResponseSchema.parse({
    debrief: { business_date: last.business_date, ends_at_ms: last.debrief_ends_at_ms },
    questions,
    ...preparingField,
  });
}

export interface SubmitAnswerDeps {
  store: DebriefStore;
  redactor: Redactor;
  log: (entry: Record<string, unknown>) => void;
}

/** `POST /api/v1/questions/{id}/answer` (device). `rawBody` is the raw request text (route reads it before this parses it). */
export async function submitAnswer(
  deps: SubmitAnswerDeps,
  claims: { outlet_id: string; device_id: string },
  path_id: string,
  rawBody: string,
  now_ms: number,
): Promise<AnswerResponse> {
  const { store, redactor, log } = deps;

  // 2. body is JSON.
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new AppError("Body must be JSON", "invalid_body", 400);
  }

  // 3. AnswerBodySchema.
  const parsedBody = AnswerBodySchema.safeParse(json);
  if (!parsedBody.success) {
    throw new AppError("Invalid answer body", "invalid_body", 400);
  }
  const body = parsedBody.data;

  // 4. path_id === body.question_id, and path_id itself is a well-formed id.
  if (!QuestionIdSchema.safeParse(path_id).success || path_id !== body.question_id) {
    throw new AppError("Path id does not match the body's question_id", "invalid_body", 400);
  }

  // 5. Reason checks (never read for content — only trimmed length).
  const reasonCheck = checkReason(body.reason);
  if (!reasonCheck.ok) {
    throw new AppError("Invalid reason", reasonCheck.code, 400);
  }

  // 6. answered_at_ms range. Exactly 14 days old is refused (<=, not <).
  if (
    body.answered_at_ms > now_ms + ANSWER_FUTURE_TOLERANCE_MS ||
    body.answered_at_ms <= now_ms - ANSWER_CACHE_MAX_AGE_MS
  ) {
    throw new AppError("answered_at_ms is out of range", "answered_at_out_of_range", 400);
  }

  // 7. DEFERRED (rate-limit follow-up, before Sun 11 Oct sign-off): not built in this slice.

  // 8. Scope check: missing, wrong outlet, or wrong device all answer identically (no existence leak).
  const question = await store.getQuestion(body.question_id);
  if (!question || question.outlet_id !== claims.outlet_id || question.device_id !== claims.device_id) {
    throw new NotFoundError("question", body.question_id);
  }

  // 9. Already answered: idempotent 200, nothing written, no redaction call.
  if (question.status === "answered") {
    log({ event: "debrief.answer", question_id: body.question_id, result: "already_answered" });
    return { status: "already_answered" };
  }

  // 10. The end this answer claims to belong to must have actually arrived.
  // Confirmed decision (Rangga, 7 Oct): no new 409 "debrief_not_ended" — this
  // is the existing 503 "not ready yet, retry" (the phone's uploader keeps
  // the cache entry and retries; see lib/http/errors.ts ServiceUnavailableError).
  const ended = await store.findEndedDebrief(claims.device_id, body.debrief_business_date);
  if (!ended) {
    throw new ServiceUnavailableError("This debrief's end has not been received yet; retry.");
  }
  const ends_ms = ended.debrief_ends_at_ms;

  // 11. The answer must fall inside this debrief's own window.
  if (!(ends_ms - DEBRIEF_DURATION_MS <= body.answered_at_ms && body.answered_at_ms <= ends_ms)) {
    throw new AppError("Answer is outside the debrief window", "not_in_debrief", 400);
  }

  // 12. A question `unverified` by any debrief end OTHER than this one is closed.
  if (question.status === "unverified" && question.expired_by_debrief_end_ms !== ends_ms) {
    throw new AppError("This question has closed", "question_closed", 400);
  }

  // 13. Staff-name scrub, ahead of redaction (hard rule #7).
  let staffNames: string[];
  try {
    staffNames = await store.listStaffNames();
  } catch {
    throw new ServiceUnavailableError("Could not load the staff scrub list", "redact");
  }
  const scrubbed = scrubReason(reasonCheck.trimmed, staffNames);

  // 14. Redaction (hard rule #3). FAIL CLOSED: never a 400 for a transient dependency failure.
  let redacted: string;
  try {
    redacted = await redactor.redact(scrubbed);
  } catch (error) {
    if (error instanceof LockedError || error instanceof DemoCapError) {
      // The public demo's spend-cap check refused (R-12): not an SDP outage. No text, no length.
      log({ question_id: body.question_id, code: "demo_cap" });
      throw error;
    }
    log({ question_id: body.question_id, code: "redaction_unavailable", length: reasonLength(body.reason) });
    if (error instanceof AppError) throw error;
    throw new ServiceUnavailableError("Redaction failed", "redact");
  }

  // 15. Placeholders can lengthen the text past the storage bound (rare).
  if (Array.from(redacted).length > CORRECTION_TEXT_MAX_CHARS) {
    throw new AppError("Reason is too long after redaction", "reason_too_long", 400);
  }

  // 16. Commit inside one transaction; every terminal state is re-derived there too.
  const calendar = await store.getOutletCalendar();
  const result = await store.transactAnswer(body.question_id, (snap) =>
    planAnswerCommit({
      snap,
      question_id: body.question_id,
      body: {
        answer: body.answer,
        debrief_business_date: body.debrief_business_date,
        answered_at_ms: body.answered_at_ms,
      },
      ends_ms,
      redacted_reason: redacted,
      device_id: claims.device_id,
      outlet_id: claims.outlet_id,
      now_ms,
      retention_days: calendar.retention_days,
    }),
  );

  // 17. Log the outcome only — never the reason, scrubbed or not.
  log({ event: "debrief.answer", question_id: body.question_id, result });

  if (result === "question_closed") {
    throw new AppError("This question has closed", "question_closed", 400);
  }
  return { status: result === "already_answered" ? "already_answered" : "answered" };
}
