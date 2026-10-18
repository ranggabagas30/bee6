# HANDOFF — read this first

## Demo-feedback 2 round (Sat 17 / Sun 18 Oct) — NEWEST
- `develop` head = 0c9e9e3 (PRs #113 to #120 merged). `web-develop` serves `web-develop-00049-q54` (0c9e9e3) at 100%, pinned; rollback = `update-traffic ... --to-revisions=web-develop-00048-vm2=100`; tag `rollback-1017` on 00040-zbm. `web` = `web-00022-np4` (same image as web-00021-qxv / main 5a47d02, only demo IP caps raised to 250 sandboxes and 2000 switches per network; tags good-1015-1624, good-1015-2006, candidate-1016, stable-1017). Release PR `develop` -> `main` NOT opened; QA on the final build owed before it (round-3 QA SHIP on 00049 for items 3-16).
- Standing orders (memory `feedback_autoship_bugfix_to_staging`): every bug-fix PR is merged to develop, dev-ops switches web-develop, finding set to READY FOR TESTING, then QA tests it live. Never DONE (Rangga sets). `web`, `main`, pilot still need an explicit go. Freeze extended to Sun 18 Oct afternoon.
- Done this round: findings 1-4/5, 7, 8 (caps web-develop 600/100/100), 9, 10 (flagged redacted lines on the sandbox debrief question; tech-lead + security-review; UX-03, tech spec §8.10, plan §10 row 60, R-25 amended), 11, 12-14, 15, 16 (option B). QA D-1 (shop name scrubbed as [STAFF]) fixed in #120, re-test SHIP. Firebase authorized domains now include both run.app hosts. Housekeeping: sweeper script on branch `feature/sandbox-sweeper` (NOT merged; dry run + real run verified on staging, 8 sandboxes + 10 orphan Auth users removed), Artifact Registry `keep-*` tags + cleanup policy in DRY-RUN mode (not enforced), docs/tasks/housekeeping-*.md.
- Mistake owned: brief used `--set-tags` on `web` and removed three 0% tags (restored by Rangga); never use replacing tag flags.
- Open: Bahasa copy provisional (C-d2-heard etc.); known gaps (no second SDP pass on quoted lines, clitics beyond nya/ku/mu/lah/kah, rare invisible chars U+00AD/U+2060-2064, single-word staff = outlet word); 3 SOP test cases and a dead headerLine parameter (tech-lead notes); flaky tests ProposalsApp.test.tsx and capture/page.test.tsx under load; README still mentions carried-over questions and a role-switch bar; Google IdP still enabled in Firebase Auth (unused); `web` min instance 1; throwaway worktrees ../bee6-fb4..fb10, fb5 read-only, older ones to remove; image cleanup + sandbox sweeper merge after submission.
- Rangga to test on web-develop: items 7, 9, 10, 11, 12, 13/14, 15, 16 (READY FOR TESTING).
- DECISIONS (Rangga, Sun 18 Oct): priority order = (1) bug fixes/adjustments, he tests himself, then (2) multi-agent/tool-call work, then (3) clip variants (last). Pilot skipped for now (judges use `web` only; the SOP step re-base rule needs no pilot flag until the pilot is deployed: revisit then). ProposalAgent: USE v4 AS IS (PROPOSAL_AGENT_V4=true, tool loop + plain-code check_proposal acts as the 'critic'); NO separate LLM critic. Turn the flag on only on `web-develop` first, only after Rangga says the current fixes pass his testing; `web` only on his explicit word. Cost to remember: v4 is ~3.6x tokens, slower (two chained asks could take 40-80 s; guide copy says 'about 20 seconds'), D2 live staging QA never completed, and once a v4 doc exists in a database older revisions reject it: rollback = remove the flag, not a traffic rollback. DebriefAgent: wording only, never decides which moments become questions (rule 10); Review is plain code today (no LLM): Rangga to choose A explain-on-top / B tool-using agent / C leave.
- Update (Sun 18 Oct, later): `develop` head = e01621e; `web-develop` serves `web-develop-00053-bkq`. Added since: guide stuck-upload hints (#122), items 19 (#123), 18 (#124), 20 (#125 approve-both, re-base rule; relaxed approval guard also applies to the PILOT code: security reviewer wants a default-off flag SOP_STEP_REBASE, tech-lead says none: Rangga to decide BEFORE any release to main). QA round 4 SHIP. `web` = web-00023-wfg (release 30c931d, pipeline-tick every MINUTE since 04:17Z) does NOT have #122-#125 yet; nothing goes to `web` before Rangga says so. Decisions: item 21 (CSS preload console hint after sign-out redirect) ACCEPTED as known noise (option A; proper fix later = proxy.ts demo redirects; add a README known-gaps line in the docs pass); review-date one-day shift between the proposal draft (today+14) and the shipped version (effective+14): Rangga chose option 3 = change the draft wording only. Follow-ups: generation-time same-step exclusion only if the model ever picks the same step; the 503 on segment uploads = transcribe preview model timeout (15 s), mitigated by the guide hint, server-side timeout retry still undecided; judging-window instances min 2/max 8 and the Vertex quota check undecided; enhancements (clip variants A/B with hint, Debrief wording agent, Review with after-data, Proposal agent v4/Critic) not started.


## R-25 regression + UI fixes (Sat 17 Oct ~13:30 WIB) — NEWEST
- `develop` head = e84a0a3. `web-develop` serves `web-develop-00040-zbm` (e84a0a3) at 100% (pinned; `--to-latest` NOT restored: every new merge needs a manual `update-traffic` go from Rangga; wait for each deploy before the next merge, builds race). Rollback = `update-traffic ... --to-revisions=web-develop-00038-wfg=100` (85e4dc1). `web` untouched (web-00021-qxv, main 5a47d02). PROPOSAL_AGENT_V4 unset everywhere.
- QA regression (docs/tasks/QA-r25-regression-17oct.md) found R25-001 P0 (blank idle screen, R-25 T5 regression, develop only), R25-002 (open-session End without confirm), R25-003 (no desktop header Sign out), R25-004 (guide lag after timeout): all fixed and merged (PRs #109, #110, #111). QA mobile report (QA-ui-mobile-17oct.md): M-001 top band, M-002 full code field, M-003 placeholder, M-004 nav, M-005 owner chips: all fixed in PR #112 (+ guide auto-open on entry at >= 900 px, first visit). Typing bug did not reproduce by any method; only the full-field case (M-002).
- Rangga is reviewing the UI himself; DO NOT dispatch QA until he asks. Items to look at: no white band at >= 900 px, guide auto-open, typing into a full field, 360 px items, idle screen day 1/2, End confirm on reopened session, header Sign out, guide flip after timeout; check the 920-1000 px header wrap and the dark 2-3 px line.
- Open decisions: pilot-visible PairForm typing change (Rangga: "skip the pilot for now": raise again before the main release); real-chain E2E on web-develop needs a go to resume `pipeline-tick-staging` briefly (and whether to include the v4 flag); UI-113 question wording stays a known gap; UI-072 timeout board covered by the clock-patch method; board deviation: pill at top 14 in the header band (not 14 px below it).
- Process lessons: add a fresh-clone sandbox test shape and a mandatory fresh-sandbox day 1/day 2 run after every merge to develop; merge one PR at a time.
- Release plan unchanged: PR develop -> main by 17:00 only after Rangga's UI review and a QA pass on the final build; hard stop for new fixes 15:00 (ask Rangga before cutting anything); rollback target web-00021-qxv.
- Throwaway worktrees to clean later: ../bee6-idlefix, ../bee6-guidefix, ../bee6-capfix, ../bee6-uifix2 (+ older ../bee6-r24*, ../bee6-r25*).

 (updated Mon 12 Oct 2026, ALL R-* TASKS MERGED INTO develop; NOT yet on main, nothing deployed from develop)

Loaded automatically at session start by a hook. The PM updates it at the end of every work session
and after every merge (`CLAUDE.md` §10 rule 9). Keep it short and current; history lives in git, plans
in `docs/tasks/`, decisions in memory and `docs/`. Sections below "Where we are" are dated history —
useful for context, may be superseded by the latest dated entry on any given topic.

## Decisions (16 Oct, after the load test) — newest
- Code freeze MOVED to Sat 17 Oct 23:59 WIB (was 12:00). Final live run and go/no-go follow it; submission Sun 18 Oct.
- Stable submission candidate = main 5a47d02 = `web-00020-p9p` (dev-ops tags it `candidate-1016` and git `submission-candidate-1`). It is the fallback if anything new fails.
- No separate CriticAgent. Plan C becomes R-24 "Proposal agent v4": one agent, SOP-scoped, with read-only tools (list_sop_sections, get_sop_section, get_evidence, list_interventions/get_intervention, get_rubric) and a plain-code `check_proposal`. Flag OFF by default. Plan: docs/tasks/R-24-proposal-agent-tools.md (tech-lead writing).
- `web-develop` becomes the STAGING env: new work is tested there before it is merged to main. Rangga does the GCP configuration; dev-ops checklist is in docs/tasks/R-01-gcp-state.md ("web-develop staging checklist (16 Oct)").
- DONE 16 Oct: `DEMO_SANDBOX_IP_CAP=60` applied on `web` -> revision `web-00021-qxv` (100%, same code as main 5a47d02). `web-00020-p9p` stays tagged `candidate-1016` at 0% (rollback target, waits for Rangga). Git tag `submission-candidate-1` pushed (-> 5a47d02).
- R-24 decisions (Rangga): keep 5-step demo SOP; switch-on bar accepted; 20-40 s Ask OK only with an estimated-wait display in the UI (new uiux slice); sop_changed = change_is_noop; alias E1..En. Spike running; FIRESTORE_DATABASE_ID change (staging DB isolation) running. `web-develop` staging: Rangga does console Phase 1; Phase 2 (named DB `staging`) after the dev change passes review.

## R-25 on develop (Sat 17 Oct ~11:20 WIB) — NEWEST
- `feature/r-25` merged into `develop` via PR #106 (f284efe): all lanes T1-T10, T12-T14, DEV-2 (= PR #99 Home waiting order), G0b, vitest timeouts (30 s), catmap, T5b. Tech-lead INTEGRATED REVIEW PASS at a35264f (build ok, 346 files / 5851 tests, flag-off R-24 byte-identical, lib/capture + lib/debrief diff EMPTY, pilot paths unchanged, hard-rule greps clean). T11 (owner approvals) built (`feature/r-25-g4b`, full suite 5857) and at its own gate; not in #106. Cloud Build -> web-develop (flag OFF): dev-ops verifying; then QA regression (brief = tech-lead integrated review section 9, in the agent report; summarised in docs/tasks/QA-r25-regression-17oct.md when QA writes it).
- Follow-ups running: chore/test-hardening-readme (RTL asyncUtilTimeout 10 s, SidePanel test by content, README known-gaps/Next drift). CLAUDE.md section 3 AI line fixed (no Critic).
- Release plan: develop -> main (R-24 flag OFF + R-25 + PR #99) AFTER QA green on web-develop and T11 decided; hard stop for new fixes 15:00; release PR by 17:00; rollback target `web-00021-qxv` (same code as main 5a47d02 + IP cap 60); `web` must keep PROPOSAL_AGENT_V4 and FIRESTORE_DATABASE_ID UNSET (dev-ops re-checks before shifting traffic). Judging-day cap etc. unchanged.
- Known notes: Bahasa copy PROVISIONAL (pilot /pair verb Pasang->Siapkan needs Tiffany/Rangga sign-off); QuestionScreen is shared with the pilot (look change); resume state per-browser localStorage; "DEV-2" = PR #99.

## R-25 progress (Sat 17 Oct ~10:35 WIB)
- Integration branch `feature/r-25` (off develop eac54ff). MERGED: T2 (PR #88, 0426646). Gates PASSED, waiting to be pushed/merged: T1 G0 primitives (`feature/r-25-g0`, local; 3 minor G0b follow-ups), T8 web shell (`feature/r-25-g3a`, rebase + swap commit after T1), T9 day record (`feature/r-25-g3b`, rebase onto T1+T8 then WebShell adoption per the gate's steps). At gate: T4 pair + StaffTopBar (`feature/r-25-g1a2`, has a TEMP-stub commit c3117d0 to drop on rebase), T5 capture P0 (`feature/r-25-g1a1`, tail still building). Not started: T3 entry, T6 guide chrome, T7 debrief, T10 proposals, T11 approvals, T12 SOP, T13 owner home (they wait for T1/T8 to merge).
- BOTTLENECK: the pre-push hook runs the full vitest suite; machine load ~90 (parallel agents) makes load-sensitive loop tests time out at 5 s (calendar, lib/demo/service, api demo session route, capture page). NEVER bypass the hook. Fix in flight: `chore/vitest-timeout` (vitest.config.ts testTimeout/hookTimeout 30000) by developer-junior; merge it into feature/r-25 first, then lanes rebase onto it.
- Rule for every lane (from the T1 gate): only G0 edits app/globals.css; never add a 900px/500px media block there; page CSS in *.module.css. G0b (after T2 merge, done): delete dead `.b6-topbar*` CSS, DialogSheet ref/tabIndex passthrough, `.b6-dsheet` vh fallback, seg item min-height, codefield focus ring.
- QA data-board re-audit running (docs/tasks/QA-ui-fidelity-17oct.md §6; first finding group: UI-087/UI-040 confirmed; UI-110..113 look functional, to be ruled by the tech-lead for T7). The `timeout` sandbox needs Rangga to run `bash <scratchpad>/reseed-timeout.sh` (QA's permission blocked it; it polls a `.done` file).
- Rangga's six answers (not-sure answer, retake path, sign-in, release shape, coverage tile, demo expiry placement) still pending; lanes continue under the approved plan.

## R-25 decisions (Rangga, 17 Oct ~09:30 WIB)
- Devices "code generated" (D2-05): OUT, placeholder "coming soon" only. Second small P2-only PR to main after 17:00 ALLOWED (web QA green by 18:30, batch <= ~1 h, before 21:00). `// PROVISIONAL` Bahasa ACCEPTED. If the gap list overflows by 15:00: ASK Rangga again, never cut automatically. Plan: docs/tasks/R-25-ui-fidelity.md (groups G0, G1a/G1b, G2, G3/G5, G4a/G4b; integration branch feature/r-25 off develop eac54ff; 15:00 hard stop for new fixes; release PR to main by 17:00 with R-24 flag-off). Waiting on the QA gap list (docs/tasks/QA-ui-fidelity-17oct.md).

## Update Sat 17 Oct ~09:30 WIB (after resume)
- Phase 2 DONE and verified by dev-ops (a3a48236): `staging` DB (4 indexes READY, TTL ACTIVE), seeded incl. template `demo-tpl-outlet` READY, `FIRESTORE_DATABASE_ID=staging` on web-develop (rev web-develop-00033-9n8, image eac54ff), staging scheduler jobs PAUSED, isolation PASS (`(default)` unchanged; web untouched). Sign-in: demo sessions need no password; demo-owner@/demo-supervisor@example.com exist in Auth with their 10 Oct passwords. Note: `(default)` lost one sbx sandbox between 01:13Z and 01:20Z, cause unproven (likely routine sandbox expiry; nothing of ours writes there).
- Rangga "go ahead" (17 Oct, to all pending items): cost of v4 accepted (~3.6x tokens / ~6x calls; GENERATE_DAILY=300 bounds it); go to set `PROPOSAL_AGENT_V4=true` on web-develop for D2 live QA (staging only; PM sets it right before D2 on the INTEGRATED build so the UI fidelity audit sees flag-off screens, then flag-off pass; dev-ops does it); tech-lead R-25 prep restarted; availability Sat 14:00/19:00 assumed OK; "Sari" fixture name kept as a planted fictional name (swap if Rangga says it is real).
- Running: QA UI fidelity audit (Fable, fresh agent, Chrome extension first) -> docs/tasks/QA-ui-fidelity-17oct.md; tech-lead R-25 prep -> docs/tasks/R-25-ui-fidelity.md. Next: tech-lead converts the gap list into tasks, uiux builds in waves on feature/r-25, gates, QA, one combined PR (R-24 flag-off + R-25 P0/P1) to main by 17:00, QA on web after deploy.

## SESSION STATE FOR RESUME (Sat 17 Oct, ~09:00 WIB) — read this first
- Freeze Sat 23:59 WIB; release to main (R-24 flag-off + any UI fidelity fixes, ONE combined PR) by 17:00 WIB at the latest; stable candidate = main 5a47d02 / `web-00020-p9p` tag `candidate-1016` / git tag `submission-candidate-1`; `web` = web-00021-qxv (`DEMO_SANDBOX_IP_CAP=60`). Cut rule: staging not usable by ~Sat 08:00 -> R-24 stays "spiked, not shipped" (decide with Rangga; it is already past 08:00).
- Phase 1 DONE and verified (web-develop public, 16 env + 2 secrets, API key has 9 referrers). `web-develop` = rev 00032 (image eac54ff = develop with all R-24 + fixes; develop since then = eac54ff, no newer).
- PHASE 2 (named Firestore DB `staging`) INTERRUPTED TWICE by Rangga; actual state UNKNOWN. A QA agent saw `FIRESTORE_DATABASE_ID` already `staging` on web-develop, so web-develop may be BROKEN (DB empty / indexes missing). FIRST ACTION ON RESUME: dispatch dev-ops for a STRICTLY READ-ONLY state check (databases list, indexes/TTL on `staging` vs `(default)`, seed/template check-only, web-develop env + 200s + logs, staging scheduler jobs, `(default)` untouched, leftovers like ../bee6-staging-seed), then finish Phase 2 (Rangga's go: "go phase 2" and "run phase 2 in parallel of uiux auditing", 17 Oct; scope: DB, 4 composite indexes, TTL, seed + `demo-tpl-outlet` template with FIRESTORE_DATABASE_ID=staging, env var on web-develop only, paused `pipeline-tick-staging`/`review-run-staging`, resume tick only for the template READY window, isolation proof; NOT PROPOSAL_AGENT_V4, nothing on web, nothing on (default), no pilot).
- UI FIDELITY (Rangga: web-develop UI does not follow page 2 of the Bee6 Wireframes canvas; ALL screens matter; P0+P1 today, P2 with spare time; severity rubric P0/P1/P2 as in the QA brief). Design source = canvas <PRIVATE_DESIGN_LINK> page 2 (boards P2-*, L2-*, D2-*; one `project/<board>.dc.html` each). 69 boards + canvas.json saved locally: <LOCAL_PATH>/boards/project/ (re-fetch with the Artifact tool `read` + `paths` + `out_dir` if gone). Boards cannot be rendered outside the canvas (`support.js` missing): compare Playwright screenshots/computed styles vs the px/copy in the board source. `.claude/agents/qa.md` now lists the `Artifact` tool and a "Reading the design source" section (needs a fresh session to be picked up; subagents may still lack it, local files are the fallback). QA audit (Fable) STOPPED before output; tech-lead R-25 prep (Fable) STOPPED before writing `docs/tasks/R-25-ui-fidelity.md`. Plan on resume: QA audit -> `docs/tasks/QA-ui-fidelity-17oct.md` -> tech-lead converts gaps into R-25 tasks (integration branch `feature/r-25` off develop, sub-branches per file-ownership group, tech-lead gate per group, uiux builds on default model) -> QA re-checks -> one combined PR to main with R-24 flag-off by 17:00 (QA on `web` after deploy).
- Model rule: Fable only for tech-lead and qa; developer/uiux/dev-ops default models. Rangga does not want to be asked twice for the same thing; do not restart stopped work without his go (he stopped agents on purpose).
- Still waiting on Rangga: cost acceptance (v4 ~3.6x tokens/~6x calls, GENERATE_DAILY=300 bounds it), "Sari" is a real staff name?, availability Sat 14:00 (decision A) / 19:00 (decision B), explicit go to set PROPOSAL_AGENT_V4=true on web-develop for D2 live QA (not yet given), step-3 script typo `asia-soheast2` in docs/tasks/R-24-staging-phase1-step3.sh line 10 (harmless, step 3 already applied; fix if the script is reused).

## R-24 update (16 Oct, ~13:00 WIB) — eval half CLOSED, staging half BLOCKED on Rangga
- `develop` = eac54ff: all of R-24 + C1 eval (PR #86) + quote fixes (PR #87: prompt wording, then `V4_QUOTE_MAX_CHARS` derived from `FACT_EXCERPT_MAX_CHARS`=320). Flag `PROPOSAL_AGENT_V4` still OFF everywhere. `main` 5a47d02 / `web` untouched (`web` = web-00021-qxv with `DEMO_SANDBOX_IP_CAP=60`).
- QA D1 (docs/tasks/QA-r24-eval-16oct.md §1-§9): 71 real v4 runs on the final code, 0 zod rejects, D14 bar 8/8 SWITCH_ON_OK, p95 14.7 s, ~3.6x tokens / ~6x calls vs v3 (GENERATE_DAILY=300 bounds spend), QA SHIP on the final code. Hallucinated tool name 1/173 (handled).
- BLOCKED on Rangga: Phase 1 console steps for `web-develop`; Phase 2 go (named DB `staging`); cost acceptance; "Sari" check; availability Sat 14:00 (decision A) / 19:00 (decision B). D2 (live staging QA, flag on then off) cannot start without Phase 1+2. Cut rule: no staging by ~Sat 08:00 -> R-24 stays "spiked, not shipped", main stays as is.

## R-24 status (16 Oct, afternoon WIB)
- `feature/r-24` (waves A, B1-B4, each tech-lead PASS; whole-branch C3 PASS) merged into `develop` via PR #85 (a17b2bc). Flag `PROPOSAL_AGENT_V4` OFF by default; flag-off is byte-for-byte main 5a47d02. `web-develop` builds from develop. PR #84 (FIRESTORE_DATABASE_ID) merged earlier (ab75d75).
- Open: C1 eval branch `feature/r-24-c1` (bee6-r24-c1, e05f131, 6685b7b) awaiting a quick tech-lead pass then merge; QA D1 full eval running; Phase 1 (Rangga console) + Phase 2 (staging DB) gate D2 live QA on web-develop.
- ROLLBACK CAVEAT (tech-lead C3, major, ops): once ANY v4 doc exists in the `(default)` demo DB (flag on on `web`), `web-00020-p9p` (code 5a47d02) is NOT a clean rollback: its strict ProposalSchema rejects v4 docs (list skips, detail/approve 404). After the flag-off merge to main, record the NEW flag-off revision as the rollback target; the kill switch is `--remove-env-vars=PROPOSAL_AGENT_V4`. `web-00020-p9p`/`candidate-1016` is only safe before any flag-on Ask ran on `web`. Staging has its own DB, so this only matters for `web`.
- Before main (flag-off, latest Sat 17:00 WIB): D2 flag-off part green on web-develop; CLAUDE.md §6 line (DONE); dev-ops writes the rollback note into plan §10. Stale "Critic" mentions in CLAUDE.md §3 and README lines 27, 31, 86 and the README cost-guard sentence ("one Ask = up to 30 model calls on v4; MODEL_DAILY counts routes, the per-day Ask cap bounds it") still to do before the submission README.

## Known gaps on main 5a47d02 (verified read-only 16 Oct by tech-lead; NOT fixed, stable candidate untouched)
- G-1 (real, latent): `lib/pipeline/label/prompt.ts:68` tells the model not to emit a `threads[]` entry for an echoed open thread alias, but `lib/pipeline/threads.ts:228-258` only resolves a component that has one -> a continuation line can end up unassigned and be ledgered `done` (lost). Not seen in any rehearsal. Post-freeze fix: synthesize the entry in `tick/service.ts` after `remapOpenThreadAliases` + a `threads: []` test.
- G-2 (real): `built.unassigned_line_ids` is discarded; the ledger marks every unit line `done` (`tick/service.ts:334-335, 421-429`). Post-freeze: retry them with a bounded attempt count.
- G-3 (real, low): throwing `.parse` in `lib/firestore/tick-store.ts` lines 196 (listActiveDevices, before the per-device try/catch), 210, 291, 335. Drift-only trigger. Post-freeze: `safeParse` + skip.
- Stale/not a bug: question-doc overwrite (fixed in R-07); missing `threads(outlet_id, device_id, last_line_end_ms)` index exists on the demo `(default)` DB, still missing on the pilot.
- "0 lost lines" in the load tests is a TRANSCRIPTION metric, not thread membership.

## Where we are (16 Oct ~05:00 WIB, LATEST) — R-19..R-23 all on `main` = 5a47d02, live as `web-00020-p9p` on the DEMO project; QA SHIP
Chain since R-19: PR #73 (R-19 release) → #77 (R-20: proposal agent input + add_record_step library v2, ghost cleanup, rewritten cards) → #78 (R-21: label threading F-1, guide pill/sheet, proposal wording, favicon/20-min/etc.) → #80 (R-22: server transcribe retry, phone jitter, IP cap 30 + `DEMO_SANDBOX_IP_CAP`) → #82 (R-23: phone 240 s time budget, server attempts 2, caps charged once per segment, sticky loss notice, stagger rule). `develop` is synced from `main` after each (#79/#81/#83).
QA: live rehearsals rounds 1-3 + load tests (docs/tasks/QA-*.md, uncommitted). Round 3 SHIP; load round 2 SHIP: N=4 and N=6 simultaneous phones lose 0 lines; N=8 lost 1 line (with notice). Shared transcribe-preview capacity is only ~6-12 served/min project-wide and cannot be raised.
Rollback anchors (rollback waits for Rangga's signal): `web-00019-6wr` (R-22), `web-00018-5kp` (R-21, QA-verified), `web-00017-q6m` (R-20), tags `good-1015-2006` → web-00016-z72, `good-1015-1624` → web-00015-9tt; git tags `main-stable-before-r19`, `demo-good-web-00015-9tt`.
Standing permissions from Rangga (memory `direct-to-main-fix-loop`): PR to main, review, merge, retest until bug-free; demo-template wipe/seed allowed. NOT covered: rollback, other infra (IAM/scheduler/API keys/indexes/env changes), hard-rule changes, pilot project. Fable only for tech-lead + QA.
Open for Rangga: (1) judging-day `DEMO_SANDBOX_IP_CAP=60` (dev-ops command drafted; needs his go, do shortly before judges); (2) ask the Builder Cup organisers' Google contact for a judging-day capacity allowance for `gemini-3.5-transcribe-preview` (only lever on the ~6-12/min limit); (3) the judging-day rule "no more than 4 phones at once" is in the guide + README; (4) real-phone manual checklists in QA round-3 and load-test docs; (5) Tiffany review (Bahasa, rubric, interventions incl. new `add_record_step`); (6) [TEAM CONTACT] placeholders, repo public, status-chip wording, 23 px watch-panel residual.
Open for PM/team: docs truth pass A + evidence pack B (after prototype final, Sat), then plans for E (why-this-proposal panel), C (Critic), D (see docs/tasks/TM-01.md, TM-02-adk-graph.md: advisory-only checkers, code gate stays; recommended order A, B, E, D?, C only if spiked clean); docs follow-ups: pipeline-and-agents T-502 id list (+add_record_step), rbac §2 owner 'Add a constraint', spec §6.6.5 discard cleanup sentence, UX-03 §5.7 (sticky notice), R-18 'a minute apart'; legacy owner file deletion chore; `web-develop` is not configured (no env/IAM/tick), left for later; `next start` vs standalone warning (developer item); pilot lacks `threads(outlet_id, device_id, last_line_end_ms)` index (needed before pilot gets the tick code).
Freeze Sat 17 Oct 12:00; final live run 15:00; go/no-go 18:00; submission Sun 18 Oct.

## (superseded) Where we are (15 Oct afternoon) — ALL R-19 PRs (MUST + owner screens) merged into `develop` = 00df2c9
Merged (#54-#70): PR-0, 0b, R, 1, 2, 3, 4a, 4b, 5, 6, 7, 8, 9a, 9b, 12a, 12b + date-rot test fix (#63). Owner screens (PR-8 Home, PR-12b Approvals, PR-9b SOP book) promoted to MUST by Rangga (15 Oct 10:50).
In flight: integration QA of develop as a whole (Fable); wiring PR (GUIDE_CONTROLS.reset_demo, onBridge wiring for supervisor/owner proposals, brand link 44 px, empty role=alert).
Still to do: chore PR deleting legacy owner files (ProposalList/ProposalDecisionPanel/ProposalCard + tests; update proposals/import-boundaries.test.ts), docs (README DEMO_NEXT_DAY_SANDBOX_CAP; docs/** edits stay UNCOMMITTED per Rangga's commit-scope rule: plan 9.5 reject bounds 3-300, tech spec 8.15 floor-v2, db-schema focus_category/first_version_date, rbac 6.6 another/watch/home/sop fields), seed template SOP v1 created_date (so the book shows 05/10/26; re-seed needs Rangga's go), P1 promotion (tell Rangga first; dev-ops: tag known-good revision, D0 trigger check, template wipe + re-seed, live checks incl. proposals list index and `demo:seed-template --check-only` CLEAN), live audio rehearsal (plan 10.2), E2E rounds.
Fable weekly limit hit earlier (reset Thu 16 Oct 00:00 WIB) but Fable dispatches have worked since Rangga raised the spend limit.

## (superseded) BLOCKER (15 Oct early): usage limits stopped all agent work
Fable weekly limit hit 14 Oct ~19:30 WIB (resets Thu 16 Oct 00:00 WIB). Then Sonnet agents failed with "monthly spend limit reached — raise it at claude.ai/settings/usage" (Rangga's action). No agent can run until that is raised. State when cut off:
- `develop` = 6f1cf21: PR-0, 0b, R, 1, 2, 4a, 3, 4b, 7 merged (#54-#62).
- PR-6 `../bee6-r19-pr6` (feature/r19-shell, HEAD e2f924c): built, tech-lead round 1 done, QA rounds 1-2 fixes committed; QA round 3 (nav focus ring + edge fade, delta only) was cut off; unresolved QA item belongs to PR-5 (DemoBar CLS 0.12 on demo origin: reserve DemoBar space in DemoBar.tsx). Needs QA delta, then push/PR/merge.
- PR-5 `../bee6-r19-pr5` (feature/r19-judge-guide, HEAD 7278ad2 + UNCOMMITTED edits in app/globals.css, app/ui/SidePanel.tsx(+test): the "collapsed pill must not cover header controls at 900-1024 px" fix, red tests written, impl in progress). Still to do: finish pill fix, DemoBar space reservation (CLS), QA re-verify, tech-lead delta, push/PR/merge. This is the critical path (judge guide).
- Not started: PR-9a SOP dates, PR-12a supervisor proposals UI (both start after PR-6 merges), docs PR (README DEMO_NEXT_DAY_SANDBOX_CAP, tech spec 8.15, db-schema, rbac 6.6), PR-7 follow-ups (GUIDE_CONTROLS.reset_demo one-liner + ResetNotice on Home after PR-5/PR-8).
- Promotion P1 (Thu 15 Oct 19:00) is at risk without PR-5/PR-6; PR-4b (needed before P1) is merged.

## Where we are (14 Oct evening) — R-19 demo v2 build in progress on `develop` (no staging; promotions to `main` per plan section 12)
Merged into `develop` (each had tech-lead PASS + QA SHIP): PR-0 contracts #54, PR-0b design tokens #55, PR-R rehearsal harness #56 (live run 30/30 PASS after card rewrite round 1 of d2-c3/d3-c2, plan A.3/A.4 updated), PR-1 evidence rules #57, PR-2 next-day shift #58, PR-4a session gates #59 (develop = 7144d09).
In flight (worktrees `../bee6-r19-*`): PR-3 debrief (rebased, tech-lead PASS, QA running), PR-4b sign-out + open-session (tech-lead fixes being applied, then QA), PR-5 judge guide (resumed after a usage-limit cut), PR-6 shell (cut by the limit, restart from scratch: nothing committed). Not started: PR-7 owner reset, PR-9a SOP dates, PR-12a supervisor proposals UI, docs PR (README `DEMO_NEXT_DAY_SANDBOX_CAP`, tech spec 8.15 floor-v2, db-schema, rbac 6.6, plan 6.3 poll amended).
Rules in force: Fable (`model: "fable"`) for most heavy dispatches (Rangga, 14 Oct, quota); both gates mandatory; develop → main only at planned checkpoints, tell Rangga first; PR-4b must merge before the Thu 15 Oct 19:00 promotion (P1); rehearsal wavs d2-c3/d3-c2/improv re-made.
Open items: usage limit hit twice (resets ~18:50 WIB); judge-guide copy must work whichever proposal is first; interim drawer wording on the last card is misleading until PR-5; PR-7 must clear `shift_started_at_ms`, reset `next_day_count`, refuse while a fresh marker exists, and invalidate the phone's local `last_ended`; live checks after P1 (dev-ops): proposals list index, `demo:seed-template --check-only` CLEAN, real-Firestore next-day contention.

## Where we were (12 Oct, superseded) — everything is built and merged into `develop` (10f2f2b); `main` promotion + infra + internal test are next
Merged this stretch: R-09–R-13, R-12 hardening + PR-B, R-18 P0/P1/P2 (PRs #34–#49), R-14 (README, generated regions table, notices; PR #49).
Every PR had tech-lead PASS + independent QA SHIP (real Chromium/WebKit/Firefox for UI). Known, accepted gaps: WebKit-only tap-before-hydration on /sign-in (focus not moved); reload mid demo session has no restore ("tap Start again", documented in drawer + README); 360x640 with demo bar scrolls ~190 px; Bahasa strings PROVISIONAL.
Pilot-affecting fix shipped in R-18 P2 (d5f892c): debrief answers never uploaded from a real browser (global fetch "Illegal invocation") — fixed.
**Security/infra decisions (Rangga, 12 Oct):** Firebase web keys + pilot/demo project IDs redacted from `docs/tasks/R-01-gcp-state.md` (committed on his explicit ask); git history still holds them (accepted, rule #11) — restrict keys instead. Demo project: public email sign-up DISABLED (done, verified). Demo browser key restriction: approved with `--no-check-existing-usage` (dev-ops running; see R-01-gcp-state.md section "Demo project auth hardening, 12 Oct"). Pilot project untouched; pilot needs sign-up disabled in the SAME step as enabling Email/Password for R-06 deploy.
**14 Oct (late): R-19 BUILD STARTED.** Plan v4 final (docs/tasks/R-19-demo-v2.md); design = page 2 of the Wireframes canvas (71 boards). Decisions: pilot items OUT of MUST (section 18 of the plan); NO staging env: PRs -> develop, promotions develop -> main at checkpoints (Thu 15 19:00, Fri 16 14:30 / 22:00, Sat 17 08:00, freeze Sat 12:00), dev-ops tags the known-good revision (web-00015-9tt today) before each, rollback = one update-traffic command; Fable override (CLAUDE.md section 10 rule 15) on PR-1/2/3/4a/5, page-1 ports and live QA. In flight: PR-0 (contracts, developer sonnet, branch chore/r19-contracts) and PR-0b (design tokens, uiux sonnet, chore/r19-design-tokens). Next: merge both after tech-lead + QA, then dispatch PR-1, PR-2, PR-3, PR-4a, PR-R in parallel worktrees (Fable for 1/2/3/4a). Infra gos still needed from Rangga: D0 pilot trigger check, template wipe + re-seed (Thu, Sat), tag/verify at each promotion.
**14 Oct: DEMO V2 PLANNED (R-19), NOT BUILT.** Rangga's internal test (docs/internal_testing/demo-feedback-1.md, 23 points) -> design on page 2 of the "Bee6 Wireframes" canvas (<PRIVATE_DESIGN_LINK>, 24 boards, page 1 untouched) -> deep plan `docs/tasks/R-19-demo-v2.md` (PLAN v2, tech-lead). Decisions: judge journey of 3 live days (~20 min) with a WORD-FOR-WORD scripted scenario (problem A days 1-2, problem B days 2-3, section A of the plan has the exact text and the 6 routine template clips); "Jump to tomorrow" = data shift (7 guards, locked once a proposal exists); jump to closing unlocks only when all cards of the day are Done; ROUTINE_OPS never proposal evidence + per-category floor, EVERYWHERE incl. pilot; owner approves one, rejects the other; debrief cap 5, no seeded questions, "preparing" state; sign-out after closing leaves the session open (open_session in config, End today on return, 10-min server sweep); before-opening stage and hh:mm clock cut; reason required. Staging = `web-develop` + named Firestore DB `staging` (FIRESTORE_DATABASE_ID), private via `gcloud run services proxy`; develop = staging, main only with Rangga's approval. 11 PRs, MUST ~73 h agent time, freeze Sat 17 Oct 12:00. WAITING on Rangga: the "go", approval of the script wording, the 6 template clips + 15 per-card rehearsal WAVs (+4 improvised), each dev-ops staging step (needs his go). 

**12 Oct late: DEMO IS LIVE AND SEEDED.** Build fixed (PR #51, `pack --publish`; all builds since 7 Oct had failed), main deployed (PR #52 -> revision web-00014/15), demo `web` has FIREBASE_*, APP_REGION, THREAD_HANDLE_KEY, DEMO_IP_SALT; demo sign-up disabled, demo browser key restricted. Template `demo-tpl-outlet` seeded from 7 English clips (private/demo-clips + plan.json) and `READY: facts=4 dates=2` after dev-ops created the missing 4th `threads` composite index (outlet_id, device_id, last_line_end_ms) on the demo project. PILOT still lacks that index (needs Rangga's go before the pilot's first upload). Still open: Rangga's internal test as judge; resume review-run (go); budget alert (amount + billingbudgets API enable); README placeholders; rule #7 vocabulary question; delete/keep `web-develop`; optional committed firestore.indexes.json (post-submission); R-06 section 9 index list updated.
**Open for Rangga:** (1) promote `develop` → `main` (his approval); (2) infra gos still needed: DEMO_IP_SALT secret, Token Creator on Cloud Run SA, TTL on demo_counters.expires_at, budget alert, XFF canary (+DEMO_XFF_FROM_END), resume review-run + run once, seed template (`npm run seed -- --project demo --template`, then `npm run demo:seed-template -- --base-url <url> --code <code> --clips-dir private/demo-clips`, then `--check-only`); (3) English clips + plan.json (≤15 s WebM/Opus, private); (4) README placeholders [DEMO URL] [REPOSITORY LINK] [TEAM CONTACT]; (5) rule #7 question: staff first names also in gitignored config/vocabulary.yaml; (6) add ~12 DEMO_* env names to CLAUDE.md §6 (PM does not edit it on an agent's request); (7) rule-#9 amendment / SOP upload (R-17), diff screen, sections format (post-18 Oct unless he decides otherwise); (8) Tiffany review of rubric/interventions + copy ratification; (9) dependency vulnerabilities (braces high; vitest/@vitest/mocker/uuid medium); (10) uptime alert address default <OWNER_EMAIL>; (11) pilot project id remains in scripts/demo-seed-template.ts (guard constant) and docs/HANDOFF.md.
After internal test: tag v1.0 (Rangga), uptime check 19 Oct–6 Nov (dev-ops), incognito link check (QA), update judge guide + setup guide artifacts (remove "Try as" wording, fill placeholders).

## Where we were (11 Oct, superseded by the 12 Oct entry above) — every remaining task has a plan; building hasn't started
R-06 and R-08 are the only fully-merged work (see below, unchanged). Since then, this session did a
full planning pass, tech-lead writing one deep plan per task, PM brainstorming edge cases and closing
each plan's open questions with Rangga in turn (same pattern as R-08/R-09 earlier):
- **R-09 (approval screens): PLAN v2.** 6.9h vs backlog's 4h. Owner-reject now also creates a
  constraint (source `owner_rejection`) per Rangga's 11 Oct decision, matching the reference-design
  copy. `docs/tasks/R-09.md`.
- **R-10 (SOP versions + plain before/after list): PLAN v2.** 4.8h vs backlog's 1h. `sop_versions` is
  immutable; "in force" vs "latest" version distinction decided (generation uses latest immediately,
  before/after list uses in-force-on-date). `docs/tasks/R-10.md`.
- **R-11 (ReviewAgent): PLAN v1, all §11 resolved.** 6.0h vs backlog's 4h. One daily Cloud Scheduler
  job (09:00 Jakarta), not one per review date. Verdict is plain code (`rev-v1`, ±20% metric shift),
  not a Gemini agent, by default — **README must not claim a Gemini ReviewAgent.** `docs/tasks/R-11.md`.
- **R-12 (demo outlet): PLAN v2.** 8.4h vs backlog's 4h — the backlog's shared-outlet assumption was
  a real design bug (breaks for every judge after the first in a day); fixed with a per-judge sandbox
  outlet cloned from a template seeded through the real segment API. Rangga confirmed (11 Oct): full
  sandbox incl. the Staff/debrief step, and re-opening a cloned debrief window is acceptable under
  T-703, disclosed in the README as simulated timing. `docs/tasks/R-12.md`.
- **R-13 (Eval): PLAN v1.** 2.25h vs backlog's 2h. **Needs Rangga's decision before building:** the
  gold-set was meant to come from 60+ real pilot episodes (Mon 12–Tue 13), which won't exist since the
  pilot is postponed. Default: label episodes from internal testing + the demo outlet instead, state
  the real `n` plainly in the README/deck. `docs/tasks/R-13.md`.
- **R-14 (Release): PLAN v1.** 2.5h vs backlog's 3h (first one under estimate). Current `README.md` is
  stale (says Google sign-in, no ADK, nothing from R-06–R-12) — Task 1 rewrites it fully. Two small
  opens: confirm `README.md` is committable (product docs, not an instruction file — the "don't commit
  docs" rule is about AI-instruction docs, not the README); uptime alert address defaults to
  `<OWNER_EMAIL>`. `docs/tasks/R-14.md`.
- **Running total, unbuilt: ≈ 30.9h** (R-09 6.9 + R-10 4.8 + R-11 6.0 + R-12 8.4 + R-13 2.25 + R-14 2.5)
  before 18 Oct. Every task ran ~1.5–2x its backlog estimate except R-14 (under). **Rangga's explicit
  call (11 Oct): keep building as planned, accept the crunch — no scope cut, no timeline extension.**
- **Build order** (tech-lead's, dependency-driven): R-09 PR-A → R-10 PR-1 (parallel-safe with R-09) →
  R-10 PR-2 + R-11 PR-A → R-12 PR-A (needs R-10 PR-1 merged; merges after R-11 PR-A) → the UI PRs →
  R-13 (independent, once its gold-set data exists) → R-14 last.
- **Side work this session, already merged/applied, not just planned:**
  - **PR #34** (`fix/schema-comment-cleanup`) OPEN against `develop`, ready for merge — comment-only
    fixes (stale "Google sign-in" wording, dormant staff-PIN-field comments, `devices.label` intent
    clarified). Lint/typecheck/tests (2227/2227) all clean; tech-lead had already specified the exact
    fix before the build, so no second review round was run — flag if you want one before merging.
  - **Firestore `corrections.expires_at` TTL** enabled and confirmed `ACTIVE` on both GCP projects
    (was missing; `segments` TTL was already fine). `docs/tasks/R-01-gcp-state.md`.
  - **`docs/db-schema.md`** created: full ERD + field reference for the live Firestore schema, plus a
    §5A "sample data trail" (18 fictional sample documents across one consistent demo-outlet story,
    cross-referenced by id). Two real doc/code findings surfaced and resolved: NON_WORK line-blanking
    now documented (§3.7); `audit_log`'s `device_id` in `details` confirmed as NOT a hard-rule-#7
    violation (the actor is still `actor_role`, matches the web spec's own stated shape).
  - **CLAUDE.md §6**: added `REVIEW_RUN_AUDIENCE` (R-11) and `DEMO_IP_SALT` (R-12) env var names.
  - **Tech debt logged, not yet scheduled:** `GoogleUserRole`/`linkGoogleUser` naming is stale
    (describes an abandoned Google-sign-in plan) — rename not done, flagged for a post-submission pass.
- **Next PM action:** dispatch actual builds, starting with R-09 PR-A, per the build order above. No
  more deep-plan writing needed — every task through R-14 has one.

## Firestore composite indexes — RESOLVED (10 Oct)
QA found `bee6-playground` AND the real pilot project (`<PILOT_PROJECT_ID>`) both had
zero composite indexes, blocking every live day-record/home/queue call. Rangga approved all 3 on
both projects; dev-ops ran all 6 `gcloud firestore indexes composite create` commands and confirmed
all 6 **READY** (verified via `gcloud firestore indexes composite list`, ~15 min build time):
`threads` (outlet_id, first_line_start_ms), `questions`-unlabelled (outlet_id, kind,
window_start_ms), `questions`-queue (outlet_id, kind, status, answered_at_ms desc) — on both
`bee6-playground` and the pilot. Live testing is now fully unblocked. Detail in
`docs/tasks/R-01-gcp-state.md`. One pre-existing, separate, lower-priority item flagged but not
actioned: `capture_sessions`/`devices` indexes not independently verified (expected to resolve as
Firestore's automatic single-field indexes, not composite — may be a non-issue).

## Where we are (10 Oct, latest) — R-06 fully built, all 8 PRs merged to `develop`
- **PR #29** (`feat/r06-unlabelled`, Task 12: unlabelled moments) MERGED. Tech-lead round 1: 4 minor
  findings (query-shape/limit/select-list test gaps, missing tie-case coverage, truncation banner
  undercounting) — fixed, confirmed exact. QA: SHIP, zero defects. 138 files / 1841 tests.
- **PR #30** (`feature/r06-questions-queue`, Task 13: supervisor questions queue) MERGED. Built in
  parallel with PR-6, scoped to exclude step 13.3 (`toSupervisorThread` extraction) per tech-lead's
  pre-merge collision analysis. Tech-lead round 1: 1 major (missing `onReload`-wiring test) + 3
  minor — fixed, confirmed exact. QA: SHIP. Then rebased onto post-PR-6 `develop` and completed the
  deferred extraction (`toSupervisorThread` now shared between `getDayRecord` and `getReviewQueue`)
  — tech-lead PASS on the rebase/extraction (1 minor optional finding, not blocking), QA re-verified
  with a fresh integration test proving the extraction is behavior-preserving across both production
  call sites. 142 files / 1913 tests.
- **R-06 PR status: COMPLETE.** All 8 PRs (1–8, #23–30) merged to `develop`. A real plan gap was
  found and fixed along the way: `getCorrections`/`DayCorrectionRow` needed `debrief_business_date`
  widening for Task 13.4 (purely additive, tech-lead-confirmed safe). `develop` has not yet merged to
  `main`.
- **R-08 PR-A (ProposalAgent server slice, Tasks 0-6) MERGED (#31).** Task 0 spike passed — real
  live Vertex call via `@google/adk` succeeded; built the real ADK path, not the fallback. Tech-lead
  round 1: 1 major (model/redact failures never logged) + 6 minor — all fixed, round 2 PASS. QA:
  SHIP, extensive live verification with real paid Gemini-on-Vertex calls against `bee6-playground`
  — evidence gate proven both directions (1-fact suppression with provably zero model calls;
  2-dated-facts real generation), owner+supervisor generation proven live with raw Firestore
  inspection (no PII/device-id leak, correct role provenance), concurrency/reuse/standalone-build all
  proven live. 159 files / 2112 tests. Two non-blocking follow-ups: a QA-usable service account needs
  `serviceAccountTokenCreator` on `bee6-playground` to force-probe staff/device 403 fully live in a
  future round (currently code+unit-test verified only); QA's fictional `qa-fixture-` prefixed test
  data is still in that project's Firestore, harmless, cleanup optional before any demo rehearsal.
  Also: `@google/adk` pulls in a transitive `@google/genai@1.52.0` via `@google-cloud/vertexai` (a
  hard dep, never imported by our code) — ruled acceptable under hard rule #1, guarded by
  `lib/agents/no-vertexai-import.test.ts` rather than forcing a version pin.
- **R-08 PR-B (the Generate screen, Task 7) MERGED (#32).** Owner+supervisor share `/proposals`
  (Q-10). Tech-lead found 1 **blocking** bug: the shared `authedRequest` client helper only accepted
  HTTP 200 as success, but the generate route correctly returns 201 for a new proposal — so the
  screen's main path always showed the generic error (component tests mocked HTTP away, couldn't
  catch it). Fixed (now accepts 200+201), tech-lead round 2 PASS. QA: SHIP — live-reverified the
  exact fix twice with real paid Vertex calls (new-proposal 201 path, reused 200 path), plus a live
  `GENERATION_IN_PROGRESS` race between two real concurrent requests, owner/supervisor parity,
  no-HTML/no-translation on model text, no leaked ids. 162 files / 2152 tests. Added a note to
  `docs/tasks/R-08.md` §9 item 10 so R-09 checks every new route's success code against the client
  helper before building against it.
- **R-08 PR-C (manual constraints, Task 8) MERGED (#33) — R-08 IS FULLY COMPLETE.** Owner and
  supervisor can both add a permanent constraint via a two-step inline confirm (never a modal).
  Tech-lead 2 rounds: no hard-rule issues, small fixes (re-cap the new store delegation to 200 to
  match the existing contract, missing EN `PROVISIONAL` dict marks, disable the textarea during
  confirm) — all fixed, round 2 PASS. **security-reviewer** (per the plan's own recommendation —
  first R-08 task where new user-typed free text reaches the model prompt): no exploitable
  vulnerabilities. Prompt injection mitigated by the per-call strict output schema + the existing
  human-approval gate; no XSS; redaction pipeline correct, no bypass; no TOCTOU on the 200-constraint
  limit. One pre-existing (not introduced here) backlog item: `scrubStaffNames` doesn't strip
  zero-width characters — worth a future hardening ticket, not blocking. QA: SHIP — both redaction
  layers proven live end-to-end, duplicate detection, no leaked text in logs/audit, 360px safety.
  168 files / 2227 tests. One pre-existing flaky test (`app/capture/page.test.tsx`, timer-based,
  unrelated to this diff) failed once under load, passed twice on rerun — not a regression.
- **R-08 plan v2 → v3, now closed.** Q-11(b)/(c) closed (Rangga, 10 Oct): owner can also add manual
  constraints (not supervisor-only), no edit/delete in MVP 1 confirmed as a known gap. Effort total
  **11.75h**. Real v0 rubric/intervention library at `config/rubric.yaml`/`config/interventions.yaml`
  (tech-lead-authored placeholder, not yet Tiffany-reviewed — a Claude Doc "Rubric & Intervention
  Library — Template for Tiffany" was created and shared for her to fill in, not yet actioned).
- **Follow-ups logged, not blocking:** `scrubStaffNames` zero-width-character hardening (backlog);
  a QA-usable service account needs `serviceAccountTokenCreator` on `bee6-playground` for a future
  round to live-probe staff/device 403 (currently code+unit-test verified across all of R-08).
- **Still open, needs Rangga's direct go-ahead (not an agent/PM decision):**
  - The Firestore composite-index gap above (now broader than previously tracked).
  - Tech-lead's recommended `assertFirestoreSafe` shared test helper (to catch the "explicit
    `undefined` key" Firestore-write bug class generally, not just where QA happened to find it in
    PR-4) — flagged as a decision for Rangga, not yet actioned.
- Real Proofed SOP PDF was found unprotected at `docs/SOP PROOFED.pdf` (untracked, never committed)
  and moved to the already-gitignored `private/SOP PROOFED.pdf` as an immediate hard-rule-8 safety
  action.
- **Google Sheets Bee6 Task Board** updated: R-07 marked Done (was stale at "In Review"), R-06 marked
  In Progress 75%, T-501 (SOP spec) marked Done, T-502 (rubric/intervention library) marked In
  Progress 50% with the placeholder-not-yet-reviewed caveat. A prefix legend added at L1.

## Schedule decision (Rangga, 9 Oct) — supersedes the Sun 11 / Mon 12 dates below
- **Pilot go-live is postponed, no new date set.** The Sun 11 18:00 sign-off and Mon 12 go-live dates
  throughout this file and `docs/plan.md` are void until Rangga sets a new pilot date.
- **Project submission target is 18 Oct, using the demo project only.** The pilot is not needed for
  submission. The bar: the demo must work end-to-end with no bugs — this is now the real deadline
  driving all scheduling, not the old pilot dates.
- **Incident, CLOSED (10 Oct).** An agent dispatched to annotate `docs/plan.md` and
  `docs/specs/web-backend-rbac.md` with this decision instead made large deletions of historical
  content. A follow-up "fix" compounded this by rebuilding both files from the wrong git reference
  (`HEAD` of the stale local `feature/r-05b-label-call-pr2` branch instead of `origin/main`), which
  looked like real data loss — the Mulai/Selesai session model, device model §2a, and insight runs
  §6.6 appeared to be gone. **No content was ever actually lost at the git level** —
  `origin/main`/`origin/develop` (same commit) always had the complete v6 `docs/plan.md` (404 lines)
  and the full 611-line `web-backend-rbac.md` with §2a/§6.6 intact. A corrected rebuild against
  `origin/main` restored the correct base and re-applied only the legitimate narrow annotations (the
  schedule supersession notes, §10 decision rows #54/#55, the auth-wording fix, R-06 v4 route
  annotations) — verified clean, additive diffs (19 and 31 lines respectively) against `origin/main`.
  Both files are now correct: `docs/plan.md` 407 lines, `docs/specs/web-backend-rbac.md` 612 lines.
  Lesson for future doc-fix dispatches: always specify `origin/main` or `origin/develop` explicitly,
  never a bare `HEAD` in this working tree, since its checked-out branch is routinely stale relative to
  the real trunk.
- **A `develop` branch now exists** (pushed off `origin/main`, verified clean build/lint/typecheck/1314
  tests before push). The Supervisor/Owner-facing body of work (R-06, R-08, R-09, R-10, R-11 and related
  dev-mode work) now targets `develop` via normal PRs (same tech-lead + QA gates, no exception) instead
  of `main` directly, so this work doesn't risk the demo project's auto-deploy-on-push-to-`main` while
  it's being built. `develop` merges to `main` only once Rangga is satisfied it's stable.

## Autopilot (Rangga, 7 Oct)
- **Loop:** the PM runs the next-steps sequence task by task. A task merges only after tech-lead PASS,
  QA SHIP, mergeable, and lint clean. Merge is done by the PM after those gates, no need to ask first.
- **Standing rule added this session:** always ask tech-lead whether a newly-found todo task is safe to
  start in parallel with in-flight work, before dispatching it (memory `feedback_ask_techlead_before_parallel_task`).
- **Standing rule added this session:** always verify via `ListAgents` before any status claim ("X is
  running/waiting") — never assert from memory; surface a finished handback immediately rather than
  batching (memory `feedback_verify_agent_status_before_claiming`), in response to a real process
  complaint from Rangga about stale status tracking.
- **Overrun:** if the remaining hours still exceed capacity by the Sunday 11 checkpoint, the PM pokes Rangga with the options.

## Where we are (7 Oct, end of session)
- **PR #19** (`feat/capture-p1-page`, the Mulai/Selesai/Batalkan capture page rewrite) MERGED to `main`.
- **PR #20** (`fix/page-copy-clock-flake`) MERGED — fixed a pre-existing flaky test in
  `app/capture/page-copy.test.tsx` that failed whenever real wall-clock time fell after 18:00 WIB
  (unmocked system clock against the Mulai cutoff window). This was blocking the pre-push hook for
  ANY branch after 18:00 WIB on any given day; now pinned with the existing `pinClock` helper.
- **PR #21** (`feat/r07-debrief-screens`, R-07 Task 7) OPEN, CLEAN/MERGEABLE, ready for your merge.
  The debrief screens on `/capture`: entry card, one-question-at-a-time flow (Ya/Tidak + required
  reason + Lewati), done screen, timeout handling. Wires the already-shipped answer cache/uploader
  and `/api/v1/questions/*` routes to the P1 page's session lifecycle. Two full review rounds: first
  tech-lead pass found 7 issues (layout order vs UX-03 §5.8, a stale done-screen unsent count, two-line
  question rendering, a late-fetch race overwriting the timeout screen, a missing defensive guard, lint,
  and 3 weak/missing tests) — all fixed and re-verified PASS. QA independently live-drove every
  acceptance scenario in a real 360px browser (Playwright against the running dev server) and confirmed
  all of them; the only gate failure it hit was the pre-existing flake fixed by PR #20, resolved by
  rebasing this branch on top of it before push.
  - **Known gaps noted in the PR, not yet resolved:** same-day Mulai re-enable after a midnight-crossing
    auto-stop is verified only by the existing unit test, not independently browser-driven (no fake-clock
    dev control exists for this scenario yet — consider extending DevPanel per the dev-mode standing rule
    if this needs live verification soon). A full real-device/Firestore end-to-end pass (real
    `getUserMedia` session → real Selesai/auto-stop → real debrief → real redaction/RBAC on the answer
    route) is still needed; this round used network-mocked fixtures for the UI slice.
- **R-07 remaining scope:** Task 8 (DevPanel debrief readouts) is already merged separately. The
  deferred answer-rate-limit follow-up (server-only, `lib/debrief/service.ts` + the answer route) is
  still open, due before the Sunday 11 Oct sign-off, and was confirmed safe to run in parallel with
  Task 7 (no shared files beyond additive lines in `lib/debrief/constants.ts`). Not yet dispatched.
- **Pilot project (`<PILOT_PROJECT_ID>`) still NOT deployed.** dev-ops found it's missing a
  Cloud Run service, Cloud Build trigger, and Scheduler job — same steps as the demo project. Needs
  Rangga's build-service-account choice and a new go-live date (the original Monday 5 Oct date has
  passed; see "Decisions (Rangga, latest)" below for the most recent postponement on record, 3 Oct —
  confirm this is still current).
- **Not yet started per the sprint sequence:** R-06 (supervisor view), P4 (retention).

## Product direction decided (Rangga, 3 Oct) — supersedes automatic hours gating
- **Manual session boundaries:** staff press Mulai (start of work, before opening, for prep) and Selesai
  (operations ended, ready for debrief). No automatic start or stop by opening hours.
- **Opening hours per day** (Mon–Sun, from Google Maps as reference, entered manually). Used only as
  checkpoints: "opening time, no session started" and "closing time, session still running".
- **Offline-first:** encrypted on-device audio queue is allowed. Gap ledger records any interruption
  (device off, reboot, battery, call, network, server error, mic lost) with timestamps and category only.
- **Redacted work text retention:** 14 days default, customizable later (storage allocation).
- **Insights:** on-demand button over a chosen date range, from saved redacted text. Weekly proposal is a
  reminder only and runs a plain-code sufficiency check first; proposes only on sufficient evidence.
- **Provider abstraction:** after MVP 1, not now.
- **Open, must be confirmed before planning:** (a) the approved privacy line says "Audio is not kept",
  which an encrypted on-device audio queue contradicts. Proofed's consent and the DPIA need to cover the
  new wording. (b) Mulai/Selesai on the live pilot phone before Monday 5 Oct changes the capture path that
  is running now. Decide whether it lands before go-live or after it is verified.
- Docs to correct: `docs/specs/web-backend-rbac.md:103`, `docs/specs/pipeline-and-agents.md:16`,
  `docs/specs/technical-specification.md:54`, `docs/backlog.md` T-101 and the closing-time trigger.

## In flight at compaction (4 Oct, late) — RESOLVED, kept for history
All items below this line were resolved by 7 Oct: the P1 page merged as PR #19, the status-truth and
upload-toast branches' fixes landed on main ahead of it. Spec corrections, seed strictness and the
CLAUDE.md edits were applied. No longer actionable; see "Where we are" above for current state.
- **P1 build** on branch `feat/prod-01-p1` (stacked on `feat/capture-live-state-truth-r2`). Done: mic-label
  fix, consent-gate removal, weekly-hours schema. Next, in order: calendar.ts + tests, session-state.ts,
  session routes, the page (Mulai/Selesai), Cancel-A, then the 30 s checkpoint and DevPanel readouts.
  Do NOT deploy this branch yet; the page still auto-starts from the clock. Do NOT merge until the
  status-truth branch passes review (page files overlap).
- **Status-truth branch** `feat/capture-live-state-truth-r2`: QA DO-NOT-SHIP earlier for the mic label
  (now fixed on the P1 branch). Needs tech-lead and QA re-review before it merges.
- **Upload-toast branch** `feat/capture-upload-toast` (a96121e): tech-lead CHANGES REQUESTED, one fix
  (use pointer events, pause on mouse only). QA browser verdict pending.
- **Spec corrections approved, not yet applied:** fix the two hours-validation examples in the revised technical spec §8 (PROD-01 is removed, 6 Oct)
  (the 20:00–02:00 example is impossible; the 03:00–06:30 example fails the 4 h rule, not the other one).
- **Seed:** keep the loader tolerant of `consent_complete` until the private seed file is cleaned, then
  make it strict before the Sun 11 deploy (Rangga to clean the private file).
- **Consent text test:** keep the negative check (no consent text on the capture page).
- **CLAUDE.md** edits applied: §2 rule 7 and 7b, §3 auth, §5 seed comment, §8 capture and consent lines.

## Approved plan (Rangga, latest)
- **Plan v5 approved:** `docs/plan.md` (PROD-01 removed 6 Oct; its rules moved into the revised docs).
  Sprint load 92% accepted, cut order R-15, then R-10 as a plain list, then P5.
- **R-16 (voice debrief) moves to "if time"**, Rangga confirmed.
- **Sufficiency thresholds confirmed:** 3 days, 60% coverage, 2 facts on 2 dates, at least 1 day with answers.
- **Revocation response time:** within 7 working days (Rangga confirmed).
- **Business day:** work is counted by the session's business date. A session started Wednesday that
  closes Thursday 01:00 belongs to Wednesday. Confirmed.
- **Revocation:** acknowledgement and complete removal are both within 7 working days. Confirmed.
- **Cancel button (new, Rangga):** staff can discard a running session that was started by mistake.
  Allowed at any time while the session is running, with a two-step confirmation. Semantics in the plan.
- **Mulai eligibility (Rangga):** once a business day has ended (Selesai or auto-stop), its Mulai is not
  offered again. The next business day's Mulai is offered only from 01:00 the calendar day after the
  ended business day's date, never earlier, even if the shop's previous close was 21:00 or 22:00.
- **Answer decisions approved (Rangga, 4 Oct):** (1) the headline is "Sekitar pukul HH:MM ada <langkah>.
  Benar?" and the SOP question moves into the reason label after YES ("Sudah sesuai SOP? Kalau belum, kenapa?"),
  with "Kenapa tidak?" after NO; (2) the reason is required on YES and on NO; (3) NO on a sensitive category
  (complaint, correction, safety, security, disruption) excludes that thread like any other NO. Sprint load
  is 82.75 of 84 h (99%). R-07 is 4.75 h.
- **Debrief answer shape for MVP 1 (Rangga, 4 Oct, final, supersedes the free-text-only shape):** the
  answer is YES / NO with a required reason. Yes confirms the thread's category; No rejects it (the existing
  `staff_rejected` gate branch). The reason is required, redacted and name-scrubbed, capped at 500 characters.
  Free text revising the category is post-MVP 1 (too hard for now). Lewati (skip) and the other decisions
  from the previous note stand.
- **Debrief answer shape (Rangga, 4 Oct, earlier):** a debrief answer is a free-text WHY explanation, not a
  yes/no. Staff explain why the SOP step was or was not implemented properly. Redaction and the name scrub
  run on it before storage; add a length cap. Supervisors do NOT answer device questions (no). A fully
  answered debrief does NOT release Mulai early: the full 1 h timeout applies (no, for simplicity).
- **Mulai and previous debrief (Rangga, 4 Oct, final, supersedes D2 and D2a):** Mulai is NOT shown until
  the previous business day's debrief is completed within its timeout, UNLESS the previous day is an
  off-day (weekend or weekday off). Reading A confirmed.
- **No undo (Q28):** accepted for MVP 1.
- **Multi-device (Rangga, 4 Oct, final):** sessions can start simultaneously on multiple devices in the
  outlet, and each device runs its own debrief. Debrief expiry is per DEVICE, not per outlet. Each device's
  answers are uploaded and merged later, so the system can generate comprehensive insights from all devices.
- **Debrief questions are role-agnostic (Rangga, 4 Oct, final):** a question does not depend on who
  answers it. It asks whether the SOP was implemented properly, and if not, why.
- **Sign-in and consent (Rangga, 4 Oct, final):** owner and supervisor keep Google sign-in. Staff need no
  sign-in. Consent is NOT collected inside the app; it is covered by the paper contract between bee6 and
  Proofed. bee6 emails the consent and the updated privacy policy and TnC to all users. The in-app
  consent gate (consent_complete, the "no consent" view) is removed from MVP 1.
- **MVP 1 device model (Rangga, 4 Oct, final):** staff sign-in (name + PIN) is NOT needed for MVP 1.
  Staff only pair the device with the system. The system does not distinguish a shop device from a staff
  phone; it tracks the device id only. The session runs uniformly regardless of mode or device. Mode is
  derived: exactly one paired device = "room mode"; more than one = "wearable mode". This supersedes the
  staff-PIN sign-in in the earlier device model and touches R-07, the RBAC table, and CLAUDE.md §2 rule 7
  (staff identity on debrief answers). Roles and no-names rules still stand for stored data.
- **Decisions D1–D5 (Rangga, 4 Oct, final):**
  - D1: Selesai shows at start + 4 h (the minimum opening duration), not at close. Example: Mulai 01:00
    shows Selesai about 05:00; Mulai 21:00 shows Selesai at 01:00. Cancel is allowed until close is triggered.
  - D2: Mulai is always shown from 01:00, even if the previous day's debrief does not exist.
  - D3: every open question expires at the end of the debrief.
  - D4: no Mulai at all on closed weekdays.
  - D5: the paired shop phone itself uploads the cached debrief answers.
- **Session model (Rangga, final):**
  - Mulai window for business day D: from 01:00 on D until (close − 4 h) on D. Close time is a const 4 h
    minimum opening assumption. Mulai allowed during the closing hour.
  - No Mulai by the window end = off-day.
  - Maximum close setting: 01:00 (next day). Auto-stop is 1 h after close, so max 02:00.
  - Selesai shows at close time; auto-stop at the latest at close + 1 h.
  - Debrief starts after Selesai or auto-stop. It lasts 1 h from its start, regardless of activity.
    Answers tapped are saved first; unanswered questions expire as unverified.
  - Interrupted debrief resumes from its original start; a reload cannot extend it.
  - Answer cache on the phone: kept until uploaded, then removed; in any case removed after 14 days
    (accepted loss if offline longer). Roles only, no names.
  - Next business day's Mulai is offered from the later of 01:00 on D+1 and the end of D's debrief.
    If D's debrief ends at 03:00 Thu, Mulai shows on Thu and marks Thu's session (D+1) running.
  - Business-day boundary is 01:00: a Mulai at 01:30 belongs to the day that opened at 01:00.

## Decisions (Rangga, latest) no change needed; the test-outlet hours stay as they are.
- **Debrief:** assumed around 01:00 to 02:00 after closing; adjustable.
- **Test outlet:** uses the same past-midnight hours (09:30 to 01:00), adjustable freely.
- **Off-hours Mulai:** no 1-hour cap. Rangga corrected this; the earlier "1 hour" wording is void.
- **Written sign-off:** Rangga's signature alone.
- **Internal testing:** test outlet in the pilot project.
- **Pilot review:** Wed 21 Oct, after submission.
- **Long off-hours run accepted** (Mulai at Sat 23:30 runs to Mon 23:00 unless Selesai is tapped).
- **Proofed hours (private seed, not in the public repo):** Mon–Sun 09:30 to 01:00 the next day. Closing
  crosses midnight: the hard auto-stop is 02:00 the next day. Plan must confirm midnight handling.
- **Upload-line copy (sample, PM-generated, Rangga will supply final copy later if available):**
  - Uploading: "Mengunggah / Uploading"
  - Retrying: "Gagal unggah, coba ulang (1x) / Upload failed, retrying (1x)", counting up (2x, 3x)
  - Skipped: "Gagal unggah, dilewati / Upload failed, skipped"
  - Succeeded: "Unggah berhasil / Upload succeeded"
  - Hints: "Server sibuk / Server busy", "Hubungi supervisor / Contact supervisor"

## Decisions (Rangga, latest)
- **Pilot go-live postponed from Mon 5 Oct to Mon 12 Oct** (Owner not ready). Time for adjustment and
  internal testing by Tiffany and Rangga. Plan and sprint schedule must be re-dated accordingly.
- **Proofed "informed" is only a verbal ack, not sign-off.** Live testing on the pilot still needs Rangga's
  formal sign-off. The encrypted on-device queue (P3) is NOT enabled on the pilot until that sign-off.
- **Overlapping insight date ranges are allowed as separate runs.**
- **Off-hours Mulai:** a session started outside the planned window runs for at most 1 hour, then stops
  automatically. Explain this clearly in the plan (what staff see, why it is bounded).
- **Holiday / closed day:** if nobody presses Mulai before the stop time, the day is treated as off or
  closed. No gap alarm for that day.
- **Consent revocation is NOT handled in-session.** A revocation request goes to Rangga or Tiffany, who
  stop capture and remove the data manually for now.

## Decisions (Rangga, 3 Oct, final)
- **Listening vs upload are separate:** green "Listening" means capture is running and audio will be
  kept, regardless of upload result. Add a separate upload status in every mode: "Mengunggah / Uploading",
  "Gagal unggah, coba ulang (1x) / Upload failed, retrying (1x)", "Unggah berhasil / Upload succeeded".
- **Mulai/Selesai goes ahead.** Go-live trial is realistic at 10:00, after 08:00 opening, because staff
  are not ready at opening. Sprint plan to be adjusted with known risks.
- **Hard auto-stop:** Selesai is forced 1 hour after the set closing time, by default.
- **Insights:** supervisor and owner can run them; runs are idempotent (no duplicate run for the same range).
- **Reminder timing:** the plan must explain exactly how reminders work.
- **Privacy wording:** generated in the plan (§12), Proofed informed of TnC changes.

## Accepted risks (Rangga, explicit, 3 Oct)
- **Silent green banner on a 401 (revoked or re-paired device):** the shop phone can show
  "Mendengarkan / Listening" while every segment is discarded. Accepted for the Monday pilot. Revisit
  after go-live: the engine status must reflect dropped uploads, and the supervisor view should alert
  when a device has heartbeats but no new segments.

## Planned, not built
- **UX-02 is DEAD (confirmed 9 Oct).** `docs/tasks/UX-02-auth-nav-refinement.md` was superseded by the
  session-model plan on 4 Oct (`docs/plan.md` §10 #46) — no staff sign-in in MVP 1, device model, manual
  sessions. Do not build PR-A or PR-B from it; its open questions (session length, `/` landing, `/today`
  placeholder, public landing names, PR-B timing) are void. **Owner/supervisor sign-in is instead R-06's
  own PR-1** (Google popup sign-in + Bearer ID token, no session cookie — see `docs/tasks/R-06.md` §0/§10),
  since R-06's tech-lead plan found no browser-side sign-in exists yet at all (R-02 only built the server
  half). This HANDOFF entry previously pointed at UX-02; that was stale and is corrected here.
- **TSD rewritten** to the standard template: `docs/specs/technical-specification.md` (379 lines, concept
  level, uncommitted per the docs commit rule). The old 952-line code-level version was never in git;
  a copy is at `/tmp/bee6-technical-specification-v1-code-level-2026-10-03.md`, which can be cleared.
  Decision needed: where the old version lives durably. Repoint references in `docs/tasks/R-05b.md`,
  `docs/specs/pipeline-and-agents.md`, and `docs/tasks/R-03-fixes.md`.
- **Deferred, tracked in `docs/tasks/R-05b.md`:** R-06/R-07 must switch the `q_thread_*` question write
  off blind `tx.set`, so an answered question is not reopened on merge.
- **Known gaps for the README/known-gaps list:** the scheduled tick's worst-case lease is 30 minutes;
  the ledger has no TTL (pilot scale acceptable); the staff-name scrub on long-lived thread text is still
  planned; the daily token ceiling enforcement is not built.

## Process and team rules (3 Oct)
- **Always dispatch dev-ops for any gcloud, IAM, or infra diagnosis or fix.** The PM does not troubleshoot
  infra in chat (CLAUDE.md §10 rule 1, memory `feedback_always_dispatch_devops_infra`).
- **tech-lead owns the deep implementation plan** (`docs/tasks/R-xx.md`). Developers follow it literally.
  developer-junior (haiku) is for mechanical slices only.
- **Browser testing split:** Playwright (scripted, headless) for repeatable checks; Claude in Chrome
  (extension, interactive) for exploratory or real-profile checks. QA loads browser tools via ToolSearch
  first; the extension was verified working on 3 Oct (one browser connected).
- **Truthful UI rule (Rangga, 3 Oct):** any label must match real system state. "Listening" means capture
  is running. "Offline" must never hide that listening continues.
- **Cost:** `/usage` on 3 Oct showed sonnet-driven subagents were the largest line item (developer 24%),
  and long sessions (>150k context) drove most spend. PM compacts at logical breakpoints, not at capacity.

## Waiting on Rangga (9 Oct, latest)
1. **Pilot deployment Stage 1** — the Cloud Build GitHub connection Console step on
   `<PILOT_PROJECT_ID>` is still not done; nothing else in the deploy guide can proceed
   until it lands. See `docs/tasks/R-01-gcp-state.md`.
2. **DEV-03 (fast-day dev tool) — 2 small credential questions** before dev-ops can build the
   tick-now route: (a) dev-ops impersonation of the demo service account vs. Rangga's own Google
   login for local Gemini calls, (b) whether to pause the demo project's live Scheduler job during
   local testing. See `docs/tasks/DEV-03-fast-day.md` §7.
3. **R-06 (day record screen) — 11 open questions**, `docs/tasks/R-06.md` §12. Headline: real cost
   is ~7.5h + 0.5h dev-ops, not the original 3h estimate (no owner/supervisor sign-in exists yet at
   all — R-06 now includes building it as PR-1). Rangga confirmed 9 Oct: keep R-06/R-08/R-09/R-10/R-11
   (17h total) in current MVP scope despite the schedule slip, "important for the judge to see."
4. Your live recorded test on the demo capture flow — unblocked, do any time.
5. The demo regression matrix (`docs/tasks/QA-demo-regression.md`) — ready to execute whenever.

## Next actions (in order, once Rangga answers above)
1. PM brainstorm pass on R-06's edge-case table (§6, E1–E32) and DEV-03's edge cases, then dispatch
   developer/developer-junior per each plan's routing table.
2. R-06 PR-1 (sign-in) and PR-2 (server) can build in parallel; PR-3 (screen) needs both merged first.
3. DEV-03 PR A (tick-now) is scoped for the same day as R-08; PR B (fast day) must merge before
   Cancel-B starts (both touch `session-service.ts`).
4. Pilot go-live: dev-ops runs the pilot setup once Stage 1 lands, same steps as demo.
5. R-08 → R-09 → R-10 → R-11 planning follows R-06, in dependency order — not yet started.

## 18 Oct (afternoon) — decisions after step 3 passed
- Step 3 (DebriefAgent) passed Rangga's test. Risk-fix batch (#131, develop 0ccbfb1) live on web-develop-00061-gv4 with PROPOSAL_AGENT_V4=true and DEBRIEF_AGENT=true. Flaky-test hardening merged (#130). D-1 = option 1 (stored summary no longer a word source). Scripted problem cards keep the template heading (accepted, option A). M4 circuit breaker still open (needed before DEBRIEF_AGENT on `web`).
- KNOWN LIMITATION (Rangga, 18 Oct): several judges/phones starting in the same second can trigger Vertex 429s on gemini-3.5-transcribe-preview (shared preview capacity, no raisable quota, NOT_ENOUGH_USAGE_HISTORY on every row; Cloud Quotas API enabled on bee6-playground). Treated as known; focus is a single user being safe. Do not start several sandboxes in the same second on judging day.
- Fix in flight: fix/transcribe-429-retry (../bee6-fb22): after Selesai/auto-stop a server-refused segment keeps retrying up to 4 min (plan docs/tasks/capture-retry-after-end-18oct.md). Root cause was End aborting the retry, not a 6-try cap (dead code removed).
- Step 4 in flight: feature/after-days (../bee6-fb21): PR-1 guards, d4-c3 split into two lines (batcher cuts at 15 s), PR-2 eval PASS (read-back 50/50 one PHONE_CALL thread), PR-3 guide/copy building. Do NOT deploy develop to web-develop between PR-1 and PR-3. Then Part 2 ReviewAgent (PR-4/5) flag REVIEW_AGENT. Heat map held.
- Demo counters reset at UTC midnight = 07:00 WIB.

## 18 Oct, ~21:50 WIB — hard stop set by Rangga at 22:00
- web-develop serves web-develop-00064-2gd = develop 9a74fe2 (Part 1 after-days 4-5 + retry-after-End + Jump wait), caps raised to model 1000 / segment 1500 / generate 80 (reset to default only on Rangga's word; counters reset 07:00 WIB). Flags: PROPOSAL_AGENT_V4=true, DEBRIEF_AGENT=true, REVIEW_AGENT unset. `web` = web-00024-rl5 (old, untouched). Rollback for web-develop: 00063-nts (old caps) or 00061-gv4; NOT 00059.
- QA live (docs/tasks/QA-after-days-and-retry-18oct.md): 5-day path, 3-day path, refusals, retry-after-End, Jump wait PASS; defects: D1 major (late note delivered by retry after End never shown in supervisor day record; tech-lead root-cause in docs/tasks/qa-after-days-defects-18oct.md), D2-D4 minor (stale retry row after Jump, review-date inconsistency on one sandbox, guide copy repeats), D5 known 503. QA round 2 (read-back "Worked" proof + owner-rejects-all) running.
- ReviewAgent (branch feature/review-agent, ../bee6-fb23, local; plan docs/tasks/review-agent-18oct.md §16): eval E2 FAILED (a_worked 60 %, b_worked_marginal 60 %, revert 80 %; fallback 5.6 % overall, 12.5 % on core cases). Rangga decision: ship as is with the plain-code fallback (UI informs the judge), improve AFTER submission. Flag REVIEW_AGENT stays unset until deploy is approved; kill = remove env var, never a traffic rollback.
- A security audit (18 Oct) was run; its report and findings are kept private and handled by Rangga outside this repo.
- Known limitation (Rangga): several judges starting phones in the same second can hit Vertex 429s on gemini-3.5-transcribe-preview (shared preview capacity, no raisable quota).
- Open decisions: release PR develop -> main / deploy to `web` needs Rangga's explicit word; M4 circuit breaker before DEBRIEF_AGENT on web; Bahasa review by Tiffany.

## 18 Oct (late) — KNOWN GAPS accepted by Rangga (for README / CLAUDE.md §8 after submission)
Source: docs/tasks/QA-after-days-and-retry-18oct.md, root causes + exact fixes in docs/tasks/qa-after-days-defects-18oct.md.
- D2 (minor, our regression): after "Jump to tomorrow" aborts a still-retrying upload, the new day's ready screen keeps "Not sent yet · retrying (Nx)" and no "Some speech was not captured" notice. Fix B = engine.abandon() via abortAllCaptureUploads({ asLost: true }) (plan has 8 tests).
- D3 (minor, not a code bug): each after-day jump moves sop_versions dates back one day by design (D2 decision), so a screen read before the jumps can show different review dates (e.g. approval summary Mon 2 Nov vs Reviews card Sat 31 Oct). Fix = copy footnote on the after-days reviews_ready card (strings in plan).
- D4 (minor, copy): the day-3/day-5 drawers repeat "Days 4 and 5 unlock after the Owner approves" / "sign out and continue as Supervisor"; after review_exists the lock line still says days 4 and 5 unlock. Fix C = copy (journey.ts, guide.ts, JudgeGuide.tsx:278, tests) after the review-agent merge.
- D5 (known limitation): Vertex 429 -> 503 on segment PUT under bursts (preview model, shared capacity); mitigated by retry-after-End (4 min) and Jump wait (25 s); a note still failing after those is lost.
- ReviewAgent: E2 failed (a_worked 60 %, b_worked_marginal 60 %, revert 80 %); ~12 % fallback on core cases to the plain card (UI notice informs the judge); narratives sometimes say "1 moments" / mild purpose clauses; Bahasa PROVISIONAL (Tiffany). Improve after submission (prompt line for the -25 % case, 10 runs per case).
- D1 (major) is NOT a known gap: fix in progress on fix/late-note-continuation (../bee6-fb24), staging first; pilot pipeline is touched, so `main` needs Rangga's explicit word.
