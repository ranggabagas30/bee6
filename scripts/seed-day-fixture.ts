/**
 * Demo-only 14-hour day fixture for the day record's performance check (R-06
 * Task 8, `docs/tasks/R-06.md`). Writes a fictional, deterministic day of
 * threads/questions/corrections on `fixture-device` so the day record screen
 * can be measured against a realistic load. Never touches real pilot data:
 * `assertFixtureAllowed` refuses anything but the demo project
 * (`bee6-playground`, Rangga 9 Oct Q6) and refuses a `--date` that is today or
 * later in Asia/Jakarta, so judges' "today" is never touched.
 *
 *   npm run seed:day-fixture -- --date 2026-10-01 [--threads 400]
 *   npm run seed:day-fixture -- --date 2026-10-01 --delete
 *
 * `fixture-device` is never written to the `devices` collection, so the tick
 * never touches it and the day header's capture-mode label is unaffected.
 * Every written doc id starts with `fixture_` (the capture session's id is
 * the one named exception: `fixture-device:<uuid>`, per the task's own
 * convention) so a human or script can always recognise fixture data at a
 * glance.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { addDays, businessDateOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { evaluateGate, type GateDecision } from "@/lib/pipeline/gate";
import { NEEDS_SUPERVISOR_CONFIRM, type Category, type WorkCategory } from "@/lib/pipeline/categories";
import { threadQuestionId } from "@/lib/pipeline/question-ids";
import {
  AUTO_STOP_AFTER_CLOSE_MIN,
  CaptureSessionSchema,
  CorrectionSchema,
  QuestionDocSchema,
  ThreadSchema,
  parseOutletDoc,
  type CaptureSession,
  type Correction,
  type Question,
  type Thread,
  type ThreadLine,
} from "@/lib/firestore/schema";
import { assertProjectMatchesEnv, type ProjectKind } from "@/scripts/seed";

// ── fixed fixture identity (demo project only) ───────────────────────────────
export const FIXTURE_OUTLET_ID = "demo-outlet";
export const FIXTURE_DEVICE_ID = "fixture-device";
export const FIXTURE_TZ = "Asia/Jakarta";
export const FIXTURE_RETENTION_DAYS = 14;
export const DEFAULT_FIXTURE_THREAD_COUNT = 400;
const WINDOW_START_HM = "09:00";
const WINDOW_END_HM = "23:00";

/** Every category that can become a model fact directly (v1 gate) with no debrief. */
const FACT_CATEGORIES: readonly WorkCategory[] = [
  "ROUTINE_OPS",
  "CUSTOMER_SERVICE",
  "TRAINING",
  "STAFF_CONSULT",
  "EVENT",
];

// ── pure: deterministic ids (no Math.random anywhere in this file) ──────────

/**
 * A deterministic, schema-valid (version-4-shaped) UUID derived from `seed`
 * via SHA-256 — a pure hash, not `Math.random`, so the same `--date` always
 * produces the same session id (the task's "uuid v5-like fixed uuid").
 */
export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const timeLow = hex.slice(0, 8);
  const timeMid = hex.slice(8, 12);
  const versionAndHigh = `4${hex.slice(13, 16)}`;
  const variantNibble = ((parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const variantAndClockSeq = `${variantNibble}${hex.slice(17, 20)}`;
  const node = hex.slice(20, 32);
  return `${timeLow}-${timeMid}-${versionAndHigh}-${variantAndClockSeq}-${node}`;
}

/** The capture_sessions doc id for a fixture day (`{device_id}:{session_id}`, web spec §6.6.3). */
export function fixtureSessionDocId(date: string): string {
  return `${FIXTURE_DEVICE_ID}:${deterministicUuid(`fixture-session-${date}`)}`;
}

// ── pure: fictional line templates (no real names; [STAFF] is the real ─────
// pipeline's own placeholder, kept here so fixture lines read like real ones).
const LINE_TEMPLATES: readonly string[] = [
  "[STAFF] restocked the pastry case before opening.",
  "Pelanggan memesan dua croissant dan kopi.",
  "[STAFF] wiped down the counter and reset the till.",
  "Antrian pagi cukup ramai, semua terlayani dengan baik.",
  "[STAFF] checked the oven temperature twice this hour.",
  "Supplier mengantar tepung terigu tepat waktu.",
  "[STAFF] reminded the team about the new price list.",
  "Mesin kopi sempat macet sebentar, lalu normal lagi.",
];

function buildLines(threadId: string, startMs: number, endMs: number, count: number, seed: number): ThreadLine[] {
  const span = Math.max(endMs - startMs, count);
  const lines: ThreadLine[] = [];
  for (let k = 0; k < count; k += 1) {
    const lineStart = startMs + Math.floor((span * k) / count);
    const lineEnd = Math.max(startMs + Math.floor((span * (k + 1)) / count), lineStart);
    lines.push({
      line_id: `${threadId}_l${k}`,
      start_ms: lineStart,
      end_ms: lineEnd,
      text: LINE_TEMPLATES[(seed + k) % LINE_TEMPLATES.length] ?? LINE_TEMPLATES[0]!,
    });
  }
  return lines;
}

function buildSummary(i: number, category: Category): string {
  return `Fixture thread ${i}: ${category.replace(/_/g, " ").toLowerCase()} notes for the demo load check.`;
}

// ── pure: the day fixture builder ────────────────────────────────────────────
export interface BuildDayFixtureInput {
  outlet_id: string;
  date: string; // "YYYY-MM-DD"
  tz: string;
  threads: number; // thread count to build
}

export interface BuildDayFixtureResult {
  session: CaptureSession;
  threads: Thread[];
  questions: Question[];
  corrections: Correction[];
}

/**
 * Builds a fictional, deterministic 14-hour day (09:00-23:00) on
 * `fixture-device`. Pure (no I/O, no `Math.random`): the same inputs always
 * produce the same output, so this can be unit-tested without Firestore.
 *
 * Status mix by `i % 20` (R-06 Task 8): 0-11 fact (0,1 are
 * `staff_confirmed`), 12-13 open question, 14 YES answered (ROUTINE_OPS,
 * stays open -> question_answered), 15 COMPLAINT YES (stays open ->
 * awaiting_supervisor; Task 10's QA target), 16 NO
 * (excluded_from_evidence), 17-18 unverified, 19 open COMPLAINT question.
 * No `supervisor_confirmed` / `supervisor_rejected` rows: those only exist
 * once PR-5's schema change lands; QA creates them through the real route.
 *
 * v3 additions: even-index threads carry a `runner_up` (Task 11); every
 * 40th index also writes one fictional `unlabelled_unit` question (Task 12),
 * cycling open / answered-yes (with a correction) / unverified.
 */
export function buildDayFixture(input: BuildDayFixtureInput): BuildDayFixtureResult {
  const { outlet_id, date, tz, threads: threadCount } = input;

  const windowStartMs = zonedTimeToEpochMs(date, WINDOW_START_HM, tz);
  const windowEndMs = zonedTimeToEpochMs(date, WINDOW_END_HM, tz);
  const span = windowEndMs - windowStartMs;
  const step = threadCount > 0 ? span / threadCount : 0;

  const session: CaptureSession = CaptureSessionSchema.parse({
    outlet_id,
    device_id: FIXTURE_DEVICE_ID,
    session_id: deterministicUuid(`fixture-session-${date}`),
    started_at_ms: windowStartMs,
    ended_at_ms: windowEndMs,
    end_reason: "selesai",
    local_date: date,
    auto_stop_at_ms: windowEndMs + AUTO_STOP_AFTER_CLOSE_MIN * 60_000,
    debrief_ends_at_ms: windowEndMs + 60 * 60_000,
    received_start_at: new Date(windowStartMs).toISOString(),
    received_end_at: new Date(windowEndMs).toISOString(),
  });

  const outThreads: Thread[] = [];
  const outQuestions: Question[] = [];
  const outCorrections: Correction[] = [];

  function buildGateQuestion(args: {
    questionId: string;
    threadId: string;
    category: WorkCategory;
    windowStart: number;
    windowEnd: number;
    status: "open" | "unverified" | "answered";
    answer?: "yes" | "no";
    answeredAtMs?: number;
    expiredByDebriefEndMs?: number;
  }): Question {
    const base = {
      outlet_id,
      question_id: args.questionId,
      device_id: FIXTURE_DEVICE_ID,
      thread_id: args.threadId,
      kind: "gate" as const,
      status: args.status,
      category: args.category,
      window_start_ms: args.windowStart,
      window_end_ms: args.windowEnd,
      created_at_ms: args.windowStart,
      expired_by_debrief_end_ms: args.status === "unverified" ? args.expiredByDebriefEndMs ?? null : null,
    };
    if (args.status === "answered") {
      return QuestionDocSchema.parse({ ...base, answer: args.answer, answered_at_ms: args.answeredAtMs });
    }
    return QuestionDocSchema.parse(base);
  }

  function buildCorrection(args: {
    questionId: string;
    threadId: string | null;
    answer: "yes" | "no";
    needsSupervisorConfirm: boolean;
    answeredAtMs: number;
  }): Correction {
    return CorrectionSchema.parse({
      outlet_id,
      correction_id: args.questionId,
      question_id: args.questionId,
      thread_id: args.threadId,
      answer: args.answer,
      reason_text: "Fixture: staff reported this during the debrief.",
      answered_device_id: FIXTURE_DEVICE_ID,
      debrief_business_date: date,
      answered_at_ms: args.answeredAtMs,
      received_at_ms: args.answeredAtMs,
      needs_supervisor_confirm: args.needsSupervisorConfirm,
      expires_at: new Date(args.answeredAtMs + FIXTURE_RETENTION_DAYS * 86_400_000).toISOString(),
      created_at: new Date(args.answeredAtMs).toISOString(),
    });
  }

  for (let i = 0; i < threadCount; i += 1) {
    const startMs = Math.floor(windowStartMs + i * step);
    const lengthMs = ((i % 4) + 1) * 60_000;
    const endMs = Math.min(startMs + lengthMs, windowEndMs - 1);
    const threadId = `fixture_thread_${date}_${i}`;
    // The real convention (`lib/pipeline/question-ids.ts`): a thread's gate
    // question id is always `q_thread_<thread_id>`, never hand-built — this
    // is what `lib/day/service.ts` looks up by, so fixture gate questions
    // and corrections must use it too.
    const questionId = threadQuestionId(threadId);
    const lineCount = 3 + (i % 6);
    const lines = buildLines(threadId, startMs, endMs, lineCount, i);
    const lineIds = lines.map((l) => l.line_id);
    const answeredAtMs = endMs + 60_000;

    let category: WorkCategory;
    let confidence: number;
    let evidenceLineIds: string[];
    let status: "fact" | "open" | "unverified";
    let gate: GateDecision;
    let labelSource: "model" | "staff_confirmed" | undefined;
    let confirmedCategory: Category | undefined;
    let excludedFromEvidence: boolean | undefined;

    const bucket = i % 20;
    switch (bucket) {
      case 0:
      case 1: {
        // Fact via a supervisor-free staff YES on a below-threshold thread.
        category = bucket === 0 ? "ROUTINE_OPS" : "CUSTOMER_SERVICE";
        confidence = 0.5; // below threshold at creation -> starts as a question
        evidenceLineIds = lineIds.slice(0, Math.min(bucket === 0 ? 2 : 1, lineIds.length));
        gate = evaluateGate({
          category,
          confidence,
          evidence_line_ids: evidenceLineIds,
          label_conflict: false,
          staff_answer: { question_id: questionId, chosen_category: category },
        });
        status = "fact";
        labelSource = "staff_confirmed";
        confirmedCategory = category;
        outQuestions.push(
          buildGateQuestion({
            questionId,
            threadId,
            category,
            windowStart: startMs,
            windowEnd: endMs,
            status: "answered",
            answer: "yes",
            answeredAtMs,
          }),
        );
        outCorrections.push(
          buildCorrection({
            questionId,
            threadId,
            answer: "yes",
            needsSupervisorConfirm: NEEDS_SUPERVISOR_CONFIRM.has(category),
            answeredAtMs,
          }),
        );
        break;
      }
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
      case 8:
      case 9:
      case 10:
      case 11: {
        // Plain model fact: passes the v1 gate directly, no debrief question.
        category = FACT_CATEGORIES[(bucket - 2) % FACT_CATEGORIES.length]!;
        confidence = 0.95;
        evidenceLineIds = lineIds.slice(0, Math.min(2, lineIds.length));
        gate = evaluateGate({ category, confidence, evidence_line_ids: evidenceLineIds, label_conflict: false });
        status = "fact";
        break;
      }
      case 12: {
        // Open question: below the fact threshold.
        category = "ROUTINE_OPS";
        confidence = 0.5;
        evidenceLineIds = lineIds.slice(0, Math.min(2, lineIds.length));
        gate = evaluateGate({ category, confidence, evidence_line_ids: evidenceLineIds, label_conflict: false });
        status = "open";
        outQuestions.push(
          buildGateQuestion({ questionId, threadId, category, windowStart: startMs, windowEnd: endMs, status: "open" }),
        );
        break;
      }
      case 13: {
        // Open question: no evidence at all.
        category = "CUSTOMER_SERVICE";
        confidence = 0.95;
        evidenceLineIds = [];
        gate = evaluateGate({ category, confidence, evidence_line_ids: evidenceLineIds, label_conflict: false });
        status = "open";
        outQuestions.push(
          buildGateQuestion({ questionId, threadId, category, windowStart: startMs, windowEnd: endMs, status: "open" }),
        );
        break;
      }
      case 14: {
        // YES on a no-evidence ROUTINE_OPS thread: stays open -> question_answered.
        category = "ROUTINE_OPS";
        confidence = 0.95;
        evidenceLineIds = [];
        gate = evaluateGate({
          category,
          confidence,
          evidence_line_ids: evidenceLineIds,
          label_conflict: false,
          staff_answer: { question_id: questionId, chosen_category: category },
        });
        status = "open";
        labelSource = "model";
        outQuestions.push(
          buildGateQuestion({
            questionId,
            threadId,
            category,
            windowStart: startMs,
            windowEnd: endMs,
            status: "answered",
            answer: "yes",
            answeredAtMs,
          }),
        );
        outCorrections.push(
          buildCorrection({ questionId, threadId, answer: "yes", needsSupervisorConfirm: false, answeredAtMs }),
        );
        break;
      }
      case 15: {
        // COMPLAINT YES: always needs a supervisor, stays open -> awaiting_supervisor.
        category = "COMPLAINT";
        confidence = 0.95;
        evidenceLineIds = lineIds.slice(0, Math.min(2, lineIds.length));
        gate = evaluateGate({
          category,
          confidence,
          evidence_line_ids: evidenceLineIds,
          label_conflict: false,
          staff_answer: { question_id: questionId, chosen_category: category },
        });
        status = "open";
        labelSource = "model";
        outQuestions.push(
          buildGateQuestion({
            questionId,
            threadId,
            category,
            windowStart: startMs,
            windowEnd: endMs,
            status: "answered",
            answer: "yes",
            answeredAtMs,
          }),
        );
        outCorrections.push(
          buildCorrection({ questionId, threadId, answer: "yes", needsSupervisorConfirm: true, answeredAtMs }),
        );
        break;
      }
      case 16: {
        // NO: the staff rejected the label -> excluded_from_evidence.
        category = "CORRECTION";
        confidence = 0.95;
        evidenceLineIds = lineIds.slice(0, Math.min(2, lineIds.length));
        gate = evaluateGate({
          category,
          confidence,
          evidence_line_ids: evidenceLineIds,
          label_conflict: false,
          staff_answer: { question_id: questionId, chosen_category: null },
        });
        status = "open";
        labelSource = "model";
        excludedFromEvidence = true;
        outQuestions.push(
          buildGateQuestion({
            questionId,
            threadId,
            category,
            windowStart: startMs,
            windowEnd: endMs,
            status: "answered",
            answer: "no",
            answeredAtMs,
          }),
        );
        outCorrections.push(
          buildCorrection({
            questionId,
            threadId,
            answer: "no",
            needsSupervisorConfirm: NEEDS_SUPERVISOR_CONFIRM.has(category),
            answeredAtMs,
          }),
        );
        break;
      }
      case 17:
      case 18: {
        // Unverified: the debrief ended before anyone answered.
        category = "ROUTINE_OPS";
        confidence = 0.5;
        evidenceLineIds = lineIds.slice(0, Math.min(2, lineIds.length));
        gate = evaluateGate({ category, confidence, evidence_line_ids: evidenceLineIds, label_conflict: false });
        status = "unverified";
        outQuestions.push(
          buildGateQuestion({
            questionId,
            threadId,
            category,
            windowStart: startMs,
            windowEnd: endMs,
            status: "unverified",
            // The real pipeline expires an open question at the session's
            // own `debrief_ends_at_ms` (`lib/pipeline/gate.ts`'s
            // `expireAtDebriefEnd`), never at this thread's own end + 1h.
            expiredByDebriefEndMs: session.debrief_ends_at_ms ?? undefined,
          }),
        );
        break;
      }
      default: {
        // bucket 19: open COMPLAINT question, never answered.
        category = "COMPLAINT";
        confidence = 0.95;
        evidenceLineIds = lineIds.slice(0, Math.min(2, lineIds.length));
        gate = evaluateGate({ category, confidence, evidence_line_ids: evidenceLineIds, label_conflict: false });
        status = "open";
        outQuestions.push(
          buildGateQuestion({ questionId, threadId, category, windowStart: startMs, windowEnd: endMs, status: "open" }),
        );
        break;
      }
    }

    // v3 (Task 11): even-index threads carry a runner-up; swap its category
    // when it would otherwise equal the thread's own category.
    const runnerUp =
      i % 2 === 0
        ? {
            category: (category === "CUSTOMER_SERVICE" ? "ROUTINE_OPS" : "CUSTOMER_SERVICE") as Category,
            why_not: "Fixture: not a service request.",
          }
        : undefined;

    const lastLine = lines[lines.length - 1]!;
    const thread: Thread = ThreadSchema.parse({
      outlet_id,
      thread_id: threadId,
      device_id: FIXTURE_DEVICE_ID,
      category,
      confidence,
      line_ids: lineIds,
      evidence_line_ids: evidenceLineIds,
      lines,
      first_line_start_ms: lines[0]!.start_ms,
      last_line_end_ms: lastLine.end_ms,
      summary: buildSummary(i, category),
      runner_up: runnerUp,
      label_conflict: false,
      status,
      gate,
      created_at_ms: lines[0]!.start_ms,
      updated_at_ms: lastLine.end_ms,
      label_source: labelSource,
      confirmed_category: confirmedCategory,
      excluded_from_evidence: excludedFromEvidence,
    });
    outThreads.push(thread);

    // v3 (Task 12): every 40th index also writes one unlabelled_unit question,
    // cycling open / answered-yes (with a correction) / unverified.
    if (i % 40 === 0) {
      const unlQuestionId = `fixture_q_unit_${date}_${i}`;
      const unlStart = startMs;
      const unlEnd = startMs + 2 * 60_000;
      const cycle = (["open", "answered", "unverified"] as const)[(i / 40) % 3]!;
      if (cycle === "open") {
        outQuestions.push(
          QuestionDocSchema.parse({
            outlet_id,
            question_id: unlQuestionId,
            device_id: FIXTURE_DEVICE_ID,
            thread_id: null,
            kind: "unlabelled_unit",
            status: "open",
            category: null,
            window_start_ms: unlStart,
            window_end_ms: unlEnd,
            created_at_ms: unlStart,
            expired_by_debrief_end_ms: null,
          }),
        );
      } else if (cycle === "answered") {
        const unlAnsweredAt = unlEnd + 60_000;
        outQuestions.push(
          QuestionDocSchema.parse({
            outlet_id,
            question_id: unlQuestionId,
            device_id: FIXTURE_DEVICE_ID,
            thread_id: null,
            kind: "unlabelled_unit",
            status: "answered",
            category: null,
            window_start_ms: unlStart,
            window_end_ms: unlEnd,
            created_at_ms: unlStart,
            answer: "yes",
            answered_at_ms: unlAnsweredAt,
            expired_by_debrief_end_ms: null,
          }),
        );
        outCorrections.push(
          CorrectionSchema.parse({
            outlet_id,
            correction_id: unlQuestionId,
            question_id: unlQuestionId,
            thread_id: null,
            answer: "yes",
            reason_text: "Fixture: unlabelled moment reviewed during the debrief.",
            answered_device_id: FIXTURE_DEVICE_ID,
            debrief_business_date: date,
            answered_at_ms: unlAnsweredAt,
            received_at_ms: unlAnsweredAt,
            needs_supervisor_confirm: false,
            expires_at: new Date(unlAnsweredAt + FIXTURE_RETENTION_DAYS * 86_400_000).toISOString(),
            created_at: new Date(unlAnsweredAt).toISOString(),
          }),
        );
      } else {
        outQuestions.push(
          QuestionDocSchema.parse({
            outlet_id,
            question_id: unlQuestionId,
            device_id: FIXTURE_DEVICE_ID,
            thread_id: null,
            kind: "unlabelled_unit",
            status: "unverified",
            category: null,
            window_start_ms: unlStart,
            window_end_ms: unlEnd,
            created_at_ms: unlStart,
            expired_by_debrief_end_ms: unlEnd + 60 * 60_000,
          }),
        );
      }
    }
  }

  return { session, threads: outThreads, questions: outQuestions, corrections: outCorrections };
}

// ── pure: the demo-only / not-today guard ────────────────────────────────────
export interface FixtureGuardInput {
  /** `outlets/demo-outlet`'s `project_kind`, or `null` when missing/unparseable. */
  outletProjectKind: "pilot" | "demo" | null;
  demoModeEnv: string | undefined;
  date: string;
  /** `businessDateOf(now, tz)` — injected so the guard stays pure/testable. */
  todayBusinessDate: string;
  /** Injected so a test can make it throw without touching real env (PR-1, `scripts/seed.ts`). */
  assertProjectMatchesEnv: (project: ProjectKind) => void;
}

/**
 * Refuses (throws) unless every check holds, in this order: the project
 * matches `DEMO_MODE` (delegated to `scripts/seed.ts`'s own guard),
 * `DEMO_MODE === "true"`, `outlets/demo-outlet` parses with
 * `project_kind === "demo"`, and `--date` is strictly before today in
 * Asia/Jakarta. Pure: takes every fact as input, touches no env or Firestore
 * itself, so it is fully unit-tested.
 */
export function assertFixtureAllowed(input: FixtureGuardInput): void {
  input.assertProjectMatchesEnv("demo");
  if ((input.demoModeEnv ?? "").toLowerCase() !== "true") {
    throw new Error(
      "Refusing to seed the day fixture without DEMO_MODE=true. This fixture is demo-project only.",
    );
  }
  if (input.outletProjectKind !== "demo") {
    throw new Error(
      "Refusing to seed the day fixture: outlets/demo-outlet must have project_kind \"demo\".",
    );
  }
  if (input.date >= input.todayBusinessDate) {
    throw new Error(
      `Refusing --date ${input.date}: it is today or later (Asia/Jakarta). Judges' "today" must never be touched.`,
    );
  }
}

// ── CLI wiring ────────────────────────────────────────────────────────────────
const USAGE =
  "Usage: npm run seed:day-fixture -- --date <YYYY-MM-DD> [--threads <n>] [--delete]";

function usageError(): Error {
  return new Error(USAGE);
}

export interface FixtureArgs {
  date: string;
  threads: number;
  delete: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFixtureArgs(argv: readonly string[]): FixtureArgs {
  let date: string | undefined;
  let threads = DEFAULT_FIXTURE_THREAD_COUNT;
  let del = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--date":
        date = argv[i + 1];
        i += 1;
        break;
      case "--threads": {
        const raw = argv[i + 1];
        i += 1;
        const n = raw !== undefined ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n <= 0) throw usageError();
        threads = n;
        break;
      }
      case "--delete":
        del = true;
        break;
      default:
        throw usageError();
    }
  }

  if (!date || !DATE_RE.test(date)) throw usageError();
  return { date, threads, delete: del };
}

// ── IO: Firestore writes/deletes ─────────────────────────────────────────────
const BATCH_LIMIT = 400;
/** Firestore `in` query cap. */
const IN_QUERY_CHUNK = 30;

async function commitSets(db: Firestore, docs: ReadonlyArray<{ ref: DocumentReference; data: Record<string, unknown> }>): Promise<void> {
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const { ref, data } of docs.slice(i, i + BATCH_LIMIT)) batch.set(ref, data);
    await batch.commit();
  }
}

async function commitDeletes(db: Firestore, refs: readonly DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
}

/** `expires_at` is stored as a native Timestamp (same conversion as `firestoreDebriefStore`'s corrections). */
function toCorrectionDoc(correction: Correction): Record<string, unknown> {
  return { ...correction, expires_at: Timestamp.fromDate(new Date(correction.expires_at)) };
}

async function writeFixture(db: Firestore, build: BuildDayFixtureResult): Promise<void> {
  const docs: Array<{ ref: DocumentReference; data: Record<string, unknown> }> = [];
  docs.push({
    ref: db.collection(COLLECTIONS.captureSessions).doc(`${build.session.device_id}:${build.session.session_id}`),
    data: build.session,
  });
  for (const t of build.threads) docs.push({ ref: db.collection(COLLECTIONS.threads).doc(t.thread_id), data: t });
  for (const q of build.questions) docs.push({ ref: db.collection(COLLECTIONS.questions).doc(q.question_id), data: q });
  for (const c of build.corrections) {
    docs.push({ ref: db.collection(COLLECTIONS.corrections).doc(c.correction_id), data: toCorrectionDoc(c) });
  }
  await commitSets(db, docs);
}

async function deleteFixture(db: Firestore, date: string): Promise<void> {
  const dayStartMs = zonedTimeToEpochMs(date, "00:00", FIXTURE_TZ);
  const dayEndMs = zonedTimeToEpochMs(addDays(date, 1), "00:00", FIXTURE_TZ);

  // `outlet_id ==` + the `first_line_start_ms` range is the same composite
  // the day record's own query needs (R-06 §9 already creates it); adding
  // `device_id ==` on top would need a second composite index nothing in
  // §9 creates, so `device_id` is filtered in memory instead.
  const threadSnap = await db
    .collection(COLLECTIONS.threads)
    .where("outlet_id", "==", FIXTURE_OUTLET_ID)
    .where("first_line_start_ms", ">=", dayStartMs)
    .where("first_line_start_ms", "<", dayEndMs)
    .get();
  const threadDocs = threadSnap.docs.filter((d) => d.data().device_id === FIXTURE_DEVICE_ID);
  const threadIds = threadDocs.map((d) => d.id);
  await commitDeletes(db, threadDocs.map((d) => d.ref));

  // Equality-only (`outlet_id ==`, `device_id ==`) needs no composite index;
  // the `window_start_ms` range is filtered in memory instead.
  const questionSnap = await db
    .collection(COLLECTIONS.questions)
    .where("outlet_id", "==", FIXTURE_OUTLET_ID)
    .where("device_id", "==", FIXTURE_DEVICE_ID)
    .get();
  const questionDocs = questionSnap.docs.filter((d) => {
    const windowStart = d.data().window_start_ms;
    return typeof windowStart === "number" && windowStart >= dayStartMs && windowStart < dayEndMs;
  });
  await commitDeletes(db, questionDocs.map((d) => d.ref));

  const correctionSnap = await db
    .collection(COLLECTIONS.corrections)
    .where("outlet_id", "==", FIXTURE_OUTLET_ID)
    .where("answered_device_id", "==", FIXTURE_DEVICE_ID)
    .where("debrief_business_date", "==", date)
    .get();
  await commitDeletes(db, correctionSnap.docs.map((d) => d.ref));

  const sessionRef = db.collection(COLLECTIONS.captureSessions).doc(fixtureSessionDocId(date));
  const sessionSnap = await sessionRef.get();
  if (sessionSnap.exists) await sessionRef.delete();

  // Task 10's QA writes audit_log entries against fixture thread ids; clean those up too.
  for (let i = 0; i < threadIds.length; i += IN_QUERY_CHUNK) {
    const chunk = threadIds.slice(i, i + IN_QUERY_CHUNK);
    if (chunk.length === 0) continue;
    const auditSnap = await db
      .collection(COLLECTIONS.auditLog)
      .where("outlet_id", "==", FIXTURE_OUTLET_ID)
      .where("target_type", "==", "thread")
      .where("target_id", "in", chunk)
      .get();
    await commitDeletes(db, auditSnap.docs.map((d) => d.ref));
  }

  console.log(
    `[seed-day-fixture] deleted date=${date}: ${threadIds.length} threads, ${questionDocs.length} questions, ` +
      `${correctionSnap.size} corrections, session=${sessionSnap.exists ? 1 : 0}`,
  );
}

async function readDemoOutletProjectKind(db: Firestore): Promise<"pilot" | "demo" | null> {
  const doc = await db.collection(COLLECTIONS.outlets).doc(FIXTURE_OUTLET_ID).get();
  if (!doc.exists) return null;
  try {
    return parseOutletDoc(doc.data()).project_kind;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseFixtureArgs(process.argv.slice(2));
  const db = adminDb();

  const outletProjectKind = await readDemoOutletProjectKind(db);
  const todayBusinessDate = businessDateOf(Date.now(), FIXTURE_TZ);
  assertFixtureAllowed({
    outletProjectKind,
    demoModeEnv: process.env.DEMO_MODE,
    date: args.date,
    todayBusinessDate,
    assertProjectMatchesEnv,
  });

  if (args.delete) {
    await deleteFixture(db, args.date);
    return;
  }

  const build = buildDayFixture({
    outlet_id: FIXTURE_OUTLET_ID,
    date: args.date,
    tz: FIXTURE_TZ,
    threads: args.threads,
  });
  await writeFixture(db, build);
  console.log(
    `[seed-day-fixture] wrote date=${args.date} outlet=${FIXTURE_OUTLET_ID} threads=${build.threads.length} ` +
      `questions=${build.questions.length} corrections=${build.corrections.length}`,
  );
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error("[seed-day-fixture] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
