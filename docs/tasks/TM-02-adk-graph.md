# TM-02 — "Graph engineering" in Google ADK for bee6: feasibility study (tech-lead, 15 Oct, DRAFT, uncommitted)

Read-only study for the PM/Rangga. Verified against `origin/main` (`4414d79`, worktree `../bee6-g3g4`), the installed
`@google/adk@2.2.1` there, the `google/adk-js` GitHub releases and `adk.dev`. Nothing is built; no product file was
touched. Companion to `docs/tasks/TM-01.md` (what exists today, claims vs code).

Question: can "graph engineering" in ADK (fan-out, join, router) raise Technical Merit (40 %: meaningful Gen AI use,
technical implementation, scalability) before the Sat 17 Oct 12:00 freeze (merge window P3 Fri 22:00; E2E round 1
Fri 15:00), and is it worth the risk to the demo?

**Short answer:** the TS package has a real, exported, working graph API (`Workflow`/`Edge`/`JoinNode`/`ParallelWorker`
/`RoutedAgent`), so a graph claim can be honest. But the product has exactly one place where a graph is a real shape
and not decoration (the proposal step), the honest gain there is one extra read-only model check plus a visible trace,
and it lands on the critical path of the one flow the judges watch live, in the last 30 h before freeze. Recommend
option (i) now as MUST, a 2 h Task-0 spike Thu night/Fri AM, and option (ii) only if the spike passes by Fri noon and
E2E round 1 has zero blockers; (iii) no.

---

## 1. What `@google/adk@2.2.1` (TypeScript) actually offers — verified, not assumed

Package: `node_modules/@google/adk/package.json` → `2.2.1`, Apache-2.0, `main: dist/cjs/index.js`,
`module: dist/esm/index.js`, `exports` map has `.`, `./a2a`, `./artifacts/gcs`, `./sessions/database`,
`./telemetry/gcp`, `./tools/mcp`, `./tools/webmcp` only. Upstream: `adk-v2.2.1` published 6 Oct; **`adk-v2.3.0`
published 13 Oct** (RoutedLlm fixes, abortSignal forwarding in RoutedLlm, "rerunOnResume human-input workflow sample").
We are pinned to 2.2.1 — do not bump before the freeze.

### 1.1 Graph workflow API — present in 2.2.1, exported from the package entry

`dist/types/workflow/index.d.ts` header: *"The new ADK workflow module (parity port of `google/adk-python`
`google/adk/workflow`)"*. Exported through `dist/types/common.d.ts:198` and reachable as
`import { Workflow, Edge, Graph, JoinNode, FunctionNode, ParallelWorker, ToolNode, NodeTool, START, DEFAULT_ROUTE,
node, BranchPath, NodeContext, NodeTimeoutError, ... } from "@google/adk"`. Runtime check (ESM and CJS builds, this
session): `Workflow=function JoinNode=function FunctionNode=function ParallelWorker=function RoutedAgent=function
FunctionTool=function AgentTool=function`. `runNodeAsInvocation` is **not** re-exported from the entry (you run a
`Workflow` by passing it as the runner's root: `RunnerConfig.agent: RunnableRoot = BaseAgent | Workflow`,
`runner/runner.d.ts:112`; `InMemoryRunner({ agent: workflow })` works, verified below).

| Piece | File (`dist/types/…`) | What it is |
| --- | --- | --- |
| `Workflow` | `workflow/workflow.d.ts` | A `BaseNode` whose `runImpl` is the orchestration loop: seed START → schedule ready nodes → handle completions → finalize. Config: `edges: EdgeItem[]` **or** `dynamicEntry(ctx, input)` (imperative, `ctx.runNode`), `maxConcurrency`, plus all `BaseNodeConfig` (`timeout` seconds, `retryConfig`, `inputSchema`/`outputSchema`/`stateSchema` zod v3/v4). Doc comment: *"Ported (Phase 2 subset) … Replay/checkpointing, dynamic scheduling, and task/chat isolation scopes are added in later phases"*. |
| `Edge`, `Graph`, `RoutingMap`, `DEFAULT_ROUTE` | `workflow/graph.d.ts` | `['START', a, {routeX: [b, c], __DEFAULT__: d}]` chain syntax; a routing-map value that is an array = **fan-out**; a node emits a route by setting `ctx.route` (string/number/boolean, matched by string value). `createGraphFromEdgeItems` validates at build time (unreachable nodes, duplicate names, routed edges from START, unconditional cycles fail loudly). |
| `JoinNode` | `workflow/nodes/join_node.d.ts` | Fan-in barrier (`requiresAllPredecessors = true`): runs once ALL predecessors complete, input = `{ predecessorName: output }` map, passes it through. |
| `FunctionNode` | `workflow/nodes/function_node.d.ts` | Wraps `(ctx, input) => value | Event | generator`; return value becomes the node output; `ctx.state` writes become state deltas on the emitted event. |
| `ParallelWorker` | `workflow/nodes/parallel_worker.d.ts` | Map over a list input with bounded concurrency (default 8), **all-or-nothing** ("If any item throws, the first error is rethrown and the already-computed sibling outputs are discarded"); cancellation stops scheduling only. |
| `LlmAgent` as a node | `agents/base_agent.d.ts:54-64` ("An agent **is** a BaseNode"), `agents/llm_agent.d.ts:179-198`, `workflow/run_llm_agent_as_node.d.ts` | `mode: 'single_turn'` (default: node input appended as a user turn, reply becomes the node output) or `'task'` (`finish_task` tool loop, `outputSchema` args become the output); `outputKey` writes the reply into session state. `includeContents: 'none'` for a stateless call. `chat` mode "not yet supported". |
| `ToolNode` / `NodeTool` | `workflow/nodes/tool_node.d.ts`, `node_tool.d.ts` | A tool as a node, and a node exposed as a tool. `requireConfirmation` tools "do not pause" as a ToolNode (HITL for workflow nodes "not wired up", `function_tool.d.ts`). |
| `RoutedAgent` | `agents/routed_agent.d.ts` | Code router: `router(agents, context, errorContext?) => key`; "Routing is strictly limited to the agents passed in the config". adk.dev marks Agent Routing **experimental**. |
| `ParallelAgent`, `SequentialAgent`, `LoopAgent` | `agents/*_agent.d.ts` | **All three carry `@deprecated Use Workflow instead … will be removed in a future version. Note that a Workflow cannot yet be an LlmAgent sub-agent.`** Do not build new work on them. |
| `FunctionTool`, `AgentTool` | `tools/function_tool.d.ts`, `tools/agent_tool.d.ts` | zod-typed tool; agent-as-tool. Not needed for a graph; see TM-01 §4 for the output-schema-with-tools caveat (`canUseOutputSchemaWithTools` reads the process env, not the `Gemini({vertexai:true})` instance). |
| LLM-transfer routing | `llm_agent.d.ts` `subAgents`, `disallowTransferToParent/Peers` | Model-chosen delegation. R-08 sets both `disallowTransfer*: true` on purpose; a graph does not need LLM transfer and should keep it off (routing by code is the honest shape for hard rule #10). |

### 1.2 Behaviour verified offline (no model, local scripts in the session scratchpad, `bee6-g3g4` node_modules)

Probe 1 — `START → router(FunctionNode, sets ctx.route="has_constraints") → {has_constraints: [checkA, checkB],
__DEFAULT__: [checkB]} → JoinNode → gate(FunctionNode)` via `InMemoryRunner({agent: workflow}).runEphemeral(...)`:
- Trace order: `router`, `A:{"category":"WAIT_TIME"}`, `B:{...}`, `gate:{"constraint_checker":{...},"measurability_checker":{...}}`.
  Both branches received the router's output as input, ran concurrently (A slept 30 ms, B 10 ms, B's event came first),
  the join delivered `{nodeName: output}` to the gate, gate output was the final node output.
- Every event carries `nodeInfo.path` (`proposal_graph.router`, `proposal_graph.constraint_checker`, …) and
  `author = node name` → **a run trace is available for free from the event stream**, no model text needed.

Probe 2 — failure modes:
| Case | Result |
| --- | --- |
| Branch B throws (`Error("vertex 503")`), A slow | Runner **throws** after 204 ms (`UNKNOWN_ERROR` event for B); A still ran to completion with `ctx.abortSignal.aborted === true`; **join and gate never ran**. A partial fan-out failure is fatal to the whole run unless the branch absorbs it. |
| Branch B catches and returns `{ ok: null, error_class: "http_503" }` | Completes in 52 ms; gate receives `{"a":{"ok":true},"b":{"ok":null,"error_class":"http_503"}}`. **This is the pattern a join-with-a-missing-branch must use.** |
| Node `timeout: 0.1` (seconds) + `retryConfig {maxAttempts: 2}` on a 300 ms node | Two attempts observed (`ctx.attemptCount` 1, 2), then `NodeTimeoutError "Node 'a' timed out after 0.1 seconds"` thrown by the runner. |
| `Workflow` with `timeout: 0.1` | `NodeTimeoutError "Node 'wf' timed out after 0.1 seconds"` after 104 ms. Workflow-level deadline works. |

### 1.3 Fit with our constraints

- **Hard rule #5 (location):** `Gemini({ model, vertexai: true, project, location })` takes the location
  programmatically (R-08 proved it; `lib/agents/proposal-agent.ts:61-68` `getOrCreateModel`). An `LlmAgent` node reuses
  the same `Gemini` instance; `config/regions.yaml` stays the only source (`gemini-3.5-flash` → `asia-southeast1`).
- **Structured output:** an `LlmAgent` node keeps `generateContentConfig.responseJsonSchema` + `responseMimeType`
  (forwarded as-is, `llm_agent.d.ts:144-156`); `thinkingConfig {thinkingLevel: LOW, includeThoughts: false}` forwarded
  unless a planner is set (none). Unverified on live: whether `mode: 'single_turn'` node-input injection plus
  `InstructionProvider` behaves exactly like the current `runEphemeral` call — that is Task-0 item 1.
- **Next.js standalone:** `next.config.ts` already has `serverExternalPackages: ["@google/adk"]` (R-08 Task 0); the
  workflow classes are in the same package and the CJS build exports them, so no new bundling risk. `lib/agents/
  no-vertexai-import.test.ts:62` allows `@google/adk` imports **only from `lib/agents/proposal-agent.ts`** — a graph
  module must either live in that file or extend the allowlist (one line, deliberate).
- **Second `@google/genai` copy** under `@google-cloud/vertexai` (TM-01/R-08 ruling) — unchanged by a graph.
- **Lease/timeouts:** `PROPOSAL_LEASE_MS = 180 s`, `MODEL_TIMEOUT_MS = 60 s`, attempts ≤ 2. Two attempts × (draft 60 s +
  a second model node 60 s) = 240 s > the lease. A graph MUST set node timeouts so one attempt ≤ 90 s (draft 60 s,
  checker 20 s, workflow 85 s) or raise the lease in the same change.

---

## 2. Where a graph honestly fits

Model calls on `origin/main` (TM-01 §1): transcription (direct genai), label (direct genai, one call per unit, sequential
per device by design — unit N's open threads feed unit N+1), proposal (ADK `LlmAgent`, no tools). Review verdict, debrief
ranking, evidence gate, proposal gate, floor: plain code.

### (a) Proposal graph — the only real candidate

Today (`lib/proposals/service.ts` 8a–8f): code picks the focus category (`evidenceByCategory`) → one draft call →
`JSON.parse` → zod wire schema → `checkProposal` (`pgate-v1`, 8 rules) → retry ≤ 2 with the fired rule fed back →
redact → commit with fresh re-read (`evidence_stale`).

```
            START
              │
       route (code): constraints? open proposals? focus category
              │
          draft (LlmAgent, gemini-3.5-flash, responseJsonSchema)   ← exists today
              │
      ┌───────┴────────────┐           (fan-out; both read-only)
 code_checks            constraint_check (LlmAgent, JSON enum per
 zod + pgate-v1 +        constraint: respected|violated|unclear;
 metric baseline         only on route has_constraints, else skipped)
      └───────┬────────────┘
            join
              │
        decide (code): pgate result is the ONLY blocker; a "violated"
        verdict → feedback for attempt 2 / a note to the supervisor
              │
   service: retry ≤ 2 · redact · commit (unchanged)
```

What is real here and what is not:
- **Real:** a semantic "does the new step text respect constraint C2?" check does not exist today
  (`constraints_unacknowledged` only checks that the model *listed* every alias). Running it in parallel with the code
  checks and feeding a "violated" verdict into the existing attempt-2 message is a genuine quality gain, and the
  verdict enums are honest, name-free trace data for the supervisor ("Checks: constraints respected (model), evidence
  on 2 days (code), metric in evidence (code)").
- **Decoration:** a separate "intervention-picker" agent (the draft already picks from a 6-entry library), a
  "measurability checker" (the metric is a category count — measurable by construction, code already enforces
  `metric_not_in_evidence`), a "process-not-person" model checker (code scrub + SDP redaction already run; prompt rule 9
  already forbids names). A router "by category / evidence shape" to different specialist prompts would be a router
  with one real branch.
- **Variant with real parallelism (flag it, do not pick it now):** fan-out one draft per READY category (up to 3), each
  through the code gate, join, code picks the best by (gate passed, facts, dates, `CATEGORIES` order). Latency = max
  not sum; "3 categories considered, 2 passed the gate, chose X because …" is strong visible evidence. **But** it
  changes which proposal comes first, and the R-19 judge journey is scripted (problem A then "Generate another" → B;
  `taken` categories, §3.3). Not before the freeze.

Costs and failure modes for the honest variant:
- **Model calls per proposal:** +1 flash call (≈ 1–2 k input tokens, ≈ 100 output) per attempt **only when the outlet
  has constraints** (demo: after the owner's first rejection, i.e. the second proposal of the journey). Demo caps count
  requests (`generate`: 8/sandbox, 300/day; `MODEL_DAILY` 5000 counts routes, not calls — a second call per request is
  invisible to the cap; note in README).
- **Latency for a judge waiting live:** no live p50/p95 is recorded anywhere in the repo (grep of R-08/R-19/HANDOFF/QA
  docs: none). Estimate: draft ≈ 3–8 s today; the checker runs *after* the draft, so +≈ 2–5 s per attempt on the
  critical path, ×2 on a retry. Task-0 measures this; if p95 of one attempt exceeds 20 s the feature stays off.
- **Partial fan-out failure:** every branch catches and returns `{status: "soft_error", error_class}` (probe 2);
  `decide` treats a soft-failed checker as "unclear" → proposal proceeds on the code gate alone. A thrown error anywhere
  → the service's catch falls back to today's `adkProposalModel` path for that attempt (gate-only), logged with
  `error_class` only.
- **Idempotency/lease:** the graph runs inside the existing lease and attempt loop; status contract untouched
  (`suppressed` / `blocked` / `awaiting_supervisor` are decided exactly where they are today).
- **Determinism:** one more stochastic point (the checker) that can only add a retry or a supervisor note, never change
  a pass into a block. Temperature 0.2, thinking LOW, `includeThoughts: false`.
- **Hard rules:** #1 ADK is Google; #3/#7 the checker sees aliases (`C1..Cm`, `E1..En`) and the draft's text, never
  thread/device ids or names; stored output is enums only; #5 location via `getOrCreateModel`; #9 untouched; **#10 the
  gate stays plain code — the checker's verdict is advisory (retry feedback / note), never a block**; zod on the
  checker output (strict enum object); cost logging extends `sumUsage` with the checker's tokens.

### (b) Review graph — decoration

`lib/reviews/service.ts:95-105` already measures before/after in `Promise.all`; `suggestVerdict` (`rev-v1`) is
deterministic code and the README says so. Wrapping two counts and a ratio in `Workflow` adds a diagram and nothing
else; an "optional Gemini rationale" would be text the humans do not need and a new stored model text. **No.**

### (c) Day-pipeline graph — wrong shape and highest blast radius

The tick is per device, units oldest-first, **sequential by design** (open-thread continuation across units,
`tick/service.ts` header). A `ParallelWorker` over units breaks that contract; across devices a sandbox has one device.
The label call is one per unit, not per thread. The pipeline is exactly what the live audio rehearsal is exercising right
now. **No.**

### (d) Other — none found

Debrief ranking (`lib/debrief/rank.ts`), evidence gate, floor, review: plain code and should stay so.

---

## 3. Visibility (how a run becomes judge-visible evidence, name-free)

Stored, additive and optional (old docs unaffected), **enums/numbers only, no text**:

```ts
// lib/firestore/schema.ts  ProposalSchema.generator (additive, optional)
graph: z.object({
  version: z.literal("pgraph-v1"),
  route: z.enum(["no_constraints", "has_constraints"]),
  nodes: z.array(z.object({
    name: z.enum(["route", "draft", "code_checks", "constraint_check", "join", "decide"]),
    status: z.enum(["ok", "soft_error", "skipped"]),
    ms: z.number().int().min(0),
    attempt: z.number().int().min(1).max(2),
  }).strict()),
  constraint_verdicts: z.array(z.object({
    alias: z.string().regex(/^C\d+$/), verdict: z.enum(["respected", "violated", "unclear"]),
  }).strict()),            // aliases only; the constraint text is already on the constraint doc
}).strict().optional(),
```
- `audit_log.details` gets `graph_version`, `route`, `nodes_run`, `soft_errors` (counts/enums).
- `ProposalView` (`lib/proposals/view.ts`, explicit keys) gets `trace: { route, nodes[], constraint_verdicts[] } |
  null` plus the already-stored `attempts`, `gate.checks`, `generator.{model, location, agent_version, gate_version,
  floor_version}` (TM-01 found these stored but invisible). The "why this proposal" panel renders that list; nothing in
  it is model prose.
- Trace source: the runner's event stream (`ev.author`, `ev.nodeInfo.path`, timestamps) — probe 1 shows every node emits
  one. No `includeThoughts`, no model reasoning stored anywhere.
- Architecture diagram = the ASCII above, drawn from the code; label the per-category fan-out variant "planned" if it is
  not built.

---

## 4. Options, estimates, Task-0, recommendation

Estimates are agent hours including tech-lead review, QA (live), and two fix rounds; calendar from
`docs/tasks/R-19-demo-v2.md` §12-13 (P2 Fri 14:30 + E2E round 1 15:00; P3 Fri 22:00; P4 Sat 08:00 + round 2; freeze
Sat 12:00). HANDOFF: Fable weekly limit resets Thu 16 Oct 00:00 WIB.

| Option | Scope | Hours | Risk to the demo | Technical Merit effect |
| --- | --- | --- | --- | --- |
| **(i) No graph: truth pass + E panel** | Fix the overclaims TM-01 §2 lists (architecture.md / specs: Critic, ReviewAgent, DebriefAgent, "gate as a tool"); add `attempts`, `gate.checks`, `generator.*`, `blocked_rule` to `ProposalView` and a "How this proposal was checked" panel on the supervisor detail (code-only, additive); README/deck diagram drawn from the code; scalability bullets from TM-01 §6. | **5–7 h** | Near zero (no model-path change; view + UI only) | Moderate and certain: judges see the evidence gate, structured outputs, versioned rules, lease/idempotency that already exist. |
| **(ii) Smallest honest graph** | `lib/agents/proposal-graph.ts`: `Workflow` START → route (code) → draft (existing `LlmAgent`) → fan-out [code_checks, constraint_check (new `LlmAgent`, enum JSON)] → `JoinNode` → decide (code). Flag `PROPOSAL_GRAPH` default **off**; on any throw → today's path. Service consumes the graph's gate result; trace stored per §3; E panel from (i) shows it. Eval fixture for the checker (3 constraint cases). | **18–24 h** (spike 2, graph+trace+flag+fallback 5, service+tests 4, checker prompt+zod+fixture 3, view/UI 3, gates+QA+2 fix rounds 5) | Medium: touches `service.ts` attempt loop and the schema the demo writes; must merge by P3 Fri 22:00 while round-1 fixes compete for the same reviewers; flag-off limits blast radius, but "built but off" earns little. | Small-to-moderate: one real new check + a visible trace + an honest "graph" claim. Not a step change: the judge still sees one proposal card. |
| **(iii) Fuller graph** | (ii) + per-category parallel drafts + review/pipeline graphs + tools (`check_evidence`, `get_constraints`) | 40 h+ | High: changes which proposal comes first (scripted journey), touches the tick, past the freeze. | Visible, but mostly decoration outside (ii)'s core; judges and engineers notice a graph wrapped around two counts. |

### Task-0 spike (2 h, demo project `bee6-playground`, Vertex, local script, go/no-go by Fri noon)

Script `scripts/spike-proposal-graph.ts` (not product code; same shape as R-08's Task 0), run with the demo project's
service account, `getModelLocation("gemini-3.5-flash")`:
1. `LlmAgent` **as a workflow node** with `InstructionProvider`, `includeContents: 'none'`, `generateContentConfig
   {responseJsonSchema, responseMimeType, thinkingConfig LOW/includeThoughts false, temperature 0.2}` — confirm the node
   output is the raw JSON text, parses, and `usageMetadata` is on the event. (Node-input injection vs today's
   `runEphemeral` user message.)
2. Fan-out `[code_checks, constraint_check]` → `JoinNode` → decide, with the checker's strict enum schema; 5 runs on the
   R-19 fixture facts with 2 constraints (one clearly violated) — record verdict agreement (≥ 4/5 "violated" on the
   violated case, 0/5 false "violated" on the clean case) and p50/p95 of one attempt.
3. Node `timeout` (draft 60 s, checker 20 s, workflow 85 s) + soft-error branch (`abortSignal` passed into the checker's
   call) — confirm the fallback path returns gate-only within the lease.
4. Trace: collect `{author, nodeInfo.path, ms}` from events; confirm no text beyond the draft JSON ever leaves the
   runner.
Go if all four pass and one attempt p95 < 20 s. No-go on any failure — then (i) only.

### Recommendation

1. **Do (i) now as MUST** — it is the cheapest, safest way to make the technical merit that already exists visible, and
   it is a precondition for (ii)'s trace panel anyway.
2. **Run Task-0 Thu night/Fri AM** (after the Fable reset) **only if** the live audio rehearsal result is in and clean.
3. **Build (ii) only if** Task-0 is a go by Fri noon **and** E2E round 1 (Fri 15:00) has zero blockers; it ships
   flag-off into P3 (Fri 22:00), is switched on in the demo project after a live generate on a sandbox with and without
   constraints, and is switched off again on any defect. Otherwise it is "Next".
4. **(iii): no.**

Honest answer to "does this materially raise Technical Merit vs the cost/risk": **marginally, and not enough to risk
the live flow.** The judges' inputs are a 3-minute video, a deck and the repo. The ADK agent, the plain-code evidence
gate, per-call structured outputs with zod, versioned rules on every doc, leases and idempotency, redaction before
storage and the region config are the technical story, and today most of it is invisible. (i) fixes that for 5–7 h at
near-zero risk. (ii) adds one real check and a diagram-with-a-trace for 18–24 h on the critical path in the last day;
if anything it should be scheduled as the first post-freeze task with the spike result already in hand.

### README "Next" wording if (ii) is not shipped

> **Proposal graph (ADK Workflow).** The proposal step runs as a single ADK `LlmAgent` today. The next step is an ADK
> `Workflow` graph: a code router, the draft agent, then a parallel fan-out to a code checker (`pgate-v1`) and a
> read-only constraint checker, joined before the plain-code gate decides. Verified against `@google/adk` 2.2.1
> (`Workflow`, `JoinNode`, `FunctionNode`), spiked on Vertex `gemini-3.5-flash`; the checker's verdict feeds the retry
> and the supervisor's view, never the gate. Not shipped for the submission to keep the live demo path unchanged.

(Only say "spiked on Vertex" if Task-0 actually ran.)

---

## 5. If the TS package had no graph API — it does, so the claim question is

- `@google/adk@2.2.1` **has** graph workflows (`Workflow`/`Edge`/`JoinNode`/`FunctionNode`/`ParallelWorker`, routed
  edges, node timeouts and retries), exported from the entry and working offline (probes above). Building (ii) on
  `Workflow` and saying "graph" is accurate. `ParallelAgent`/`SequentialAgent`/`LoopAgent` are deprecated in this very
  version — a graph built on them would be stale on arrival.
- A hand-rolled TypeScript state machine orchestrating several `LlmAgent`s (the CLAUDE.md §3 fallback) would be
  "code-orchestrated ADK agents", **not** a graph; do not call it one. Today's `generateProposal` is exactly that state
  machine around one agent and the README describes it correctly.
- Maturity caveats to state plainly if (ii) ships: the TS workflow module is a "Phase 2 subset" port (its own doc
  comment: replay/checkpointing, dynamic scheduling, isolation scopes "added in later phases"; `chat` node mode "not yet
  supported"; `Workflow` "cannot yet be an `LlmAgent` sub-agent"; HITL for `ToolNode` "not wired up"). None of these
  are needed by (ii).

## 6. Open questions for Rangga

1. Is the live audio rehearsal clean? (Gate for running Task-0 at all.)
2. If Task-0 passes, is a flag-off (ii) in P3 acceptable knowing it competes with round-1 fixes for Fri afternoon?
3. The per-category parallel-draft variant changes which proposal the judge sees first — out for the submission; worth a
   line in "Next"?
4. `MODEL_DAILY` counts requests, not model calls; with (ii) one request can be two calls — accept and document, or
   count calls (small change in `caps.ts`)?
