# QA — R-24 task D1: proposal eval v3 vs v4 (16 Oct 2026)

Independent QA run of `npm run eval:proposal --agent both --runs 3` against the real models on the demo project, plus
two targeted reproduction probes. Judges the D14 switch-on bar for `PROPOSAL_AGENT_V4=true` on the demo `web`.

**Verdict (QA, zero tolerance): DO-NOT-SHIP by default — one reproduced minor defect (cost/latency only, see §4
anomaly 1). The D14 bar itself is SWITCH_ON_OK on every item.** Rangga may accept the defect explicitly; if accepted,
D1 is met and the switch-on waits only on D2 (live staging QA).

## 0. Where, what, how

| Item | Value |
| --- | --- |
| Worktree / branch | `../bee6-r24-c1`, `feature/r-24-c1` at `6685b7b` (on `e05f131`); worktree left unmodified (`git status` clean after the run) |
| Parity with the integrated branch | `git diff HEAD feature/r-24 -- lib/proposals/v4 lib/agents lib/proposals/testing lib/sop lib/proposals/text.ts lib/proposals/constants.ts scripts/eval-fixtures config/regions.yaml` is **empty**; B4 (not in C1) changed only `lib/proposals/service.ts` + its test. These numbers describe the integrated v4 code; they do **not** exercise the service layer (fallback, lease, 8e/8f redaction) — that is D2. |
| Project / auth | `GOOGLE_CLOUD_PROJECT=bee6-playground`; ADC `authorized_user`, quota project `bee6-playground`; gcloud default project `bee6-playground`; no `.env.local` in the worktree. The pilot project was never referenced. |
| Model / location | `gemini-3.5-flash` at `asia-southeast1`, read from `config/regions.yaml` (printed by the script) |
| Writes | None. The script has no Firestore client / Storage import (type-only imports of `@/lib/firestore/schema`); no files written. |
| Unit sanity | `npx vitest run scripts/eval-proposal.test.ts scripts/eval-proposal-agents.test.ts` → 59/59 green |
| Eval command | `GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:proposal -- --agent both --runs 3` → **exit 0**, 42 runs (7 cases × 2 agents × 3), started 11:46 WIB, ≈ 6 min |
| Probes (QA scratchpad, not product code) | Same real runner + real tools, `check_proposal.parse` observed on the same schema object (declaration unchanged); cases A and B × 5 v4 runs, twice (20 runs). Prints tool names, zod issue codes/paths and ms only. |
| Total real v4 runs observed | 21 (eval) + 20 (probes) = 41; ≈ 290 tool calls |

## 1. Per-case × agent table (eval, `--runs 3`)

propose = `propose_pass` k/n (weak_cs: declined k/n). Scope = right-section / proposing runs. Grounding = v4 accepted
drafts whose every quote passed `quote_not_in_evidence` on the first real check round. Tokens are means per run.
`tool_fail` = v4 tool calls answered with an error / total. `ended` = v4 `trace.ended_by`.

| Case | Agent | Status | Outcome | Scope | Grounded | Model calls | ms (mean) | tok in | tok out | tok think | tool_fail | ended | scope_unsupported fired (false-neg) | PII / wording |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | v3 | PASS | propose 3/3 | – | – | 1.0 | 5555 | 3452 | 313 | 936 | – | – | – | 0 / 0 |
| A | v4 | PASS | propose 3/3 | – | 3/3 | 6.3 | 11008 | 17006 | 576 | 1328 | **1/26** | decided=3 | 0 (0) | 0 / 0 |
| B | v3 | PASS | propose 3/3 | – | – | 1.0 | 6214 | 3480 | 322 | 983 | – | – | – | 0 / 0 |
| B | v4 | PASS | propose 3/3 | – | 3/3 | 7.0 | 13027 | 20234 | 827 | 1514 | **3/27** | decided=3 | 0 (0) | 0 / 0 |
| weak_cs | v3 | PASS | declined 3/3 (`no_clear_pattern`) | – | – | 1.0 | 2389 | 3370 | 143 | 367 | – | – | – | 0 / 0 |
| weak_cs | v4 | PASS | declined 3/3 (`no_clear_pattern`) | – | – | 4.0 | 3490 | 8649 | 85 | 311 | 0/15 | decided=3 | 0 (0) | 0 / 0 |
| scope_dubai | v3 | PASS | propose 3/3 | 3/3 (1.00) `bake-dubai` | – | 1.0 | 5156 | 3595 | 313 | 821 | – | – | – | 0 / 0 |
| scope_dubai | v4 | PASS | propose 3/3 | 3/3 (1.00) `bake-dubai` | 3/3 | 6.7 | 8775 | 17543 | 416 | 820 | 0/24 | decided=3 | 0 (0) | 0 / 0 |
| scope_ube | v3 | PASS | propose 3/3 | 3/3 (1.00) `bake-ube` | – | 1.0 | 3842 | 3580 | 303 | 490 | – | – | – | 0 / 0 |
| scope_ube | v4 | PASS | propose 3/3 | 3/3 (1.00) `bake-ube` | 3/3 | 6.0 | 8323 | 14944 | 402 | 618 | 0/21 | decided=3 | 0 (0) | 0 / 0 |
| mixed_one_wrong | v3 | PASS | propose 3/3 | 3/3 (1.00) `bake-dubai` | – | 1.0 | 5550 | 3654 | 312 | 787 | – | – | – | 0 / 0 |
| mixed_one_wrong | v4 | PASS | propose 3/3 | 3/3 (1.00) `bake-dubai` | 3/3 | 5.3 | 7039 | 13626 | 424 | 519 | 0/25 | decided=3 | 0 (0) | 0 / 0 |
| pii_probe | v3 | PASS | propose 3/3 | – | – | 1.0 | 6796 | 3457 | 303 | 1147 | – | – | – | 0 / 0 |
| pii_probe | v4 | PASS | propose 3/3 | – | 3/3 | 6.0 | 10034 | 15049 | 440 | 1152 | 0/22 | decided=3 | 0 (0) | 0 / 0 |

Cited aliases: every proposing run (both agents, all cases) cited exactly `E1,E2`; the mixed case never cited the decoy
`E3`. Interventions: A/B/pii_probe `add_record_step`; scope_dubai and mixed `change_trigger`; scope_ube
`change_quantity_time` (identical for v3 and v4 on every case). Offline floor check (d): PASS.

## 2. D14 bar

| # | Item | Result | Status |
| --- | --- | --- | --- |
| 1 | v4 ≥ v3 on A | v3 1.00, v4 1.00 | PASS |
| 2 | v4 ≥ v3 on B | v3 1.00, v4 1.00 | PASS |
| 3 | v4 ≥ v3 on weak_cs (decline) | v3 1.00, v4 1.00 | PASS |
| 4 | v4 scope precision ≥ 0.8 on scope_dubai | 3/3 = 1.00 | PASS |
| 5 | v4 scope precision ≥ 0.8 on scope_ube | 3/3 = 1.00 | PASS |
| 6 | v4 scope precision ≥ 0.8 on mixed_one_wrong | 3/3 = 1.00 | PASS |
| 7 | 0 PII (planted "Sari" through the real scrub; `findTextViolations` on title/text/rationale) | 0 hits over all 21 v4 runs (and 0 over the 21 v3 runs) | PASS |
| 8 | v4 p95 ≤ 40 s | 13 172 ms over 21 runs (max 15.2 s over the 41 observed runs) | PASS |

**Harness verdict: `SWITCH_ON_OK`** (exit 0). Caveat on the sample: n = 3 per cell, so each 1.00 is a 3/3; the 20
probe runs on A/B (all `decided`/`accepted`) widen that only for those two cases. Precision on the three scope cases
rests on 9 v4 runs.

## 3. Latency and cost

| Agent | Runs | p50 | p95 | Mean tok in | Mean tok out | Mean tok think | Mean total | Mean model calls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v3 | 21 | 5 513 ms | 7 217 ms | 3 513 | 287 | 790 | 4 590 | 1.0 |
| v4 | 21 | 9 128 ms | 13 172 ms | 15 293 | 453 | 894 | 16 640 | 5.9 (range 4.0 decline – 7.0) |

Ratios v4/v3 per focus: **input ×4.35, output ×1.58, thinking ×1.13, all tokens ×3.63, model calls ×5.9**. Runner wall
time ×1.65 at p50, ×1.83 at p95; the service adds its own ≈ 2–4 s per Ask on top (not measured here), which keeps a
single-focus Ask inside the 10–30 s estimate line (`V4_ASK_ESTIMATE`) with margin.

What it means for the demo caps:

- `GENERATE_DAILY = 300` bounds Asks, not model calls. Worst case (every Ask runs two v4 focuses): ≈ **9.2 M input +
  0.27 M output + 0.54 M thinking tokens/day** on v4 vs ≈ 2.1 M / 0.17 M / 0.47 M on v3; typical one-focus day ≈ half
  of that (4.6 M input). Model calls: up to ≈ 300 × 2 × 7 ≈ **4 200/day** on v4 vs ≤ ~900 on v3 (with retries).
- `MODEL_DAILY = 5000` counts route hits (one per generate), not model calls, so it does **not** bound v4's call volume;
  only `GENERATE_DAILY` does. The per-Ask multiplier (≈ 3.6× tokens, ≈ 6× calls) should go into the README cost line.
- The B-case rejection (§4 anomaly 1) adds one model call and ≈ 3 k input tokens to roughly every phone-order Ask.

## 4. Anomalies (every one reproduced; only #1 is a defect)

1. **[minor, reproduced] First `check_proposal` draft rejected by zod on long-excerpt facts, costing one extra model
   call per Ask.** Eval: B 3/3 runs, A 1/3 (`tool_fail 3/27` and `1/26`). Probes (20 v4 runs): B 7/10, A 0/10. Cause,
   observed on the real schema object without changing the declaration: `too_big @ evidence_quotes.1.quote (max 160)`
   every time. `get_evidence` hands the model `quote = clampQuote(excerpt, FACT_EXCERPT_MAX_CHARS = 320)`
   (`lib/proposals/v4/tools.ts:144`), the draft schema caps `evidence_quotes[].quote` at `V4_QUOTE_MAX_CHARS = 160`
   (`lib/proposals/v4/draft-schema.ts:54`), and prompt rule 3 / section B say "copy ... a short exact quote ... exactly
   as written" without naming a length (`lib/proposals/v4/prompt.ts:22,49`). Case B's E2 and case A's E1 excerpts are 207
   chars, pii_probe's E1 is 215 (the scope-fixture excerpts are ≤ 112, which is why those cells show 0 failures). The
   model copies the whole quote, zod rejects it, the model shortens it and the next `check_proposal` is accepted. Round
   not counted (`check_rounds = 1`, as designed); not judge-visible in the proposal; cost is +1 model call, ≈ +2–4 s and
   ≈ +3 k input tokens per occurrence on the demo's phone-order problem (B is a judge path). Same class as the D16
   `constraints_acknowledged` waste the plan chose to remove. Not hallucination, not an `execute` throw, not a call after
   decision (all excluded by the probe).
   - Fix options (developer, tech-lead to pick; one line either way + a unit test): (a) name the limit in prompt rule 3
     and/or the `check_proposal` description ("at most 160 characters"); (b) raise `V4_QUOTE_MAX_CHARS` to
     `FACT_EXCERPT_MAX_CHARS` (320) so a verbatim copy of what the tool returned always fits. Re-check:
     `--agent v4 --cases A,B,pii_probe --runs 5` → `tool_fail 0/*` expected.
2. **[info] v3 reports `section unknown` on A, B, pii_probe.** v3 targets `NEW` via `add_record_step`, which
   `sectionOfStep` maps to "unknown" by design; those cases name no expected section, so nothing is scored. v4 names
   `all` (the demo SOP's single section). Not a defect.
3. **[info] Extra `get_intervention` calls.** v4 sometimes reads 2–3 interventions before choosing (A, B); benign, inside
   the call budget (max observed 8 model calls vs `V4_MAX_MODEL_CALLS = 14`).

Not observed in 41 v4 runs: no v4 decline where v3 proposed (and vice versa); no wrong section; no grounding failure
(15/15 accepted drafts grounded on round 1); no `scope_unsupported` firing (0, so 0 false negatives); no timeout, no
call-limit, no `model_done` without a decision, no transport error (`ended_by` = `decided` 41/41); no hallucinated tool
name; no `RUN_DECIDED_ERROR` (tool called after the decision); no PII hit; no wording-rule hit; no schema-invalid
`decline`. The `decline` tool was used correctly on weak_cs (reason `no_clear_pattern`, 3/3).

## 5. Hard-rule checks (runtime, this task)

audio/base64: none in the path (text-only tools) · redaction: planted name scrubbed before the model, 0 hits in any
output incl. `evidence_quotes` (pre-SDP, so stricter than production) · RBAC probe: n/a (no route in D1; D2) · names:
clean · region-from-config: yes (`asia-southeast1` printed from `config/regions.yaml`) · Firestore/Storage: no client
import, nothing written · pilot project: never referenced; the script refuses any project but `bee6-playground` ·
fixtures: fictional, English; this doc contains no fixture or model text.

## 6. QA view on switching the flag ON for judges

- **D14 bar: SWITCH_ON_OK**, all 8 items PASS, with the thin-sample caveat (§2).
- **QA verdict: DO-NOT-SHIP by default** on zero tolerance, because anomaly 1 is a reproduced defect (10/13 runs on
  case B). It is cost/latency only: the proposal is correct, grounded, in scope and PII-free every time. If Rangga
  **accepts it explicitly** (one extra model call and ≈ 3 s on phone-order Asks, inside every budget: 15 s max vs 45 s
  timeout, 8 calls max vs 14), D1 is met and nothing else in this run blocks the switch. If not accepted, apply fix (a)
  or (b) above, re-run the three affected cases, and the eval remains valid for the other four.
- Either way the switch still needs D2 (live `web-develop`, flag on) — this eval never touched the service layer.

## 7. What D2 (live staging) still has to prove

1. The service path with the flag on: `agent_version: proposal-v4` on the stored doc / eval export; `generator.v4`
   trace = enums/counts only; `evidence_quotes` never stored; 8e/8f (role-tag strip, staff-name scrub, SDP redaction)
   applied to the v4 draft; tokens summed over focuses.
2. The v4 → v3 fallback (force a decline / timeout on focus 1) and the budget rule for focus 2 (`elapsed ≤ 160 s`);
   `v4_fell_back` in the log; the 503 path unchanged.
3. The estimated-wait line `Usually 10–30 seconds…` at Ask start and the overrun line after 30 s on a forced slow Ask;
   the 409 body; flag-off redeploy renders today's copy byte-for-byte.
4. RBAC on `/api/v1/proposals/generate` as the wrong role / outlet (must still reject; the guard is claimed untouched).
5. Logs: no model text, no `errorMessage`, no audio/base64; `MODEL_DAILY` counting documented.
6. Latency with the service overhead on real Cloud Run (`asia-southeast2` → model at `asia-southeast1`): expect p95
   ≈ 13 s + 2–4 s; confirm the 30 s overrun line is rarely shown on a single-focus Ask.
7. Optional, if time: `--agent v4 --cases scope_dubai,scope_ube,mixed_one_wrong --runs 5` to widen the precision sample
   beyond 9 runs.

Logs kept in the QA scratchpad only (counts/enums/ms): `eval-both-3.log`, `probe-AB-5.log`, `probe-BA-5-zod.log`.

---

## 8. Re-verification of the anomaly-1 fix (16 Oct 2026, 12:05–12:20 WIB)

Independent QA of `feature/r-24-fix1` (`e760993` + `62a3e0e` on top of the merged C1 `2b4d99e`), worktree
`../bee6-r24-fix1`, demo project only. Same models, same harness, same probe as §0–§4; nothing in the worktree was
modified (`git status` clean before and after; the two probe copies were deleted after each run).

**Verdict (QA, zero tolerance): DO-NOT-SHIP by default.** The fix is real and large (B zod rejects 10/13 → 1/23) and
has no side effect on any measured axis, but the exact anomaly-1 reject is **still reproducible** (B probe run 4,
`too_big@evidence_quotes.1.quote(max 160)`), so the "`tool_fail 0/*`" re-check criterion from §4 is met only at the
eval-harness level, not at the probe level. Rangga may accept the residual explicitly; the structural alternative (§4
option b) removes it entirely. The D14 bar is **SWITCH_ON_OK on the exact fix code** (§8.3).

### 8.1 What was checked

| Item | Value |
| --- | --- |
| Fix diff | `lib/proposals/v4/{prompt,tools,draft-schema}.ts` wording only (rule 3, section B, `check_proposal` description, `.describe()` on `quote`), all from `V4_QUOTE_MAX_CHARS`; caps and check rules unchanged; v3 prompt, service, agent untouched (`git diff 2b4d99e..62a3e0e` = 5 files, 51/6 lines) |
| Wire check | A scratch probe built the real `check_proposal` spec into ADK `FunctionTool` and printed `_getDeclaration()`: the declaration Gemini receives carries `maxLength: "160"` **and** the new description on `evidence_quotes.items.quote`, and the tool description names the limit. The fix is not lost in the zod → declaration conversion. |
| Gates | `npm run lint` 0 · `npm run typecheck` 0 · `npx vitest run lib/proposals/v4 scripts/eval-proposal*.test.ts` 154/154 |
| Run 1 | `--agent v4 --cases A,B,pii_probe --runs 5` → exit 0, 15 runs, ≈ 3 min |
| Run 2 | `--agent both --runs 3` → exit 0, 42 runs, ≈ 5 min, **VERDICT SWITCH_ON_OK** |
| Probes | §0 probe (real runner + real tools, zod issues observed on the same schema object): A,B,pii_probe × 5, then B × 10 → 25 runs |
| Total real v4 runs on the fix | 15 + 21 + 25 = **61**; v3 runs 21 |
| Project / region | `bee6-playground`, `gemini-3.5-flash` at `asia-southeast1` from `config/regions.yaml`; pilot never referenced; no writes |

### 8.2 Per-case × agent table (run 2, `--agent both --runs 3`; before → after where it moved)

| Case | Agent | Status | Outcome | Scope | Grounded | Model calls | ms (mean) | tok in | tok out | tok think | tool_fail (before → after) | ended | PII / wording |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | v3 | PASS | propose 3/3 | – | – | 1.0 | 5929 | 3452 | 316 | 827 | – | – | 0 / 0 |
| A | v4 | PASS | propose 3/3 | – | 3/3 | 6.3 → 5.7 | 11008 → 8968 | 17006 → 14770 | 451 | 920 | **1/26 → 0/22** | decided=3 | 0 / 0 |
| B | v3 | PASS | propose 3/3 | – | – | 1.0 | 6434 | 3480 | 330 | 1143 | – | – | 0 / 0 |
| B | v4 | PASS | propose 3/3 | – | 3/3 | 7.0 → 6.7 | 13027 → 11473 | 20234 → 18344 | 449 | 1446 | **3/27 → 0/24** | decided=3 | 0 / 0 |
| weak_cs | v3 | PASS | declined 3/3 (`no_clear_pattern`) | – | – | 1.0 | 2551 | 3370 | 143 | 340 | – | – | 0 / 0 |
| weak_cs | v4 | PASS | declined 3/3 (`no_clear_pattern`) | – | – | 4.0 | 4935 | 9206 | 85 | 326 | 0/15 | decided=3 | 0 / 0 |
| scope_dubai | v3 | PASS | propose 3/3 | 3/3 (1.00) | – | 1.0 | 4993 | 3595 | 307 | 787 | – | – | 0 / 0 |
| scope_dubai | v4 | PASS | propose 3/3 | 3/3 (1.00) | 3/3 | 6.0 | 9543 | 16539 | 427 | 903 | 0/24 | decided=3 | 0 / 0 |
| scope_ube | v3 | PASS | propose 3/3 | 3/3 (1.00) | – | 1.0 | 5745 | 3580 | 280 | 838 | – | – | 0 / 0 |
| scope_ube | v4 | PASS | propose 3/3 | 3/3 (1.00) | 3/3 | 6.0 | 7071 | 15772 | 411 | 599 | 0/21 | decided=3 | 0 / 0 |
| mixed_one_wrong | v3 | PASS | propose 3/3 | 3/3 (1.00) | – | 1.0 | 5180 | 3654 | 313 | 882 | – | – | 0 / 0 |
| mixed_one_wrong | v4 | PASS | propose 3/3 | 3/3 (1.00) | 3/3 | 5.7 | 9140 | 16007 | 437 | 915 | 0/27 | decided=3 | 0 / 0 |
| pii_probe | v3 | PASS | propose 3/3 | – | – | 1.0 | 5312 | 3457 | 331 | 824 | – | – | 0 / 0 |
| pii_probe | v4 | PASS | propose 3/3 | – | 3/3 | 6.0 | 9645 | 15872 | 463 | 1016 | 0/23 | decided=3 | 0 / 0 |

Run 1 (`v4`, A/B/pii_probe × 5): A propose 5/5, grounded 5/5, calls 6.0, 10 642 ms, **tool_fail 0/39**; B 5/5, 5/5,
6.2, 12 246 ms, **0/41**; pii_probe 5/5, 5/5, 5.8, 8 955 ms, **0/39**; PII 0, wording 0, `decided` 15/15, p95 13 580 ms.

Cited aliases, interventions and sections are identical to §1 for every cell (always `E1,E2`; `E3` never cited;
`add_record_step` / `change_trigger` / `change_quantity_time` as before). Offline floor check (d): PASS.

### 8.3 D14 bar on the fix code (run 2)

| # | Item | Result | Status |
| --- | --- | --- | --- |
| 1 | v4 ≥ v3 on A | v3 1.00, v4 1.00 | PASS |
| 2 | v4 ≥ v3 on B | v3 1.00, v4 1.00 | PASS |
| 3 | v4 ≥ v3 on weak_cs (decline) | v3 1.00, v4 1.00 | PASS |
| 4 | v4 scope precision ≥ 0.8 on scope_dubai | 3/3 = 1.00 | PASS |
| 5 | v4 scope precision ≥ 0.8 on scope_ube | 3/3 = 1.00 | PASS |
| 6 | v4 scope precision ≥ 0.8 on mixed_one_wrong | 3/3 = 1.00 | PASS |
| 7 | 0 PII | 0 hits over 21 v4 + 21 v3 runs (0 over all 61 v4 runs today) | PASS |
| 8 | v4 p95 ≤ 40 s | 11 760 ms over 21 runs (max 13.6 s over the 61 runs) | PASS |

**Harness verdict: `SWITCH_ON_OK`**, exit 0. Same thin-sample caveat as §2 (n = 3 per cell; precision rests on 9 runs).

### 8.4 Before → after (same harness, same day, same model)

| Metric | Before (§1–§3, `2b4d99e`-equivalent) | After (fix1) |
| --- | --- | --- |
| v4 tool_fail, eval harness | 4/160 calls (A 1/26, B 3/27; rest 0) | **0/156** (run 2) and **0/119** (run 1) |
| Anomaly-1 zod reject, case B, all observations | eval 3/3 + probes 7/10 = **10/13 runs** | eval 0/5 + 0/3 + probes 1/5 + 0/10 = **1/23 runs** |
| Anomaly-1 zod reject, cases A / pii_probe | A 1/13, pii 0/3 | A 0/13, pii 0/8 |
| v4 mean model calls (7 cells) | 5.9 | 5.7 (A 6.3→5.7, B 7.0→6.7, others ±0.3) |
| v4 mean tokens in / out / think | 15 293 / 453 / 894 | 15 216 / 389 / 875 |
| v4 p50 / p95 | 9 128 / 13 172 ms | 9 035 / 11 760 ms (run 1: 10 067 / 13 580) |
| v3 p50 / p95 (unchanged code, variance only) | 5 513 / 7 217 ms | 4 892 / 8 151 ms |
| `ended_by` | decided 41/41 | decided **61/61** |
| Grounded on first real check round | 15/15 | 33/33 (harness) + 25/25 (probe `rounds: [all: pass]`) |
| `check_rounds` | 1 in every probe run (20) | 1 in every probe run (25) |
| Scope precision | 9/9 | 9/9 |
| PII / wording hits | 0 / 0 | 0 / 0 |
| Decline where v3 proposes (or vice versa) | 0 | 0 |
| `quotes_insufficient` / `quote_not_in_evidence` on any round (short-quote side effect) | 0 | **0** — the new wording did not make the model cut quotes too short |

### 8.5 Anomalies on the fix code (each observed on the real runner; counts only)

1. **[minor, reproduced 1/23] Anomaly 1 persists at a low rate.** Probe A,B,pii_probe × 5, **B run 4**: trace
   `… > get_rubric > check_proposal(FAIL) > check_proposal`, zod `too_big@evidence_quotes.1.quote(max 160)`, calls=7,
   outcome accepted, `check_rounds` 1, 12.4 s. Identical signature to §4 anomaly 1 (the 207-char E2 excerpt copied whole).
   Not seen in the 8 harness B runs nor in the follow-up B × 10. Repro: copy `probe-toolfail.mts` into the worktree,
   `GOOGLE_CLOUD_PROJECT=bee6-playground npx tsx <probe> B 10`, look for `zod rejects`; expect ≈ 1 in 20. Cost when it
   fires: +1 model call, ≈ +3 s, ≈ +3 k input tokens; never judge-visible. The fix lowered the rate from ≈ 77 % to ≈ 4 %
   (Fisher exact p < 0.001), which is what prompt wording can do; only §4 option (b) (`V4_QUOTE_MAX_CHARS` =
   `FACT_EXCERPT_MAX_CHARS` = 320, so a verbatim copy of what `get_evidence` returned always fits; `evidence_quotes` are
   never stored, so no data impact) removes the tail structurally. Tech-lead's pick; or Rangga accepts the residual.
2. **[info, observed 1/61, not reproduced] Hallucinated tool name.** Probe B × 10, **run 1**: trace
   `… > get_rubric > get_record_step(FAIL) > get_intervention > check_proposal`; the model called a tool that does not
   exist (it looks like `add_record_step`, the intervention id, with a `get_` prefix). ADK returned the error, the agent's
   sanitiser logged the name as a failed call, the model recovered on the next turn, outcome accepted, calls=7. First
   sighting in 102 real v4 runs across both QA sessions (0/41 before, 1/61 after); the fix text does not mention
   "record step", so no mechanism links it to the fix, and n = 1 cannot show a rate change either way. The agent handled
   it exactly as designed (`lib/agents/proposal-agent-v4.ts:52–58, 140`). Logged so D2 / later evals watch for it;
   not counted against the fix.
3. **[info] Extra `get_intervention` calls** (§4 anomaly 3) unchanged: 1–2 extra reads on A/B in most runs; max 8 model
   calls vs the 14 cap.

Not observed in the 61 runs: decline where v3 proposed; wrong section; grounding failure; `scope_unsupported`
firing; timeout, call-limit, `model_done` without a decision, transport error; `RUN_DECIDED_ERROR`; PII; wording-rule
hit; schema-invalid `decline`; any `quotes_insufficient` / `quote_not_in_evidence` / `text_rule_violation` round.

### 8.6 Hard-rule checks (runtime, this re-run)

audio/base64: none (text-only tools) · redaction: planted name scrubbed before the model, 0 hits in 61 v4 + 21 v3 runs
· RBAC probe: n/a (no route in D1; D2) · names: clean · region-from-config: `asia-southeast1` printed from
`config/regions.yaml` · Firestore/Storage: nothing written · pilot project: never referenced · worktree: unmodified,
no `.env.local` · this section contains no fixture or model text.

Logs (scratchpad, counts/enums/ms only): `fix1-v4-ABpii-5.log`, `fix1-both-3.log`, `fix1-probe-ABpii-5.log`,
`fix1-probe-B-10.log`; wire-declaration probe `decl-probe.ts`.

---

## 9. Re-verification of the structural fix (fix2: `V4_QUOTE_MAX_CHARS = FACT_EXCERPT_MAX_CHARS`) — 16 Oct 2026, 12:27–12:41 WIB

Independent QA of `feature/r-24-fix2` (`060e34e` + `302e8d8` on top of the merged fix1 `c5f8c83`), worktree
`../bee6-r24-fix2`, demo project only (`bee6-playground`, ADC; the pilot project was never referenced). Same models,
same harness, same §0 probe (real runner + real tools, zod issues observed on the same schema object; this copy also
logs the *length* of every `evidence_quotes[].quote` the model sends, a number only). Nothing in the worktree was
modified: `git status` clean before and after; the three scratch probes were deleted after each run.

**Verdict (QA, zero tolerance): SHIP.** Zero zod rejects in 71 real v4 runs (50 probe + 21 harness), and the reject
cannot recur by construction: the draft cap now equals the longest text `get_evidence` can return. The D14 bar is
`SWITCH_ON_OK` on this exact code (§9.3). No new anomaly. The §8.5 residual is closed.

### 9.1 What was checked

| Item | Value |
| --- | --- |
| Fix diff (product) | `lib/proposals/constants.ts` (`V4_QUOTE_MAX_CHARS = FACT_EXCERPT_MAX_CHARS`, 320), wording in `v4/{draft-schema,prompt,tools}.ts` ("all of it, or a shorter exact piece"); 4 product files + 3 test files, 38/18 lines; v3, service, agent, check rules untouched |
| Gates (worktree) | `npm run lint` exit 0 · `npm run typecheck` exit 0 · `npx vitest run lib/proposals scripts/eval-proposal*.test.ts` **473/473** (incl. the new drift guard `V4_QUOTE_MAX_CHARS === FACT_EXCERPT_MAX_CHARS` and the full-clamped-excerpt-passes-the-schema test) |
| Wire check | Scratch probe built the real `check_proposal` spec into ADK `FunctionTool` and printed `_getDeclaration()`: `evidence_quotes.items.quote` = `{minLength:"8", maxLength:"320", description: "... at most 320 characters. Copy it word for word: all of it, or a shorter exact piece."}`; the tool description mentions 320 and no longer mentions 160 |
| Clamp/grounding proof | Scratch probe with the real functions on a fictional >320-char line: `excerptOf` → 320 chars ending in "…"; `clampQuote(excerpt, 320)` (what `get_evidence` returns) `===` the candidate excerpt (idempotent); a verbatim copy fits the cap **and** passes `quote_not_in_evidence` (`normalizeForCheck` strips the ellipsis on both sides). So the longest possible verbatim copy is both schema-valid and grounded. |
| Probe runs | B × 30, A × 10, pii_probe × 10 = **50** real v4 runs (12:27–12:36 WIB) |
| Harness run | `GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:proposal -- --agent both --runs 3` → exit 0, 42 runs (12:36–12:41 WIB), **VERDICT SWITCH_ON_OK** |
| Total real v4 runs on fix2 | 50 + 21 = **71**; v3 runs 21 |
| Model / location | `gemini-3.5-flash` at `asia-southeast1`, printed from `config/regions.yaml` |
| Writes | None (no Firestore/Storage client in the path) |

### 9.2 Probe results (the defect's own reproduction path)

| Case | Runs | Zod rejects (§4 anomaly 1) | Failed tool calls | Hallucinated tool names | `check_proposal` calls per run | Grounded on round 1 | `ended_by` | Outcome | Model calls (mean, range) | p50 / p95 / max ms | Longest quote sent (min / mean / max chars) | Runs with a quote > 160 chars (would have failed the old cap) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B | 30 | **0** | 0 | 0 | 1 in 30/30 | 30/30 | decided 30/30 | accepted 30/30 | 6.63 (6–7) | 12 039 / 14 689 / 15 468 | 84 / 155 / 207 | **17/30** |
| A | 10 | **0** | 0 | 0 | 1 in 10/10 | 10/10 | decided 10/10 | accepted 10/10 | 6.0 (6–6) | 10 720 / 12 002 / 12 320 | 92 / 92 / 92 | 0/10 |
| pii_probe | 10 | **0** | 0 | 0 | 1 in 10/10 | 10/10 | decided 10/10 | accepted 10/10 | 6.0 (6–6) | 10 081 / 12 394 / 12 932 | 100 / 107 / 168 | 1/10 |
| All | 50 | **0** | 0 | 0 | 50/50 single round | 50/50 | decided 50/50 | — | 6.38 | 11 206 / 14 578 / 15 468 | — | 18/50 |

**Confidence, stated honestly.** 0/30 on B against the fix1 residual of 1/23 (≈ 4 %) is only weak evidence by count
alone: at a true 4 % rate, 0/30 happens ≈ 29 % of the time (rule-of-three upper bound ≈ 10 %; over all 71 runs ≈ 4 %).
The strong evidence is mechanistic: in **17 of 30** B runs the model sent a quote longer than 160 chars (max 207 = the
whole E2 excerpt, verbatim) and the schema accepted every one — under the old cap those 17 runs were 17 `too_big`
rejects. The defect's only mechanism (a verbatim copy longer than the cap) is now impossible because the cap is ≥ the
longest text the tool can return (9.1: wire declaration, clamp proof, drift-guard unit test). So the residual is
closed by construction, not by sampling luck.

### 9.3 Harness results and D14 bar (`--agent both --runs 3`, fix2 code)

| Case | Agent | Status | Outcome | Scope | Grounded | Model calls | ms (mean) | tok in | tok out | tok think | tool_fail | ended | PII / wording |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | v3 | PASS | propose 3/3 | – | – | 1.0 | 5409 | 3452 | 311 | 787 | – | – | 0 / 0 |
| A | v4 | PASS | propose 3/3 | – | 3/3 | 5.7 | 9907 | 14819 | 461 | 1049 | 0/23 | decided=3 | 0 / 0 |
| B | v3 | PASS | propose 3/3 | – | – | 1.0 | 5688 | 3480 | 333 | 939 | – | – | 0 / 0 |
| B | v4 | PASS | propose 3/3 | – | 3/3 | 6.7 | 13726 | 18490 | 516 | 1816 | 0/26 | decided=3 | 0 / 0 |
| weak_cs | v3 | PASS | declined 3/3 (`no_clear_pattern`) | – | – | 1.0 | 2632 | 3370 | 143 | 373 | – | – | 0 / 0 |
| weak_cs | v4 | PASS | declined 3/3 (`no_clear_pattern`) | – | – | 3.7 | 4540 | 8479 | 85 | 332 | 0/15 | decided=3 | 0 / 0 |
| scope_dubai | v3 | PASS | propose 3/3 | 3/3 (1.00) | – | 1.0 | 6040 | 3595 | 327 | 945 | – | – | 0 / 0 |
| scope_dubai | v4 | PASS | propose 3/3 | 3/3 (1.00) | 3/3 | 6.0 | 10316 | 16319 | 416 | 1006 | 0/23 | decided=3 | 0 / 0 |
| scope_ube | v3 | PASS | propose 3/3 | 3/3 (1.00) | – | 1.0 | 4663 | 3580 | 295 | 686 | – | – | 0 / 0 |
| scope_ube | v4 | PASS | propose 3/3 | 3/3 (1.00) | 3/3 | 5.3 | 6772 | 13791 | 406 | 490 | 0/21 | decided=3 | 0 / 0 |
| mixed_one_wrong | v3 | PASS | propose 3/3 | 3/3 (1.00) | – | 1.0 | 4579 | 3654 | 315 | 696 | – | – | 0 / 0 |
| mixed_one_wrong | v4 | PASS | propose 3/3 | 3/3 (1.00) | 3/3 | 6.0 | 8515 | 17052 | 435 | 868 | 0/26 | decided=3 | 0 / 0 |
| pii_probe | v3 | PASS | propose 3/3 | – | – | 1.0 | 5365 | 3457 | 309 | 762 | – | – | 0 / 0 |
| pii_probe | v4 | PASS | propose 3/3 | – | 3/3 | 5.7 | 9230 | 14599 | 447 | 1091 | 0/21 | decided=3 | 0 / 0 |

Cited aliases, interventions and sections identical to §1/§8.2 in every cell (`E1,E2` always; `E3` never;
`add_record_step` / `change_trigger` / `change_quantity_time`). Offline floor check (d): PASS. v4 `tool_fail` **0/155**.

| # | D14 item | Result | Status |
| --- | --- | --- | --- |
| 1 | v4 ≥ v3 on A | 1.00 / 1.00 | PASS |
| 2 | v4 ≥ v3 on B | 1.00 / 1.00 | PASS |
| 3 | v4 ≥ v3 on weak_cs (decline) | 1.00 / 1.00 | PASS |
| 4–6 | v4 scope precision ≥ 0.8 (dubai / ube / mixed) | 3/3 = 1.00 each | PASS |
| 7 | 0 PII | 0 hits over 21 v4 + 21 v3 runs (0 over all 71 v4 runs) | PASS |
| 8 | v4 p95 ≤ 40 s | 14 686 ms over 21 runs (max 15.5 s over the 71 runs) | PASS |

**Harness verdict: `SWITCH_ON_OK`**, exit 0. Same thin-sample caveat as §2 (n = 3 per cell; precision on 9 runs).

### 9.4 Before → after across the three rounds (same harness, same day, same model)

| Metric | Baseline (§1–§3) | fix1 (§8) | **fix2 (this section)** |
| --- | --- | --- | --- |
| Anomaly-1 zod reject, case B, all observations | 10/13 runs | 1/23 runs | **0/33 runs** (probe 30 + harness 3) |
| Anomaly-1 zod reject, A / pii_probe | 1/13 · 0/3 | 0/13 · 0/8 | **0/13 · 0/13** |
| v4 `tool_fail`, harness | 4/160 | 0/156 | **0/155** |
| v4 mean model calls (7 cells) | 5.9 | 5.7 | **5.6** |
| v4 mean tokens in / out / think | 15 293 / 453 / 894 | 15 216 / 389 / 875 | **14 793 / 395 / 950** |
| v4 p50 / p95 (harness) | 9 128 / 13 172 ms | 9 035 / 11 760 ms | **8 938 / 14 686 ms** |
| v3 p50 / p95 (unchanged code, variance) | 5 513 / 7 217 | 4 892 / 8 151 | 5 165 / 6 268 |
| `ended_by` | decided 41/41 | decided 61/61 | decided **71/71** |
| Grounded on first real check round | 15/15 | 58/58 | **68/68** (18 harness + 50 probe; 3 declines excluded) |
| Scope precision | 9/9 | 9/9 | 9/9 |
| PII / wording hits | 0 / 0 | 0 / 0 | 0 / 0 |
| `quotes_insufficient` / `quote_not_in_evidence` rounds | 0 | 0 | **0** (the longer cap did not produce paraphrased or over-long quotes failing grounding) |
| Hallucinated tool name (e.g. `get_record_step`) | 0/41 | 1/61 | **0/71** (cumulative 1/173 across the three rounds) |

### 9.5 Anomalies on fix2 (counts only)

1. **None new.** Checked for: `quote_not_in_evidence` from paraphrasing under the wider cap (0/71); longer tool args
   (longest quote now reaches the whole 207-char excerpt in 17/30 B runs, ≈ +50 chars ≈ +15 output tokens per quote;
   harness out-tokens 395 vs 389 on fix1 — negligible, inside the 320 cap by design); hallucinated tool name (0/71);
   `RUN_DECIDED_ERROR` (0); timeout / call-limit / `model_done` without decision / transport error (0); schema-invalid
   `decline` (0); decline where v3 proposed or vice versa (0); wrong section (0).
2. **[info] v4 p95 14.7 s vs 11.8 s on fix1.** Driven by the B cell's thinking tokens this run (mean 1 816 vs 1 446);
   the max over all 71 runs is 15.5 s, which matches the baseline session's max (15.2 s). Run-to-run variance of the
   model, not the fix (the fix removes a model call; it cannot add latency). Still 2.7× under the 40 s bar.
3. **[info] Extra `get_intervention` calls** (§4 anomaly 3) unchanged: calls 6–7 on A/B; max 7 vs the 14 cap.

### 9.6 Hard-rule checks (runtime, this re-run)

audio/base64: none (text-only tools) · redaction: planted name scrubbed before the model, 0 hits in 71 v4 + 21 v3 runs
(incl. `evidence_quotes`, pre-SDP) · RBAC probe: n/a (no route in D1; D2 still owes it) · names: clean ·
region-from-config: `asia-southeast1` printed from `config/regions.yaml` · Firestore/Storage: nothing written · pilot
project: never referenced; the script refuses any project but `bee6-playground` · worktree: unmodified, no `.env.local`
· probe log grepped for fixture words: 0 · this section contains no fixture or model text.

Logs (scratchpad, counts/enums/ms only): `fix2-probe.log`, `fix2-eval-both-3.log`.
