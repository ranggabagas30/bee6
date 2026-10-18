# AI capabilities audit (18 Oct 2026): Proposal agent v4, the "Review agent", and demo coupling

Read-only investigation by tech-lead against `origin/develop` = `0c9e9e3` (read in a sibling worktree
`../bee6-ro-develop`; nothing edited there). Every `file:line` below is at that commit unless it names a
`docs/` file, which is read from the main checkout. Where I am not sure, I say so.

One fact that frames all three answers: **`origin/main` = `5a47d02` does not contain `lib/proposals/v4/` at all**
(`git ls-tree origin/main lib/proposals/v4` is empty; `main` is an ancestor of `develop`). The judges' service `web`
runs `main` (`docs/HANDOFF.md:4`), so today `web` has only the v3 Proposal agent and **cannot** switch v4 on by env var.
v4 exists only on `develop` / `web-develop`.

---

## Q1. Proposal agent v4 (`PROPOSAL_AGENT_V4`)

**Verdict.** v4 is a real, working, Google ADK tool loop with a plain-code `check_proposal`; it is merged on `develop`,
evaluated offline (71 runs, 0 defects on the final code, QA SHIP), and **off everywhere**. On the demo's 5-step,
one-section SOP it produces the same proposals as v3 (same intervention, same cited facts, every case) at about 3.6x the
tokens, 5.6x the model calls and about 1.7x the wall time. Its extra guarantees (verbatim quotes, "read before you cite",
section scoping) are real but invisible to a judge on this SOP. It is off because (a) the plan's switch-on bar needed a
live staging QA pass (D2) that was never completed, and (b) `main`/`web` never received the code.

### 1.1 What v3 does today (the live path on `web`)

- One structured-JSON Gemini call, no tools, no planner: `lib/agents/proposal-agent.ts:100-120` (`responseMimeType:
  "application/json"`, `responseJsonSchema`, temperature 0.2, thinking LOW, `includeThoughts: false` at `:31`).
  Model `gemini-3.5-flash` (`:18`), location from `config/regions.yaml` via the route (`app/api/v1/proposals/generate/route.ts:61`).
- The prompt carries **everything inline**: the full SOP steps, the full intervention and rubric definitions, and every
  fact with its quote and staff note: `lib/proposals/prompt.ts:78-110`. System rules 1-11 at `:15-49`.
- Service loop `runV3(2)`: two attempts; attempt 2 appends `PREVIOUS ANSWER REJECTED: <rule>`: `lib/proposals/service.ts:420-483`.
  Output is zod-parsed (`wireSchema.safeParse`, `:458`), then the plain-code `pgate-v1` gate (`lib/proposals/proposal-gate.ts:59-91`,
  8 rules at `:37-46`). Model error twice -> 503 (`:439-441`); schema or gate failure twice -> a `blocked` proposal doc.

### 1.2 What v4 adds: the tools and what each returns

Built per focus category from already-loaded, already-outlet-scoped data; every id the model may pass is a `z.enum` of
what this Ask offered (`lib/proposals/v4/tools.ts:69-85`). No tool does I/O or calls a model. Each call is recorded on
the run session (`:98-103`).

| Tool | Returns | Side effect on the session |
| --- | --- | --- |
| `list_sop_sections` (`tools.ts:107-114`) | `{sections:[{section_id,title,step_count}]}` | none |
| `get_sop_section(section_id)` (`:116-132`) | the section's steps `{step_id, role, title, text}` | `fetchedSections.add` |
| `get_evidence(alias E1..En)` (`:134-163`) | date, time, category, summary, fields, `quote` (clamped 320 chars), `staff_note` (clamped 200), `label_confidence`, `gate {verdict, fired_rule}`, `confirmed_by` (`staff_debrief` / `supervisor` / `label_gate`) | `inspectedAliases.add` |
| `get_intervention(id)` (`:165-174`) | `{id,label_en,definition,when_to_use}` | `inspectedInterventions.add` |
| `get_rubric()` (`:176-184`) | all rubric criteria with definitions | none |
| `check_proposal(draft)` (`:185-234`) | `{passed, accepted, final, round, rounds_left, reasons[]}` | counts a round; sets `outcome` on pass or on the 3rd failed round |
| `decline(reason)` (`:236-245`) | `{accepted:true}` | sets `outcome = declined` |

The draft schema (`lib/proposals/v4/draft-schema.ts:23-89`) is the v3 wire shape plus `section_id` and
`evidence_quotes[{alias, quote 8..320 chars}]`. Quotes are **never stored**: `draftToWire` drops them (`:98-116`).

### 1.3 How it loops

- Runner `lib/agents/proposal-agent-v4.ts`: one `LlmAgent` with the seven `FunctionTool`s (`:183-206`), run through
  `InMemoryRunner.runEphemeral` with `runConfig: { maxLlmCalls: 14 }` (`:214`). The prompt's user content is an **index
  only** (fact one-liners, intervention/rubric ids, constraints) with no SOP text (`lib/proposals/v4/prompt.ts:64-98`); the
  system instruction tells the model to call the tools in order A-E and to reply `DONE` after `check_proposal` accepts
  (`:50-58`).
- The loop ends the moment `session.outcome` is set (`proposal-agent-v4.ts:224-228`, saves the trailing DONE call), on an
  ADK error event (`:217-223`, classified from fixed literals only), on the genai abort signal (`:182`, 45 s), or on a
  wall-clock backstop at timeout + 5 s (`:266-273`).
- Service side (`lib/proposals/service.ts:485-594`): flag off -> `runV3(2)` byte-for-byte (`:486-487`). Flag on -> budget
  check (`:490`: skip v4 if elapsed + 45 s + 65 s > 270 s), build tools/prompt (`:495-528`; any build error -> `runV3(1)`),
  run v4 (`:540`), then: `accepted` -> proposed; `declined` -> next focus; `blocked` -> blocked doc (`:570-585`). Any v4
  error/timeout/limit/no-decision -> **one** v3 attempt (`:587-594`), recorded as `agent_version: proposal-v3` with
  `generator.v4.fell_back = true` (`:290-302`, `:561-568`).
- After an accepted draft the rest is exactly the v3 pipeline: role-tag strip, digit mask, staff-name scrub, SDP redaction
  (`:735-755`), `output_too_long` (`:757-785`), and the commit transaction that re-reads the cited threads and blocks with
  `evidence_stale` if fewer than 2 threads on 2 dates survive (`:787-826`).

### 1.4 What `check_proposal` checks and what happens when it fails

`lib/proposals/v4/check.ts:89-128`: first the 8 `pgate-v1` rules through the same `checkProposal` function
(`intervention_unknown, rubric_missing, rubric_unknown, evidence_unknown, evidence_min (>=2 threads on >=2 dates),
step_unknown, constraints_unacknowledged, metric_not_in_evidence`), then the 10 v4 rules in order
(`lib/proposals/v4/types.ts:15-26`):

`section_not_fetched`, `step_not_in_section`, `evidence_not_inspected`, `intervention_not_inspected`,
`quote_alias_not_cited`, `quotes_insufficient` (quotes from >= 2 different aliases), `quote_not_in_evidence`
(normalised substring of summary / excerpt / staff note, `check.ts:105-111`), `scope_unsupported` (`:64-87`; only when the
SOP has >= 2 sections; on the demo SOP it always passes), `change_is_noop` (`:113-116`), `text_rule_violation` (role tags,
`(role:`, ISO dates, "phone number", "customer's name": `lib/proposals/text.ts:24-31`).

On failure the tool returns every failed rule code to the model (codes only, never shop text) and the model gets another
round; after `V4_MAX_CHECK_ROUNDS = 3` the outcome is `blocked` with the first failed rule (`tools.ts:216-232`), and the
service writes a `status: "blocked"` proposal doc with that `fired_rule` (`service.ts:699-726`); the supervisor sees the
blocked wording, not a proposal. A malformed draft (zod) is answered with `schema_invalid:<path>` and does **not** count
as a round (`tools.ts:192-203`).

### 1.5 Limits, caps, cost, latency

- Constants (`lib/proposals/constants.ts:59-82`): 3 check rounds, 14 model calls, 45 s per v4 run, 270 s per-Ask budget
  for v4 (so two focuses + a v3 fallback each fit the 300 s lease, `:53`), quotes 8-320 chars, scope token min 3.
  `MAX_FOCUS_PER_ASK = 2` (`:46`) and the 80-candidate prompt cap (`:27`) are shared with v3.
- The supervisor sees a "usually 10-30 s" estimate line only when the flag is on (`lib/proposals/v4/flag.ts:27-32`).
- Measured on the final code (`docs/tasks/QA-r24-eval-16oct.md` §9.3-9.4, 21 harness runs each + 50 probes): v4 mean
  14.8k input / 0.4k output / 0.95k thinking tokens and 5.6 model calls per focus; p50 8.9 s, p95 14.7 s, max 15.5 s.
  v3: 3.5k / 0.3k / 0.8k tokens, 1 call, p50 5.2 s, p95 6.3 s. Ratio about x3.6 tokens, x5.6 calls, x1.7-2.3 time.
- Cost guard gap: the demo `MODEL_DAILY = 5000` counts route hits, not model calls, so only `GENERATE_DAILY = 300`
  bounds v4 spend (QA doc §3; R-24 plan §12). Worst case about 9 M input tokens/day.

### 1.6 Eval results: where v4 is better or worse than v3

`docs/tasks/QA-r24-eval-16oct.md` (three rounds on 16 Oct; §9 is the final code):

- **Outcomes identical.** Both agents propose 3/3 on A (egg tart), B (phone order), `scope_dubai`, `scope_ube`,
  `mixed_one_wrong`, `pii_probe`, and both decline 3/3 (`no_clear_pattern`) on `weak_cs`. Both cite exactly `E1,E2`
  every time, never the decoy `E3`, and pick the same intervention per case (`add_record_step` for A/B/pii) (§1, §9.3).
- **Better (v4):** every accepted draft was grounded on round 1 (68/68 quotes verified verbatim by code); scope precision
  9/9 on the two-procedure fixture; 0 PII, 0 wording hits; `ended_by = decided` 71/71; the pcheck rules give a provable
  "read the section, read the evidence, quoted it" trail stored as counts on the doc (`generator.v4`). None of this is
  visible in the judge journey, where the SOP has one section (R-24 plan §0.4, D13).
- **Worse (v4):** x3.6 tokens, x5.6 calls, roughly double the latency; one hallucinated tool name in 173 runs (handled,
  outcome still accepted); extra `get_intervention` reads (1-2 per run). The earlier zod `too_big` reject on long quotes
  (10/13 B runs) is closed structurally by `V4_QUOTE_MAX_CHARS = FACT_EXCERPT_MAX_CHARS` (§9.2, 0/33).
- **Not proven:** n = 3 per cell on the harness; the service layer (fallback, lease, 8e/8f) was never exercised live
  with the flag on (§7 "what D2 still has to prove": 7 items, all open).

### 1.7 Why it is off

1. Plan decision D6/D14 (`docs/tasks/R-24-proposal-agent-tools.md` §1): flag-off keeps the stable candidate; switching on
   `web` required decision A (merge to main flag-off) and decision B (QA SHIP on live staging with the flag on, then the
   full judge journey on v4). HANDOFF shows the D2 live run was never done ("whether to include the v4 flag" still open,
   `docs/HANDOFF.md:16`; "PROPOSAL_AGENT_V4 unset everywhere", `:13`).
2. The release PR `develop -> main` was not opened (`docs/HANDOFF.md:4`), so `web` runs code without v4.
3. Value-for-cost: on the demo SOP the output is the same as v3 and costs 3.6x; the only judge-visible change would be
   the "10-30 s" wait line.

### 1.8 Exact steps and risks to switch it on

**`web-develop` (staging, demo project, Firestore `staging`):**
1. `gcloud run services update web-develop --project=bee6-playground --region=asia-southeast2 --update-env-vars=PROPOSAL_AGENT_V4=true`
   (R-24 plan §10). The flag is read per request (`route.ts:63-65`), so the next Ask uses v4; no rebuild.
2. Run the QA doc §7 list live: `agent_version: proposal-v4` on the doc, no `evidence_quotes` stored, the estimate line at Ask
   start and the overrun line after 30 s, the 409 path, RBAC unchanged, logs show no model text, p95 with service overhead.
3. Kill: `--remove-env-vars=PROPOSAL_AGENT_V4` (seconds).
Risks: shares the Vertex quota with `web` (plan §12); a v4 doc written to `staging` is harmless to `web` (separate DB).

**`web` (judges):** not possible today. Order would be: (1) release PR `develop -> main` with the flag off, Cloud Build to
`web`, dev-ops records the new revision as the rollback target; (2) full judge-journey QA on v3; (3) the same
`--update-env-vars` on `web`; (4) one v4 judge journey incl. a timed Ask. Risks specific to `web`: **once any v4 doc exists
in the `(default)` DB, the old revisions (`5a47d02` code, tags `candidate-1016` / `stable-1017`) are no longer a clean
rollback: their strict `ProposalSchema` rejects v4 docs (list skips, detail/approve 404)** (`docs/HANDOFF.md:73`); the only
safe kill is the env removal, not a traffic rollback. Also the cost ceiling gap (1.5), and that the judge gains nothing
visible except a longer, explained wait.

---

## Q2. The "Review agent" and the owner's fast-forward button

**Verdict.** There is **no Review LLM agent**. The review stage is plain code end to end: it counts facts of the
proposal's metric category before and after the change and suggests `worked / revise / revert` by a +/-20 % rule
(`rev-v1`). There is no Gemini call and no model-written summary in `lib/reviews/*`. CLAUDE.md §3's "Proposal and
Review agents on gemini-3.5-flash" is stale for the review half. The demo button creates the same review the daily job
would, flagged `simulated: true`, without moving any clock; on a sandbox the "after" window is in the future, so the
judge sees real "before" numbers, an empty "after" window, and "Bee6 has no suggestion: fewer than 2 captured days".

### 2.1 Where it is and what it does

- Rule: `lib/reviews/verdict.ts:20-50` (`suggestVerdict`): needs >= 2 captured days in each window
  (`MIN_DAYS_PER_WINDOW`, `lib/reviews/constants.ts:7`), a non-zero baseline rate, then `change_ratio` vs
  `CHANGE_THRESHOLD = 0.2` (`:8`) in the metric's direction -> `improved | worsened | no_clear_change` ->
  `worked | revert | revise`. The free-text `failure_condition` is shown to humans; code never interprets it (`verdict.ts:5-8`).
- Counting: `lib/reviews/metric.ts:35-53` (`countWindow`) reuses the proposal path's own `selectCandidates` (so "a fact"
  means the same thing, ROUTINE_OPS excluded, R-19 D-3) and counts only captured days.
- Windows: before = the source proposal's evidence range clipped to the day before the change took effect; after =
  `effective_from_date .. review_date - 1` (`metric.ts:22-33`).
- Creating a review: `lib/reviews/service.ts:106-155` (`createReview`) reads the proposal, measures both windows, builds
  the `reviews/{sop_version_id}` doc (`lib/reviews/plan.ts:56-117`) and an audit entry with the suggestion enum only.
- Reads: `sop_versions`, `proposals`, `capture_sessions`, `threads`, `reviews`, `staff` (scrub names, verdict reasons only).
  Writes: `reviews`, `outcomes` (owner verdict or expiry), `audit_logs`. The only external call in the module is SDP
  redaction of a typed verdict reason (`service.ts:75-77, 320`).
- Verdict state machine `awaiting_supervisor -> awaiting_owner -> confirmed` (+ `outcome`, `in_memory`), expiry to
  `unknown` after `confirm_by_date` (7 days): `plan.ts:16-27, 127-151, 188-226`. Slot comes from `claims.role`, never the body.

### 2.2 The daily job

- Route `app/api/internal/reviews/run/route.ts:24-46`: Cloud Scheduler OIDC (`REVIEW_RUN_AUDIENCE`), then
  `runDueReviews` (`lib/reviews/service.ts:165-219`): per outlet, creates a review for every shipped change with
  `review_date <= today` and no review yet (`plan.ts:37-45`), and expires unconfirmed reviews. **Sandbox outlets are
  skipped** (`service.ts:172-173`).
- Demo project job `review-run`: `0 9 * * *` Asia/Jakarta, ENABLED since 12 Oct (`docs/tasks/R-01-gcp-state.md:428, 586-592`);
  the staging copy is paused (`docs/HANDOFF.md:53`). No pilot job exists yet.

### 2.3 The "Fast-forward to the review date (simulated)" button

- Copy: `lib/i18n/dict.ts` key `C-rev-ff` (EN "Fast-forward to the review date (simulated)", ID line 489). Shown only when
  the list response says `fast_forward_available` (`app/reviews/ReviewsApp.tsx:189, 223-230`), which the server sets only
  when `DEMO_MODE` is on, the outlet is `project_kind: "demo"`, and a shipped change is still unreviewed
  (`lib/reviews/service.ts:261-265`).
- Click -> `POST /api/v1/reviews/fast-forward` with `{}` (`ReviewsApp.tsx:128-152`). Route
  (`app/api/v1/reviews/fast-forward/route.ts:49-87`): 404 unless `DEMO_MODE === "true"`; per-sandbox cap of 3 checked
  before and charged after (`FAST_FORWARD_PER_SANDBOX`, `lib/demo/constants.ts:55`).
- Service `fastForwardReview` (`lib/reviews/service.ts:357-396`): 404 unless the outlet is a demo outlet; role must be
  supervisor or owner; picks the **lowest-version shipped change with no review, ignoring its `review_date`**
  (`plan.ts:48-54`); calls the **same `createReview`** with `simulated: true` and `actor_role = claims.role`; "exists"
  -> 409 `NOTHING_TO_REVIEW`. "It never moves a clock" (`route.ts:19`). No Gemini, no canned data: the before/after
  numbers are counted from the sandbox's own threads.
- What the judge sees (`app/reviews/ReviewCard.tsx:144-235`): kicker "SOP version N: review on <date>", an amber chip
  "Simulated time (demo)" (`:150`), the change title, the metric line with the baseline, two tiles "Before" / "After"
  with per-day rates and the window lines, the suggestion box, the failure condition, then the verdict panel.
- In a sandbox the numbers are predictable from code: `effective_from_date = approval day + 1`
  (`lib/sop/ship.ts:17-19`), `review_date = effective + review_after_days` (`:22-24`, model picks 7-28), so the "after"
  window lies entirely in the future: `days_captured = 0`, "After (...): no captured days", and
  `suggestVerdict` returns `not_enough_days` with `verdict: null` (`verdict.ts:33-35`) -> the card says "Bee6 has no
  suggestion: fewer than 2 captured days in one of the windows" (`dict.ts` `C-rev-suggest-none`, `C-rev-why-not_enough_days`).
  The "before" tile shows the judge's real counts (e.g. 2 CUSTOMER_SERVICE facts in N captured days).
- What the supervisor decides: `worked / revise / revert` with an optional 3-300 char reason (redacted before storage,
  `service.ts:319-321`); then the owner's verdict becomes the `outcome` (`in_memory` unless `unknown`). "Revert" does
  not change the SOP by itself (`C-rev-revert-note`).

### 2.4 Interaction with the scheduler and the "sandbox clock"

- There is no sandbox clock. "Jump to tomorrow" is a **data shift** one day back (`lib/demo/next-day.ts:17-20`), blocked
  once any proposal has content (G6, `:81`), so an approved SOP version and its review never meet a shift. The review
  date is therefore a real future calendar date; the button is the only way a sandbox ever gets a review.
- The daily job and the button cannot double-write: `createReview` is idempotent on `reviews/{sop_version_id}`
  (`service.ts:152`), and the job skips sandboxes anyway. On the non-sandbox `demo-outlet` the job would create the review
  on the real date unless the button already did.
- DEV-02 (`/capture` time-travel) was superseded and never built (`docs/tasks/DEV-02-time-travel-control.md:3`).

---

## Q3. "The AI does not know our scenario clip; it purely examines the data"

**Verdict: true in the strict sense, with four honest qualifications.** No runtime code matches speech against the
script cards, no card id or expected category reaches the pipeline, no proposal text is canned, and the seeded template
holds routine-only history that is checked never to be evidence. The output is produced from the judge's spoken lines +
the sandbox data + generic prompts/config. **But** three prompt/config texts were tuned on this very script during
R-20/R-21 (an intervention example that names both demo problems, a threading example that quotes the phone-order line,
and a privacy rule worded around "order details and pickup time"), and one UI panel pre-draws the two expected
categories. The model does not "know the clip", but the prompts were sharpened so that this clip lands where we want.

### 3.1 Every demo-specific coupling found (runtime code, prompts, config, seeds, template)

Greps run over `lib/`, `app/`, `config/`, `scripts/` (tests excluded) for: egg tart, baking time, read back / read it
back / read-back, Demo Bakery, pickup time, card ids `d1-c1..d3-c5`, fifty, croissant, cinnamon, birthday cake, tray.

| # | Where | What | Reaches the model? | Judgement |
| --- | --- | --- | --- | --- |
| 1 | `config/interventions.yaml:100-105` (`add_record_step.when_to_use`, added `c2934ed` R-20, 15 Oct) | "for example not knowing when a tray was baked, or an order taken by phone not read back or noted" | Yes: verbatim in the v3 prompt (`lib/proposals/prompt.ts:85-89`) and via `get_intervention` in v4 (`tools.ts:172`) | **Strongest coupling.** The library entry both demo problems resolve to was written with the demo's two problems as its examples; the eval shows A and B pick `add_record_step` every run. Generic in form, demo in substance. |
| 2 | `lib/pipeline/label/prompt.ts:54-60` (threading rule, `63e724f` R-21 F-1, 16 Oct) | example: "after a phone call: 'that was a phone order, I did not read it back'" | Yes, every label call (pilot too) | A few-shot example lifted from card d2-c3's second line. Purpose is legitimate (keep a self-remark in the event's thread) but the wording is the demo's. |
| 3 | `lib/proposals/prompt.ts:40-41`, `lib/proposals/v4/prompt.ts:41-42` (rule 9, `263a725` R-21, 16 Oct) | "a slip or record names the order itself: say 'order details and pickup time'" | Yes | A privacy rule (never ask for a customer's name/phone) whose example is the phone-order fix. Rule 8's example "staff twice unable to answer the same customer question" (R-20) mirrors problem A in generic words. |
| 4 | `config/rubric.yaml:25` (10 Oct, before the script existed) | "Write the time on the tray label when the tray goes out" as the `observable` example | Yes | Bakery-flavoured but predates the script; generic. |
| 5 | `config/categories.draft.yaml:34` (CORRECTION definition tightened in `63e724f`) | "Not a speaker's own remark about what they themselves just did or forgot" | Yes | Generic wording, motivated by the rehearsal. All per-category `examples` are still the literal `TODO` and are skipped by the prompt builder (`label/prompt.ts:22-27`). |
| 6 | `scripts/demo-sop.ts:19-52` (demo SOP v1, 5 steps incl. `serve-01` "confirm it back") | the SOP being improved | Yes (prompt / `get_sop_section`) | **Legitimate**: the SOP is the object of the task. |
| 7 | `lib/transcribe/vocabulary.ts:21-26, 46-48` + `.gitignore:20` + `cloudbuild.yaml:20-30` | private `config/vocabulary.yaml` is gitignored; Cloud Build packs the git checkout, so the deployed demo uses `config/vocabulary.example.yaml` (flat white, cortado, sourdough, "Proofed", barista...) | Yes (transcription hints) | **No story terms** (no "egg tart", "Demo Bakery", "read back"). "Proofed" (pilot name) is in the example list: harmless, but a real-shop word in a fictional demo. I could not verify the running container's filesystem, only that git cannot carry the private file. |
| 8 | `app/proposals/watch-placeholders.ts:12-15` | pre-draws `CUSTOMER_SERVICE` and `PHONE_CALL` rows as "Not seen yet" on demo sandboxes | No (display only) | Demo scaffolding: tells the judge what to expect before the pipeline has seen it. Should be named as such in the deck. |
| 9 | `lib/demo/guide.ts:270` (debrief tip) | "The phone order did happen, so answer Yes and type ... I did not read the order back to the caller." | Indirectly: the judge's typed reason becomes the `staff note` the proposal prompt sees (`service.ts:376-389`) | Judge-read text; it also seeds the exact staff note that makes problem B strong. Honest to call it "guided input". |
| 10 | `lib/demo/script.ts` cards; `problem` field | the script | No: "no server code reads it" (`script.ts:12-13`) | Text the judge reads. |
| 11 | `lib/demo/guide.ts:655, 673-684` (card unlock), `lib/demo/closing.ts:64-66` + `script.ts:175-177` (closing needs >= 5 heard lines) | counts of transcribed lines only | No text matching anywhere | Scaffolding; speech-gated, never time- or content-gated. |
| 12 | `scripts/demo-seed-template.ts:17-25, 169-203` (inverted clean check) | the template must hold **no** evidence-category fact; routine-only | n/a | Guarantees no seeded history can create or pad a proposal; the judge's own three days must. |
| 13 | `scripts/eval-scenario.ts`, `scripts/eval-fixtures/scenario-v2.ts`, `lib/proposals/testing/{rehearsal-fixture,v4-world}.ts` | expected categories per card (`kind`) | No: not imported by `lib/` or `app/` runtime (grep) | Test/eval only. |
| 14 | `lib/demo/next-day.ts:24-25`, `lib/demo/clone.ts:38-42` | time shifts never touch labels, summaries, lines, gate decisions | n/a | Scaffolding, rule-10 safe. |

Canned output: none. A model failure is a 503 (`service.ts:439-441`) or a `blocked` / `suppressed` doc; no fallback
proposal text exists (grep for canned/fallback text: nothing).

### 3.2 Conclusion on the claim

The app never compares the spoken line with the script. What becomes a fact is decided by `evaluateGate`
(`lib/pipeline/gate.ts:379-428`) from the label's category, confidence and evidence lines; what becomes a proposal is
decided by the floor (`lib/proposals/precheck.ts:27-50`), the model's choice among offered ids, and `pgate-v1`. So
"purely examines the data" holds for **data**. For **instructions**, say it this way: "the prompts and the intervention
library are generic, but two examples in them and one library entry were written while rehearsing this script". If a
judge asks whether the pipeline would find a different problem in a different clip: yes, provided it is a 2-day repeated
problem in one evidence category (3.4).

### 3.3 Predefined steps: product rules vs demo scaffolding

Product rules (apply to the pilot too; all plain code):
- Gate precedence and waives: `lib/pipeline/gate.ts:46-58, 167-174, 194-210`.
- `PHONE_CALL` always a question (`lib/pipeline/categories.ts:44-50`; `categories.draft.yaml:38-44`; "one side audible").
  Staff Yes waives it and makes a fact (`gate.ts:194-198`, `lib/debrief/answer-plan.ts:106-122`).
- `NEEDS_SUPERVISOR_CONFIRM` = COMPLAINT, CORRECTION, SAFETY_INCIDENT, SECURITY_INCIDENT, DISRUPTION
  (`categories.ts:36-42`): a staff Yes is **not** enough (`gate.ts:264-269`); a supervisor confirm on the Day record is
  (`lib/day/confirm-service.ts:150`, `gate.ts:205-210`).
- Fact threshold 0.9 for every category (`categories.ts:83-95`, uncalibrated).
- floor-v2: >= 2 facts on >= 2 dates in ONE category (`lib/proposals/constants.ts:9-11, 21`; `precheck.ts:42`;
  `proposal-gate.ts:76`; commit re-check `service.ts:802`). ROUTINE_OPS never evidence (`constants.ts:13-18`,
  `candidates.ts:87`; R-19 D-3 "pilot and demo alike").
- One focus category per proposal, at most 2 focuses per Ask, cited threads and taken categories not reused
  (`service.ts:274-284, 609-629`).
- Debrief question wording: one fixed sentence per category from the enum (`lib/i18n/category-labels.ts:95-106`,
  `lib/i18n/v2/debrief.ts:95-101`), "Bee6 heard:" + at most 2 scrubbed lines of the thread
  (`lib/debrief/constants.ts:28-29`), Yes/No, reason required; ranked incident first, cap 5 (`lib/debrief/rank.ts:7-10`,
  `constants.ts:21`).
- Review rule rev-v1 (2.1).

Demo scaffolding (demo project only, never on the pilot): script cards and order, card unlock by heard lines, jump to
closing, jump to tomorrow (data shift), watch placeholders (#8), guide tips (#9), fast-forward review, template clean
check, sandbox caps, `script_id: "bakery-v2"` literal in the capture config (`lib/capture/contract.ts:213, 230`).

### 3.4 Rangga's design goal: "every scenario clip should definitely create a proposal, varied by scenario"

What in the current rules stops that, in order of how often it would bite:

1. **One clip never does; two days in one category must.** floor-v2 needs 2 facts on 2 distinct business dates in the
   same category. A single day's clip, however strong, ends as "suppressed, 1 of 2 days". This is the product's premise
   ("a repeated problem"), so any scenario is by construction a 2-day story (the script already does days 1-2 and 2-3).
2. **ROUTINE_OPS is excluded.** "Routine ops not properly done" will be labelled ROUTINE_OPS ("Everyday work (SOP steps,
   stock, handoffs...)", `categories.draft.yaml:8-10`) and never counts (`candidates.ts:87`). It would never pass the
   floor as the rules stand.
3. **Label consistency across the two days.** If day 1 lands as DISRUPTION and day 2 as COMPLAINT, neither category
   reaches 2 dates. There is no cross-category pooling. (`eval-scenario` exists precisely to check this per card.)
4. **Human confirmations on the path to "fact".** CUSTOMER_SERVICE/TRAINING/STAFF_CONSULT/EVENT become facts directly at
   >= 0.9 confidence, else via a staff Yes. PHONE_CALL needs a staff Yes in the debrief on both days (the guide tells the
   judge). COMPLAINT and the incident categories need a **supervisor confirm per thread** on the Day record after a staff
   Yes; the guide's `day` card already says "Confirm the note that needs your check" (`guide.ts:299`), but the stage order
   sends the supervisor to the Day record only after day 1, so a day-2 complaint needs another visit before Ask.
5. **The model may decline.** Rule 8 (`prompt.ts:33-36`) declines `no_clear_pattern` when the two facts are "routine,
   unrelated or one-off"; the eval's `weak_cs` case (two unrelated customer-service facts on two days) was declined 3/3 by
   both agents. The two days must show the *same gap*, not merely the same category.
6. **Gate/text/redaction failures** end as `blocked` (schema, pgate, text rules, output too long, evidence stale), not a
   proposal; and a second Ask on the same range reuses the open proposal unless "Generate another".
7. Review period and `MIN_EVIDENCE` do not block creation; the review period only matters for Q2.

Per variant:

- **Customer complaint.** Label COMPLAINT (needs supervisor confirm) -> debrief question on both days (tier 1) -> staff
  Yes -> still `open` -> supervisor confirm on the Day record for each of the two threads -> 2 facts / 2 dates ->
  floor ready -> model needs the same gap on both days (e.g. twice "wrong item handed over", not "wrong item" then
  "long wait") -> likely `add_script` / `add_failure_path` / `capture_unmet_request`. **Would pass** with no rule change
  if the journey includes the two supervisor confirms (guide step) and the script keeps one complaint type. If the extra
  taps are unacceptable, the smallest rule change is to let a staff Yes promote COMPLAINT (drop it from
  `NEEDS_SUPERVISOR_CONFIRM`); I do not recommend that: it is a pilot-facing product rule, and "a complaint is
  confirmed by a supervisor" is defensible.
- **Service incident.** There is no such category. The model will pick CUSTOMER_SERVICE (fact path, easiest),
  COMPLAINT, DISRUPTION or SAFETY_INCIDENT (supervisor confirm, debrief tier 0). It passes the floor only if both days
  land in the **same** category; incidents are the most likely to drift between categories. Write the script so the two
  days are unmistakably one category (e.g. both DISRUPTION: "the oven tripped again, customers waited"), then it behaves
  like the complaint variant (supervisor confirms) and resolves to `add_failure_path`.
- **Routine ops not properly done.** As the rules stand, **never**: ROUTINE_OPS is excluded, and the only neighbouring
  category, CORRECTION, requires a supervisor to have corrected someone on the spot (and needs supervisor confirm).
  A self-report ("I forgot to log the leftovers") has no evidence-eligible home today.

### 3.5 Smallest change that keeps rule 10 intact (design sketch)

Keep floor-v2, keep the per-category focus, keep every decision in code. Change the **category set**, which is config +
plain-code tables, not AI:

1. **Add one work category `SOP_DEVIATION`**: "a step the SOP names was skipped, done late, done without a required
   check, or done from memory, reported by the person or observed; not a supervisor's correction (CORRECTION) and not
   normal work (ROUTINE_OPS)". `always_question: true` (a self-report is confirmed by the staff member in the debrief,
   like PHONE_CALL), `needs_supervisor_confirm: false`, evidence-eligible. Files, all mechanical and enforced by `tsc`
   through the exhaustive `Record<WorkCategory, ...>` tables: `lib/pipeline/categories.ts` (`CATEGORIES`, `ALWAYS_QUESTION`,
   `GRACE_MS`, `FACT_THRESHOLD`), `config/categories.draft.yaml` (entry + `decision_order` between CORRECTION and
   STAFF_CONSULT), `lib/i18n/category-labels.ts` + `lib/i18n/v2/debrief.ts` (label and `C-d2-why-SOP_DEVIATION`),
   `lib/debrief/rank.ts` (falls into tier 1 automatically), `config/interventions.yaml` `when_to_use` mentions,
   `app/proposals/watch-placeholders.ts` (if a third demo row is wanted), the label wire schema needs nothing
   (`CategorySchema` is derived, `lib/pipeline/label/wire-schema.ts:2, 53`). This makes the "routine not done" variant a
   2-day, staff-confirmed problem that resolves to `add_record_step` / `change_trigger` without touching the gate's logic.
2. **Fill the `examples` in `config/categories.draft.yaml`** (today every one is `TODO` and skipped). One real / one
   not-this pair per category is the cheapest lever for point 3 above (label consistency across the two days), and it is
   config, not code. Write them generically (no demo items); the demo script then benefits without being named.
3. **Do not** pool categories, lower the floor to one day, add canned text, or auto-promote complaints. Each would either
   break the product's "repeated problem" premise or move a decision from code to convenience.
4. **Accept that "definitely" cannot be guaranteed by code**: the model may still decline a genuinely weak pair
   (`no_clear_pattern`). The honest guarantee is "a clear 2-day repeated problem in one category produces a proposal";
   the eval harness (`npm run eval:scenario`, `npm run eval:proposal`) is where each new scenario clip gets that proven
   before it goes in the guide.

Effort: item 1 is a half-day mechanical slice for `developer` (tables + yaml + i18n + tests) plus one `eval:scenario`
run per new clip; item 2 is Tiffany/Rangga copy work. Neither touches the pilot's data model beyond adding an enum value
(existing docs stay valid). Not a submission-day change.

---

## What I could not verify

- The running `web`/`web-develop` container filesystem (whether any non-git file such as `config/vocabulary.yaml` was
  ever baked in). Git and `cloudbuild.yaml` say it cannot be.
- The live scheduler state today (read from `docs/tasks/R-01-gcp-state.md` and `docs/HANDOFF.md`, not from `gcloud`).
- Whether D2 (live staging QA with the flag on) was run after the last HANDOFF entry; the docs say it was not.

---

## Floor-v2 and day gaps (tech-lead, 18 Oct, read against `origin/develop` 0c9e9e3)

Rangga's question: "the plain-code gate only detects 2 facts on 2 days when both run on 2 CONSECUTIVE days, and the
sentence must be quite exact?" **Both halves are false.** Days need not be consecutive, and no rule reads the sentence.

### F1. What "2 different days" means (file:line)

| Question | Answer | Evidence |
|---|---|---|
| Consecutive or just distinct? | **Distinct calendar business dates only.** The floor counts `Set<local_date>.size >= 2` per category; nothing compares dates to each other. | `lib/proposals/precheck.ts:33,35,42`; `lib/proposals/constants.ts:10-11` (`MIN_EVIDENCE_FACTS = 2`, `MIN_EVIDENCE_DATES = 2`) |
| Day 1 + day 3 with the fact, day 2 without (gap) | **Passes** (2 distinct dates). The empty day is simply absent from the set. | same lines |
| Day 1 in category A, day 2 in category B | **Fails.** Rows are keyed by category first; each row has 1 date. There is no cross-category pooling. | `precheck.ts:28-37` (`byCategory` map), `:42` |
| 3 days where two categories each have 1 day (e.g. A, B, none) | **Fails**, same reason; the watch shows the closest row ("1 of 2 days"). | `precheck.ts:57-65`, `:72-82` |
| Lookback window | **No N-day drop inside the floor.** The range is the caller's: the supervisor Ask sends the watch range `[today-6, today]` (7 business dates); the server only validates it (`<= 14` days, `from >= today-(retention-1)` = today-13 by default). Older threads are dropped by Firestore TTL (P4, 14 days), not by the floor. | `lib/proposals/review-contract.ts:82` (`WATCH_DAYS = 7`), `lib/proposals/review-service.ts:135`, `app/proposals/SupervisorProposals.tsx:254-255`, `lib/proposals/range.ts:29-36`, `lib/proposals/service.ts:211-218` |
| Do confirmed facts count the same? | **Yes, identically.** The candidate filter is `status === "fact"` and not `excluded_from_evidence` and not `label_source === "supervisor_rejected"`; it never looks at `gate.fired_rule` or `label_source` otherwise. A staff Yes writes `status: "fact"` (`staff_confirmed`); a supervisor confirm writes `status: "fact"` (`supervisor_confirmed`, and uses `confirmed_category` as the effective category). A staff No sets `excluded_from_evidence: true` (dropped). | `lib/proposals/candidates.ts:82-85`; `lib/debrief/answer-plan.ts:117-128`; `lib/day/confirm-service.ts:163-171` |
| What is a "day" after the demo's Jump-to-tomorrow shift? | The candidate's `local_date` is the **capture session's business date** (`attributedBusinessDate`: the session containing `first_line_start_ms`, else the calendar business date in the outlet zone). The shift moves every `*_ms` back one day and every `local_date`/`business_date` key back one day, consistently, and never touches category, confidence, gate or status. So the three demo days are three consecutive business dates (`today-2, today-1, today`), all inside the 7-day watch range. | `candidates.ts:88-90`; `lib/day/attribution.ts:60-84`; `lib/demo/next-day.ts:24,133-138,174-181`; `lib/demo/clone.ts:108,143-158` |
| Things that do shrink the pool | Threads already cited by an **open** proposal are not offered again, and a category an open proposal is about is "taken" (so "Ask for another" needs a second ready category). `ROUTINE_OPS` and `NON_WORK` never count. | `service.ts:277-284`; `candidates.ts:86-87`; `constants.ts:18` |

### F2. Exactness: where text matters and where it does not

**Code that never reads the sentence:** the evidence gate (`category`, `confidence`, `evidence_line_ids`, `label_conflict`
only: `lib/pipeline/gate.ts:122,146-173`); the floor (`category` + `local_date`: `precheck.ts:28-43`); the proposal gate
(`evidence_min` = >= 2 distinct thread ids **and** >= 2 distinct dates among the cited aliases, `metric_category` must be
one of the cited categories: `lib/proposals/proposal-gate.ts:65-79`). Thresholds are a flat 0.9 for every category
(`lib/pipeline/categories.ts:83-95`); PHONE_CALL is always a question, COMPLAINT/CORRECTION/incidents/DISRUPTION need a
supervisor confirm (`categories.ts:36-50`). The model's `runner_up` is stored and shown on the Day record but feeds nothing:
not the gate, not the floor, not the proposal (`lib/pipeline/threads.ts:251-253`, `lib/pipeline/tick/service.ts:204,219,390`;
no reader in `lib/pipeline/gate.ts` or `lib/proposals/*`).

**Every place where wording can matter (exhaustive):**

1. **The label call** (`lib/pipeline/label/prompt.ts`): the model picks the category and the confidence from the lines'
   text and the category definitions in `config/categories.draft.yaml`. This is the only place where a paraphrase can
   change the floor's inputs, by moving a day into a different category or under 0.9.
2. **Threading by gap, not text**: lines join an open thread only when the model resolves them to the **same category**
   and the gap is within `GRACE_MS` (2 min for CS/PHONE_CALL, 5 min incidents, 10 min TRAINING); two categories on one
   component = `label_conflict` = question (`threads.ts:260-280`, `categories.ts:64-76`). Text matters here only via (1).
3. **Rule 8 of the Proposal agent** (`lib/proposals/prompt.ts:33-36`): "the same gap, omission, uncertainty or mistake on
   at least two different dates, even when worded differently ... if the facts show only routine, unrelated or one-off
   events, answer no_proposal with reason no_clear_pattern". The model reads the fact `summary`, the `fields`, the
   thread's excerpt (R-20, up to 320 chars) and the staff debrief note (200 chars) (`prompt.ts:45-50`, `constants.ts:40-43`).
   Same category but a different problem on each day **can** be declined: the eval's `weak_cs` pair was declined 3/3
   (§3.4 point 5), and on 15 Oct round 1 the scripted A pair was declined 3/3 **because the summaries then omitted the
   problem** (day 1's staff line had been dropped by transcription; `QA-live-rehearsal-15oct.md:69,80,101`). R-20 fixed
   that by sending the excerpt, not by loosening the rule.
4. **Intervention choice and the SOP text** are the model's, graded by the proposal gate and the text rules; wording
   changes the proposal's content, never whether the floor passes.

**How far can the wording drift before the category changes? QA evidence:**

- Scripted A (customer asks when the tray was baked, staff cannot say): **CUSTOMER_SERVICE every time**: 9/9 on 15 Oct
  round 1 incl. four improvised/real paraphrases (`QA-live-rehearsal-15oct.md:87-90,97`), 15/15 cards on round 2
  (`...-15oct-round2.md:56`), 6/6 A threads + the var1/var3 days "all CUSTOMER_SERVICE facts" on 16 Oct round 3
  (`...-16oct-round3.md:47,95,121`). Confidence 0.9-1.0, always >= the 0.9 threshold.
- **One real flip on record:** the real-voice clip `real-q1-staff-a + b` ("When was the eclair baked? ... who baked the
  last tray?" / "I forgot what time it came out") labelled CUSTOMER_SERVICE 0.95 on one run and **STAFF_CONSULT 0.9 on
  another** (`...-16oct-round3.md:213`). Same clip, two runs, two categories. That is the risk shape: a question that
  reads as staff-to-staff rather than customer-to-staff.
- Scripted B: before the 15 Oct rewrite the staff's self-report line ("I hung up without reading the order back")
  was labelled as its own **CORRECTION** thread (needs supervisor confirm) on both phone days (`...-15oct.md:43`,
  `...-15oct-round2.md:47,51`). After the R-20 rewrite ("That was a phone order ... I did not read the order back")
  plus the F-1 threading fix it joins the PHONE_CALL thread 5/5 and 2/2 improv variants (`...-16oct-round3.md:47,73,77,218-219`).
  So a wording change did move a line's category once, and the fix was to make the sentence say "that was a phone
  order" rather than to tune code.
- The runner-up shows how close the model sits: A carried runner-up COMPLAINT twice (`...-16oct-round3.md:68`,
  `...-15oct.md:38`), B once runner-up CUSTOMER_SERVICE at 0.95 (`...-16oct-round3.md:77`). A paraphrase of A in which the
  customer sounds unhappy ("this is the third time nobody knows") is the likeliest flip to COMPLAINT, which then needs a
  supervisor confirm per day and would not pool with the CUSTOMER_SERVICE day.

Decisive answer: the sentence need not be exact; it needs to **keep the same category on both days** (and, for the
model's rule 8, describe the same gap). Verbatim A/B script cards have never flipped in three rehearsal rounds; real
improvised speech has flipped once in ~12 clips.

### F3. A judge picking variant A or B per day

Assume one clip per day, A = customer-asks-bake-time (CUSTOMER_SERVICE, auto-fact at >= 0.9), B = phone order not read
back (PHONE_CALL, fact only after the staff **Yes** in that day's debrief). The floor passes when any one category has
facts on >= 2 distinct dates; order and gaps are irrelevant.

| Picks (day 1, 2, 3) | Floor after day 2 | Floor after day 3 | Proposals available |
|---|---|---|---|
| A A A | CS ready | CS ready (3/3) | 1 (A). "Ask for another": none |
| A A B | CS ready | CS ready; PHONE 1 date | 1 (A) |
| A B A | **not ready** (1+1) | CS ready (days 1+3, gap on day 2 is fine) | 1 (A) |
| B A A | not ready | CS ready (days 2+3) | 1 (A) |
| B B A | PHONE ready (both Yes) | PHONE ready; CS 1 date | 1 (B) |
| B A B | not ready | PHONE ready (days 1+3, both Yes) | 1 (B) |
| A B B | not ready | PHONE ready (days 2+3, both Yes) | 1 (B) |
| B B B | PHONE ready | PHONE ready (3/3) | 1 (B) |
| A + B both on >= 2 days each (needs the current 2-problem days, e.g. day 2 = A and B) | as today | both ready | 2 (A, then "Ask for another" = B) |

Fails the floor: any 2-day story with **one of each** (A B or B A) and nothing else; any B day where the judge answers
**No** or skips the debrief (the thread stays `open` or is excluded, `answer-plan.ts:124-128`); any day where a
paraphrase lands in a third category. With one clip per day and three days, pigeonhole guarantees one category on two
days, so **every 3-day A/B path passes the floor**; only the 2-day mixed paths and the "no Yes" phone days do not. The
residual non-code risk is rule 8 (`no_clear_pattern`): A-A and B-B pairs are the same gap by construction and have
produced a proposal 5/5 Asks since R-20 (`...-16oct-round3.md:98-121`), so for the scripted cards it is not a practical
risk; it becomes one only if a variant clip describes a *different* customer-service problem on each day.
