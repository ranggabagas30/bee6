import { businessDateOf } from "@/lib/capture/calendar";
import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/http/errors";
import { maskDigitRuns } from "@/lib/constraints/normalize";
import { stripLeadingRoleTag } from "@/lib/proposals/text";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import type { AttributionSession } from "@/lib/day/attribution";
import type { WorkCategory } from "@/lib/pipeline/categories";
import {
  ProposalSchema,
  type AuditLog,
  type Constraint,
  type Outlet,
  type Proposal,
  type ProposalRule,
  type SopVersion,
} from "@/lib/firestore/schema";
import { LibraryNotReadyError, type ProposalLibrary } from "@/config/proposal-library";
import { PROPOSAL_AGENT_VERSION, PROPOSAL_MODEL, type ProposalModel } from "@/lib/agents/proposal-agent";
import { PROPOSAL_AGENT_V4_VERSION, type ProposalAgentV4 } from "@/lib/agents/proposal-agent-v4";
import {
  FLOOR_VERSION,
  MAX_FOCUS_PER_ASK,
  MODEL_TIMEOUT_MS,
  PROPOSAL_CHECK_VERSION,
  PROPOSAL_GATE_VERSION,
  PROPOSAL_LEASE_MS,
  V4_ASK_BUDGET_MS,
  V4_TIMEOUT_MS,
} from "@/lib/proposals/constants";
import { evidenceReadWindow, validateRange } from "@/lib/proposals/range";
import { aliasCandidates, selectCandidates, type Candidate, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { checkEvidenceFloor, evidenceByCategory, followupFor, type CategoryEvidence } from "@/lib/proposals/precheck";
import { reviewDate } from "@/lib/proposals/baseline";
import { countWindow } from "@/lib/reviews/metric";
import { checkProposal, type ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { buildProposalWireSchema, generateProposalJsonSchema, type ProposalWire, type WireContext } from "@/lib/proposals/wire-schema";
import { buildProposalPrompt } from "@/lib/proposals/prompt";
import { toProposalView } from "@/lib/proposals/view";
import { GenerateResponseSchema, type ProposalView } from "@/lib/proposals/contract";
import { isFreshFact, type FreshThread } from "@/lib/proposals/freshness";
import { buildProposalDraftV4Schema, draftToWire, type V4WireContext } from "@/lib/proposals/v4/draft-schema";
import { buildV4Tools } from "@/lib/proposals/v4/tools";
import { buildProposalPromptV4 } from "@/lib/proposals/v4/prompt";
import type { V4Rule, V4Session, V4Trace } from "@/lib/proposals/v4/types";
import { deriveSections } from "@/lib/sop/sections";
import { z } from "zod";

/**
 * The proposal generation state machine (R-08 Task 5.4; architecture §1).
 * One service function, `generateProposal`, holds every step; the route
 * (Task 6) is a thin caller. Pure logic (range/candidates/precheck/gate/
 * baseline/prompt/wire-schema) is imported and unit-tested separately; the
 * store is a thin Firestore adapter (Task 5.3, injected); the model is an
 * injected function (Task 4.4).
 */

/** The fields `commit`'s re-read needs to decide whether a cited ref is still a fact at write time. */
export type { FreshThread } from "@/lib/proposals/freshness";

export interface ProposalStore {
  getOutlet(): Promise<Outlet | null>;
  /** `capture_sessions` with `local_date` in `dates` (<= 16 values). Malformed skipped. */
  listSessions(dates: readonly string[]): Promise<AttributionSession[]>;
  /** Threads with `first_line_start_ms` in `[fromMs, toMs)`, ascending, at most `MAX_THREADS_READ + 1`, field-masked. */
  listThreadsInRange(fromMs: number, toMs: number): Promise<ProposalThreadRow[]>;
  /** The highest-version `sop_versions` doc of this outlet. null if none. */
  getCurrentSop(): Promise<SopVersion | null>;
  /** All constraints of the outlet, oldest first, at most MAX_CONSTRAINTS. */
  listConstraints(): Promise<Constraint[]>;
  /** A proposal of this outlet with this exact range and status awaiting_supervisor | awaiting_owner, newest. */
  findOpenProposalForRange(from: string, to: string): Promise<Proposal | null>;
  /** R-19 §3.3: every awaiting_supervisor | awaiting_owner proposal of this outlet, any range, at most 50, malformed skipped. */
  listOpenProposals(): Promise<Proposal[]>;
  /** By thread id, outlet-checked, for the result card's live evidence summaries. */
  getThreads(
    ids: readonly string[],
  ): Promise<Map<string, Pick<ProposalThreadRow, "status" | "excluded_from_evidence" | "label_source" | "summary" | "first_line_start_ms">>>;
  /** R-20: `corrections/{threadQuestionId(thread_id)}` with answer "yes", outlet-checked -> reason_text. Missing, TTL-deleted, "no" or malformed -> absent. */
  listStaffReasons(threadIds: readonly string[]): Promise<Map<string, string>>;
  listStaffScrubNames(): Promise<string[]>;
  /** Transaction on `proposal_locks/{outlet}`: missing/malformed/expired -> write a new lease, return its token; live -> null. */
  acquireLock(nowMs: number, leaseMs: number): Promise<string | null>;
  /** Deletes the lock only if its lease_token === token. Never throws (logs error_class). */
  releaseLock(token: string): Promise<void>;
  /** Transaction: re-reads the given thread ids, calls `build(fresh)` once, writes the returned proposal + audit entry. */
  commit(
    threadIds: readonly string[],
    build: (fresh: Map<string, FreshThread>) => { proposal: Proposal; audit: AuditLog },
  ): Promise<Proposal>;
}

export interface ProposalDeps {
  model: ProposalModel;
  generatorKind: "adk" | "direct";
  /** Throws `LibraryNotReadyError`. */
  loadLibrary: () => ProposalLibrary;
  redact: (texts: readonly string[]) => Promise<string[]>;
  project: string;
  resolveLocation: (model: string) => string;
  /** `crypto.randomUUID`. */
  newId: () => string;
  /**
   * R-24: the tool-using Proposal agent. Absent or `null` (the `PROPOSAL_AGENT_V4` flag is off) = today's path,
   * byte for byte: nothing from `lib/proposals/v4/*` runs. When set, a focus tries it first and falls back to the
   * v3 path for ONE attempt on any error, timeout or no decision.
   */
  agentV4?: ProposalAgentV4 | null;
  /** R-24: wall clock in ms for the per-Ask v4 budget rule (§3.1). Tests inject one; default `Date.now`. */
  clockMs?: () => number;
}

/** Room one v3 fallback needs after a v4 run starts: one model call raced at `MODEL_TIMEOUT_MS` + the 5 s backstop (§3.1). */
const V3_FALLBACK_RESERVE_MS = MODEL_TIMEOUT_MS + 5_000;

/** `generator.v4` as stored: the runner's trace plus whether the v3 path had to finish the focus. */
type StoredV4Trace = V4Trace & { fell_back: boolean };

/** Which agent produced a focus outcome (D10) and, when v4 ran, its trace. */
interface RunInfo {
  agent: "v3" | "v4";
  v4?: StoredV4Trace;
}
const V3_RUN: RunInfo = { agent: "v3" };

const STORED_TEXT_MAX: Record<string, number> = {
  change_title: 160,
  change_text: 800,
  rationale: 800,
  metric_description: 320,
  failure_condition: 480,
};

function buildAudit(
  outletId: string,
  nowMs: number,
  actorRole: "owner" | "supervisor",
  proposalId: string,
  details: Record<string, unknown>,
): AuditLog {
  return {
    outlet_id: outletId,
    ts: new Date(nowMs).toISOString(),
    actor_role: actorRole,
    action: "proposal.generated",
    target_type: "proposal",
    target_id: proposalId,
    details,
  };
}

/** `attempts`-summed usage: a per-attempt `null` is treated as 0 for the sum, but the whole field stays `null` if every attempt reported `null`. */
function sumUsage(values: Array<number | null>): number | null {
  if (values.every((v) => v === null)) return null;
  return values.reduce((sum: number, v) => sum + (v ?? 0), 0);
}

/**
 * Public entry point. Wraps `generateProposalCore` so a `z.ZodError` thrown
 * while parsing the service's OWN constructed objects (`ProposalSchema`,
 * `ProposalViewSchema`, `GenerateResponseSchema` — never request input,
 * which the route validates separately) never surfaces as the generic
 * `handleApiError` 422 branch: that branch exists for request-shaped
 * validation failures, not for a bug in what this service built. Converting
 * it to a plain `Error` with a fixed message (no `cause`, so the generic
 * handler's `console.error("Unexpected API error:", error)` never prints a
 * prompt/response-derived zod issue path) makes it fall through to the
 * generic 500 branch instead (plan §5.5).
 */
export async function generateProposal(
  store: ProposalStore,
  deps: ProposalDeps,
  input: { claims: CustomClaims; from_date: string; to_date: string; now_ms: number; another?: boolean },
): Promise<{ proposal: ProposalView; reused: boolean }> {
  try {
    const result = await generateProposalCore(store, deps, input);
    return GenerateResponseSchema.parse(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error("generateProposal: internal schema violation");
    }
    throw error;
  }
}

async function generateProposalCore(
  store: ProposalStore,
  deps: ProposalDeps,
  input: { claims: CustomClaims; from_date: string; to_date: string; now_ms: number; another?: boolean },
): Promise<{ proposal: ProposalView; reused: boolean }> {
  // Step 1: permission + role.
  assertPermission(input.claims, "proposals:generate");
  const role = input.claims.role;
  if (role !== "owner" && role !== "supervisor") {
    throw new ForbiddenError(`Role "${role}" may not perform "proposals:generate".`);
  }
  const requestedByRole = role;

  // Step 2: outlet.
  const outlet = await store.getOutlet();
  if (!outlet) throw new NotFoundError("outlet", "outlet");
  assertOutlet(input.claims, outlet.outlet_id);
  const tz = outlet.timezone;
  const today = businessDateOf(input.now_ms, tz);
  const retention = outlet.retention_days ?? 14;

  // Step 3: range.
  const range = { from_date: input.from_date, to_date: input.to_date };
  const rangeResult = validateRange(range, today, retention);
  if (!rangeResult.ok) {
    throw new ValidationError("invalid_range", [{ field: "range", message: rangeResult.code }]);
  }

  // Step 4: library.
  let library: ProposalLibrary;
  try {
    library = deps.loadLibrary();
  } catch (error) {
    if (error instanceof LibraryNotReadyError) {
      throw new ConflictError("Library not ready", "LIBRARY_NOT_READY");
    }
    throw error;
  }

  // Step 5: SOP.
  const sop = await store.getCurrentSop();
  if (!sop) throw new ConflictError("No SOP", "NO_SOP");

  // Step 6: reuse check. Skipped on "Generate another" (R-19 §3.3): the caller wants a second proposal about
  // another problem in the same range, not the open one back.
  const another = input.another === true;
  const open = another ? null : await store.findOpenProposalForRange(range.from_date, range.to_date);
  let constraints: Constraint[] | null = null;
  if (open) {
    constraints = await store.listConstraints();
    const acknowledged = new Set(open.content?.constraint_ids_acknowledged ?? []);
    const reusable = constraints.every((c) => acknowledged.has(c.constraint_id));
    if (reusable) {
      const citedIds = (open.content?.evidence ?? []).map((e) => e.thread_id);
      const threads = await store.getThreads(citedIds);
      const summaries = new Map<string, string | null>();
      for (const id of citedIds) {
        const thread = threads.get(id);
        summaries.set(id, thread ? thread.summary : null);
      }
      return { proposal: toProposalView(open, summaries, library, sop, tz), reused: true };
    }
    // Not reusable: a newer constraint exists. Fall through to a fresh
    // generation; the old proposal is left exactly as it is.
  }

  // Step 7: lease.
  const token = await store.acquireLock(input.now_ms, PROPOSAL_LEASE_MS);
  if (!token) throw new ConflictError("Generation in progress", "GENERATION_IN_PROGRESS");
  const clock = deps.clockMs ?? Date.now;
  const askStartMs = clock(); // R-24 §3.1: the v4 budget is measured from the lease, not from the request body's now_ms

  try {
    // 8a. candidates (the read window is shared with the watch panel and the template check).
    const window = evidenceReadWindow(range, tz);
    const [sessions, rows] = await Promise.all([
      store.listSessions(window.dates),
      store.listThreadsInRange(window.fromMs, window.toMs),
    ]);
    const all = selectCandidates(rows, sessions, tz, range);

    // 8a'. R-19 §3.3: threads already cited by an open proposal are not offered again, and a category that an open
    // proposal is already about is not proposed twice. The focus is the first READY category not yet taken.
    // An open proposal found at step 6 but not reusable (a newer constraint) is being replaced by this run, so it
    // must not block its own replacement (its threads stay citable, its category free). Never excluded on "another".
    const openProposals = (await store.listOpenProposals()).filter((p) => p.proposal_id !== open?.proposal_id);
    const cited = new Set(openProposals.flatMap((p) => (p.content?.evidence ?? []).map((e) => e.thread_id)));
    const taken = new Set(openProposals.map((p) => p.focus_category).filter((c): c is WorkCategory => !!c));
    const pool = all.filter((c) => !cited.has(c.thread_id));
    // R-20: every READY, not-taken category in floor order. The Ask tries at most MAX_FOCUS_PER_ASK of them: a decline
    // moves on to the next one, a proposal or a gate block stops the loop.
    const readyRows = evidenceByCategory(pool).filter((r) => r.ready && !taken.has(r.category));

    // 8b. evidence floor (hard rule #10: plain code decides sufficiency; the model is never called for this).
    const location = deps.resolveLocation(PROPOSAL_MODEL);
    // R-24 D10: `agent_version` records what actually produced the doc. A v3 doc (the default, and every flag-off doc)
    // carries exactly today's fields; only a v4 doc adds `check_version`, and only a doc whose focus ran v4 adds `v4`.
    const generatorOf = (attempts: number, run: RunInfo = V3_RUN) => ({
      kind: deps.generatorKind,
      model: PROPOSAL_MODEL,
      location,
      agent_version: run.agent === "v4" ? PROPOSAL_AGENT_V4_VERSION : PROPOSAL_AGENT_VERSION,
      gate_version: PROPOSAL_GATE_VERSION,
      library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
      sop_version_id: sop.sop_version_id,
      attempts,
      floor_version: FLOOR_VERSION,
      ...(run.agent === "v4" ? { check_version: PROPOSAL_CHECK_VERSION } : {}),
      ...(run.v4 ? { v4: run.v4 } : {}),
    });
    if (readyRows.length === 0) {
      // `floor` = the pool's first row: the closest problem, which the result card shows ("1 of 2 days").
      const floor = checkEvidenceFloor(pool);
      const proposalId = deps.newId();
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "suppressed",
        requested_by_role: requestedByRole,
        range,
        focus_category: null,
        generator: generatorOf(0),
        gate: { passed: false, fired_rule: null, checks: [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: (constraints ?? []).length },
        suppression: { reason: "insufficient_evidence", model_reason: null, followup: followupFor(pool) },
        content: null,
        created_at_ms: input.now_ms,
        updated_at_ms: input.now_ms,
      });
      const audit = buildAudit(outlet.outlet_id, input.now_ms, requestedByRole, proposalId, {
        status: "suppressed",
        fired_rule: null,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
        attempts: 0,
      });
      const stored = await store.commit([], () => ({ proposal, audit }));
      console.info("[proposal] generated", {
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "suppressed",
        fired_rule: null,
        generator: deps.generatorKind,
        model: PROPOSAL_MODEL,
        location: stored.generator.location,
        attempts: 0,
        input_tokens: null,
        output_tokens: null,
        thoughts_tokens: null,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
      });
      const summaries = new Map<string, string | null>();
      return { proposal: toProposalView(stored, summaries, library, sop, tz), reused: false };
    }

    // 8c. shared inputs. Staff names are read here (not after the model call) so every quote and note offered to the
    // model is re-scrubbed at prompt time (hard rule #7), covering a staff member added after the thread was labelled.
    const constraintList: Constraint[] = constraints ?? (await store.listConstraints());
    const constraintAliased = constraintList.map((c, i) => ({ alias: `C${i + 1}`, c }));
    const staffNames = await store.listStaffScrubNames();

    const inputTokens: Array<number | null> = [];
    const outputTokens: Array<number | null> = [];
    const thoughtsTokens: Array<number | null> = [];

    // R-24: a v4 check lists the eight `pgate-v1` rules and the ten v4 rules; `ProposalRule` itself is not widened.
    type GateChecks = { rule: ProposalRule | V4Rule; passed: boolean }[];
    type FocusDecision =
      | { kind: "proposed"; wire: ProposalWire; passedGateChecks: GateChecks; aliasToCandidate: Map<string, Candidate>; attempts: number }
      | { kind: "declined"; reason: ProposalWire["no_proposal_reason"]; attempts: number }
      | { kind: "blocked"; rule: string; checks: GateChecks; attempts: number };
    /** A focus decision plus which agent produced it (R-24 D10) and, when v4 ran, its trace. */
    type FocusOutcome = FocusDecision & RunInfo;

    /** One focus category: prompt + wire schema, then the attempt loop (at most 2). Model errors twice -> throws 503. */
    const tryFocus = async (focus: CategoryEvidence): Promise<FocusOutcome> => {
      const focused = pool.filter((c) => c.category === focus.category);
      const aliased = aliasCandidates(focused);
      const aliasToCandidate = new Map(aliased.map(({ alias, c }) => [alias, c]));

      // R-20: the staff's confirmed debrief notes for exactly the facts offered. An enrichment: if the read fails the
      // Ask still runs without notes (log by class); it never fails open on redaction (the scrub below is mandatory).
      let reasons = new Map<string, string>();
      try {
        reasons = await store.listStaffReasons(aliased.map(({ c }) => c.thread_id));
      } catch (err) {
        console.error("[proposal] staff reasons unavailable", {
          outlet_id: outlet.outlet_id,
          error_class: err instanceof Error ? err.constructor.name : "unknown",
        });
      }
      const scrubbedAliased = aliased.map(({ alias, c }) => ({
        alias,
        c: { ...c, excerpt: scrubStaffNames(c.excerpt, staffNames) },
      }));
      const scrubbedReasons = new Map([...reasons].map(([id, text]) => [id, scrubStaffNames(text, staffNames)]));

      const wireCtx: WireContext = {
        interventionIds: library.interventions.entries.map((e) => e.id),
        rubricIds: library.rubric.entries.map((e) => e.id),
        evidenceAliases: aliased.map((a) => a.alias),
        stepIds: sop.steps.map((s) => s.step_id),
        constraintAliases: constraintAliased.map((c) => c.alias),
      };
      const wireSchema = buildProposalWireSchema(wireCtx);
      const jsonSchema = generateProposalJsonSchema(wireCtx);
      const basePrompt = buildProposalPrompt({
        library,
        sop,
        aliased: scrubbedAliased,
        reasons: scrubbedReasons,
        constraints: constraintAliased.map(({ alias, c }) => ({ alias, text: c.text })),
        range,
      });
      const gateCtx: ProposalGateContext = {
        aliasToCandidate,
        interventionIds: new Set(wireCtx.interventionIds),
        rubricIds: new Set(wireCtx.rubricIds),
        stepIds: new Set(wireCtx.stepIds),
        constraintAliases: wireCtx.constraintAliases,
      };

      /**
       * Today's path, unchanged: the v3 attempt loop (`maxAttempts` = 2). On the v4 fallback it runs ONCE (R-24 D6/D7),
       * so the focus ends on that attempt exactly as attempt 2 ends it today (error -> 503, anything else -> blocked).
       */
      const runV3 = async (maxAttempts: number): Promise<FocusDecision> => {
        let lastFailureCode = "invalid_output";
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const userContent =
            attempt === 1
              ? basePrompt.userContent
              : `${basePrompt.userContent}\nPREVIOUS ANSWER REJECTED: ${lastFailureCode}. Fix it or answer no_proposal.`;

          const res = await deps.model(
            { systemInstruction: basePrompt.systemInstruction, userContent, responseJsonSchema: jsonSchema },
            { project: deps.project, location, timeoutMs: MODEL_TIMEOUT_MS },
          );

          if (res.kind === "error") {
            console.error("[proposal] model error", {
              outlet_id: outlet.outlet_id,
              error_class: res.error_class,
              attempt,
            });
            if (attempt === maxAttempts) {
              throw new ServiceUnavailableError("Proposal model unavailable");
            }
            lastFailureCode = "invalid_output";
            continue;
          }

          inputTokens.push(res.usage.input_tokens);
          outputTokens.push(res.usage.output_tokens);
          thoughtsTokens.push(res.usage.thoughts_tokens);

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(res.text);
          } catch {
            if (attempt === maxAttempts) return { kind: "blocked", rule: "schema_invalid", checks: [], attempts: attempt };
            lastFailureCode = "invalid_output";
            continue;
          }
          const parsed = wireSchema.safeParse(parsedJson);
          if (!parsed.success) {
            if (attempt === maxAttempts) return { kind: "blocked", rule: "schema_invalid", checks: [], attempts: attempt };
            lastFailureCode = "invalid_output";
            continue;
          }

          if (parsed.data.decision === "no_proposal") {
            return { kind: "declined", reason: parsed.data.no_proposal_reason, attempts: attempt };
          }

          const gateResult = checkProposal(parsed.data, gateCtx);
          if (!gateResult.passed) {
            if (attempt === maxAttempts) {
              // `rule` is the gate's own fired rule (never schema_invalid here).
              return { kind: "blocked", rule: gateResult.fired_rule ?? "invalid_output", checks: gateResult.checks, attempts: attempt };
            }
            lastFailureCode = gateResult.fired_rule ?? "invalid_output";
            continue;
          }

          return { kind: "proposed", wire: parsed.data, passedGateChecks: gateResult.checks, aliasToCandidate, attempts: attempt };
        }
        // Unreachable: the last attempt always returns or throws above.
        throw new Error("generateProposal: attempt loop ended with no decision");
      };

      // R-24: flag off (`deps.agentV4` null/absent) -> exactly today's two-attempt v3 path, nothing from v4 touched.
      const agentV4 = deps.agentV4;
      if (!agentV4) return { ...(await runV3(2)), ...V3_RUN };

      // Flag on, but this focus cannot afford a v4 run plus a v3 fallback inside the lease (§3.1): v3, ONE attempt.
      if (clock() - askStartMs + V4_TIMEOUT_MS + V3_FALLBACK_RESERVE_MS > V4_ASK_BUDGET_MS) {
        return { ...(await runV3(1)), ...V3_RUN };
      }

      // Flag on: build this focus's tools and prompt. Anything that cannot be built is a v4 failure, not a 500 (D6).
      const session: V4Session = {
        fetchedSections: new Set(),
        inspectedAliases: new Set(),
        inspectedInterventions: new Set(),
        checkRounds: 0,
        toolCalls: [],
        outcome: null,
      };
      let v4Input: Parameters<ProposalAgentV4>[0];
      try {
        const sections = deriveSections(sop.steps);
        const draftSchema = buildProposalDraftV4Schema({ ...wireCtx, sectionIds: sections.map((x) => x.section_id) } satisfies V4WireContext);
        const rowsByThread = new Map(rows.map((r) => [r.thread_id, { confidence: r.confidence, gate: r.gate, label_source: r.label_source }]));
        const tools = buildV4Tools(
          {
            sections,
            sop,
            aliased: scrubbedAliased,
            reasons: scrubbedReasons,
            rows: rowsByThread,
            library,
            constraintAliases: wireCtx.constraintAliases,
            draftSchema,
            gateCtx,
          },
          session,
        );
        const promptV4 = buildProposalPromptV4({
          library,
          aliased: scrubbedAliased,
          constraints: constraintAliased.map(({ alias, c }) => ({ alias, text: c.text })),
          range,
        });
        v4Input = { systemInstruction: promptV4.systemInstruction, userContent: promptV4.userContent, tools, session };
      } catch (err) {
        console.error("[proposal] v4 setup error", {
          outlet_id: outlet.outlet_id,
          error_class: err instanceof Error ? err.constructor.name : "unknown",
        });
        return { ...(await runV3(1)), ...V3_RUN };
      }

      const v4StartedAt = clock();
      let r: Awaited<ReturnType<ProposalAgentV4>>;
      try {
        r = await agentV4(v4Input, { project: deps.project, location, timeoutMs: V4_TIMEOUT_MS });
      } catch (err) {
        // The runner's contract is "never throws"; a thrown error is still only a v4 failure.
        r = {
          kind: "error",
          error_class: err instanceof Error ? err.constructor.name : "unknown",
          usage: { input_tokens: null, output_tokens: null, thoughts_tokens: null },
          trace: {
            model_calls: 0,
            tool_calls: session.toolCalls.slice(0, 40),
            check_rounds: Math.min(3, session.checkRounds),
            ms: Math.max(0, clock() - v4StartedAt),
            ended_by: "error",
          },
        };
      }
      // A failed run still spent tokens (CLAUDE.md §7): its usage counts like a successful one's.
      inputTokens.push(r.usage.input_tokens);
      outputTokens.push(r.usage.output_tokens);
      thoughtsTokens.push(r.usage.thoughts_tokens);

      const trace = (fellBack: boolean): StoredV4Trace => ({
        model_calls: r.trace.model_calls,
        tool_calls: r.trace.tool_calls.slice(0, 40),
        check_rounds: Math.min(3, r.trace.check_rounds),
        ms: Math.max(0, Math.round(r.trace.ms)),
        ended_by: r.trace.ended_by,
        fell_back: fellBack,
      });

      if (r.kind === "decided") {
        const out = r.outcome;
        const run: RunInfo = { agent: "v4", v4: trace(false) };
        if (out.kind === "accepted") {
          return {
            kind: "proposed",
            wire: draftToWire(out.draft),
            passedGateChecks: out.checks,
            aliasToCandidate,
            attempts: 1,
            ...run,
          };
        }
        if (out.kind === "declined") return { kind: "declined", reason: out.reason, attempts: 1, ...run };
        return { kind: "blocked", rule: out.rule, checks: out.checks, attempts: 1, ...run };
      }

      // v4 error, timeout, limit or no decision: log the class only (never model text), then ONE v3 attempt.
      console.error("[proposal] v4 error", {
        outlet_id: outlet.outlet_id,
        error_class: r.error_class,
        ended_by: r.trace.ended_by,
      });
      const fallback = await runV3(1);
      return { ...fallback, attempts: 1 + fallback.attempts, agent: "v3", v4: trace(true) };
    };

    // 8d. focus loop (R-20): a decline tries the next READY category; a proposal or a block stops.
    let attempts = 0;
    let focusesTried = 0;
    let focus: CategoryEvidence = readyRows[0]!;
    let wire: ProposalWire | null = null;
    let passedGateChecks: GateChecks | null = null;
    let aliasToCandidate = new Map<string, Candidate>();
    let modelDeclined: { reason: ProposalWire["no_proposal_reason"] } | null = null;
    let blockedRule: string | null = null;
    let lastGateChecks: GateChecks | null = null;
    let run: RunInfo = V3_RUN; // R-24: the agent of the focus whose outcome the doc records (the last one tried)

    for (const row of readyRows.slice(0, MAX_FOCUS_PER_ASK)) {
      const outcome = await tryFocus(row);
      attempts += outcome.attempts;
      focusesTried += 1;
      run = { agent: outcome.agent, ...(outcome.v4 ? { v4: outcome.v4 } : {}) };
      if (outcome.kind === "declined") {
        modelDeclined = { reason: outcome.reason }; // the LAST decline's reason is the one recorded
        continue;
      }
      modelDeclined = null;
      focus = row;
      if (outcome.kind === "blocked") {
        blockedRule = outcome.rule;
        lastGateChecks = outcome.checks.length > 0 ? outcome.checks : null;
      } else {
        wire = outcome.wire;
        passedGateChecks = outcome.passedGateChecks;
        aliasToCandidate = outcome.aliasToCandidate;
      }
      break;
    }

    // `floor` = the numbers written on the doc: the row of the focus that produced a proposal or a block, else the first ready row.
    const floor = { passed: true, facts: focus.facts, dates: focus.dates };

    const totalInputTokens = sumUsage(inputTokens);
    const totalOutputTokens = sumUsage(outputTokens);
    const totalThoughtsTokens = sumUsage(thoughtsTokens);

    function logGenerated(
      proposalId: string,
      status: string,
      firedRule: string | null,
      statedAttempts: number,
    ): void {
      console.info("[proposal] generated", {
        outlet_id: outlet!.outlet_id,
        proposal_id: proposalId,
        status,
        fired_rule: firedRule,
        generator: deps.generatorKind,
        model: PROPOSAL_MODEL,
        location,
        attempts: statedAttempts,
        focuses_tried: focusesTried,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        thoughts_tokens: totalThoughtsTokens,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
        // R-24 (flag on only, so a flag-off log line is exactly today's): enums and counts, never text.
        ...(deps.agentV4
          ? {
              agent_version: run.agent === "v4" ? PROPOSAL_AGENT_V4_VERSION : PROPOSAL_AGENT_VERSION,
              v4_model_calls: run.v4?.model_calls ?? null,
              v4_fell_back: run.v4?.fell_back ?? null,
            }
          : {}),
      });
    }

    if (modelDeclined) {
      const proposalId = deps.newId();
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "suppressed",
        requested_by_role: requestedByRole,
        range,
        focus_category: null,
        generator: generatorOf(attempts, run),
        gate: { passed: false, fired_rule: null, checks: [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraintList.length },
        suppression: { reason: "model_declined", model_reason: modelDeclined.reason, followup: followupFor(pool) },
        content: null,
        created_at_ms: input.now_ms,
        updated_at_ms: input.now_ms,
      });
      const audit = buildAudit(outlet.outlet_id, input.now_ms, requestedByRole, proposalId, {
        status: "suppressed",
        fired_rule: null,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
        attempts,
      });
      const stored = await store.commit([], () => ({ proposal, audit }));
      logGenerated(proposalId, "suppressed", null, attempts);
      return { proposal: toProposalView(stored, new Map(), library, sop, tz), reused: false };
    }

    if (blockedRule) {
      const proposalId = deps.newId();
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "blocked",
        requested_by_role: requestedByRole,
        range,
        focus_category: focus.category,
        generator: generatorOf(attempts, run),
        gate: { passed: false, fired_rule: blockedRule, checks: lastGateChecks ?? [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraintList.length },
        suppression: null,
        content: null,
        created_at_ms: input.now_ms,
        updated_at_ms: input.now_ms,
      });
      const audit = buildAudit(outlet.outlet_id, input.now_ms, requestedByRole, proposalId, {
        status: "blocked",
        fired_rule: blockedRule,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
        attempts,
      });
      const stored = await store.commit([], () => ({ proposal, audit }));
      logGenerated(proposalId, "blocked", blockedRule, attempts);
      return { proposal: toProposalView(stored, new Map(), library, sop, tz), reused: false };
    }

    if (!wire) {
      // Defensive: every loop exit above either sets wire, modelDeclined or
      // blockedRule, or throws. This is unreachable; thrown as a bug, never
      // silently treated as any status.
      throw new Error("generateProposal: attempt loop ended with no decision");
    }

    // 8e. redaction (staff names were read at 8c).
    const rawTexts: Record<string, string> = {
      change_title: stripLeadingRoleTag(wire.change_title),
      change_text: stripLeadingRoleTag(wire.change_text),
      rationale: wire.rationale,
      metric_description: wire.metric_description,
      failure_condition: wire.failure_condition,
    };
    const keys = Object.keys(rawTexts);
    const prepped = keys.map((k) => scrubStaffNames(maskDigitRuns(rawTexts[k]!), staffNames));
    let redacted: string[];
    try {
      redacted = await deps.redact(prepped);
    } catch (err) {
      // Classification only — never the error message, never prompt/model
      // text (hard rule #2/#3: no transcript-derived text in logs).
      const error_class = err instanceof Error ? err.constructor.name : "unknown";
      console.error("[proposal] model error", { outlet_id: outlet.outlet_id, stage: "redact", error_class });
      throw new ServiceUnavailableError("Redaction unavailable", "redact");
    }
    const redactedByKey = new Map(keys.map((k, i) => [k, redacted[i]!]));

    const tooLong = keys.some((k) => redactedByKey.get(k)!.length > STORED_TEXT_MAX[k]!);
    if (tooLong) {
      const proposalId = deps.newId();
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "blocked",
        requested_by_role: requestedByRole,
        range,
        focus_category: focus.category,
        generator: generatorOf(attempts, run),
        gate: { passed: false, fired_rule: "output_too_long", checks: [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraintList.length },
        suppression: null,
        content: null,
        created_at_ms: input.now_ms,
        updated_at_ms: input.now_ms,
      });
      const audit = buildAudit(outlet.outlet_id, input.now_ms, requestedByRole, proposalId, {
        status: "blocked",
        fired_rule: "output_too_long",
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
        attempts,
      });
      const stored = await store.commit([], () => ({ proposal, audit }));
      logGenerated(proposalId, "blocked", "output_too_long", attempts);
      return { proposal: toProposalView(stored, new Map(), library, sop, tz), reused: false };
    }

    // 8f. commit — re-read cited threads inside the transaction, drop stale ones.
    const citedAliases = [...new Set(wire.evidence)];
    const citedCandidates = citedAliases
      .map((alias) => aliasToCandidate.get(alias))
      .filter((c): c is Candidate => c !== undefined);
    const citedThreadIds = [...new Set(citedCandidates.map((c) => c.thread_id))];

    const proposalId = deps.newId();
    const stored = await store.commit(citedThreadIds, (fresh) => {
      const keptCandidates = citedCandidates.filter((c) => {
        return isFreshFact(fresh.get(c.thread_id));
      });
      const keptThreadCount = new Set(keptCandidates.map((c) => c.thread_id)).size;
      const keptDateCount = new Set(keptCandidates.map((c) => c.local_date)).size;

      if (keptThreadCount < 2 || keptDateCount < 2) {
        const proposal: Proposal = ProposalSchema.parse({
          outlet_id: outlet.outlet_id,
          proposal_id: proposalId,
          status: "blocked",
          requested_by_role: requestedByRole,
          range,
          focus_category: focus.category,
          generator: generatorOf(attempts, run),
          gate: { passed: false, fired_rule: "evidence_stale", checks: [] },
          counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraintList.length },
          suppression: null,
          content: null,
          created_at_ms: input.now_ms,
          updated_at_ms: input.now_ms,
        });
        const audit = buildAudit(outlet.outlet_id, input.now_ms, requestedByRole, proposalId, {
          status: "blocked",
          fired_rule: "evidence_stale",
          candidate_facts: floor.facts,
          candidate_dates: floor.dates,
          attempts,
        });
        return { proposal, audit };
      }

      const evidence = [...keptCandidates]
        .sort((a, b) => a.first_line_start_ms - b.first_line_start_ms)
        .map((c) => ({
          thread_id: c.thread_id,
          local_date: c.local_date,
          category: c.category,
          first_line_start_ms: c.first_line_start_ms,
        }));
      // The review's own counter (lib/reviews/metric.ts), so the baseline and the later outcome are the same measure.
      const w = countWindow({ window: range, rows, sessions, tz, category: wire!.metric_category! });
      const baseline = { baseline_count: w.count, baseline_days: Math.max(1, w.days_captured) };
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "awaiting_supervisor",
        requested_by_role: requestedByRole,
        range,
        focus_category: focus.category,
        generator: generatorOf(attempts, run),
        // Gate checks = the checkProposal() result from the attempt that
        // passed (real per-rule results, never relabelled), plus the
        // evidence_stale check this commit transaction just ran itself.
        gate: {
          passed: true,
          fired_rule: null,
          checks: [...passedGateChecks!, { rule: "evidence_stale", passed: true }],
        },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraintList.length },
        suppression: null,
        content: {
          intervention_id: wire!.intervention_id!,
          rubric_criterion_ids: [...new Set(wire!.rubric_criterion_ids)],
          target_step_id: wire!.target_step_id === "NEW" ? null : wire!.target_step_id,
          change_title: redactedByKey.get("change_title")!,
          change_text: redactedByKey.get("change_text")!,
          rationale: redactedByKey.get("rationale")!,
          metric: {
            category: wire!.metric_category!,
            direction: wire!.metric_direction!,
            description: redactedByKey.get("metric_description")!,
            baseline_count: baseline.baseline_count,
            baseline_days: baseline.baseline_days,
          },
          failure_condition: redactedByKey.get("failure_condition")!,
          review_after_days: wire!.review_after_days!,
          review_date: reviewDate(today, wire!.review_after_days!),
          evidence,
          constraint_ids_acknowledged: constraintList.map((c) => c.constraint_id),
          censored_floor: true,
        },
        created_at_ms: input.now_ms,
        updated_at_ms: input.now_ms,
      });
      const audit = buildAudit(outlet.outlet_id, input.now_ms, requestedByRole, proposalId, {
        status: "awaiting_supervisor",
        fired_rule: null,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
        attempts,
      });
      return { proposal, audit };
    });

    logGenerated(proposalId, stored.status, stored.gate.fired_rule, attempts);

    const summariesByThreadId = new Map<string, string | null>();
    for (const c of citedCandidates) summariesByThreadId.set(c.thread_id, c.summary);

    return { proposal: toProposalView(stored, summariesByThreadId, library, sop, tz), reused: false };
  } finally {
    await store.releaseLock(token);
  }
}
