import { addDays, businessDateOf, zonedTimeToEpochMs } from "@/lib/capture/calendar";
import { assertOutlet, assertPermission } from "@/lib/auth/rbac";
import type { CustomClaims } from "@/lib/auth/roles";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "@/lib/http/errors";
import { scrubStaffNames } from "@/lib/pipeline/label/scrub";
import type { AttributionSession } from "@/lib/day/attribution";
import {
  ProposalSchema,
  type AuditLog,
  type Constraint,
  type Outlet,
  type Proposal,
  type SopVersion,
} from "@/lib/firestore/schema";
import { LibraryNotReadyError, type ProposalLibrary } from "@/config/proposal-library";
import { PROPOSAL_AGENT_VERSION, PROPOSAL_MODEL, type ProposalModel } from "@/lib/agents/proposal-agent";
import { MODEL_TIMEOUT_MS, PROPOSAL_GATE_VERSION, PROPOSAL_LEASE_MS } from "@/lib/proposals/constants";
import { validateRange } from "@/lib/proposals/range";
import { aliasCandidates, selectCandidates, type Candidate, type ProposalThreadRow } from "@/lib/proposals/candidates";
import { checkEvidenceFloor, followupFor } from "@/lib/proposals/precheck";
import { metricBaseline, reviewDate } from "@/lib/proposals/baseline";
import { checkProposal, type ProposalGateContext } from "@/lib/proposals/proposal-gate";
import { buildProposalWireSchema, generateProposalJsonSchema, type ProposalWire, type WireContext } from "@/lib/proposals/wire-schema";
import { buildProposalPrompt } from "@/lib/proposals/prompt";
import { toProposalView } from "@/lib/proposals/view";
import { GenerateResponseSchema, type ProposalView } from "@/lib/proposals/contract";
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
export interface FreshThread {
  status: "fact" | "open" | "unverified";
  excluded_from_evidence?: boolean;
  label_source?: string;
}

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
  /** By thread id, outlet-checked, for the result card's live evidence summaries. */
  getThreads(
    ids: readonly string[],
  ): Promise<Map<string, Pick<ProposalThreadRow, "status" | "excluded_from_evidence" | "label_source" | "summary" | "first_line_start_ms">>>;
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
}

const DIGIT_RUN = /\d{6,}/g;
const STORED_TEXT_MAX: Record<string, number> = {
  change_title: 160,
  change_text: 800,
  rationale: 800,
  metric_description: 320,
  failure_condition: 480,
};

function maskDigits(text: string): string {
  return text.replace(DIGIT_RUN, "[NUMBER]");
}

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
  input: { claims: CustomClaims; from_date: string; to_date: string; now_ms: number },
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
  input: { claims: CustomClaims; from_date: string; to_date: string; now_ms: number },
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

  // Step 6: reuse check.
  const open = await store.findOpenProposalForRange(range.from_date, range.to_date);
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

  try {
    // 8a. candidates.
    const dates: string[] = [];
    for (let d = addDays(range.from_date, -1); d <= addDays(range.to_date, 1); d = addDays(d, 1)) {
      dates.push(d);
    }
    const fromMs = zonedTimeToEpochMs(range.from_date, "01:00", tz);
    const toMs = zonedTimeToEpochMs(addDays(range.to_date, 1), "03:00", tz);
    const [sessions, rows] = await Promise.all([
      store.listSessions(dates),
      store.listThreadsInRange(fromMs, toMs),
    ]);
    const all = selectCandidates(rows, sessions, tz, range);

    // 8b. evidence floor (hard rule #10: plain code decides sufficiency; the model is never called for this).
    const floor = checkEvidenceFloor(all);
    if (!floor.passed) {
      const proposalId = deps.newId();
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "suppressed",
        requested_by_role: requestedByRole,
        range,
        generator: {
          kind: deps.generatorKind,
          model: PROPOSAL_MODEL,
          location: deps.resolveLocation(PROPOSAL_MODEL),
          agent_version: PROPOSAL_AGENT_VERSION,
          gate_version: PROPOSAL_GATE_VERSION,
          library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
          sop_version_id: sop.sop_version_id,
          attempts: 0,
        },
        gate: { passed: false, fired_rule: null, checks: [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: (constraints ?? []).length },
        suppression: { reason: "insufficient_evidence", model_reason: null, followup: followupFor(all) },
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

    // 8c. prompt + schema.
    if (constraints === null) constraints = await store.listConstraints();
    const constraintAliased = constraints.map((c, i) => ({ alias: `C${i + 1}`, c }));
    const aliased = aliasCandidates(all);
    const aliasToCandidate = new Map(aliased.map(({ alias, c }) => [alias, c]));

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
      aliased,
      constraints: constraintAliased.map(({ alias, c }) => ({ alias, text: c.text })),
      range,
    });
    const location = deps.resolveLocation(PROPOSAL_MODEL);

    const gateCtx: ProposalGateContext = {
      aliasToCandidate,
      interventionIds: new Set(wireCtx.interventionIds),
      rubricIds: new Set(wireCtx.rubricIds),
      stepIds: new Set(wireCtx.stepIds),
      constraintAliases: wireCtx.constraintAliases,
    };

    // 8d. attempt loop (at most 2).
    const inputTokens: Array<number | null> = [];
    const outputTokens: Array<number | null> = [];
    const thoughtsTokens: Array<number | null> = [];

    let wire: ProposalWire | null = null;
    let passedGateChecks: ReturnType<typeof checkProposal>["checks"] | null = null;
    let lastFailureCode = "invalid_output";
    let attempts = 0;
    let modelDeclined: { reason: ProposalWire["no_proposal_reason"] } | null = null;
    let blockedRule: string | null = null;
    /** Only set when `blockedRule` came from the gate itself (never schema_invalid). */
    let lastGateChecks: ReturnType<typeof checkProposal>["checks"] | null = null;

    for (attempts = 1; attempts <= 2; attempts++) {
      const userContent =
        attempts === 1
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
          attempt: attempts,
        });
        if (attempts === 2) {
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
        if (attempts === 2) {
          blockedRule = "schema_invalid";
          break;
        }
        lastFailureCode = "invalid_output";
        continue;
      }
      const parsed = wireSchema.safeParse(parsedJson);
      if (!parsed.success) {
        if (attempts === 2) {
          blockedRule = "schema_invalid";
          break;
        }
        lastFailureCode = "invalid_output";
        continue;
      }

      if (parsed.data.decision === "no_proposal") {
        modelDeclined = { reason: parsed.data.no_proposal_reason };
        break;
      }

      const gateResult = checkProposal(parsed.data, gateCtx);
      if (!gateResult.passed) {
        if (attempts === 2) {
          blockedRule = gateResult.fired_rule;
          lastGateChecks = gateResult.checks;
          break;
        }
        lastFailureCode = gateResult.fired_rule ?? "invalid_output";
        continue;
      }

      wire = parsed.data;
      passedGateChecks = gateResult.checks;
      break;
    }

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
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        thoughts_tokens: totalThoughtsTokens,
        candidate_facts: floor.facts,
        candidate_dates: floor.dates,
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
        generator: {
          kind: deps.generatorKind,
          model: PROPOSAL_MODEL,
          location,
          agent_version: PROPOSAL_AGENT_VERSION,
          gate_version: PROPOSAL_GATE_VERSION,
          library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
          sop_version_id: sop.sop_version_id,
          attempts,
        },
        gate: { passed: false, fired_rule: null, checks: [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraints.length },
        suppression: { reason: "model_declined", model_reason: modelDeclined.reason, followup: followupFor(all) },
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
        generator: {
          kind: deps.generatorKind,
          model: PROPOSAL_MODEL,
          location,
          agent_version: PROPOSAL_AGENT_VERSION,
          gate_version: PROPOSAL_GATE_VERSION,
          library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
          sop_version_id: sop.sop_version_id,
          attempts,
        },
        gate: { passed: false, fired_rule: blockedRule, checks: lastGateChecks ?? [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraints.length },
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

    // 8e. redaction.
    const staffNames = await store.listStaffScrubNames();
    const rawTexts: Record<string, string> = {
      change_title: wire.change_title,
      change_text: wire.change_text,
      rationale: wire.rationale,
      metric_description: wire.metric_description,
      failure_condition: wire.failure_condition,
    };
    const keys = Object.keys(rawTexts);
    const prepped = keys.map((k) => scrubStaffNames(maskDigits(rawTexts[k]!), staffNames));
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
        generator: {
          kind: deps.generatorKind,
          model: PROPOSAL_MODEL,
          location,
          agent_version: PROPOSAL_AGENT_VERSION,
          gate_version: PROPOSAL_GATE_VERSION,
          library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
          sop_version_id: sop.sop_version_id,
          attempts,
        },
        gate: { passed: false, fired_rule: "output_too_long", checks: [] },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraints.length },
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
        const t = fresh.get(c.thread_id);
        return t !== undefined && t.status === "fact" && t.excluded_from_evidence !== true && t.label_source !== "supervisor_rejected";
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
          generator: {
            kind: deps.generatorKind,
            model: PROPOSAL_MODEL,
            location,
            agent_version: PROPOSAL_AGENT_VERSION,
            gate_version: PROPOSAL_GATE_VERSION,
            library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
            sop_version_id: sop.sop_version_id,
            attempts,
          },
          gate: { passed: false, fired_rule: "evidence_stale", checks: [] },
          counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraints!.length },
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
      const baseline = metricBaseline(all, wire!.metric_category!);
      const proposal: Proposal = ProposalSchema.parse({
        outlet_id: outlet.outlet_id,
        proposal_id: proposalId,
        status: "awaiting_supervisor",
        requested_by_role: requestedByRole,
        range,
        generator: {
          kind: deps.generatorKind,
          model: PROPOSAL_MODEL,
          location,
          agent_version: PROPOSAL_AGENT_VERSION,
          gate_version: PROPOSAL_GATE_VERSION,
          library_version: { interventions: library.interventions.version, rubric: library.rubric.version },
          sop_version_id: sop.sop_version_id,
          attempts,
        },
        // Gate checks = the checkProposal() result from the attempt that
        // passed (real per-rule results, never relabelled), plus the
        // evidence_stale check this commit transaction just ran itself.
        gate: {
          passed: true,
          fired_rule: null,
          checks: [...passedGateChecks!, { rule: "evidence_stale", passed: true }],
        },
        counts: { candidate_facts: floor.facts, candidate_dates: floor.dates, constraints: constraints!.length },
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
          constraint_ids_acknowledged: constraints!.map((c) => c.constraint_id),
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
