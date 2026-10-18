# Demo feedback 2 — round 4 (items 18–20): design pass

Tech-lead design pass, Sun 18 Oct (submission day). Read against `origin/develop` **d7ac459** (read-only sibling
worktree `../bee6-tl-ro`, removed afterwards). Source: `docs/internal_testing/demo-feedback-2.md` lines 18–20 (all OPEN,
found by Rangga on `web`). No code was edited. Every `file:line` below is on d7ac459.

**Recommendation in one line:** three PRs, merged in order **PR-A (item 19, 0.5 h, `developer-junior`) → PR-B (item 18,
client-side chained Ask, ~3 h, `developer`) → PR-C (item 20, step-level re-base of the SOP_CHANGED guard, ~5 h incl. a
full live judge run, `developer` + `security-reviewer` on the approve path)**. PR-A and PR-B are safe for the last day.
PR-C is a go/no-go for Rangga: it changes the owner-approval transaction (the demo's finale); it is small and
pure-function-heavy, but it must not go to `web` without one complete live judge run (3 days → supervisor → owner →
both approvals → SOP → Reviews) on `web-develop` first. If there is not ≥ 5 h of clock for that, keep today's guard
and only fix the copy (option D) — which does **not** satisfy Rangga's ask; say so rather than ship it half-tested.

Item 20 is the only one that is architectural: it touches the invariant "a version is built on exactly the SOP the
proposal was drafted on". Items 18 and 19 are bounded UI changes.

---

## Item 18 — one tap of "Ask Bee6" should produce every proposal the evidence allows

### Today (file:line)

- The button has four looks decided by the server's watch rows (`app/proposals/WatchPanel.tsx` L17–23, L64–75):
  `ready` + no proposal → "Ask Bee6 for a proposal" (`C-propw-ask`, `lib/i18n/v2/proposals.ts` L143); `ready` + a
  proposal exists → "Ask for another proposal" (`C-propw-ask-another`, L144, sends `another: true`); every row
  `proposed` → "Both asked · no more evidence to use" (demo, L186) disabled.
- One tap = one `POST /api/v1/proposals/generate` (`app/proposals/SupervisorProposals.tsx` L245–291 `ask()`), guarded
  against double taps by `askingRef` (L246–247). The route (`app/api/v1/proposals/generate/route.ts` L51) charges one
  demo "generate" slot per request (`GENERATE_PER_SANDBOX` 8, `GENERATE_DAILY` 300, `lib/demo/constants.ts` L41–42)
  before the model runs.
- The service (`lib/proposals/service.ts`) writes **one proposal per request by design**: the focus loop L609–629 walks
  the READY, not-taken categories (`readyRows` L284) and `break`s on the first proposal or block; a *decline* moves on to
  the next category (`MAX_FOCUS_PER_ASK` = 2, `lib/proposals/constants.ts` L46). Per request it holds the outlet lease
  (`acquireLock` L260, `PROPOSAL_LEASE_MS` 300 s) and releases it in `finally` L898.
- The "one at a time" invariants the brief asked about:
  - threads cited by an OPEN proposal leave the pool (L278–281 `cited`), and a category an open proposal is about is
    not proposed again (L280 `taken`) — both read fresh at the start of every request;
  - a focus's evidence aliases come only from that category's slice of the pool (L370 `focused = pool.filter(c =>
    c.category === focus.category)`), so two proposals about two categories **cannot cite a common thread** even
    without the `cited` filter; a sequential second Ask works off the pool minus the first proposal's threads and
    category — exactly what "Ask for another" does today;
  - two requests at once are impossible: the second gets 409 `GENERATION_IN_PROGRESS` (L261), which the page turns
    into the 5 s polling "waiting" state (L276–279, L190–212). So a *parallel* run cannot double-cite either — it simply
    cannot run.
  - the demo's "Jump to tomorrow" locks once any proposal has content (`lib/demo/next-day.ts` L81, G6) — unaffected by
    how many proposals one tap produces (the first one locks it already).
- Latency: v3 agent ≈ 6–8 s per focus; v4 (web-develop only) 20–40 s. Cloud Run timeout 1800 s and the 300 s lease are
  not a constraint for 2–3 proposals either way.
- The demo guide card `proposals_ready` (`lib/demo/guide.ts` L313–325) says "it writes one proposal for one problem at a
  time. Ask for another to get the next one."

### Options

**(a) Client chains the existing route (recommended).** `ask()` loops: round 1 as today; after a result *with content*
it calls again with `another: true`, up to `min(readyRowsAtTap, MAX_ASK_ROUNDS = 3)` rounds; stops early on anything
that is not a new proposal (suppressed, blocked, reused, 409, error). One list reload at the end, one status line. Each
round is its own request (own lease, own demo-cap charge). No server change, no contract change, no change to the
evidence gate or the agent.

**(b) New server behaviour: `{ all: true }` generates every ready category in one request.** Would change the response
contract (`GenerateResponseSchema` is one proposal), the 900-line service's focus loop, the audit/log shape, the demo cap
semantics (1 charge for N model runs) and the lease budget (2 focuses × 2 attempts × 60 s already = 240 s of a 300 s
lease; 3+ categories on the pilot would overrun it). Most-tested core file, on the last day. **Rejected.**

**(c) Keep "Ask for another" and reword.** Rangga explicitly rejected it. Not an option.

### PR-B design (option a) — what the builder does

`app/proposals/SupervisorProposals.tsx`
1. Replace `ask(another: boolean)` (L245) with `askAll()`:
   ```ts
   const MAX_ASK_ROUNDS = 3;                                   // bounded on the pilot too (Q-18.2)
   const readyAtTap = data.watch.categories.filter((r) => r.state === "ready").length;
   const rounds = Math.min(Math.max(1, readyAtTap), MAX_ASK_ROUNDS);
   let another = hasProposal;                                  // the WatchPanel's `another` for round 1 (unchanged)
   let written = 0; let last: GenerateResult | null = null;
   for (let round = 1; round <= rounds; round++) {
     setRound({ n: round, total: rounds });                    // new state, shown by GeneratingState
     const body = another ? { from_date, to_date, another: true } : { from_date, to_date };
     const result = await authedPostJson(auth, "/api/v1/proposals/generate", body, GenerateResponseSchema);
     last = result;
     if (result.kind === "ok" && result.data.proposal.content !== null && !result.data.reused) { written++; another = true; continue; }
     break;                                                    // suppressed / blocked / reused / 409 / error ends the chain
   }
   ```
2. Settling: `written >= 1` → `settleOnReload.current = written === 1 ? {key:"C-propg-wrote"} : {key:"C-propg-wrote-n", vars:{n: written}}`,
   bump `reloadKey`, publish `progress` **once**. Then, if `last` ended the chain for a reason other than "all rounds
   done", append that reason as today's notices do, but only when `written === 0` (today's branches L268–290 unchanged);
   when `written ≥ 1` and the last round failed/was suppressed, use ONE new key `C-propg-wrote-partial`
   ("Bee6 wrote {n} proposal(s). The other problem could not be proposed now — tap Ask for another to retry.").
   A 409 `GENERATION_IN_PROGRESS` on **round 1** keeps today's waiting path (L276–279) byte for byte; on a later round
   it ends the chain like any other failure (the first proposal is already on the list; the lock will expire).
3. `askingRef` double-tap guard unchanged (L246–247); `holdTop`/`reserveHeight` D2 layout logic unchanged (set once at
   the tap, not per round).
4. `GeneratingState` (`app/proposals/GeneratingState.tsx`): new optional prop `round?: { n: number; total: number } | null`;
   when `total ≥ 2` render one extra line `C-propg-round` = "Writing proposal {n} of {total}…" under the existing
   body. `askEstimate` behaviour unchanged.
5. `WatchPanel.tsx` L64–74: when `readyRows.length >= 2` and not `busy`, the label is `C-propw-ask-all` = "Ask Bee6 for
   proposals"; one ready row keeps today's singular/another labels (so a retry after a partial chain still reads "Ask for
   another proposal"). `onAsk` signature unchanged.
6. Copy (`lib/i18n/v2/proposals.ts`, EN + ID `// PROVISIONAL`): add `C-propw-ask-all`, `C-propg-wrote-n` ("Bee6 wrote {n}
   proposals. Open each to read the evidence."), `C-propg-wrote-partial`, `C-propg-round`.
7. Guide (`lib/demo/guide.ts` L313–325 `proposals_ready`): body → "Evidence is ready. Tap Ask Bee6 once: it writes one
   proposal for each problem that has enough evidence (about 20 s)." / "Once a proposal exists, the demo days can't be
   run again." `proposals_generating` L326–329: "The proposals appear in about half a minute." `proposal_detail` todo L334
   already says "Ask Bee6 for proposals".

Tests to write
- `SupervisorProposals.test.tsx`: (1) two ready rows → two POSTs, 1st body without `another`, 2nd with `another: true`;
  exactly one reload after the chain; line "Bee6 wrote 2 proposals"; bridge gets ONE `progress`. (2) one ready row → one
  POST (today's L234 test still passes unchanged). (3) round 2 suppressed → partial line, list reloaded, the round-1 row
  visible. (4) round 2 network error → partial line. (5) 409 on round 1 → today's waiting path (L360 test unchanged).
  (6) `MAX_ASK_ROUNDS`: four ready rows → three POSTs. (7) during round 2 the generating block reads "Writing proposal 2
  of 2…"; during a one-round ask no such line. (8) a `reused: true` answer ends the chain and reads `C-prop-reused`.
- `WatchPanel.test.tsx`: ≥ 2 ready rows → "Ask Bee6 for proposals"; 1 ready row → unchanged labels.
- `GeneratingState.test.tsx`: round line shown only when `total ≥ 2`.
- `lib/demo/guide.test.ts` L103 text assertion for `proposals_ready`.

Hard rules: none touched (no new route, no model change, rule 6 still via the authed client). Demo caps: a chained
Ask charges 2 of 8 per sandbox (plus retries) — fine; `GENERATE_DAILY` 300 bounds the day. Cost per judge rises from 1
to 2 model runs per tap — which is what "Ask for another" cost anyway.

Risks: the `SupervisorProposals` state machine is intricate (D2 layout hold, settle-on-reload); keep the loop inside
`ask()` and do not touch the effects. Partial chains are visible to the judge as "1 proposal + retry" rather than a
dead end. Estimate: 2–3 h build, 1 h gate + live QA (a sandbox at day 3 with both rows ready: tap once, expect two rows).
Route to `developer` (sonnet), not junior.

---

## Item 19 — drop the "Sign out · pick Owner" button under a marked-feasible proposal

### Today (file:line)

- The button is **not** a guide card; it is the proposal detail's bottom action row: `app/proposals/FeasibleHandover.tsx`
  L34–56 `FeasibleActions` = a disabled "Marked feasible ✓" (`C-propd-feasible-done`, `lib/i18n/v2/proposals.ts` L176)
  plus the primary "Sign out · pick Owner" (`C-propd-signout-owner`, L192) that signs out and `router.replace("/sign-in?as=owner")`
  (L43). Rendered by `app/proposals/ProposalDetail.tsx` L250 (`{feasible && <FeasibleActions …/>}`), import L18.
- The banner above it (`FeasibleHandover` L21–32, rendered at `ProposalDetail.tsx` L178) already carries the instruction:
  "Marked feasible. The owner decides next. **Sign out and pick Owner to approve or reject.**" and takes focus
  (role=status, tabIndex −1) when the actions unmount.
- Guide cards already route the judge without the button: `proposal_detail` todo row 5 "Sign out, then pick Owner"
  (`lib/demo/guide.ts` L337); `proposals_feasible` (L340–348, shown once every proposal is feasible, `guide.ts` L617)
  "Every proposal is marked feasible. Sign out and sign in as Owner to approve or reject."; `sign_in_owner` card L156–167
  fills the credentials. The top-bar Sign out exists on every web page (`app/web/SignOutButton.tsx`, `WebTopBar.tsx`
  L20; desktop header Sign out restored in R25-003), and since finding 12–14 sign-out lands on the entry page whose
  "Open Owner view" link is `/sign-in?as=owner` (`app/web/EntryLanding.tsx` L53).
- Same pattern elsewhere? No. The only other `?as=supervisor|owner` links are the entry page (L45, L53) and the two
  guide card *titles* "Sign in as Supervisor/Owner" (L145, L157) that sit on the sign-in page itself. The owner has no
  "Sign in as Supervisor" button anywhere (`approvals_done` L383–391 sends them to SOP/Reviews).

### Quick win = the change

- Delete `FeasibleActions` (L34–56) and its import/use (`ProposalDetail.tsx` L18, L250). Keep `FeasibleHandover` (the
  banner). Delete the two dead keys `C-propd-feasible-done` / `C-propd-signout-owner` in both language blocks
  (`proposals.ts` L64, L82, L176, L192) — `lib/i18n/dict.test.ts` only checks value/placeholder parity, so unused keys
  would not fail, but dead keys are noise.
- a11y: the banner keeps focus on appear; no dead end — the "‹ Proposals" back button (L165) is above, the top-bar Sign
  out is in the header. After #1 is feasible the judge goes back to the list for #2 as today.
- Tests: `FeasibleHandover.test.tsx` L42–57 (two `FeasibleActions` tests) → delete; L25–40 banner tests stay. Check
  `SupervisorProposals.test.tsx` L494 ("Mark feasible shows the hand-over…") does not query the removed button.
- Estimate 0.5 h, `developer-junior`. No hard-rule surface.

Q-19.1 (default = remove the whole row): keep the disabled "Marked feasible ✓" chip alone? A lone disabled button is odd;
the banner already says "Marked feasible." Recommend removing the row.

---

## Item 20 — "Not available: the SOP changed" on the second proposal

### Today: where the guard lives and why it exists

- A proposal records the SOP it was drafted on: `generator.sop_version_id` (`lib/firestore/schema.ts` L945; set at
  `lib/proposals/service.ts` L297 from `getCurrentSop()`). Its change is `content.target_step_id` (L853; `null` = a new
  step) + `change_text` which **replaces** the step's whole text (`lib/sop/ship.ts` L15–21, L78).
- Three places enforce "drafted on the latest version":
  1. `GET /api/v1/proposals` → `notices.sop_changed = currentSopId !== p.generator.sop_version_id`
     (`lib/proposals/review-service.ts` L236). The owner UI mirrors it: `ApprovalDecision.tsx` L75 `approveBlocked`,
     L157 label "Approve · not available" (`C-propa-approve-na`), L159–163 note `C-propa-sop-changed`; `ApprovalCard.tsx`
     L30 `blocked`, L147–149 "Not available: the SOP changed" / "This proposal was drafted on the old SOP version, so it
     can only be rejected…" (`C-propa-na-h` / `C-propa-na-why`, `proposals.ts` L234–235). The supervisor side mirrors
     it too (`ProposalDetail.tsx` L115 `positiveBlocked`, L228 `C-prop-notice-sop`).
  2. `classifyDecision` step 7 (`lib/proposals/review-plan.ts` L139) → 409 `SOP_CHANGED`; rejections are never blocked
     by it (L135).
  3. `planShip` (`lib/sop/ship.ts` L63–65) inside the approval transaction, plus a step-level check L73–75 (target step
     missing from the latest version → `SOP_CHANGED`).
- How a version is made: the owner's approval and the new `sop_versions/{outlet}:v{n+1}` doc are written in ONE
  transaction (`review-service.ts` L346–377; store `proposal-review-store.ts` L302–331, `tx.create`, immutable). `planShip`
  copies the latest version's steps, applies the one change, sets `previous_version_id`, `effective_from_date` =
  **tomorrow** (L36–38), `review_date` = effective + `review_after_days` (L41–43), and a self-contained `change` block
  (L104–122) with its own metric/failure condition. One change per version; reviews are keyed by version
  (`schema.ts` L1057, `review_id = sop_version_id`); R-11's fast-forward picks the lowest unreviewed version
  (`lib/reviews/plan.ts` L47–54).
- Why the guard: `change_text` replaces the step text, so a proposal drafted on v1 that rewrites step S, approved
  after another proposal already rewrote S into v2, would silently **overwrite the first approved change**. The guard
  also covers "the step no longer exists". It is not about rule 9 (both paths go through proposals) — it is a
  lost-update guard. Today it is far too coarse: it fires for *any* newer version, including one that touched a
  different step.
- The demo: proposals A (egg-tart freshness, CUSTOMER_SERVICE) and B (phone order read-back, PHONE_CALL) are both
  drafted on v1 (both generated before any approval). The model picks `target_step_id` from the 5-step demo SOP
  (`scripts/demo-sop.ts` L28 `bake-01`, L40 `serve-01`, …) or `NEW`; that choice is **not deterministic**. In Rangga's
  run they landed on `bake-01`/new step and `serve-01` — different steps, so there is **no real conflict** and the
  guard is simply over-strict. The same model could, in another run, send both to `serve-01` (the customer-facing
  step) — that *is* a real conflict and must stay reject-only.

### Options

- **(A) Batch approve → ONE version with every approved change.** Needs `change` → `changes[]` on the version doc, a
  review per change (reviews are keyed by version today), the SOP book's undo walk (`app/sop/versions.ts` L33–37),
  the "Shipped as SOP version N" matching (`app/proposals/approvals.ts` L36–40 matches title + date), and a session
  notion of "the owner's approvals in one sitting". Days of work. **No.**
- **(B) Sequential re-base, step-level conflict rule (recommended).** Keep one version per approval. Replace "drafted
  on the latest version" with "the step this proposal rewrites still reads exactly as it did when drafted (or the
  proposal adds a new step)". Approving A → v2 (effective tomorrow); approving B → v3 built on v2 (effective tomorrow,
  its own review date and metric). Both target different steps → both approvable; same step → B stays reject-only with
  copy that says *why*. No schema change. ~40 lines of plain code plus copy.
- **(C) Approve a stale proposal by amending the pending v2.** Versions are immutable (`tx.create`), reviews/audit are
  keyed by version id, the before/after list is per version. Mutating a shipped version breaks every one of those.
  **No.**
- **(D) Copy only.** Does not meet "every proposal can be approved or rejected". Fallback only if PR-C cannot be
  live-tested in time.

**Smallest option that satisfies the ask without weakening the guard for real conflicts: (B).**

### PR-C design (option B) — what the builder does

**1. One pure rule, used in all three places.** New `lib/sop/rebase.ts` (plain code, hard rule 10):
```ts
import type { Proposal, SopVersion } from "@/lib/firestore/schema";
/**
 * "SOP_CHANGED" iff the version this proposal was drafted on is not the latest AND the step it rewrites no longer
 * reads as it did when drafted (text, title or role differ, or the step is gone), or any input needed to prove it
 * is missing. A new-step proposal never conflicts. Fail closed: null inputs are a conflict.
 */
export function sopConflict(input: { proposal: Proposal; drafted: SopVersion | null; current: SopVersion | null }): "ok" | "SOP_CHANGED" {
  const { proposal: p, drafted, current } = input;
  if (current === null || p.content === null) return "SOP_CHANGED";
  if (current.sop_version_id === p.generator.sop_version_id) return "ok";          // today's path, unchanged
  if (drafted === null || drafted.outlet_id !== current.outlet_id || drafted.version >= current.version) return "SOP_CHANGED";
  const id = p.content.target_step_id;
  if (id === null) return "ok";                                                     // an added step cannot collide (p-<uuid> id)
  const was = drafted.steps.find((s) => s.step_id === id);
  const now = current.steps.find((s) => s.step_id === id);
  if (!was || !now) return "SOP_CHANGED";
  return was.text === now.text && was.title === now.title && was.role === now.role ? "ok" : "SOP_CHANGED";
}
```
Note the rule is *content*-based, not chain-walking: it does not need the intermediate versions, only the drafted
and the current doc, both already in every read set below. (Equivalent to "no intermediate change touched this step"
because a `modify` always changes `text`; the gate refuses a no-op change_text.)

**2. `lib/proposals/review-plan.ts`**
- `DecisionSnapshot` (L18–32): add `drafted_sop: SopVersion | null` ("the `sop_versions` doc named by
  `proposal.generator.sop_version_id`, outlet-checked; null if missing/malformed"). Keep `current_sop_version_id` and
  `current_sop` as they are.
- `classifyDecision` L139 → `if (sopConflict({ proposal: p, drafted: snap.drafted_sop, current: snap.current_sop }) === "SOP_CHANGED") return { kind: "conflict", code: "SOP_CHANGED" };`
  Order of checks (L138–142) unchanged. Rejections still skip it (L135).

**3. `lib/sop/ship.ts` `planShip`**
- Input gains `drafted: SopVersion | null`. Replace L63–65 with the `sopConflict` call (keep L57–62 and the L72–89 step
  logic; the L73–75 missing-step check stays as defence). `before` for a modify is still copied from `current` (L77) —
  by the rule it equals the drafted text. `previous_version_id` = `current.sop_version_id` (v2 when re-basing onto v2).
  Nothing else changes: effective tomorrow, review date, one `change` per version.

**4. `lib/proposals/review-service.ts`**
- `listProposalsCore` L219–239: `const currentSop = currentSopId !== null ? sops.get(currentSopId) ?? null : null;`
  (the map already holds it, L215) and
  `sop_changed: sopConflict({ proposal: p, drafted: sops.get(p.generator.sop_version_id) ?? null, current: currentSop }) === "SOP_CHANGED"`.
  `ProposalReviewStore` interface unchanged.
- `decideCore` L348: pass `drafted: snap.drafted_sop` to `planShip`.
- `sop_audit.details` L366–372: add `drafted_on_sop_version_id: check.proposal.generator.sop_version_id` (an id, allowed
  by rule 7; makes a re-based approval visible in the audit log).

**5. `lib/firestore/proposal-review-store.ts` `loadSnapshot`**
- Step 5 (L178–190) already lists every version of the outlet to find the highest; while iterating, also keep the doc
  whose `sop_version_id === proposal.generator.sop_version_id` → `drafted_sop`. Zero extra reads, same transaction.
  `empty` (L94–101) gets `drafted_sop: null`.

**6. Copy** (EN + ID `// PROVISIONAL`), now describing the *step* rule:
- `C-propa-na-h` (L234) → "Not available: this step was just changed"; `C-propa-na-why` (L235) → "An approved proposal
  already changed the step this one rewrites, so this one can only be rejected. A rejection reason becomes a rule Bee6
  respects."; `C-propa-sop-changed` (L213) → "The step this proposal rewrites changed after it was drafted. You can
  still reject it with a reason."; `lib/i18n/dict.ts` L872 `C-prop-notice-sop` and L899 `C-prop-err-sop-changed` →
  same idea ("…so it cannot go ahead. Reject it with a reason or ask for a new proposal.").
- Copy that encodes the old one-approval rule and is now **wrong**: `C-propa-pace-one` (L233 "After you approve one
  change, the other can only be rejected.", rendered `ApprovalCard.tsx` L153) → "Each approved change becomes its own
  SOP version."; `C-home-waiting-one-body` (`lib/i18n/v2/home.ts` L127, rendered `app/home/HomeView.tsx` L135) → "Each
  approval becomes a new SOP version; the other can still be approved or rejected with a reason. Bee6 sets the start
  date."; `C-propa-next-p` (L224) "The approved change…" → "Each approved change…" (optional).
- Guide (`lib/demo/guide.ts`): `home` todo L372 and `approvals` title/todo L375–382 "Approve one, reject the other" →
  see Q-20.2; `approvals_done` L387 → "Each approved change is now its own SOP version. Open SOP to see the improved
  steps, and Reviews for their review dates." `lib/demo/guide.test.ts` L263–266, L275–280 follow. `todoDoneCount`
  (L499–508) needs no change.

**7. What the owner sees (ApprovalsReview).** With A and B on different steps: approve #1 → "Approved. It ships as a
new SOP version." → #2 shows the normal "Approve" (not "· not available") → approve → "Both decided." summary lists
"Shipped as SOP version 2" and "…version 3" (`approvals.ts` L36–40 matches title + approval date, both match),
`C-propa-all-starts` uses the first shipped change's dates (both effective tomorrow). Same-step run: #2 reads the new
"this step was just changed" copy with Approve disabled, Reject with reason works as today (the `ApprovalsReview.test.tsx`
L308–322 409 paths stay valid).

**8. SOP tabs and Reviews after two approvals.** Versions v1 (seed), v2, v3; `in_force_version` today = v1 → labelled
"· current" (`app/sop/SopApp.tsx` L47–48), header "Version 3 starts on <tomorrow>. Until then, version 1 applies."
(`C-sop-version-pending`). v2 and v3 both carry tomorrow's date, so the version switch shows two identical date labels
(the spread itself prints "Version 2/3 · date", `SopBookSpread.tsx` L85–91) — see Q-20.3. The undo walk
(`versions.ts` L33–37, L69–80) handles the chain. Reviews: one per version; the demo fast-forward
(`lib/reviews/service.ts` L357, cap `FAST_FORWARD_PER_SANDBOX` 3) picks v2 then v3; each review's
`notices.overlapping_change` will be **true** (same-day approvals share the effective date, `lib/reviews/plan.ts`
L74–85 — already designed for this) — see Q-20.4.

**9. RBAC / hard rules.** Approve route still owner-only + outlet-checked (`approve/route.ts` L26, `decideCore` L307–313);
nothing new is callable. Rule 9: still only via proposals; no endpoint edits an SOP. Rule 10: `sopConflict` is plain
code. Rule 7: ids only in audit. Rule 6: no new browser data path. Race: two owners approving at once → the loser's
`tx.create` on the same version id fails → 409 `SOP_CHANGED` (store L326–329) → a retry re-reads v3 and re-bases again
if the step is still untouched. `security-reviewer` to confirm the approve path (one new field in audit details, the
relaxed guard) — on demand, short.

**10. Tests (exact).**
- `lib/sop/rebase.test.ts` (new): same version id → ok; current null → conflict; drafted null → conflict; drafted
  version ≥ current → conflict; add proposal on a newer version → ok; modify, step untouched between drafted and current
  → ok; step text changed → conflict; step title changed → conflict; step missing from current → conflict; step missing
  from drafted → conflict; `content` null → conflict.
- `lib/sop/ship.test.ts`: extend L41 (3.T3) — "current newer but target step untouched → ships v{n+1} on current, before =
  current's step, previous_version_id = current"; "current newer and target step changed → SOP_CHANGED"; "add on a newer
  current → ships, appended last".
- `lib/proposals/review-plan.test.ts` L461 (4.T12): split into "newer SOP, same step touched → SOP_CHANGED", "newer SOP,
  other step touched → proceed", "reject never blocked" (unchanged).
- `lib/proposals/review-service.test.ts`: fake store `snapshotOf` (L269–290) adds `drafted_sop`; **rewrite 6.T9 (L1009)**:
  "two proposals on v1 targeting different steps: approving A ships v2, approving B ships v3 (previous v2, steps = v2 +
  B's change, effective tomorrow, own review_date), both audits carry `drafted_on_sop_version_id: v1`"; add 6.T9b "same
  step: B is 409 SOP_CHANGED and stays awaiting_owner"; add 6.T9c "A adds a new step, B modifies serve-01 → both ship";
  L457 (`notices.sop_changed` true) → make the fixture a same-step case and add the different-step `false` case; 6.T4
  (L937) → keep as the same-step case.
- `lib/firestore/proposal-review-store.test.ts`: loadSnapshot returns `drafted_sop` (present, missing, foreign →
  null).
- `app/proposals/ApprovalsReview.test.tsx` L239/L376/L485 fixtures keep `sop_changed: true` for the conflict copy; add
  one "two awaiting_owner, approve #1 then #2 both approved, summary shows version 2 and 3".
- `lib/demo/guide.test.ts` copy updates.
- Live (QA, mandatory before `web`): fresh sandbox → 3 days → Ask (PR-B: once) → both feasible → owner approves both →
  SOP shows v1 current + v2/v3 pending → Reviews fast-forward twice. Then a second run to observe whether the model
  targeted the same step (if so, the conflict copy must read right).

**11. Effort and risk.** Build 3–4 h (`developer`, sonnet; the rule and the re-based ship need judgment), gate 1 h,
live run 1 h. Risk: moderate — the approval transaction is the demo's finale; mitigations are the pure-function test
set above, no schema change, a Cloud Run revision pin for rollback. The one thing (B) cannot fix is a genuine same-step
collision; that stays reject-only by design and the copy now explains it. If Rangga wants "always approvable" even
then, the only honest answer is a text merge of two rewrites of one step, which is not plain code and is not a
last-day change.

---

## PR grouping and merge order

| PR | Items | Owner | Est. | Touches | Safe on the last day? |
|---|---|---|---|---|---|
| PR-A | 19 | `developer-junior` | 0.5 h + 0.5 h gate | `FeasibleHandover.tsx`, `ProposalDetail.tsx`, 2 i18n keys, 1 test file | Yes |
| PR-B | 18 | `developer` | 2–3 h + 1 h gate/QA | `SupervisorProposals.tsx`, `GeneratingState.tsx`, `WatchPanel.tsx`, i18n, `guide.ts` L313–329, tests | Yes (client-only; bounded chain) |
| PR-C | 20 | `developer` + `security-reviewer` | 3–4 h + 2 h gate/live | `lib/sop/rebase.ts` (new), `ship.ts`, `review-plan.ts`, `review-service.ts`, `proposal-review-store.ts`, i18n, `guide.ts` L366–391, `home.ts`, tests | Go/no-go: only with a full live judge run on `web-develop` before `web` |

Merge A → B → C (A and B both touch `SupervisorProposals.test.tsx`/`ProposalDetail.tsx`; B and C both edit `guide.ts`
— rebase, trivial). Each PR: tech-lead review + QA live on `web-develop` (standing order), then Rangga's go for `web`.
Skills for the builders: `react-patterns` + `react-testing` (A, B), `api-design` + `tdd-workflow` (C), `ux-copy` for
the strings; `security-review` is the security-reviewer's, on PR-C only.

## Questions for Rangga

- **Q-20.1** Accept that a *real* same-step collision (both proposals rewrite the same SOP step) stays reject-only, with
  copy that says why? (Recommended yes; the alternative is an AI text merge — not plain code, not today.)
- **Q-20.2** Guide script: keep recommending "approve #1, reject #2" so judges also see a rejection become a rule
  (`C-propa-next-p` sells exactly that), while the product now allows approving both — or change the cards to "decide
  each one"? Recommended: product allows both; guide says "Approve #1. Approve or reject #2 — a rejection reason becomes
  a rule Bee6 respects."
- **Q-20.3** Two versions effective the same day show two identical date labels in the SOP version switch ("19/10/26",
  "19/10/26"); the spread shows the version number. Accept, or add "· v2 / · v3" to the label (10 lines in `SopApp.tsx`)?
- **Q-20.4** Both reviews will carry the `overlapping_change` notice (same effective date). Accept the existing copy?
- **Q-20.5** Go/no-go for PR-C today given the clock: it needs ≈ 5–6 h end to end including one full live judge run.
  If no, ship PR-A + PR-B and keep the old guard with option-D copy as a stated known gap.
- **Q-18.1** After a partial chain (round 1 wrote, round 2 failed), is "tap Ask for another to retry" acceptable, or do
  you want an automatic retry? (Recommended: no auto-retry — each round is a paid model call.)
- **Q-18.2** `MAX_ASK_ROUNDS = 3` per tap (applies to the pilot too, where more than two categories may be ready in a
  real week). OK, or "all ready rows"?
- **Q-19.1** Remove the whole bottom row (incl. the disabled "Marked feasible ✓" chip) — recommended — or keep the chip?
