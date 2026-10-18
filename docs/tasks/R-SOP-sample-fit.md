# R-SOP-sample-fit: fitting a real-sized SOP into the demo (tech-lead design note, 11 Oct)

Status: DESIGN ONLY, waiting on Rangga's answers (questions at the end). No code. Builds into R-12 Task 3.1.

**Privacy rule for this note and everything built from it:** the sample (`docs/SOP PROOFED.docx`) is treated as
Proofed's real SOP (hard rule #8). This note keeps only shape statistics (counts, lengths, kinds of content). It holds
no product names, place names, codes, quantities, times, group names or wording from the sample. Whoever writes the
demo SOP works from this note, **not from the docx**.

## 1. Shape of the sample (statistics only)
- About 6,000 characters of text, in Bahasa, plus about 14 embedded photos (about 3.7 MB). The photos look like product
  pictures beside a product reference table. The app does not ingest them.
- 7 sections: product preparation (3 general rules plus a reference table of about 13 product variants), equipment
  programme list (about 10 numbered programmes plus 1 safety rule), opening checklist (about 18 items), shift
  handover checklist (about 10), closing checklist (about 16), daily freshness or discard check (about 6, plus a worked
  example), goods receiving and returns (about 6 items plus a report-format example block).
- About 80 atomic items. Median about 50 characters, longest 244. **None is over 400 characters**, and only one is over
  200. Most items are actions for staff; a few name the supervisor as the person who approves or checks.
- Some content is repeated across sections (the same check appears in opening and handover, and equipment cleaning
  appears in opening and closing). That is realistic, and it makes targeting a step harder for the model.

## 2. Mapping to `sop_versions.steps`
- 1 checklist item maps to 1 step. A reference row maps to 1 step, or a few rows are grouped. That gives about 60 to
  70 steps, well under the 200 limit. The doc is about 30 KB, well under Firestore's 1 MiB.
- `step_id`: section prefix plus a number (`open-07`, `close-03`, `recv-02`), so it matches `^[a-z0-9][a-z0-9_-]{0,39}$`.
- `title` (at most 160 characters): `"<Section> · <short action>"`. The sample has no titles, so the section prefix is the
  only grouping (there is no `section` field, and adding one is not worth the cost, see §5).
- `text`: at most 300 characters in the demo SOP, so it stays well under `SOP_STEP_TEXT_MODEL_CAP` (400).
- `role`: `staff` by default; `supervisor` only where the step is the supervisor's own action.
- Not ingested: photos, the table layout, and the example and report-format blocks (if a reference row is needed, it
  becomes a short step).

## 3. Recommended design (quick win), about 2 to 2.5 h, folded into R-12 Task 3.1
1. **A new `scripts/demo-sop.ts`** exports `DEMO_SOP_V1` (fictional, English per R-12 Q-6). It has the same 7-section
   shape, about 60 steps, every text at most 300 characters, and one repeated check kept for realism. Its products,
   equipment, places and numbers are all fictional. `DEMO_TEMPLATE_SEED` uses it. `DEMO_SEED` may use it too (see Q5).
2. **Author it after reading the 5 fictional clips' transcripts.** The lead scenario's natural target step must exist,
   be unique, and have a near neighbour as a decoy. Fact categories that the template path can turn into facts
   automatically are ROUTINE_OPS, CUSTOMER_SERVICE, STAFF_CONSULT, TRAINING and EVENT. COMPLAINT, CORRECTION and
   DISRUPTION need a supervisor to confirm them, and PHONE_CALL is always a question. So the lead scenario that feeds
   the evidence floor must sit in an automatic category.
3. **Tests (`scripts/demo-sop.test.ts`):** the doc parses with `SopVersionSchema`; step ids are unique; the count is
   between 40 and 80; every `text.length` is at most `SOP_STEP_TEXT_MODEL_CAP`; titles carry a section prefix; and no
   step text contains the demo id tokens (`demo-tpl-`), as R-12's clone test expects. **Do not commit a deny-list of
   real terms.** That list would itself leak the real SOP. Run any such check locally against a file under `private/`.
4. **Dry run:** after the template is seeded, run one generate on the template copy and check that the target step is
   right and that the change text stays within 400 characters. Budget 0.5 h.

## 4. The two earlier open items
- **(a) Steps over 400 characters.** The real data has none, so the seed is not the risk. The real path is a v2 step:
  the model may write up to 400 characters, redaction can make the text longer, and the stored cap is 800. So a step
  in v2 or later can pass 400, and a later proposal on that step reaches the owner as `STEP_TEXT_TOO_LONG`, which is a
  dead end. Fix (ultimate, about 1 h, R-08 code):
  - In `lib/proposals/service.ts`, offer only steps with `text.length <= SOP_STEP_TEXT_MODEL_CAP` as
    `wireCtx.stepIds`.
  - In `prompt.ts`, still list the other steps, marked "(not changeable)".
  - **Edge case:** if no step qualifies, `buildProposalWireSchema` throws on an empty `stepIds`. Allow `["NEW"]` alone.
  - Raising the wire cap is rejected because it ripples into the stored and schema caps. Splitting steps at seed time
    is done anyway, through the demo SOP's length test.
- **(b) A discard path that creates no constraint.** It is unreachable in the demo: proposals are not cloned, so a
  sandbox has no legacy proposals; about 60 steps is far from the 200-step limit; and (a) above removes
  `STEP_TEXT_TOO_LONG`. Defer it and list it as a known gap. The ultimate option (about 2 to 2.5 h) is an owner-only
  "Dismiss: can't be applied". It is offered only after a 409 refusal, ends in a terminal status, writes no constraint
  and writes an audit row with the actor's role.

## 5. Not doing
- **No SOP upload or import feature.** It is not in the backlog or the specs, and it would add parsing for docx and
  photos and a new write path for SOP v1, which makes hard rule #9 harder to protect. When the pilot resumes, the real
  SOP reaches `private/seed.pilot.json` by hand (it is never committed).
- No `section` field, and no choosing where a NEW step is inserted (a NEW step is appended at the end, which is a
  cosmetic issue). No step-level evidence links: the gate stays category-based, and the supervisor judges whether a
  step is relevant.

## 6. Questions for Rangga
See the tech-lead report (Q1 to Q7).

## Decisions (Rangga, 11 Oct)
1. The sample is the real Proofed SOP; the .docx was moved out of `docs/` (only `private/SOP PROOFED.pdf` is in the tree, gitignored). Never commit it.
2. Demo SOP is full-size (about 60 steps, 7 sections), fictional, written by the team, English (aimed at judges).
3. Only the R-12 template uses it; the existing `demo-outlet` keeps its 5-step v1.
4. Long-step filter and Dismiss action: explained to Rangga, decision pending (default: known gaps until after 18 Oct).
5. No SOP import feature; pilot SOP goes into `private/seed.pilot.json` by hand.
Open: the 5 demo clips' content (what was said) is needed so the fictional SOP has a step the lead scenario can lead to.

## Rulings (Rangga, 11 Oct, later)
- The .docx and the PDF in `private/` carry the same content.
- Long-step filter and Dismiss action are KNOWN GAPS for 18 Oct. Research continues on handling steps longer than the 800-char stored cap (and the 400-char model cap), because the real SOP and other SOPs may have them (tech-lead research task open).
- The current 5-step placeholder SOP lives in `scripts/seed.ts` (`sop_v1`, step ids open-01, bake-01, stock-01, serve-01, close-01). The fictional ~60-step demo SOP will replace it for the R-12 template only.

## 7. Long steps (over 400 / over 800 characters): research (tech-lead, 11 Oct)
Rangga's ruling: the long-step filter and Dismiss stay KNOWN GAPS for 18 Oct; research continues for the pilot.
Facts checked against `origin/develop` (626ef19). Counts only; nothing from the sample's wording.

### 7.1 How long can a step get in the sample?
The PDF and the earlier docx have the same content (about 5,700 characters of item text, 7 sections).

| Mapping | Steps | Longest | > 200 | > 400 | > 800 |
|---|---|---|---|---|---|
| A. one item or table row = one step | 85 | 243 | 1 | 0 | 0 |
| B. each section's whole list = one step | 7 | 1,263 | 6 | 6 | 3 |
| C. product table as one reference step (with its 3 general rules) | 1 | 1,181 (1,311) | 1 | 1 | 1 |
| D. "natural" grouping a shop might choose (rule + its example; sub-list under its header) | – | 529 | – | 2 | 0 |

Group sizes behind D and C: equipment programme list as one step 313 (444 with its safety rule); goods-receiving
rule + its report-format example 529; the 5-line sub-list under one receiving header 430; discard rule + its worked
example 135. Whole sections: 155 (rules only), 444, 1,263, 517, 986, 581, 976.

**What a shop would plausibly want.** Checklist items are naturally atomic (mapping A, all under 250). The structure
invites longer steps in three places: a rule with its worked or report-format example attached (about 530), a
sub-list under one header (about 430), and reference blocks (product table about 1,200; programme list 300 to 450).
So the real SOP under a natural grouping gives **2 steps between 401 and 800 and 1 over 800**. Other shops' SOPs
(franchise manuals, cleaning procedures with sub-steps) will go well past 1,000 characters per procedure.

### 7.2 What breaks today
- **Over 800:** the seed is rejected loudly (`SopStepSchema.text` max 800; `scripts/seed.ts` `sop_v1`). This is the
  only check, and it fails the whole seed. Nothing else is reached. This is safe, but the owner has to split the step by hand.
- **401 to 800 (seedable, but cannot be changed):** the step is offered to the model like any other
  (`service.ts` `stepIds: sop.steps.map(...)`). The prompt asks for the *complete* new text, but the wire schema caps
  `change_text` at 400 (`WIRE_MAX`). So the model either fails the schema (one retry, then blocked) or writes a
  shorter text that **silently drops content**. That proposal passes the gate and the supervisor, and then the owner
  gets `STEP_TEXT_TOO_LONG` (`planShip`, `ship.ts:76`). Generating again picks the same step. Dead end; the only exit
  is Reject, which wrongly writes a constraint.
- **Also for steps of 250 to 400 characters (not about the cap):**
  (i) the proposal card shows only the target step's *title* plus the new text, never the current text
  (`view.ts` `target_step`), so the supervisor cannot see what a full rewrite dropped;
  (ii) the whole rewritten step goes through the name scrub and SDP (PERSON_NAME, STREET_ADDRESS), so text the owner
  wrote that did not change can come back redacted (a product or mall name flagged) and longer;
  (iii) every screen renders step text in a plain `<p>` with no `white-space: pre-line`, so a multi-line step
  (list, table rows) collapses into one paragraph on `/sop`, the change card and the proposal card.
- **Not a constraint:** Gemini output limits (400 characters is about 120 tokens), the SDP request size (0.5 MB), and
  prompt size (the real SOP is about 2k tokens). **The real ceiling is Firestore's 1 MiB per `sop_versions` doc:**
  200 steps × the text cap, plus before and after. 800 is about 0.2 MB, 2,000 about 0.45 MB, 4,000 about 0.85 MB
  (too close). ReviewAgent (R-11) reads only `change.metric` and the dates, never step text, so it is unaffected by
  any option below.

### 7.3 Options
| # | Option | Effort | Risk | Verdict |
|---|---|---|---|---|
| 1 | Raise caps (wire 400 to N, stored 800 to 2N) | 2–3 h | Medium-high: moves the cliff without removing it; a full rewrite of 1,500 characters makes silent drops and re-redaction of unchanged text more likely; doc size limits N to about 2,000 | Reject on its own |
| 2 | **Segment edit** (model edits one segment of a long step; plain code puts the step back together) | 8–10 h with card before/after | Medium: needs a prompt eval; segment ids must be validated | **Recommend for pilot** |
| 3 | Structural: `items[]` sub-items or `section` field, auto-split at seed | 8–12 h | High blast radius: immutable `sop_versions` shape, R-10/R-11 views, seed | Not now |
| 4 | Reference flag (`targetable: false`) for tables and lists; NEW notes inserted after them | 2–3 h (+2 h insert-after) | Low | Optional, after 2 |
| 5 | Hide steps over 400 from `stepIds`, list them as "not changeable" | about 1 h (+0.5 h decline reason) | Low, but the model may pick a wrong neighbour or a duplicate NEW | Interim |
| 6 | Owner Dismiss after any 409 (terminal, no constraint, audit by role) | 2–2.5 h | Low | Interim; useful beyond long steps (`SOP_STEP_LIMIT`, legacy) |

**Option 2 in detail (the design to plan from).**
- `lib/sop/segments.ts` (pure): split a step's text on newlines, then split any line over 400 at sentence ends.
  Any piece still over 400 makes that step not changeable (it falls back to option 5). Segment ids are `s1..sN`.
  They are deterministic, and stable because a version's text never changes.
- Steps of 400 or less keep today's full-replace mode. Longer steps are shown in the prompt as numbered segments.
  The wire gains `edit_op: "full" | "replace_segment" | "insert_after_segment"` and `target_segment` (a string,
  checked in plain code by a new gate check `segment_unknown`, not an enum, because a large enum risks Vertex's
  schema-size limits; verify before building). The replacement stays at 400 or less. Delete is not supported (Q-L3).
- Only the replacement goes through the name scrub, the digit mask and SDP. Plain code then builds the full new text
  (current text + edited segment) and stores it in `change_text`. The untouched owner text is byte-identical by
  construction. A new optional `content.edit {op, segment_index, before_segment, after_segment}` drives a plain
  before/after on the proposal card. `planShip` is unchanged, except that `STEP_TEXT_TOO_LONG` applies only to
  `op === "full"`. `SOP_CHANGED` already guarantees the same base text.
- Caps: stored `change_text` and `SopStepSchema.text` go from 800 to 2,000. Add a superRefine on total step bytes in
  `SopVersionSchema` (about 700 KB) so the 1 MiB limit can never be hit. These are wider caps only, so stored docs stay valid.
- Stored proposals: `proposal-v2` docs have no `edit`, so they are read as `full` and stay shippable (not added to
  `LEGACY_AGENT_VERSIONS`). New ones are `proposal-v3`.
- Hard rule #9: still proposal → supervisor → owner, and the new text is built by plain code. Evidence gate (#10):
  unchanged, since it is category-based. Hard rule #3: tighter than today, because only model-written text is
  redacted. Hard rule #7: unchanged.

### 7.4 Phased plan
- **Phase 0, by 18 Oct (0 h):** known gaps in the README. The demo SOP stays at 300 characters or less per step, as
  in §3, so nothing in the demo can hit these paths.
- **Phase 1, interim, first after 18 Oct (about 4.5–5 h):** option 5 (1 h) + decline reason `target_not_changeable`
  (0.5 h) + seed-time report of steps over 400 (0.5 h) + `pre-line` rendering on 3 screens (0.5 h) + option 6
  (2–2.5 h).
- **Phase 2, pilot-ready (about 9–11 h):** option 2 + caps to 2,000 + doc-size guard + before/after on the proposal
  card + about 1 h of Gemini dry-runs on a fictional long step. After this, option 5's filter only applies to
  steps that cannot be split into segments.
- **Phase 3, only if the owner asks (2–5 h):** option 4.

### 7.5 Questions for Rangga (long steps)
- Q-L1: For the pilot, is it OK for the owner to enter reference blocks (product table, programme list) as one row
  per step? If yes, the pilot never has a step over 800 and Phase 2 can wait until a second shop.
- Q-L2: Should the proposal card show the current text next to the new text? Cut #51 removed diff wording from
  `/sop` only. A plain before/after on the card is what makes a change to a long step reviewable.
- Q-L3: Should a proposal be able to *remove* a sub-item or a step? Neither is possible today. Option 2 leaves it out
  unless you say so.
- Q-L4: Phase 1 includes Dismiss for every 409, not only `STEP_TEXT_TOO_LONG`. Do you agree?
