# Proposal agent + "Critic functionality" — design pass (tech-lead, Sun 18 Oct 2026)

Read-only design pass against `origin/develop` = `e01621e` (via `git show`; nothing edited, no worktree created) and
`docs/tasks/{ai-capabilities-18oct, R-24-proposal-agent-tools, QA-r24-eval-16oct, TM-01, TM-02-adk-graph}.md`,
`docs/plan.md`, `docs/HANDOFF.md`. Skills loaded: `superpowers:brainstorming`, `api-design`, `security-review`.
Priority 2 behind the open bug-fix round. Submission is **today** (platform deadline Sun 18; freeze "Sun 18 afternoon",
HANDOFF). Every estimate below is agent time including tech-lead gate and QA.

## 0. The one-paragraph answer

**Do not build an LLM critic (options b and c). The Critic already exists on `develop` as plain code: v4's
`check_proposal` is the Critic folded into the Proposal agent (Rangga's 16 Oct decision, R-24 header; HANDOFF "No
separate CriticAgent. Plan C becomes R-24").** What is missing is not a check but **visibility**: every proposal doc,
v3 and v4, already stores `gate.checks[]` (8 pgate-v1 rules; 18 with pcheck-v4) and `generator.{agent_version,
check_version, v4.check_rounds, v4.tool_calls}`, and `toProposalView` exposes **none of it** (only `blocked_rule`,
`lib/proposals/view.ts:47`). Ship that line on the proposal screen ("Checked by Bee6: 8 of 8 checks passed") — it is
UI-only, works with the flag off, costs ~2.5 h, and is the only Critic-shaped thing a judge can see today. Whether to
also switch v4 ON for judges is a separate go/no-go (§5); my lean is **OFF on `web` for judging** unless the bug-fix
round closes early enough for D2 live QA plus a judge-journey re-run, because v4 doubles the one wait the judges
watch and its live service path has never been exercised.

## 1. Goal alignment, hard-rule risk, deliverability (per option)

Shared facts (QA-r24-eval §9): v3 and v4 produce the **same outcome on every eval case** (propose/decline, cited
aliases, intervention); v4 = ×3.6 tokens, ×5.6 calls, p95 14.7 s vs 6.3 s per focus; 0 defects on the final code;
D2 (live staging with the flag on) **never ran**; `main` now carries the v4 code (30c931d), flag unset everywhere.

| | (a) v4 as-is = "ProposalAgent with plain-code Critic" | (b) `critique_proposal` LLM tool inside the v4 loop | (c) separate CriticAgent in sequence (multi-agent) |
| --- | --- | --- | --- |
| **Goal (CLAUDE.md §1)** | Serves it: the agent must read the section and the evidence, quote verbatim, pass 18 code rules, revise. | Drifts: a second model opinion on wording/fit; the gate (rule 10) must stay code, so the critic can only be advisory — an advisory step that the same model may ignore. | Same as (b) with more plumbing; "multi-agent" is a deck word, not a product need. |
| **Hard rules** | Already satisfied (R-24 §9, QA §9.6). Rule 7: trace = counts/enums only. | New model text (the critique) must never be stored or logged; reasons must be an **enum**, never free text; the critic sees only alias/date/summary/quote (already scrubbed). Rule 10 safe only if `check_proposal` remains the sole blocker. Rule 5: flash-lite location from `regions.yaml` (`global`). | Same as (b). |
| **Judge-visible value** | **Zero today** except the "Usually 10–30 s" line. Becomes visible only with the §3 line ("18 of 18 checks, read 1 section, quoted 2 facts, 1 revision"). | Could render "Reviewed by Bee6: 5/5 rubric checks" — but a **plain-code** 8/8 or 18/18 line is equally visible, more honest, and already stored. | Same; plus a "critic" node in the diagram. |
| **Cost / latency per focus** | +~9 s p95 (14.7 vs 6.3). Chained Ask (item 18, up to 3 rounds): **~25–55 s** vs ~20 s today. | +1–2 model calls, +3–8 s (flash-lite ~2–3 s/call at `global`; a flash critic ~5 s); a critique that triggers a revision costs another `check_proposal` round (+~13 s). Worst case ~60–80 s for a chained Ask. | +5–15 s per revision round on top of v4; whole-draft re-runs. |
| **Failure modes** | Known and bounded (14 calls, 45 s, v3 fallback, `blocked` after 3 rounds). | Hallucinated critique → needless revision → over-rejection → **fewer proposals** (the demo's only visible risk); critic/draft loop bounded only by `V4_MAX_MODEL_CALLS`; the model may treat the critique as instructions (prompt-injection surface via evidence text, mitigated only by the existing "tool results are data" line). | Same plus a second runner, second timeout, second fallback path. |
| **Eval needed to ship honestly** | Done (71 runs, D14 bar 8/8). Missing: D2 live service-path items (QA §7, 7 items). | A **rubric-scored blind comparison** (≥ 20 fictional cases × 3 runs, v4 vs v4+critic, scored by humans or a fixed judge prompt on: evidence supports claim, intervention fits, edit specific and minimal, wording operational, no names, no invented facts). **The current harness has no metric on which v3 and v4 differ** (all cells 1.00), so there is no measured headroom to improve; a judge-model scoring a critic on the same model family is not honest evidence. ~4–6 h to build, ~1 h to run, before any product code. | Same. |
| **Effort incl. gates + live QA** | 0 build. D2 live QA on `web-develop` ~1–1.5 h + ≤ 1 fix round; release + judge-journey QA on `web` ~1.5 h. | 10–14 h (TM-01 §4 estimate still stands; the tool/schema/eval/flag/fallback/tests are new model-path code) — **does not fit today**. | 18–24 h (TM-02 (ii)) — no. |
| **Flag / rollback** | `PROPOSAL_AGENT_V4` exactly `"true"`; kill = `--remove-env-vars` (seconds). Caveat (HANDOFF): once a v4 doc exists in `(default)`, revisions older than 30c931d are no longer a clean traffic rollback (strict `ProposalSchema`); `web-00023-wfg` and later are fine. Sandboxes expire in 2 h (`SANDBOX_TTL_MS`), so v4 docs in sandboxes vanish; the non-sandbox `demo-outlet` would keep one. | Second flag `PROPOSAL_CRITIC` exactly `"true"`, only meaningful with v4 on; off = byte-identical v4. | Same. |

**Simpler alternative that gets most of the value:** the §3 "Checked by Bee6" line, flag-independent. It makes the
*existing* plain-code critic visible on every proposal (pilot and demo), and if v4 is switched on it automatically
shows the stronger numbers (18 checks, rounds, section/evidence reads) with no further UI work.

## 2. Recommendation (decisive)

1. **Do not ship an LLM critic.** No measurable gain exists to show (v3 = v4 on every case; a critic has nothing
   measured to improve), it adds latency to the one live flow judges watch, and it is new model-path code on
   submission day. Say in the deck/README: "The Critic is plain code (`check_proposal`, 18 rules); the model proposes,
   code decides" — that is the stronger story under hard rule 10, not a weaker one.
2. **Build the "Checked by Bee6" line (§3) now** — UI + view, additive, ~2.5 h, no model path touched, no flag.
   Route: `developer-junior` for the view/contract/i18n (mechanical, exact shapes below), `uiux` default model for the
   two components. This works on `web` with v3 and is the honest Critic-visible deliverable.
3. **v4 ON for judges = separate go/no-go (§5)**, only after the bug-fix round is closed and only if D2 on
   `web-develop` is green with ≤ 1 fix round by Rangga's cut time. If it does not fit: v4 stays OFF, the deck uses
   R-24 §11 "merged but off" wording with the eval numbers, and (optional) the video is recorded on `web-develop` with
   the flag on so the 18-check line is on screen without touching the judges' link.
4. **Cut:** option (b)/(c), any second flag, any critic eval harness, any change to `MAX_ASK_ROUNDS`,
   `GENERATE_PER_SANDBOX`, `V4_MAX_CHECK_ROUNDS` (round 1 passes 68/68; lowering it changes nothing typical).

## 3. Slice CHK-1 — "Checked by Bee6" line (exact plan; junior-executable)

Pure read-through of data every proposal doc already carries. **No new route, no new Firestore field, no model call,
no flag.** Additive to the view (`.strict()` schemas: add the key on both schema and mapper).

### 3.1 `lib/proposals/contract.ts` — add to `ProposalViewSchema` (after `blocked_rule`)

```ts
/** CHK-1: how this proposal was checked; counts and enums only (hard rule 7). null on a suppressed doc (no checks ran). */
checked: z
  .object({
    checks_total: z.number().int().min(0),
    checks_passed: z.number().int().min(0),
    rule_set: z.enum(["pgate-v1", "pcheck-v4"]),
    agent: z.enum(["proposal-v3", "proposal-v4", "other"]),
    revisions: z.number().int().min(0).max(2),      // v4 check_rounds - 1 (clamped at 0); v3: attempts - 1 (clamped 0..2)
    read_sections: z.number().int().min(0).nullable(), // v4: count of `get_sop_section` tool calls with ok=true; v3: null
    read_facts: z.number().int().min(0).nullable(),    // v4: count of `get_evidence` ok=true; v3: null
  })
  .strict()
  .nullable(),
```

### 3.2 `lib/proposals/view.ts` — in `toProposalView`, explicit keys only (never a spread)

```ts
checked: stored.gate.checks.length === 0
  ? null
  : {
      checks_total: stored.gate.checks.length,
      checks_passed: stored.gate.checks.filter((c) => c.passed).length,
      rule_set: stored.generator.check_version === "pcheck-v4" ? "pcheck-v4" : "pgate-v1",
      agent:
        stored.generator.agent_version === "proposal-v4" ? "proposal-v4"
        : stored.generator.agent_version === "proposal-v3" ? "proposal-v3" : "other",
      revisions: stored.generator.v4 && !stored.generator.v4.fell_back
        ? Math.max(0, stored.generator.v4.check_rounds - 1)
        : Math.min(2, Math.max(0, stored.generator.attempts - 1)),
      read_sections: stored.generator.v4 && !stored.generator.v4.fell_back
        ? stored.generator.v4.tool_calls.filter((t) => t.name === "get_sop_section" && t.ok).length : null,
      read_facts: stored.generator.v4 && !stored.generator.v4.fell_back
        ? stored.generator.v4.tool_calls.filter((t) => t.name === "get_evidence" && t.ok).length : null,
    },
```

Edge cases (implement every row): suppressed doc → `gate.checks` is `[]` → `checked: null`. Blocked doc → counts
show e.g. `7 of 8` and `blocked_rule` as today. v4 doc that fell back to v3 (`v4.fell_back = true`) → the doc was
produced by v3: `agent: "proposal-v3"`, `rule_set: "pgate-v1"`, `read_*: null`. Pre-R-19 docs (no `v4`, no
`check_version`) → v3 shape. Tool names are already sanitised/clamped at write time (R-24 §3.5) — compare by exact
string. `attempts` is per Ask (up to 4 across focuses) so `revisions` is clamped at 2 for v3 — label it "revisions"
only when ≥ 1 (see copy).

### 3.3 i18n — `lib/i18n/v2/proposals.ts` (EN + ID columns, ID marked `// PROVISIONAL`)

| key | EN | ID (provisional) |
| --- | --- | --- |
| `C-propd-checked` | `CHECKED BY BEE6 · {passed} OF {total} CHECKS` | `DIPERIKSA BEE6 · {passed} DARI {total} PEMERIKSAAN` |
| `C-propd-checked-code` | `Every check is a fixed rule in code, not the model's opinion.` | `Setiap pemeriksaan adalah aturan tetap dalam kode, bukan pendapat model.` |
| `C-propd-checked-v4` | `The agent read {sections} SOP section(s) and {facts} fact(s) before writing.` | `Agen membaca {sections} bagian SOP dan {facts} fakta sebelum menulis.` |
| `C-propd-checked-rev` | `Revised {n} time(s) until every check passed.` | `Direvisi {n} kali sampai semua pemeriksaan lolos.` |

Copy is a draft for Tiffany/Rangga; English wins on ambiguity (CLAUDE.md §1). No rule names in the line (the raw
codes already render in `C-prop-blocked`; do not add more).

### 3.4 UI — `app/proposals/ProposalDetail.tsx` (supervisor) and `app/proposals/ApprovalCard.tsx` (owner)

One `Card` block directly **after** the evidence block, same `styles.block` / `b6-kick` pattern as
`C-propd-evidence` (`ProposalDetail.tsx:196-212`). Render only when `content !== null && checked !== null`.
Lines: kicker `C-propd-checked`; body `C-propd-checked-code`; then `C-propd-checked-v4` only when
`read_sections !== null`; then `C-propd-checked-rev` only when `revisions >= 1`. No icons, no colour semantics (a
`7 of 8` on a blocked doc reads as text). 360 px: it is text in the existing block style; nothing new to size.
Owner card: kicker + `C-propd-checked-code` only (the owner summary stays short).

### 3.5 Tests (exact)

- `lib/proposals/view.test.ts`: (1) suppressed → `checked: null`; (2) v3 awaiting_supervisor fixture with
  `attempts: 2` → `{8, 8, "pgate-v1", "proposal-v3", revisions 1, null, null}`; (3) v4 fixture
  (`check_version: "pcheck-v4"`, `v4: { check_rounds: 2, tool_calls: [get_sop_section ok, get_evidence ok,
  get_evidence ok, get_evidence ok=false, check_proposal ok, check_proposal ok], fell_back: false }`, 18 checks all
  passed) → `{18, 18, "pcheck-v4", "proposal-v4", 1, 1, 2}`; (4) v4 fell back → v3 shape with `read_* null`;
  (5) blocked v3 doc with one failed check → `checks_passed 7`; (6) the existing "no thread_id/device_id/question_id
  key anywhere" test still passes (extend its fixture with the v4 trace).
- `lib/proposals/contract.test.ts`: `ProposalViewSchema` rejects an unknown key inside `checked` and accepts `null`.
- `app/proposals/ProposalDetail.test.tsx`: renders the kicker "8 OF 8 CHECKS"; hides the v4 line when
  `read_sections` is null; shows it with "1 SOP section(s) and 2 fact(s)" on a v4 view; nothing rendered when
  `checked` is null.
- `app/proposals/ApprovalCard.test.tsx`: kicker present on a view with `checked`, absent when null.
- Any test that builds a `ProposalView` literal (`SupervisorProposals.test.tsx`, `ApprovalsReview.test.tsx`,
  `guide-bridge.proposals.test.tsx`, `review-service` fixtures) gains `checked: null` or the v3 shape — the
  `.strict()` schema will tell `tsc`/vitest exactly where.

### 3.6 Hard rules

1 Google-only: no model call. 2/3: no new stored text. 5: n/a. 6: data flows through the existing list/detail routes
with their unchanged role+outlet checks. **7: counts and enums only** — `tool_calls[].name` is never exposed, only
two counts derived from it; no ids. 8/9/10: untouched (the line *reports* the plain-code gate; it decides nothing).
Pilot: the supervisor/owner proposal screens show the line too (it is a product fact, not demo scaffolding); if Rangga
wants the pilot byte-identical, gate the `Card` on `project_kind === "demo"` is **not** available in the view —
the honest options are "show everywhere" (recommended) or "do not build". Question for Rangga (§6).

### 3.7 Routing, estimate, merge

`developer-junior`: 3.1, 3.2, 3.3, 3.5 view/contract tests (~1 h). `uiux` (default model): 3.4 + component tests
(~1 h). Tech-lead delta review + QA live on `web-develop` (one Ask on a fresh sandbox, supervisor detail and owner
card, 360 px) ~0.5 h. One PR to `develop`; goes to `main` only inside the next release Rangga approves. Dev-mode
(DEV-01): not needed — the line is visible on any proposal.

## 4. If an LLM critic is ever built (post-submission; recorded so nobody re-derives it)

Shape (b) only: a `critique_proposal(draft)` tool on the v4 agent, `gemini-3.5-flash-lite` at its `regions.yaml`
location, `responseJsonSchema` → zod `{ verdict: "ok" | "revise", reasons: z.array(z.enum([...6 rubric codes])).max(6) }`,
temperature 0, no thoughts; input = the draft + the same `get_evidence` payloads already in the session (alias-keyed,
scrubbed). Advisory only: `check_proposal` stays the sole blocker (rule 10); the critic may run at most **once** per
run (session flag) so it cannot loop; its result is stored as `generator.v4.critic: { verdict, reasons[] }` (enums
only); a critic error is ignored (`verdict: null`), never a fallback trigger. Flag `PROPOSAL_CRITIC` exactly
`"true"`, inert unless v4 is on. Ship bar: the §1 rubric-scored blind comparison shows a gain on ≥ 2 rubric axes with
no loss in propose rate on A/B and no loss in decline rate on weak_cs; p95 per focus ≤ 20 s. If that bar is not met,
it does not ship — and on today's evidence it would not be met because there is nothing measured to gain.

## 5. v4 ON for judges — go/no-go bar and plan (only if Rangga wants it today)

Pre-conditions, in order: (1) bug-fix round closed and QA SHIP on `web-develop`; (2) `PROPOSAL_AGENT_V4=true` on
`web-develop` only (dev-ops); (3) QA runs QA-r24-eval §7 items 1–6 live, plus the two chain-specific checks below;
(4) ≤ 1 fix round; (5) release to `main` with the flag **unset**, judge journey on v3; (6) flag on `web`, one judge
journey timed; (7) kill = `--remove-env-vars=PROPOSAL_AGENT_V4`; rollback target = the flag-off revision of the same
build (never an older tag once a v4 doc exists in `(default)`). Elapsed estimate: ~3–3.5 h wall from (2) to (6).

Chain-specific checks (demo feedback 2 item 18 + R-24 D11 interact; nobody has run them together):
- **Overrun line false positive.** `GeneratingState` starts its `max_s` (30 s) timer on mount and the chain keeps it
  mounted across rounds (`SupervisorProposals.tsx:172,263-300` updates `round` state; the block is not re-keyed). A
  2-round v4 chain (~25–35 s) will show "Taking longer than usual…" on most Asks. Fix if confirmed (one line, uiux):
  `key={round?.n ?? 0}` on `<GeneratingState>` so each round restarts the estimate, and the "n of total" line keeps
  its meaning. Verify on `web-develop` before any switch on `web`.
- **Caps.** One tap = up to 3 generate calls = 3 charges against `GENERATE_PER_SANDBOX = 8`; unchanged by v4, but a
  judge now waits up to ~55 s for them. `MODEL_DAILY` under-counts v4 (documented, R-24 §3.10); `GENERATE_DAILY = 300`
  bounds it.
- Latency levers that are **not** available today: no parallel focuses (single-flight lease per outlet), no
  flash-lite proposal agent (never evaluated), fewer check rounds changes nothing typical (round 1 passes 68/68). The
  honest number for the deck if ON: "about 10–30 s per proposal; the screen says so".

My lean: **OFF on `web`** unless (1)–(4) are done with ≥ 2 h left before Rangga's own stop time. The judges see the
same proposal either way; the only visible difference is a longer, explained wait and — with CHK-1 — "18 of 18"
instead of "8 of 8".

## 6. Questions for Rangga

1. Approve CHK-1 (§3) as the "Critic functionality" deliverable for today? Show the line on the pilot screens too
   (recommended), or not build it at all — there is no clean demo-only gate in the view.
2. v4 ON for judges: do you want the §5 go/no-go attempted today at all, and what is your cut time? If not, confirm
   the deck line "built, evaluated offline (71 runs, 0 defects, same outcomes as v3), off for stability".
3. Record the video on `web-develop` with the flag on (18-check line on screen) while `web` stays v3?
4. Copy sign-off for the four `C-propd-checked*` strings (EN + provisional ID).
5. Confirm "no LLM critic before submission" so the enhancement list in HANDOFF can close that item.
