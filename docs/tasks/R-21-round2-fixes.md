# R-21: round-2 rehearsal fixes — deep plan (tech-lead, 16 Oct early morning WIB)

Base: `origin/main` **bc54898** (= live revision `web-00017-q6m`). Evidence: `docs/tasks/QA-live-rehearsal-15oct-round2.md`
(F-1, F-2, D4–D7 re-checks, O-1…O-6, proposal B text), `docs/tasks/QA-live-rehearsal-15oct.md` (D4–D7 origin),
`docs/tasks/R-20-rehearsal-fixes.md` (what already shipped). Calendar: E2E round 1 **Fri 16 Oct 15:00**, freeze
**Sat 17 Oct 12:00**. PRs go straight to `main` (Rangga's standing rule); every PR is independently green.

Working-tree note for builders: the shared checkout is on an old branch; build from a **worktree of `origin/main`**
(`superpowers:using-git-worktrees`), never `checkout`/`reset` the shared tree.

**No re-seed, no new wavs, no template change** is needed by anything below: the four problem cards' text is untouched,
the template outlet is routine-only, the SOP seed is untouched, and every prompt change applies only to new model calls.

## 0. Verdict table

| Id | Severity | Decision | PR |
|---|---|---|---|
| F-1 second phone line → separate CORRECTION thread | major, model | **must fix** (label-prompt threading rule, eval-gated) + guide copy safety net | A |
| D4 stage pill "1 of 5" on every hard-loaded web page | minor, visible all journey | **must fix** (auth-ready bug, not a guide bug) | B |
| F-2 / D7 open sheet covers "Yes, end" / "Set up" | minor 360 px, judge gets stuck | **must fix** | B |
| Proposal B text: `[staff]` tag, ISO dates, customer name + phone on a slip | quality, judge-facing headline output | **must fix** (prompt rules + one code strip) | C |
| O-3 10-min session hard stop | journey-breaker for a slow judge | **must fix** (20 min) — Rangga decision | D |
| O-5 "17/10/26 · current" for a not-yet-in-force version | minor | fix (mechanical) | D |
| D6 favicon 404 (console error + WARNING logs) | minor | fix (mechanical) | D |
| D5 "Signed in as Staff" bar on /sign-in | minor | fix (mechanical) | D |
| O-6 skew log ×5 per tick | noise | fix (mechanical) | D |
| O-1 only one of two proposals approvable (R-09 `sop_changed`) | by design | **accept**; the `approvals` guide card already says it (§6) | — |
| O-2 owner can generate / add constraints | spec drift | **accept**; code follows Rangga's R-08 Q-10/Q-11b ruling, update the spec table | docs |
| O-4 day-3 opening+closing merged into one ROUTINE_OPS thread | harmless | accept | — |

---

## 1. F-1 — the staff's remark after the call opens a CORRECTION thread

### 1.1 What actually happens (code, not the QA wording)
- Both lines of d2-c3 / d3-c2 are in **one label unit** (`T3`/`T4` of `w_4baa834a…`): the split is the **label model's
  own decision inside one call**, not the thread builder's (`lib/pipeline/threads.ts` only unions what the model hints;
  `GRACE_MS`/open-thread join never applies within a unit). The decision order `PHONE_CALL > CORRECTION` cannot help:
  it ranks categories *for one thread*; the model made two threads.
- The label is also wrong by the config's own definition: `CORRECTION` = "Supervisor correcting a mistake just made"
  (`config/categories.draft.yaml:34`); nobody is correcting anyone, and the summary invents a "Supervisor".
- The system instruction (`lib/pipeline/label/prompt.ts:30-63`) says nothing about *what a thread is*; the only
  threading guidance is the schema text ("reply/continuation of an earlier line"). The model has no rule telling it
  that a speaker's remark about the event it just took part in belongs to that event.
- Why it matters: (a) 2 questions per phone day, (b) a "Waiting for review" CORRECTION item per day, (c) the PHONE_CALL
  fact's excerpt is only the call, so proposal B depends on the typed debrief reason, (d) the proposal path sends the
  model **only facts of the focus category** (`lib/proposals/service.ts:329` `focused = pool.filter(category === focus)`),
  so a CORRECTION thread's text never reaches proposal B; and if the supervisor confirms both CORRECTION threads,
  CORRECTION becomes a third READY category → "Ask for another" writes a duplicate proposal about the same problem.
- `eval:scenario` **cannot see this today**: `cardVerdict` takes the category of the thread holding *most* of the
  card's lines, "first seen wins a tie" (`scripts/eval-scenario.ts:180-193`), so a 1/1 split still scores PHONE_CALL.

### 1.2 Options (quick-win AND ultimate, per Rangga's triage rule)
| Option | Verdict |
|---|---|
| (a) Fold line 2 into line 1 as one utterance | **No.** 27 + 28 words ≈ 19–24 s spoken; `maxSegmentMs` 15 000 hard-cuts it mid-sentence (R-20 §3.1) and the model can still split one segment into two threads. |
| (b) Plain-code post-merge in the tick: a same-unit CORRECTION thread whose `runner_up` is PHONE_CALL, starting ≤ 60 s after a PHONE_CALL thread, is merged into it | **Hold as fallback.** Deterministic and testable, but a demo-shaped heuristic in the fact path two days before freeze, keyed on an optional, non-deterministic `runner_up`. Build only if (c) fails its eval gate. |
| (c) Label system instruction: one explicit threading rule + CORRECTION definition tightened; gated by `eval:scenario` with a new "one thread per problem card" metric | **Do (quick-win, recommended).** Additive text; the harness that scored 24/24 is exactly the regression gate; `eval:label` too. |
| (d) Mandatory / prefilled debrief reason for PHONE_CALL | **No.** Pilot behaviour change; the reason is optional by design (UX-03). |
| (e) Guide copy: the debrief card's example reason names the problem | **Do (zero-risk safety net).** Today it says "for example: took a big order on the phone", which carries no problem at all. |
| (f) Ultimate: (c) + Tiffany's `examples` for every category + a label eval round | Post-submission. |

### 1.3 Exact changes (PR-A, `developer`, Fable)

**`config/categories.draft.yaml`** — only the `CORRECTION` definition line (keep everything else byte-identical):
```yaml
    definition: A supervisor correcting a mistake someone else just made (record the step, not the person). Not a speaker's own remark about what they themselves just did or forgot; that remark belongs to the thread of the event it is about.
```
(`CategoryEntrySchema.definition` is `z.string().min(1)`; no length cap. `examples` stay `TODO`.)

**`lib/pipeline/label/prompt.ts`** `buildSystemInstruction` — insert after the `Categories:` loop and before the
`"Respond with structured output only…"` block, exactly:
```ts
  lines.push(
    "",
    "Threading rules:",
    "- One event is one thread. A speaker's own remark right after an event about what happened in it, what they",
    "  did, or what they forgot (for example, after a phone call: 'that was a phone order, I did not read it back')",
    "  belongs to that event's thread, not to a new one.",
    "- Open a new thread only for a different event (a different customer, call, task or topic).",
    "- Decide a thread's category from all of its lines together, using the order above.",
  );
```
No `{`/`}` anywhere (same discipline as the proposal prompt). The user-content builder is unchanged.

**`lib/pipeline/label/prompt.test.ts`** — add:
1. "carries the threading rules": `systemInstruction` contains `"One event is one thread"` and `"Open a new thread only for a different event"`, and the `Threading rules:` block appears **after** the last `- ROUTINE_OPS` category line and **before** `"Respond with structured output only"` (assert by `indexOf` ordering).
2. "has no { or }": `expect(systemInstruction).not.toMatch(/[{}]/)`.

**`scripts/eval-scenario.ts`** — the metric that makes this provable offline:
- `CardOutcome` gains `one_thread: boolean` = the card's lines that reached any thread all share one `thread_id`
  (compute from `thread.line_ids` while filling `verdictOfLine`: also fill `threadOfLine: Map<lineId, threadId>`; `one_thread = new Set(cardLines.map(threadOfLine.get).filter(Boolean)).size <= 1`; a card with no line in any thread → `false`).
- `CellSummary` gains `a_one_thread: number`, `b_one_thread: number` (count over runs); `summarizeRuns` fills them.
- `judgeCell`: for `exact` only, `if (s.b_applicable && s.b_one_thread < Math.ceil(0.8 * n)) failures.push(\`B one thread ${s.b_one_thread}/${n} (need ${Math.ceil(0.8*n)})\`)`; same for A (A is already one thread live; this is a regression guard). Variants: report only, no threshold.
- Report line (`~:481`): add `B one thread k/n`, `A one thread k/n`.
- `scripts/eval-scenario.test.ts` (exists next to it; extend): a fake label output that splits the B card 1/1 → `one_thread false`, `judgeCell` FAIL for exact with the exact failure string; a 2-line single thread → `true`.

**`lib/demo/guide.ts`** `debrief_question` body[0] (EN; ID = EN via `same()`):
```
"Answer what really happened in today's script. The phone order did happen, so answer Yes and type a few words why, for example: I did not read the order back to the caller."
```
(≤ 240 chars: 191.) `lib/demo/guide.test.ts`: update any assertion on that body line; the day-1 and day-3 variants in `guideCard` reuse `base.body[1]`/`[2]`, unchanged.

**Eval gate (the PR is not mergeable without it; builder runs on the demo project, pastes the summary in the PR):**
1. Baseline *before* the prompt change: `GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:scenario -- --runs 5 --days 2,3 --variants exact --uniting U2` → record `B one thread k/5` per day (expected low; this is the number we are fixing).
2. After: full matrix `npm run eval:scenario -- --runs 5` must be PASS on every cell under the **existing** thresholds (A/B correctness, contamination 0 on exact, questions ≤ 5) **and** `B one thread ≥ 4/5` on exact days 2 and 3, `A one thread ≥ 4/5` on exact days 1 and 2.
3. `npm run eval:label` (R-05b fixtures) must not regress its pass count versus its last recorded run (ask the PM for the number; if none is recorded, run it on `origin/main` first in the same worktree and compare).
If (2) fails on the one-thread threshold only, build option (b) (§1.2) as a second commit on the same PR: `lib/pipeline/tick/service.ts` after `buildThreads`, pure helper `mergeSelfRemarkIntoCall(built: BuiltThread[]): BuiltThread[]` in a new `lib/pipeline/tick/merge-remark.ts`, unit-tested; ask tech-lead for a 15-min design check before writing it.

### 1.4 Hard rules
#10: the gate (`lib/pipeline/gate.ts`) and the thread builder are untouched; only prompt text and a config definition
change; the evidence floor stays plain code. #7: no name anywhere in the new text. #5/#1: no model/location change.
Pilot: same prompt (the pipeline is shared); the rule is general, not demo-specific.

---

## 2. D4 — stage pill "1 of 5" on hard-loaded web pages (PR-B)

### 2.1 Root cause (verified)
`app/demo/JudgeGuide.tsx:186-195` fetches `/api/v1/demo/progress` in an effect on mount/route change through
`authedGetJson(getClientAuth(config), …)`. `lib/auth/client/api.ts:76-77`: `if (!auth.currentUser) return { kind: "signed_out" }`
— **no fetch**. On a hard page load Firebase restores the user asynchronously, so the effect runs before `currentUser`
exists, gets `signed_out`, keeps the default (stage 1) and never retries until the guide is opened, the route changes
client-side, or the proposals page bumps `progressVersion`. That matches QA exactly: `/day` right after sign-in works
(the user was just signed in synchronously), `/proposals` after an Ask flips to stage 4 (the bump refetches), every
hard-loaded page shows stage 1.

### 2.2 Exact change
`app/demo/JudgeGuide.tsx`:
- `import { useAuthUser } from "@/lib/auth/client/use-auth-user";` (already imported by guide-controls; the test file already mocks it).
- Inside the component: `const auth = config ? getClientAuth(config) : null; const authState = useAuthUser(auth);`
  (`getClientAuth` returns the cached app auth; calling it per render is what other screens do).
- The progress effect: guard becomes `if (isEntry || isCapture || webRole === null || !auth || authState.status !== "signed_in") return;`,
  use `auth` for the call, and add `authState.status` to the dependency array. Nothing else moves.
- Test (`app/demo/JudgeGuide.test.tsx`): make the `use-auth-user` mock read a mutable `let authStatus: "loading" | "signed_in" = "signed_in"`.
  New case: `authStatus = "loading"`, render on `/sop` as supervisor with a live demo record → **no** fetch of
  `/api/v1/demo/progress`; set `authStatus = "signed_in"` and re-render → exactly one fetch, pill reads the fetched stage.
  Existing cases keep `signed_in` and pass unchanged.

---

## 3. F-2 / D7 — the open sheet covers the page's next button (PR-B)

### 3.1 Facts
`app/ui/Sheet.tsx` is `position: fixed; bottom: 0; z-index: var(--b6-z-overlay)` (40), max 70 vh, non-modal. The End
confirm (`app/capture/page.tsx:1085`, `role="group"` in page flow, not a dialog) and `/pair`'s submit button are page
content, so with the sheet open they sit under it. The guide already collapses itself on route and page-driven card
changes (`JudgeGuide.tsx:222-236`) but tapping End today changes no phase, and the pair card's "Fill in" action leaves
the sheet open while the next tap must hit the page.

### 3.2 Options
- **Quick-win (do):** (i) the phone sheet collapses on any `pointerdown` outside itself; (ii) the pair card's Fill-in action collapses the sheet after filling. Two small, general behaviours; a bottom sheet that closes on outside tap is standard.
- Ultimate (defer): the page reserves the open sheet's measured height as bottom padding (ResizeObserver → CSS var) so content can always scroll above it. More code, and the judge would still have to know to scroll.

### 3.3 Exact changes
`app/ui/Sheet.tsx`:
- New optional prop `collapseOnOutsidePointerDown?: boolean` (doc: "Phone only: a pointerdown outside the sheet collapses it. The event is not stopped, so the tap still lands on its target.").
- `const sectionRef = useRef<HTMLElement>(null)` on the `<section>`.
- `useEffect(() => { if (!open || !collapseOnOutsidePointerDown) return; const onDown = (e: PointerEvent) => { const el = sectionRef.current; if (el && e.target instanceof Node && !el.contains(e.target)) onOpenChange(false); }; document.addEventListener("pointerdown", onDown, true); return () => document.removeEventListener("pointerdown", onDown, true); }, [open, collapseOnOutsidePointerDown, onOpenChange]);`
- `app/ui/Sheet.test.tsx`: (1) with the prop, open → `fireEvent.pointerDown(document.body)` → `onOpenChange(false)` called once; (2) pointerdown inside the body → not called; (3) without the prop → not called; (4) collapsed → listener absent (no call).

`app/demo/JudgeGuide.tsx`:
- The phone `<Sheet …>` gets `collapseOnOutsidePointerDown`. The laptop `SidePanel` is untouched.
- `FillCode({ lang, onFilled })`: call `onFilled()` after `setFilled(true)`; the guide passes `onFilled={() => setOpen(false)}`.
- `JudgeGuide.test.tsx`: on `/pair` open the guide, click "Fill in 000000" → the input holds the code **and** the handle has `aria-expanded="false"`. On `/capture` in phase `closing` with the sheet open, `fireEvent.pointerDown` on an element outside → collapsed.

Side effects checked: the SignOutDialog portal is "outside" → collapses the sheet behind it (harmless); the `b6-sheet`
handle is inside the section, so the opening tap never self-closes (integration QA D1 stays fixed); the collapsed
handle never covers content thanks to the existing `guide-sheet-reserve` spacer.

---

## 4. Proposal B wording (PR-C, `developer`, sonnet)

### 4.1 What the model did and why
- `[staff]` copied into `change_text`: the prompt renders SOP steps as `- step_id [role] title: text`
  (`lib/proposals/prompt.ts:77`), so the model mirrors the bracket. The shipped NEW step then reads "Record phone orders
  on order slips — [staff] Take a phone order: …" (`lib/sop/ship.ts:86` takes `change_text` verbatim).
- ISO dates in the rationale: the FACTS rows carry `2026-10-14`, nothing tells the model not to echo them.
- "write down their name, phone number": nothing forbids it. **Hard-rule status:** not a break of #7 (that rule governs
  what *our system* stores: nothing of this reaches Firestore except the proposal text, which is redacted at 8e); it is a
  product/privacy **wording** choice for a step on paper in the shop. Rangga/Tiffany decide the wording policy (§7).

### 4.2 Exact changes
`lib/proposals/prompt.ts`:
- Step rendering: `` lines.push(`- ${step.step_id} (role: ${step.role}) ${step.title}: ${step.text}`); ``
- `SYSTEM_INSTRUCTION` edits (keep the no-`{`/`}` invariant):
  - rule 9, append: `"Never tell staff to ask for or write down a customer's name, phone number or other personal details; a record names the order itself (items, quantities, pickup date and time)."` — **wording subject to Rangga's decision §7.3**.
  - rule 10, append: `"Do not write calendar dates, times or ISO dates in any text; say 'on two days' or 'on several days'."`
  - rule 11, append: `"change_text never starts with the step id, a role tag such as [staff] or (role: staff), or the step title; those are separate fields."`
- `lib/proposals/prompt.test.ts`: the SOP block renders `(role: staff)` and never `[staff]`; `systemInstruction` contains the three new sentences; no `{`/`}` (existing test).

`lib/proposals/service.ts` step 8e, **before** `maskDigitRuns`/scrub/redact (deterministic safety net, code not prompt):
```ts
/** R-21: the model sometimes echoes the SOP rendering's role tag at the head of the step text. Strip exactly that. */
export function stripLeadingRoleTag(text: string): string {
  return text.replace(/^\s*(\[(staff|supervisor|owner)\]|\((role:\s*)?(staff|supervisor|owner)\))\s*/i, "");
}
```
applied to `change_text` (and `change_title`) only. Export it from `lib/proposals/text.ts` (new, pure) and unit-test:
`"[staff] Take…"` → `"Take…"`, `"(role: staff) Take…"` → `"Take…"`, `"Take [staff] …"` unchanged, `"[STAFF]"` case-insensitive,
empty → empty. `service.test.ts`: a scripted wire with `change_text: "[staff] Write…"` stores `"Write…"`.

**Eval gate:** `GOOGLE_CLOUD_PROJECT=bee6-playground npm run eval:proposal -- --runs 5` → A ≥ 4/5 propose, B ≥ 4/5
propose, weak CS declines ≥ 4/5 (R-20 numbers), **and** the builder greps every proposed `change_text`/`rationale` the
script prints (extend `formatReport` to print the two texts of each run when a new `--texts` flag is set; demo project,
fictional fixture, so printing is fine) for `\[staff\]`, `\d{4}-\d{2}-\d{2}`, `phone number`, `name` → zero hits in 5 runs.

---

## 5. Mechanical slice (PR-D, `developer-junior`)

### 5.1 O-3 — demo session hard stop 10 → 20 min (**needs Rangga's yes, §7.2**)
- `lib/demo/constants.ts:23` `DEMO_SESSION_MAX_MS = 1_200_000` and its comment ("20 min; the judge ends the day with End today or Cancel today, so this is only the ceiling").
- `lib/demo/constants.test.ts:37` → `1_200_000`.
- `lib/capture/contract.ts:210` `max_ms: z.literal(DEMO_SESSION_MAX_MS)` → `max_ms: z.number().int().min(60_000).max(3_600_000)` so a judge tab holding the **old** JS bundle still parses the new config after deploy (the literal would make `/api/v1/capture/config` fail validation in a stale tab). `FRESH_DEMO_SESSION.max_ms` stays the constant.
- `lib/capture/contract.test.ts`: `max_ms: 1_200_000` parses; `30_000` and `3_600_001` fail.
- `lib/demo/next-day.test.ts:229,236` use `600_000` as a fixture offset only — leave them.
- No copy mentions 10 minutes (grep clean), nothing to change in the guide.

### 5.2 O-5 — "· current" only for the in-force version
- `lib/i18n/v2/sop.ts`: add `"C-sop-book-upcoming": "{date} · upcoming"` (EN) and `"{date} · akan berlaku" // PROVISIONAL` (ID) next to `C-sop-book-current`.
- `app/sop/SopApp.tsx` `versionLabel(v, state: "current" | "upcoming" | "past", lang)`:
  `first-current` when `effective_from_date === null && state === "current"`, `C-sop-book-first` when null otherwise;
  dated: `current` → `C-sop-book-current`, `upcoming` → `C-sop-book-upcoming`, `past` → the bare date.
  Call site: `const inForce = data.in_force_version ?? newest.version; state = v.version === inForce ? "current" : v.version > inForce ? "upcoming" : "past"`.
- `app/sop/SopApp.test.tsx`: existing fixtures (`in_force_version` = latest) unchanged; add one with `in_force_version: 1`, latest 2 effective tomorrow → `["05/10/26 · current", "16/10/26 · upcoming"]`, newest still selected.

### 5.3 D6 — favicon
- Add `app/icon.svg` (Next 16 metadata file convention, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`: `icon.svg` in `app/` → `<link rel="icon" type="image/svg+xml" sizes="any">`). Content: a 32×32 SVG, teal rounded square (`#1F6F6B`), white "b6" text, no external refs. Fictional, no brand asset.
- `next.config.ts`: `async rewrites() { return [{ source: "/favicon.ico", destination: "/icon" }]; }` so any client that still asks for `/favicon.ico` (Safari, bots) gets the generated icon route instead of a 404 WARNING.
- Verify after deploy: `curl -sI https://<web>/favicon.ico` → 200 `image/svg+xml`; Chrome console has no 404 on `/`.
- No test beyond `npm run build` (the metadata route is generated at build).

### 5.4 D5 — demo bar on /sign-in
- `app/demo/DemoBar.tsx` `shown`: hide on `/sign-in` always (the page's own `C-demo-cred-continuing` line carries "ends HH:MM"; the role there is stale by definition): `const shown = pathname !== "/" && pathname !== "/sign-in" && view !== null;`
- `app/demo/first-paint.ts`: a LIVE state reserves the top bar everywhere **but** `/` and `/sign-in` (today: everywhere but `/`): change `if(Date.now()<x){c.add("b6-topbar-reserved");…}` to add the top-bar class only when `p!==""&&p!=="/sign-in"`; keep the panel reserve as is.
- Tests: `DemoBar.test.tsx:182` ("drops the class at the instant the demo ends while /sign-in is open") → now `reserved()` is `false` from the start; add "a LIVE state on /sign-in renders nothing and reserves nothing". `first-paint.test.ts`: add the LIVE-on-/sign-in case (pill reserved, top bar not).

### 5.5 O-6 — skew log noise
- `lib/pipeline/tick/service.ts`: `export const SKEW_LOG_THRESHOLD_MS = 60_000;` and call `logSkew(...)` only when
  `Math.abs(asOf.skew_newest_ms) > SKEW_LOG_THRESHOLD_MS || asOf.skew_min_ms < -SKEW_LOG_THRESHOLD_MS` (a device clock a minute off is worth a line; 2–4 s upload latency is not).
- `service.test.ts`: the existing seam test(s) that assert `logSkew` was called must use segments whose `received_at − device_end` > 60 s; add "small skew → logSkew not called".

### 5.6 O-1, O-2 — no code
- O-1: `lib/demo/guide.ts` `approvals` card already reads "Approve one, reject the other … After the first approval the SOP changes, so the remaining one can only be rejected." Nothing to change; QA re-reads it on the live page (§8).
- O-2: `lib/auth/rbac.ts:43-53` documents Rangga's R-08 ruling (owner may generate; constraints:write owner+supervisor). `docs/specs/web-backend-rbac.md` §2 table row "Add a constraint" → owner ✅ (PM, docs only, uncommitted per the commit-scope rule).

---

## 6. Slicing, order, estimates

| PR | Builder | Est. | Files | Gate |
|---|---|---|---|---|
| **A** F-1 + guide copy | `developer` (Fable) | 3 h incl. evals | `lib/pipeline/label/prompt.ts` + test, `config/categories.draft.yaml`, `scripts/eval-scenario.ts` + test, `lib/demo/guide.ts` + test | hook; `eval:scenario` full matrix PASS + one-thread ≥ 4/5; `eval:label` no regression; tech-lead review |
| **B** D4 + F-2/D7 | `developer` (Fable) | 2.5 h | `app/demo/JudgeGuide.tsx` + test, `app/ui/Sheet.tsx` + test | hook; tech-lead review; QA 360 px |
| **C** proposal wording | `developer` (sonnet) | 2 h | `lib/proposals/prompt.ts` + test, new `lib/proposals/text.ts` + test, `lib/proposals/service.ts` + test, `scripts/eval-proposal.ts` (`--texts`) | hook; `eval:proposal` 5 runs; tech-lead review |
| **D** mechanical | `developer-junior` (haiku) | 2 h | §5 files | hook; tech-lead diff check |

Order: **A first** (longest eval, and QA's re-run needs it), B and D in parallel with A (no file overlap), C last
(touches `service.ts`; nothing else does). Merge order A → B → D → C; each independently green. All four before
Fri 12:00 is tight: if something slips, D's 5.1 (O-3) and B are the two that protect the judge path; D's 5.2–5.5 can
follow after E2E round 1 but before the freeze.

No file overlap between A/B/C/D. `lib/proposals/*` only in C; `app/demo/JudgeGuide.tsx` only in B; `lib/demo/guide.ts`
only in A; `lib/demo/constants.ts` only in D.

---

## 7. Decisions needed from Rangga (minimum)
1. **F-1:** approve the label system-instruction change + CORRECTION definition (reopens the 24/24 label pipeline, gated by the full `eval:scenario` matrix and `eval:label`). Fallback (b) only on eval failure.
2. **O-3:** 10 → 20 min demo session ceiling (doubles the per-session transcription ceiling on the demo project; daily caps unchanged).
3. **Proposal wording policy:** forbid "customer name / phone number" in generated record steps (recommended for the demo; note the pilot's real phone orders may need a callback number — Tiffany's call for the library text later).
4. **O-1:** keep R-09 `sop_changed` as is (one approval per judge run; copy already explains it). A finer rule (block only when the *targeted* step changed, so a NEW-step proposal survives) is defensible but is a product-rule change: not before freeze.

## 8. What QA must re-verify (one full 3-day live run, exact wavs, after A+B+D; C can ride the same run if merged)
1. Phone days: **one** PHONE_CALL question per phone day, **no** "correction" question, no "Waiting for review" item; the PHONE_CALL thread's `lines` hold both card lines (Firestore read-only).
2. Debrief card example text reads "I did not read the order back to the caller."
3. Stage pill: hard-load `/sop`, `/reviews`, `/devices` as supervisor on day 3 → "Stage 3/4 of 5" (not 1); owner `/home` → stage 5 after proposals are feasible.
4. 360 px: guide open on "Tap End today" → tap End today → sheet collapses, "Yes, end" tappable; `/pair`: Fill in → sheet collapses → Set up tappable.
5. Proposal B text: no `[staff]`, no `(role:`, no ISO date, no "name"/"phone number"; A unchanged in quality.
6. `/favicon.ico` 200; no console 404; Cloud Logging has no favicon WARNING for the run.
7. `/sign-in` after staff sign-out: no "Signed in as Staff" bar; "You are continuing your demo (ends …)" still shown.
8. SOP book after approval: "08/10/26 · current" and "<tomorrow> · upcoming"; after `reviews/fast-forward` unchanged.
9. `GET /api/v1/capture/config` → `demo_session.max_ms: 1200000`; a session left open ends by `auto_stop` at +20 min.
10. Pipeline tick logs: no `[pipeline-tick] skew` lines at normal latency.
11. Regression: labels 15/15 on the routine cards, proposals A and B on attempt 1, supervisor → owner → SOP v2 → review date (R-20 §4 done-when).

## 9. Accept-and-document (honest residual risk)
- F-1 is a model behaviour: even at ≥ 4/5 offline, a live run can still split once; then the judge sees one extra
  "correction" question and the supervisor sees one "Waiting for review" row (relabel via "Change category"), and
  proposal B still works through the debrief note (R-20 PR-A). Say so in the judge script notes.
- O-1: a judge who expects two approvals ships one; the card explains it. Risk: a judge skims the guide.
- O-2: owner can generate/constraints by ruling; the entry page frames generation as the supervisor's job. Cosmetic.
- D3 residual (R-20 §5) unchanged: two short lines read back-to-back can still share a segment.

## R-21 PR-B review (tech-lead, 16 Oct; branch `feature/r-21-guide-fixes`, 00714ff + 86c7992 on bc54898)

**Verdict: PASS-WITH-NOTES.** The diff matches §2.2 and §3.3 line for line. Hard rules: not touched (no data, routes or model
calls change; the progress read is still the authed GET). Touched tests run green in the worktree: Sheet 18/18, JudgeGuide 45/45.

**D4 (`app/demo/JudgeGuide.tsx:176-199`)** — correct. `getClientAuth` → `getAuth(app)` is the same instance every render, so `auth`
is a stable dep (no loop). Transitions: loading → guard returns (no fetch); signed_in → one fetch per pathname/open/progressVersion
(test asserts exactly one `/demo/progress` call); signed_out → guard returns, in-flight read cancelled (no fetch after sign-out even
while `bee6.demo` still says supervisor, the D5 case). Device path: `/capture` and entry routes exit at `isCapture`/`isEntry`, and the
device role maps to `webRole === null`, so the gate is a no-op for staff; `useAuthUser` now subscribes on every route (harmless:
`onAuthStateChanged` only reads persistence). R-19 guide-lag / pageSig / collapse rule untouched.

**F-2 / D7 (`app/ui/Sheet.tsx:31-46`)** — correct, and it fixes F-2 for real: the judge's tap on "End today" (above the sheet; QA
could tap it) is itself the outside pointerdown, so the sheet is collapsed before the confirm card renders; the sheet is `position:
fixed` with no transition, so collapsing causes no reflow and the same gesture's click still lands on End today. "Yes, end" then
sits above the 96 px reserve. Opening tap: handle is inside the section → never self-closes. Listener only while open; cleanup on
collapse/unmount. Card state survives a collapse (body is `hidden`, not unmounted; spoken cards are in sessionStorage). Laptop
`SidePanel` untouched. D7: `onFilled` collapse is deterministic.

Notes (optional, not required for merge):
1. `app/ui/Sheet.tsx:40` — a pointerdown inside a portaled modal (`ResetDemoButton` alertdialog, opened from the guide's own
   owner-Home card) collapses the sheet behind it; on Cancel the dialog focuses its trigger, which now sits in a `hidden` body, so
   focus falls to `<body>`. Fix if wanted: `if (e.target instanceof Element && e.target.closest('[aria-modal="true"]')) return;`.
2. No backdrop: an "outside" tap also activates whatever is under it (e.g. "Not yet, keep going" when the confirm is already up and
   the sheet opened after). Accepted trade-off (§3.2 quick-win); a touch scroll on the page also collapses the sheet. Say so in QA.
3. `JudgeGuide.test.tsx:331` `expect(container).toBeTruthy()` is filler; harmless.

jsdom cannot see (QA at 360 px): End today still above the open sheet after this diff (geometry, not logic); the End today tap both
collapses and arms the confirm in one gesture on a real touch device; `/pair` Fill in → Set up tappable; stage pill on a hard load of
`/sop`, `/proposals`, `/reviews`, `/devices` for supervisor and owner.

## R-21 PR-C review (tech-lead, 16 Oct; branch `feature/r-21-proposal-wording`, 2411627..2b788df on bc54898)

**Verdict: PASS-WITH-NOTES.** Hard rules: pass (Google only, no audio, strip runs before mask/scrub/redact, location from
`config/regions.yaml`, demo-project guard untouched, no text printed without `--texts` and only on the fictional fixture).
Touched tests run in the worktree: 93/93 (text 6, prompt 15, eval-proposal 17, service 55).

Matches the plan: `stripLeadingRoleTag` is pure, head-anchored, one tag, case-insensitive, `[x]` / `(x)` / `(role: x)`,
`Take [staff] …` and `[note] …` untouched; applied at 8e to both `change_text` and `change_title`; `(role: x)` rendering;
rules 9–11 appended; `systemInstruction` still has no braces, untrusted text stays in the data block. R-20 unchanged
(attempt loop, focus loop, excerpt/reason scrub, `attempts` accounting are not in the diff). Pilot: same prompt; harmless.

Deviation (rule 11 "never contains a role tag anywhere"): **ratified.** Additive, prompt-only, re-run clean. A mid-text
`(role: x)` strip is **not worth adding**: `[staff]` mid-text is legal ("Take [staff] …"), `(role: x)` mid-text is rare
and now prompt-forbidden, and a mid-text regex would leave grammatical holes we can't test for. Keep the head strip only.

Eval evidence: 3 runs, last two A 5/5 B 5/5, weak CS 5/5 decline, grep 0 across 2x5 — enough for a wording change
(the plan asked for one 5-run pass). Rule 10 ("no calendar dates, clock times") does not collide: `review_after_days` is a
number, review dates are computed by code, and the demo SOP (`scripts/demo-sop.ts`) carries no clock times or "name".

Required (optional, non-blocking; fold into PR-D or a follow-up):
1. `lib/proposals/service.ts:570-571` — wire non-empty check runs before the strip, stored `ProposalContentSchema`
   `min(1)` after. A field that is only a tag (`"[staff]"`) passes wire, strips to `""`, and `ProposalSchema.parse` at 8f
   throws a ZodError → 422 with no blocked proposal or audit (every other failure writes one). Fix: fall back to the
   unstripped text when the strip empties it (`s.trim() ? s : t`). Near-impossible in practice.
2. `scripts/eval-proposal.ts:138` — bare `/name/i` grep also hits "names", "rename", "menu item name"; rule 9's own
   wording ("names the order itself") invites it. Use `\bname\b` or target `customer's name|their name|write.*name`.
   A false positive only fails a dev eval run, never product code.
3. `parseArgs` loop change: the only caller is `package.json` `eval:proposal` with no positional args; nothing breaks.

## R-21 PR-D review (tech-lead, 16 Oct; branch `feature/r-21-mechanical`, 76f468d..d7c4f35 on bc54898)

**Verdict: FAIL (one required fix, D6).** Hard rules: not touched. Touched tests green in the worktree (8 files, 269/269).
`npm run build` green.

**Required**
1. `next.config.ts:12` — D6 does not fix the 404. Built and started the worktree: this Next serves the static icon at
   `/icon.svg` (head emits `<link rel="icon" href="/icon.svg?icon.<hash>.svg">`, `.next/server/app/icon.svg*`); `/icon`
   is 404, so `/favicon.ico` → `/icon` is still 404. The plan (§5.3, my error: the docs page shows `/icon?<generated>`)
   is wrong for a static file. Fix: `destination: "/icon.svg"`, then verify locally
   (`npm run build && npx next start -p 3977`, `curl -sI localhost:3977/favicon.ico` → 200 `image/svg+xml`). No proxy/
   middleware in the repo, no CSP, no `public/favicon.ico`, so nothing else intercepts it; `output: standalone` is fine.
2. `lib/pipeline/tick/service.test.ts:349-375` — the large-skew test dropped the assertions the old test existed for
   (exact key set, `device_id`, and "no text content" via `/irrelevant/`). Restore them in the new >60 s case; the
   threshold is now the only thing proven.

**Optional / notes**
3. `app/sop/SopApp.tsx:48` — fallback when `in_force_version` is null is `v.version - 1` per version (plan: `newest.version`).
   Only reachable when no version is in force yet (every `effective_from_date` is in the future); harmless but labels
   v1 "current" while nothing is in force. Multiple future versions all read "upcoming" (correct); midnight Jakarta
   relabels on the next overview fetch (server `today`). i18n: EN + ID keys both added.
4. `app/demo/DemoBar.test.tsx:190` — the test name still says "drops the class at the instant the demo ends while
   /sign-in is open" but the body now tests a /pair → /sign-in remount. Rename, or restore the fake-timer expiry on /pair.
5. O-3 stale tab: relaxing `max_ms` to a range helps the *next* change, not this deploy — a judge tab holding the old
   bundle has `z.literal(600_000)` baked in, so `fetchCaptureConfig` (`lib/capture/browser/client.ts:160`) throws once
   the server sends 1_200_000, until reload. Accept and note in the judge script (deploy before judges start). New
   bundle vs old server (600_000) parses. Pilot is unaffected (`demo_max_ms` only set for sandbox outlets, `session-api.ts:55`).
   Consumers all read the value (`autoStopDeadline` maxMs from config, `autoStopFor` from the constant), none assume 10 min.
   Guide copy already says "about 20 minutes"; no "10 min" copy. `lib/demo/constants.ts:43` comment ("3 days x up to
   10 min") is stale; `SEGMENT_PER_SANDBOX = 150` at 15 s segments covers ~37 min of continuous speech across 3 days —
   fine as a ceiling since judges end days early, but Rangga should know the cap can now bind before the hard stop.
6. D5: first-paint and DemoBar now agree (LIVE on /sign-in: pill reserved, top bar not), so no CLS; other routes
   unchanged. After staff sign-out, `/sign-in` shows only DemoAccess's "continuing (ends HH:MM)" line (`DemoAccess.tsx:124`);
   the ENDED case was already hidden. Consistent.
7. O-6: `logSkew` has no consumer beyond the tick route's log line (no alert, no test seam elsewhere); real clock
   skew (>60 s either way, or any segment >60 s ahead) still logs.

## R-21 PR-A review and re-checks (tech-lead, 16 Oct)

### PR-A (`feature/r-21-label-threading`, d289478 + 63e724f + 330bfd7 on bc54898) — **PASS-WITH-NOTES; deviation ratified**

Hard rules: pass. Prompt text only (no new model, location, data or route); `config/categories.draft.yaml` changes one
`definition` string; the guide copy is fictional (rule 8) and ID = EN (172 chars, under the 240 cap, test-asserted).
Model location unchanged (`lib/pipeline/label/call` reads `config/regions.yaml`; not in the diff). No `{`/`}` in the
system instruction (test-asserted). Token cost: +508 chars (~130 tokens) of system instruction per label call on
flash-lite, per unit; negligible against the user content, and the pilot pays it too.

**The deviation (bullet 3 dropped, bullet 2 reworded) is ratified.** My plan's bullet 3 ("decide a thread's category
from all of its lines together") was an invitation to merge: it tells the model that lines *belong together* before it
has decided what the event is, and the `eval:label` trap (what-if beside a real stock-out on the same item) is exactly the
case where that is wrong. 20/35 → 4/35 is a real regression, and the shipped sentence ("a general instruction or a
what-if is not the same event as something that actually happened, even when both mention the same item") is the
one that names the distinction the trap protects. Read adversarially against the demo:
- Problem A (customer asks, staff "not sure", customer "I will take two anyway"): one customer, one exchange, no
  instruction or what-if in any line, so rule 2 has nothing to split on; `A one thread 5/5` on exact days 1-2 is the
  direct evidence. The staff reply is not an instruction (it reports a missing practice, "nobody writes the time").
- Problem B two lines: the first bullet's example is this exact shape, and the second line names the call ("that was a
  phone order"); `B one thread 5/5` days 2 and 3, U1 and U2.
- A routine staff line after a customer line (d2-c4 after d2-c3, d1-c4 after d1-c3): "different task or topic" opens a
  new thread; `contamination 0` on all exact cells is the metric for this, and it held.
- Residual: rule 2's "general instruction" clause means a supervisor's instruction *right after* a real event ("next
  time write the baking time on the tray") opens its own thread rather than joining the event. That is the CORRECTION
  definition working as intended (someone else's mistake, supervisor confirms), not a regression; it is the pilot
  case, not the demo script.

**eval:label 24/40 vs 20/35:** acceptable. The trap was an "early, informal signal" by R-05b Decision 1, never a 5/5
gate; 60 % vs 57 % is inside run-to-run noise, so "no regression" is met. What it protects: a hypothetical (TRAINING)
must not be labelled as the live event. The product consequence of a miss is a what-if line riding inside a
CUSTOMER_SERVICE thread's excerpt, which the gate can then turn into a fact that quotes a hypothetical. That is a
pre-existing weakness of the label model, not of this PR, and the demo script has no hypothetical line. Pilot risk
statement: unchanged from before this PR (the rule text, if anything, pushes the model the right way).

**CORRECTION definition:** the leading clause still reads "A supervisor correcting a mistake someone else just made",
so a genuine supervisor correction keeps its label. Nothing depends on the old wording: `gate.v1-fixture.json` uses
category ids only, `config.test.ts:43` is an inline fixture, `eval:label` has no CORRECTION case. Honest gap: no eval
proves a real CORRECTION still labels CORRECTION; the category's `needs_supervisor_confirm` means a miss costs a
question, never a false fact.

**eval-scenario.ts:** `one_thread` is computed from `thread.line_ids` across all units (so a card split across two
units also reads false, which is the right answer), `threadIds.size === 1` is equivalent to the plan's `<= 1` given the
"no line reached a thread → false" rule, and a card the day lacks stays `null`. Thresholds `Math.ceil(0.8 * n)` with
the exact failure strings `A/B one thread k/n (need m)`, exact script only; variants report-only. Report columns are on
every row (test asserts day 1 shows `B one thread -`). Test coverage matches the plan (1/1 split → false + FAIL string;
clean → true; none → false; 4/5 passes).

**Demo caps / the ~1,500 real-model eval calls:** no effect on the live QA or judges. `scripts/eval-label.ts` and
`scripts/eval-scenario.ts` call the model directly and import nothing from `lib/demo`, so `demo_counters` (`model_day:<utc
day>` = 5,000 global per UTC day, `segment_day`, per-sandbox kinds) were never bumped. In product code the only
model-counting checkpoint is `enforceDemoCaps` on the segment, generate and redact routes: the pipeline's label calls
are not counted per call; one segment upload buys its transcription and downstream labelling. `DAILY_TOKEN_CEILING`
exists only as this count-based interim (`lib/demo/constants.ts:51`). Only Vertex quota / billing on bee6-playground
was spent.

Notes (not required): (1) `prompt.test.ts` collapses whitespace before `toContain`, good, but the test name says
"threading rules between the category list and the structured-output block": fine. (2) The guide's `debrief_question`
card now says "I did not read the order back to the caller" — this is also the card's day-3 text (same `card`), and
the day-1 test still asserts no "phone order"; both green.

### PR-D re-check (`feature/r-21-mechanical`, +d263fe1 +6fe069d +47c83e8 +b5c38ba) — **PASS**
1. D6 `next.config.ts` → `destination: "/icon.svg"`, which is the path this Next really serves (verified in the earlier
   review; `/icon` 404s). Required item closed.
2. `service.test.ts` large-skew case restores the exact key set, `device_id: "d1"` and the `/irrelevant/` no-text
   assertion. Required item closed.
3. O-5 fallback now `newestVersion` (plan wording). 4. Test renamed; stale "10 min" comment fixed.

### PR-B follow-up (870c531) — **PASS**
`Sheet.tsx:39-46`: `closest('[aria-modal="true"]')` early-return, `instanceof Element` guard (pointer events target
elements, so no lost case), listener still capture-phase and open-only. Test covers in-modal (no collapse) and outside
(collapse). Filler assertion removed from `JudgeGuide.test.tsx`.

### PR-C follow-ups (bfbed3f, e7f3b70) — **PASS**
`stripLeadingRoleTag` falls back to the unstripped text when the strip empties it (`stripped.trim() ? stripped : text`),
so a tag-only field keeps `min(1)` and the proposal is written instead of a 422 ZodError; service test proves it end to
end. `eval-proposal.ts` `name` rule now needs customer/caller/person/their context or "name and phone"; the fixture test
covers both directions. Dev-eval only, no product code.

### Integration (merge-tree, no refs moved): A → B → D → C onto bc54898 — **clean**
`git merge-tree --write-tree` chained through dangling `commit-tree` objects: every step merged without conflict, and
the four branches touch **no common file** (`lib/demo/guide.ts` is only in A; B is `Sheet`/`JudgeGuide`; C is
`lib/proposals`/`eval-proposal`; D is `next.config`/`SopApp`/`DemoBar`/tick test/constants). Final simulated tree
`690c39cc` (35 files, +743/-88). Extracted to the scratchpad with a current worktree's `node_modules`:
`tsc --noEmit` clean · `eslint .` clean · `vitest run` **322 files, 5283 passed, 1 skipped**. `next build` could not run
in the extract (Turbopack refuses a symlinked `node_modules` outside its root: "points out of the filesystem root"),
not a code failure; each branch's build is already enforced by the pre-push hook and no files overlap, so the merged
build risk is nil. Order A, B, D, C is confirmed; any order works.

Rangga/QA on the live URL after merge: `curl -sI <url>/favicon.ico` → 200 `image/svg+xml`; one full 3-day exact run
per §8 with the `one thread` columns read from the eval report, and the judge-script note from §9 (a live split can still
happen once; proposal B still works through the debrief note).
