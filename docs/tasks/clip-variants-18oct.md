# Clip variants A/B for the judge script (design pass, tech-lead, 18 Oct 2026)

Read-only design against `origin/develop` = `e01621e` (read with `git show`; nothing in the main checkout was edited
except this file). Facts about the pipeline come from `docs/tasks/ai-capabilities-18oct.md` (Q3, F1-F3) and were
re-checked at `e01621e` where this plan depends on them. Where I am guessing, I say so (section 12).

Status: **DESIGN + IMPLEMENTATION PLAN. Not started. Needs Rangga's answers in section 13 before any code.**
It is **not** a submission-day change (section 10): it lands on `develop` behind a server flag and reaches `web`
only when Rangga says so.

---

## 0. Decision summary (read this if nothing else)

| Topic | Decision |
|---|---|
| What a judge sees | Every one of the 15 script cards gets an **Option A / Option B** picker. A = today's rehearsed wording, byte for byte (no regression). B = a second fictional line with a different outcome. Under each option a one-line **"What Bee6 does with this"** hint. |
| Honesty claim | The app never matches speech against the script today and still will not: the chosen option is never sent to the server, hints live only in guide copy, and expected outcomes live only in the eval fixture. Three prompt/config examples tuned on the story are generalised in a separate, eval-gated slice (section 8). |
| New categories | **None** (Rangga's decision). Routine B options label ROUTINE_OPS and make no question and no proposal; the hint says so. |
| Proposal variety | Four evidence paths with the existing categories: CUSTOMER_SERVICE (A+A), COMPLAINT (B+B, supervisor confirms), PHONE_CALL (A+A), DISRUPTION (B on both bake cards). PHONE B+B = a shop that reads orders back = expected **no proposal** (model declines, proven by eval). |
| Flag | Server env `DEMO_SCRIPT_ID` (`bakery-v2` default = today's guide; `bakery-v3` = picker on). Read per request on `/api/v1/capture/config`; no rebuild to switch, seconds to kill. `web` unaffected until set. |
| Bahasa | Not needed for judging. B lines and hints ship `id = en` (provisional) like today, behind the existing "Bahasa coming soon" note. |
| Review "after" data (day 4/5) | Interface only (section 11); separate design. |
| Effort | ~17-21 h build + ~3 h eval + ~3 h QA live (section 10), 6 PR slices. |

---

## 1. Goal alignment and hard rules

**Goal (CLAUDE.md section 1).** The demo exists to show speech -> evidence-gated -> supervisor/owner-approved SOP change.
A/B options strengthen the core claim ("Bee6 works from what was said") only if (a) the pipeline is untouched by the
choice and (b) different speech visibly yields different outcomes, including *no* outcome. Both are designed in below.
It drifts from the goal if we start adding categories, lowering the floor, or pooling categories to make every
option "pay off": that is explicitly out (Rangga, 18 Oct; ai-capabilities section 3.5 item 3).

**Hard rules touched.**

| Rule | How this plan satisfies it |
|---|---|
| 10 (gate is plain code) | The option id, the hints and the expected outcomes never reach a server route, a prompt or the gate. The only server read of `lib/demo/script.ts` stays `requiredLines(day)` (a count). Expected outcomes move out of `script.ts` into the eval fixture (section 3.1), so even `problem` disappears from runtime data. A new import-boundary test asserts `app/api/**`, `lib/pipeline/**`, `lib/proposals/**`, `lib/debrief/**` never import `lib/demo/script` except `lib/demo/closing.ts`. |
| 8 (fictional only) | Every B line is fictional (Demo Bakery), no person's name, no phone number, no price, no digits (the existing script test keeps enforcing this over both options). |
| 7 (people data) | No name in any line or hint; the debrief tip stops quoting a reason text (section 6). |
| 2, 3, 5, 6, 9 | Untouched: no audio, no storage change, no model location, no new Firestore access from browsers, SOP still only via proposals. |
| 4 | Eval and QA runs stay on `bee6-playground` (the harness refuses other projects). |

---

## 2. What is actually true about "the AI never sees the script" (verified at e01621e)

- No runtime code compares a transcript line with a card: `lib/demo/guide.ts` `cardState` counts `segment_accepted`
  lines only (`JudgeGuide.tsx:642-654`); `lib/demo/closing.ts:64-66` counts `lines.length` over segment docs.
- `script.ts` is imported by `app/demo/JudgeGuide.tsx` (display) and `lib/demo/closing.ts` (`requiredLines`, a number).
  `script.ts:12-13`: "`problem` is a QA/guide reference only ... no server code reads it". Still true.
- The four couplings that remain are *instructions*, not matching (ai-capabilities section 3.1 rows 1, 2, 3, 9):
  `config/interventions.yaml` `add_record_step.when_to_use` example; `lib/pipeline/label/prompt.ts:54-57` threading
  example; `lib/proposals/prompt.ts:40-41` rule 9 example; the debrief tip in `guide.ts` that seeds the staff note.
  Section 8 generalises all four. Row 8 (`app/proposals/watch-placeholders.ts`) pre-draws the two A-path categories;
  with options it becomes misleading and is handled in section 6.4.

So the honest sentence for the deck stays the one in ai-capabilities 3.2, and after section 8 lands it becomes:
"the prompts and the library are generic; the judge's own choice of words decides what Bee6 finds."

---

## 3. The variant model

### 3.1 Data (`lib/demo/script.ts`)

```ts
export const ScriptOptionIdSchema = z.enum(["A", "B"]);
export type ScriptOptionId = z.infer<typeof ScriptOptionIdSchema>;

export const ScriptOptionSchema = z.object({
  /** One short label for the picker chip, e.g. "All steps done" / "A step skipped". */
  label: Bilingual(40),
  lines: z.array(z.object({ speaker: ScriptSpeakerSchema, text: Bilingual(240) }).strict()).min(1).max(6),
  /** Judge-facing "What Bee6 does with this" line. Guide copy only; never sent anywhere. */
  hint: Bilingual(220),
}).strict();

export const ScriptCardV3Schema = z.object({
  id: z.string().regex(/^d[1-3]-[a-z0-9-]{1,24}$/),
  title: Bilingual(60),
  options: z.object({ A: ScriptOptionSchema, B: ScriptOptionSchema }).strict(),
}).strict();
```

- `problem` is **removed** from runtime data. Expected category / gate outcome / rehearsal confidence live in the
  eval fixture `scripts/eval-fixtures/scenario-v3.ts` (section 8.2), which `lib/` and `app/` never import (existing
  grep test in `app/demo/import-boundaries.test.ts` is extended to assert it).
- `SCRIPT_V3: Record<ScriptDay, readonly ScriptCardV3[]>`; `BAKERY_V3 = { id: "bakery-v3", days: SCRIPT_V3 }`.
- `BAKERY_V2` is **derived**: `toV2(card) = { id, title, lines: card.options.A.lines }`. The existing `ScriptCardV2`
  type, `SCRIPT_V2`, `requiredLines`, `scriptFor` keep their names and behaviour, so `closing.ts` and every v2 test
  compile unchanged. `lib/demo/script.test.ts` keeps "the EN text is word for word the exact fixture" against A.
- `requiredLines(day)` stays `cards.length * CARD_MIN_LINES = 5`: every option has >= 1 line (schema `min(1)`), so
  the closing rule is option-independent. Add a test: "every option of every card has >= 1 line, so
  requiredLines does not depend on the choice".
- `DemoScript["id"]` becomes `"bakery-v2" | "bakery-v3"`; `SCRIPT_BY_ID` has both. `scriptFor("bakery-v3")` returns
  the v3 object; the guide branches on `script.id` to show or hide the picker.

### 3.2 Flag and wire contract

- `lib/capture/contract.ts:213` `script_id: z.literal("bakery-v2")` -> `z.enum(["bakery-v2", "bakery-v3"])`
  (R-21 O-3 lesson: a stale tab must still parse). `FRESH_DEMO_SESSION.script_id` stays `"bakery-v2"`.
- The server picks the id in `toCaptureConfig` (wherever the profile is built; today the literal comes from
  `FRESH_DEMO_SESSION`): `script_id: process.env.DEMO_SCRIPT_ID === "bakery-v3" ? "bakery-v3" : "bakery-v2"`,
  evaluated only when `DEMO_MODE === "true"` (the pilot never sees a script). Add to CLAUDE.md section 6 env list:
  `DEMO_SCRIPT_ID` (demo project only; `bakery-v3` turns the A/B picker on; unset = today's guide).
- Stale-tab behaviour at switch time: a judge mid-day on a v2 tab receives `bakery-v3` on the next config refetch and
  the picker appears with A selected; nothing else changes. A v3 tab receiving `bakery-v2` (kill switch) hides the
  picker and shows A; a card already marked spoken as B stays marked (ids only).

### 3.3 Picker UI (JudgeGuide `ScriptCard`, 360 px)

Layout inside the existing card box, top to bottom:

1. Kicker row as today ("CARD n OF 5" + title chip).
2. Progress bars as today.
3. **Segmented control**, two equal buttons, full width, 44 px tall: `A · <label>` / `B · <label>` (role="radiogroup",
   `aria-label` "Choose what to say"; the selected one `aria-checked`). Default **A**.
4. The lines of the selected option (`ScriptLines`, unchanged component).
5. **Hint line**, mono small text under the lines: "What Bee6 does with this: <hint>". Replaces nothing; the
   footnote ("Read it word for word...") stays below it.
6. "I have spoken this" + the existing waiting/stuck hints.

Rules:
- The picker is enabled until the card is marked spoken; once marked, the chosen option is **locked** and the
  "Previous card" re-read shows exactly the lines that were read (the choice is in storage, section 3.4).
- Switching options before marking does not reset `linesSinceCardShown`: the unlock is a 1-line nudge, not a check
  (same accepted softness as today, `JudgeGuide.tsx:646-647`). Switching after Bee6 already heard one line simply
  leaves the button enabled; the server guard (`requiredLines`) is unchanged.
- Keyboard: left/right arrows move the radio; the existing focus-on-heading after "next card" is kept.
- No option text or id is ever posted. The bridge (`app/demo/guide-bridge.ts`) is unchanged.
- `uiux` pass: the segmented control reuses the `Chip`/`Ctl` primitives; copy in section 7.

### 3.4 Storage (phone only)

`sessionStorage` key `bee6.script.{session_id}` grows from `{ spoken: string[] }` to
`{ spoken: string[]; choice?: Record<string, "A" | "B"> }`. `readSpoken` tolerates a missing `choice` (= A). The
session-scoped key means day 2 starts clean (a new session id), as today.

Optional (slice S2b, 1 h): `localStorage` `bee6.script.choices` = `{ [day]: { [cardId]: "A" | "B" } }` keyed by the
sandbox, written when a card is marked, so day 2's hint can say "Yesterday you chose B here" (section 7.3). Phone
only; never read by the web guide (the supervisor's browser is a different device). Cleared by the owner reset
(`ResetDemoButton` already clears guide keys; add this one).

---

## 4. The 30 lines (A = today's text, B = new)

Author's rules for every B line: fictional; staff voice unless marked; no names, phone numbers, prices or digits;
one event per card; the category must be **unmistakable on both days it repeats**, with the same gap (rule 8 of
the Proposal agent); routine B lines must not mention a customer, a phone or a colleague (so they cannot drift into
CUSTOMER_SERVICE / PHONE_CALL / CORRECTION); DISRUPTION lines avoid hazard words (fire, smoke, burn, gas, hurt) so
they cannot drift into SAFETY_INCIDENT (decision order puts SAFETY first).

Expected = what the eval must prove (section 8.3). "conf." = my rehearsal confidence before any eval run.

### Day 1

| Card | A (today, unchanged) | B (new) | Expected label / gate (B) | conf. |
|---|---|---|---|---|
| d1-c1 Opening | "Good morning. I am opening the shop now. The oven is on and the display lights are on. I counted the cash in the till and it matches the float." | staff: "Good morning. I am opening the shop now. The oven is on and the display lights are on. I did not count the cash in the till yet, I will do it later when it is quiet." | ROUTINE_OPS, fact or routine question; never evidence | high |
| d1-c2 First bake | "The first tray of egg tarts is out of the oven..." | staff: "The oven switched itself off in the middle of the first bake. The display is empty and the first tray is late. I am restarting the oven and waiting for it to heat up before I can bake again." | **DISRUPTION** (cause: equipment) -> debrief question (tier 0) -> staff Yes -> still open -> supervisor confirm -> fact | medium (drift risk: ROUTINE_OPS if the model reads it as ordinary delay) |
| d1-c3 A customer at the display | customer asks bake time; staff cannot say; "I will take two anyway." | customer: "Excuse me, this egg tart is not fresh at all, it is dry and cold. I wanted a fresh one from this morning. Do you know when this tray was baked?" staff: "I am sorry about that. I am not sure when this tray was baked, because nobody writes the baking time on the tray, and I have no fresher tray to offer you right now." customer: "That is disappointing. I really wanted a fresh one. I will leave it, then." | **COMPLAINT** (complaint_type: taste_texture, customer_request: replacement) -> debrief question -> Yes -> supervisor confirm -> fact | high (A's runner-up was COMPLAINT twice in rehearsal; B says it outright) |
| d1-c4 Display check | "...cinnamon rolls are running low, so I am refilling them now..." | staff: "Display check. The cinnamon rolls are running low, but I am busy at the till, so I will refill them later." | ROUTINE_OPS | high |
| d1-c5 Closing | "...I counted the till, I cleaned the oven, and I wrote the leftover bread in the log." | staff: "We are closing now. I counted the till and cleaned the oven. I forgot to write the leftover bread in the log, I will do it tomorrow morning." | ROUTINE_OPS (not CORRECTION: the definition excludes one's own remark) | high |

### Day 2

| Card | A (today) | B (new) | Expected (B) | conf. |
|---|---|---|---|---|
| d2-c1 Opening | "Morning. Oven on, display lights on. The cash in the till is counted and correct." | staff: "Morning. Oven on, display lights on. I skipped the till count, there was already a queue outside." | ROUTINE_OPS | high |
| d2-c2 A customer at the counter | customer asks bake time; "I will have one anyway." | customer: "Hi there. I bought an egg tart here yesterday and it was stale. I want a fresh one today. Can you tell me what time this tray was baked?" staff: "Sorry, I do not know exactly when it was baked. Nobody wrote the baking time on the tray, so I can only guess, and I have no fresher tray to give you." customer: "That is not good enough. I wanted a fresh one. I will not take it." | **COMPLAINT**, same gap as d1-c3 B (stale tart, no bake time, no fresher tray) | high |
| d2-c3 A phone order | not read back (PHONE_CALL) | staff: "Hello, Demo Bakery, thanks for calling. Yes, we can do fifty egg tarts for tomorrow morning, pickup at ten o'clock. Let me read that back: fifty egg tarts, tomorrow morning, pickup at ten. Correct? Great, thank you, bye." staff: "That was a phone order for tomorrow. I read the order back to the caller and wrote it on the order slip, so the quantity and the pickup time are confirmed." | **PHONE_CALL** (always a question) -> Yes -> fact **with no gap** | high for the label; medium for the model declining (section 5) |
| d2-c4 Display check | "...croissants are almost gone, I am putting out a new tray..." | staff: "Display check. The croissants are almost gone. I have no new tray ready, so the croissant shelf stays empty for now." | ROUTINE_OPS (stock) | high |
| d2-c5 Closing | "Closing time. Till counted, oven cleaned, leftover bread logged." | staff: "Closing time. Till counted. I did not clean the oven tonight, I will do it in the morning. Leftover bread logged." | ROUTINE_OPS | high |

### Day 3

| Card | A (today) | B (new) | Expected (B) | conf. |
|---|---|---|---|---|
| d3-c1 Opening | "...the float in the till is correct." | staff: "Good morning. The oven is on and the display lights are on. I have not checked the float in the till, I will do it after the first customers." | ROUTINE_OPS | high |
| d3-c2 Another phone order | not read back (PHONE_CALL) | staff: "Hello, Demo Bakery, thanks for calling. A birthday cake and twenty croissants for Saturday, pickup at four o'clock. Let me read that back: one birthday cake, twenty croissants, Saturday at four. Correct? Thank you, bye." staff: "That was another phone order. I read it back to the caller and wrote it on the order slip, so I am sure the pickup time is right." | **PHONE_CALL**, no gap | high / medium |
| d3-c3 Second bake | "The second tray of croissants is out..." | staff: "The oven switched itself off again in the middle of the second bake of croissants. The display is running low and I am waiting for the oven to heat up again before I can finish the tray." | **DISRUPTION**, same gap as d1-c2 B (oven switches off mid-bake) | medium |
| d3-c4 Display check, a calm one | "Everything is full. Nothing to refill right now." | staff: "Display check. The cinnamon rolls are low again. I am not refilling now, I will wait until the next bake is out." | ROUTINE_OPS | high |
| d3-c5 Closing | "...counted the till, cleaned the oven and logged the leftovers." | staff: "We are closed. I counted the till and cleaned the oven. I did not log the leftovers tonight." | ROUTINE_OPS | high |

Test changes in `lib/demo/script.test.ts`: the "routine cards never mention customer/phone/call/colleague" rule now
runs over **both options** of the 10 routine cards (d1-c1, d1-c4, d1-c5, d2-c1, d2-c4, d2-c5, d3-c1, d3-c4, d3-c5)
and over the **A** option of the bake cards; the bake cards' B option must not match
`/fire|smoke|burn|gas|hurt|injur|hazard/`; the complaint B options must not match `/refund|price|money/`; the
"problem A/B positions" test is replaced by an "A text equals the eval fixture's `A` path" test (section 8.2) and
"every option has >= 1 line, no digits, no names". The ">= 20 words per non-final line" rule applies to the four
problem cards' **A and B** options.

Option labels (the picker chips, <= 40 chars):

| Card | A label | B label |
|---|---|---|
| opening (x3) | All steps done | Till count skipped |
| d1-c2 / d3-c3 | Bake went fine | Oven switched off mid-bake |
| d1-c3 / d2-c2 | Customer asks, buys anyway | Customer complains, leaves |
| display (x3) | Refilled | Not refilled |
| d2-c3 / d3-c2 | Order not read back | Order read back and written |
| closing (x3) | All closing steps done | A closing step skipped |

---

## 5. Path table: which choices produce what

Rules that decide it (all plain code, `ai-capabilities` F1): a category needs facts on **>= 2 distinct business
dates**; ROUTINE_OPS never counts; CUSTOMER_SERVICE auto-facts at >= 0.9; PHONE_CALL needs the staff **Yes** in that
day's debrief; COMPLAINT and DISRUPTION need the staff Yes **and** a supervisor confirm on that day's Day record
(`lib/day/confirm-service.ts:62-66`: the confirm is only possible once the question is **answered**; a skipped
question blocks the supervisor); at most 2 focus categories per Ask, "Ask for another" for the rest; a declined
focus "takes nothing" and is retried on the next Ask (`lib/proposals/service.ts:608-618`).

| Story | Choices | What becomes evidence | Proposal | Judge sees |
|---|---|---|---|---|
| Customer, mild | d1-c3 **A** + d2-c2 **A** | 2 CUSTOMER_SERVICE facts (auto) | **Yes**: `add_record_step` (write the bake time) — today's proposal A | watch row "2 of 2 days", Ask -> proposal |
| Customer, complaint | d1-c3 **B** + d2-c2 **B**, Yes in both debriefs, supervisor confirms both notes | 2 COMPLAINT facts (supervisor_confirmed) | **Yes**: likely `add_failure_path` (no fresher tray / cannot say bake time) or `add_script`; eval decides which is stable | debrief question each evening, "Needs your check" pill on both Day records |
| Customer, mixed | d1-c3 A + d2-c2 B (or B then A) | 1 CS + 1 COMPLAINT | **No** (floor fails: one date each) | watch rows "1 of 2 days" twice. Safety net: on the Day record the supervisor can **Change category** of the COMPLAINT thread to Customer service -> it becomes a supervisor-confirmed CS fact -> 2 CS dates -> proposal. The reverse (changing the CS auto-fact) is **not** possible: an auto-fact with no question is not reviewable (`confirm-service.ts:59-66`). |
| Phone, not read back | d2-c3 **A** + d3-c2 **A**, Yes both | 2 PHONE_CALL facts | **Yes**: `add_record_step` (read back + slip) — today's proposal B | |
| Phone, done properly | d2-c3 **B** + d3-c2 **B**, Yes both | 2 PHONE_CALL facts with no gap | **Expected no**: the model answers `no_proposal / no_clear_pattern` (rule 8). Must be proven by the new eval case `phone_ok` (section 8.3). If the model proposes anyway, that is a defect of the story, not of the code, and the fallback is to drop the PHONE B hint to "may or may not" (not acceptable) or rewrite B | "Bee6 found no clear pattern" (suppressed doc). Costs one of the two focus slots per Ask while it stays READY. |
| Phone, mixed | A + B (either order) | 2 PHONE_CALL facts, one gap | **Expected no** (one slip is not a pattern); eval case `phone_mixed` | |
| Oven | d1-c2 **B** + d3-c3 **B**, Yes both, supervisor confirms both | 2 DISRUPTION facts (days 1 and 3; the gap on day 2 is fine) | **Yes**: `add_failure_path` on `bake-01` | tier-0 question first in the debrief; "Needs your check" on day 1 and day 3 records |
| Any routine B | any | nothing (ROUTINE_OPS) | **No** | the hint says so; nothing else changes |
| Everything A | | CS + PHONE | 2 proposals (today's journey) | unchanged |
| Everything B | | COMPLAINT + DISRUPTION (+ PHONE no-gap) | 2 proposals, both needing 4 supervisor confirms in total; PHONE declines | |
| Max variety | customer A+A, phone A+A, oven B+B | CS, PHONE, DISRUPTION | 3 proposals over Ask + Ask for another (cap 8 generates per sandbox is enough) | the Home card must stop saying "both proposals" (section 6.4) |

Debrief load check (cap 5 questions/day): all-B day 1 = DISRUPTION + COMPLAINT (2); day 2 = COMPLAINT + PHONE (2);
day 3 = PHONE + DISRUPTION (2). Fine.

Supervisor tap count, all-B: 4 confirms (d1 x2 at stage 2; d2 and d3 after day 3, before Ask). Adds ~2 min to the
20-min journey. The guide must send the supervisor to the Day records *before* Ask (section 6.2).

---

## 6. The judge journey for the complaint path (B on d1-c3 and d2-c2), screen by screen

1. `/capture` listening, card 3 of 5: picker shows A/B; judge taps **B · Customer complains, leaves**; reads the 3
   lines; hint under them: "Bee6 will ask you about this complaint tonight. Pick B again on day 2 and confirm it as
   Supervisor to see a proposal." Taps "I have spoken this". *(changes: ScriptCard; copy 7.1)*
2. Jump to closing, End today: unchanged.
3. Debrief: "Bee6 heard what sounded like a customer complaint. It needs your answer to be sure." + 2 heard lines.
   Judge answers **Yes**, types a reason ("the tart was not fresh and I could not say when it was baked").
   *(changes: the `debrief_question` guide tip no longer dictates the phone-order reason; copy 7.2)*
4. Day 1 done -> sign out -> Supervisor: Day record shows the complaint thread with the **"Needs your check"** pill
   and Confirm / Change category / Reject. Judge taps Confirm. *(no change on the page; guide `day` card todo row 1
   already says "Confirm the note that needs your check")*
5. Proposals (waiting): watch panel shows COMPLAINT "1 of 2 days" (server row). *(change: placeholders, 6.4)*
6. Days 2-3 as staff: card d2-c2 B again (hint: "Pick B again today..." or, with S2b, "Yesterday you chose B here.
   B again makes it a repeated problem."). Debrief Yes again.
7. After day 3, as Supervisor: **new guide line on `proposals_ready`**: "Before you ask: open the Day record of each
   day and confirm every note marked Needs your check. Bee6 only counts confirmed notes." Judge confirms day 2's
   complaint. *(change: guide copy 7.4; the `day` card todo gains "for each day")*
8. Ask Bee6 -> proposal on COMPLAINT -> Feasible -> Owner approves -> SOP v2. Unchanged screens.

Screens / cards that must change (complete list):

| Where | Change |
|---|---|
| `app/demo/JudgeGuide.tsx` `ScriptCard`, `RereadLast` | picker, hint, locked choice, re-read of the chosen option |
| `lib/demo/guide.ts` `capture_listening` footnote | add "Choose A or B, then read it" (7.1) |
| `lib/demo/guide.ts` `debrief_question` (base and day-3 variant) | generic tip (7.2) |
| `lib/demo/guide.ts` `day` todo | "Confirm every note marked Needs your check (each day)" |
| `lib/demo/guide.ts` `proposals_waiting`, `proposals_ready` | the "confirm first" line (7.4) |
| `lib/demo/guide.ts` `home`, `approvals` todo | count-agnostic ("every proposal", "each proposal") instead of "both"/"#1/#2"; `todoDoneCount` for `home` uses `feasible >= proposals_with_content` instead of `>= 2` |
| `app/proposals/watch-placeholders.ts` | with `bakery-v3`: no pre-drawn rows (server rows only) **or** four placeholders (CS, PHONE, COMPLAINT, DISRUPTION) — Rangga's call (Q4). My pick: none; the empty state already exists for the pilot |
| `lib/i18n/v2/*` | new keys for the picker and the hint prefix (7.1) |
| README / deck | the honesty sentence (section 2) |

Nothing changes on `/day`, `/proposals` detail, `/approvals`, `/sop`, `/reviews`, the debrief screens or any API.

---

## 7. Copy (EN final; ID provisional = developer's draft, Tiffany reviews)

### 7.1 Picker and hint (new dict keys, `lib/i18n/v2/journey.ts` or wherever `C-journey-*` live)

| Key | EN |
|---|---|
| `C-journey-opt-group` | Choose what to say |
| `C-journey-opt-a` | Option A |
| `C-journey-opt-b` | Option B |
| `C-journey-opt-locked` | You read option {opt}. |
| `C-journey-opt-next` | What Bee6 does with this |
| `capture_listening.footnote` | Choose A or B, then read it word for word. You play every voice; the speaker name is not spoken. Pause about 2 seconds between speakers. |

Hints per option (`options.X.hint`, <= 220 chars, plain words, no category codes):

| Card | A hint | B hint |
|---|---|---|
| openings, displays, closings | Routine work. Bee6 notes it and moves on: no question, no proposal. | Still routine work to Bee6. A skipped step on its own is not evidence: no question, no proposal. |
| d1-c2 | Routine work. No question, no proposal. | Bee6 will ask about this tonight and a Supervisor must confirm it. If the oven fails again on day 3 (option B there), Bee6 proposes a fallback step. |
| d3-c3 | Routine work. No question, no proposal. | If the oven also failed on day 1 (option B), confirm both as Supervisor and Bee6 proposes a fallback step. On its own: no proposal. |
| d1-c3 | Bee6 notes a customer question staff could not answer. Pick A again on day 2 and Bee6 proposes a change. | Bee6 will ask you about this complaint tonight; a Supervisor must confirm it. Pick B again on day 2 to see a proposal. A today and B tomorrow are two different things to Bee6: no proposal. |
| d2-c2 | Same as day 1 option A? Bee6 now has the same gap on two days: a proposal is ready. Chose B yesterday? Then this is one of each: no proposal. | Same as day 1 option B? Answer Yes tonight and confirm both as Supervisor: a proposal is ready. Chose A yesterday? One of each: no proposal (a Supervisor can still change this note's category). |
| d2-c3 | Bee6 asks about every phone call tonight. Answer Yes. Pick A again on day 3 and Bee6 proposes a change. | Bee6 asks about every phone call tonight. Answer Yes. An order read back correctly is not a problem: no proposal, even if you pick B again. |
| d3-c2 | Same as day 2 option A, answered Yes both nights: a proposal is ready. Otherwise one slip is not a pattern: no proposal. | A call handled correctly. With A on day 2: one slip is not a pattern. With B on day 2: nothing to fix. No proposal either way. |

With S2b (remembered choice) the d2/d3 hints drop the "Chose X yesterday?" halves and show one line:
"Yesterday you chose {opt} here." above the hint.

### 7.2 Debrief tip (`debrief_question`, replaces the phone-order sentence; also removes coupling row 9)

Body line 1: "Answer what really happened in the lines you read today. Yes means it happened; No means it did not.
Where a question asks why, type a few words about what went wrong, or that nothing did."
Day 1 variant: identical (the day-1 override in `guideCard` can be dropped).

### 7.3 Day record card (`day` todo row 1)

"Confirm every note marked Needs your check, on each day's record"

### 7.4 Proposals cards

`proposals_waiting` todo row 4: "Confirm any Needs-your-check notes, then come back and ask for a proposal".
`proposals_ready` body, new first line: "If a Day record still shows a note marked Needs your check, confirm it
first: Bee6 only counts confirmed notes." (keep the existing two lines after it.)
`proposals_ready` title unchanged. Honest empty outcome already exists ("no clear pattern" suppressed wording).

### 7.5 Home and approvals (count-agnostic)

`home` todo: "Supervisor marked every proposal feasible" · "Open Approvals and review in order" · "Approve or reject
each proposal". `approvals` todo: "Review each proposal, then approve or reject it" · "Open SOP and see the new
versions" (todo min is 2, so two rows are fine).

---

## 8. De-tuning the prompts and proving the paths (eval)

### 8.1 Prompt / config changes (small, but **every one is a last-day-class risk** and is gated by 8.3)

| File | Today | Change |
|---|---|---|
| `config/interventions.yaml` `add_record_step.when_to_use` | "for example not knowing when a tray was baked, or an order taken by phone not read back or noted" | "for example staff unable to say when an item was made, or details agreed with a customer or supplier that were never written down". `version: 3`. Keep the id. |
| `lib/pipeline/label/prompt.ts:54-57` threading example | "after a phone call: 'that was a phone order, I did not read it back'" | "for example a remark right after a call or a customer about what was just agreed, done or forgotten". Pilot-facing: every label call. |
| `lib/proposals/prompt.ts:40-41` and `lib/proposals/v4/prompt.ts:41-42` rule 9 example | "say 'order details and pickup time'" | "describe the record by its content (what was agreed, how much, when), never by the person". |
| `config/categories.draft.yaml` `examples` | all `TODO` (skipped) | **Not in this task** (Tiffany copy; ai-capabilities 3.5 item 2). Leaving them out keeps the label prompt byte-identical except the threading line. |

Recommendation: do 8.1 **only together with** a green 8.3 run on both the A path (regression) and the B paths, in one
PR (S5), after the data/UI slices are merged. If the schedule does not allow the eval, ship the variants with the
prompts **unchanged** and keep the honesty sentence of ai-capabilities 3.2 as is. Never change a prompt on the day of a
judge session.

### 8.2 Eval fixture `scripts/eval-fixtures/scenario-v3.ts` (replaces v2's role; v2 file stays until S5 deletes it)

- Rename v2's wording dimension: `VariantId` (`exact | v1 | v2 | v3 | v4`) -> `WordingId` (`exact | paraphrase |
  fillers | reordered | improvised`) to stop the "variant" clash with A/B.
- New shape: `ScenarioCardV3 = { id, kind, lines }` where `kind` becomes an explicit expectation:
  `{ category: WorkCategory; verdict: "fact" | "question"; evidence: boolean }` plus `one_thread: true` for multi-line
  cards. `ScenarioDayV3 = { day, paths: Record<PathId, Record<WordingId, readonly ScenarioCardV3[]>> }` with
  `PathId = "A" | "B"` (per-card mixes are built by the harness from the two, not written by hand).
- `lib/demo/script.test.ts` asserts `SCRIPT_V3[day][i].options.A.lines == paths.A.exact[i].lines` and the same for B.
- Wording for B: `exact` (section 4) plus `paraphrase` and `fillers` for the **six** non-routine B cards only
  (d1-c2, d1-c3, d2-c2, d2-c3, d3-c2, d3-c3); routine B cards get `exact` only (drift there is harmless by design,
  but the harness still checks they never land in an evidence category).

### 8.3 `npm run eval:scenario` extensions and pass bar

- Flags: `--paths A,B,mixAB` (default all three). `mixAB` = A on d1-c3 / B on d2-c2 / A on d2-c3 / B on d3-c2 /
  B on d1-c2 / A on d3-c3 (the awkward mix), to prove no cross-contamination.
- Per cell (day x path x wording x uniting x 5 runs), **PASS requires**:
  - each card's majority thread category == the fixture's expected category, and `verdict` as expected: **5/5** on
    `exact`, **>= 4/5** on `paraphrase` / `fillers` (same bar as today's A cards had in practice: 15/15, 9/9);
  - every multi-line problem card `one_thread` 5/5 on exact;
  - routine cards (A or B) never CUSTOMER_SERVICE / PHONE_CALL / COMPLAINT / DISRUPTION (contamination, as today);
  - DISRUPTION B cards never SAFETY_INCIDENT / SECURITY_INCIDENT (new drift check);
  - COMPLAINT B cards never CUSTOMER_SERVICE (the one drift that silently changes the path);
  - <= 5 questions per day.
- Cost: today's run = 3 days x 5 wordings x 2 unitings x 5 runs = 150 flash-lite calls. v3 = A path as today (150) +
  B path 3 days x 3 wordings x 2 x 5 = 90 + mixAB 3 x 1 x 2 x 5 = 30 -> **~270 label calls, ~10-15 min at
  concurrency 3**, a few cents. The latency tail (~5 % slow calls) only lengthens the run.

### 8.4 `npm run eval:proposal` new cases (offline fixture rows in `lib/proposals/testing/rehearsal-fixture.ts`)

| Case | Rows | Expected |
|---|---|---|
| `complaint_pair` | 2 COMPLAINT supervisor-confirmed facts, days 1-2, summaries + excerpts from section 4 B lines, staff notes "tart not fresh, could not say bake time" | propose; intervention in {`add_failure_path`, `add_script`, `add_record_step`}; cites both; 3/3 |
| `disruption_pair` | 2 DISRUPTION facts, days 1 and 3 | propose; `add_failure_path`; step `bake-01` or NEW; 3/3 |
| `phone_ok_pair` | 2 PHONE_CALL facts, read back + slip, notes "read it back" | **decline** `no_clear_pattern` 3/3 |
| `phone_mixed` | day-2 A row (today's `phoneDay2`) + a clean day-3 row | decline 3/3 (a 2/3 here is a yellow flag: rewrite the clean line to be more explicit, not the prompt) |
| `cs_complaint_mixed` | 1 CS + 1 COMPLAINT | offline only: `evidenceByCategory` says not ready (no model call) |

Cost: 5 cases x 3 runs x 1-2 calls = ~25 flash calls. Run with `--texts` once and read the proposals by eye (no
names, no dates, no quoted story in the SOP text).

### 8.5 QA live rehearsal (Playwright + fake microphone, as rounds 1-3)

- New clips: 15 B WAVs (`private/rehearsal/b/d{d}-c{n}.wav`), made the same way as the A set (QA's TTS pipeline; the
  repo never holds them). ~1 h.
- Sandboxes (3 x 3 days, one persistent profile each; IP cap 30/day is fine):
  1. **all-A**: regression; expect today's 2 proposals (CS, PHONE).
  2. **all-B**: expect 2 questions per debrief, 4 supervisor confirms, Ask -> COMPLAINT proposal, Ask for another ->
     DISRUPTION proposal, PHONE suppressed `no_clear_pattern` somewhere in the two Asks; owner approves both.
  3. **mixed**: customer A/B, phone A/A, oven B/B -> PHONE proposal + DISRUPTION proposal; then the safety net:
     Change category of the day-2 COMPLAINT to Customer service -> third proposal on "Ask for another".
- Gemini calls: per sandbox ~15 transcribe + ~8 label + ~2-3 proposal = ~26; **~80 calls total**, well inside
  `SEGMENT_PER_SANDBOX` 150 / `GENERATE_PER_SANDBOX` 8. Wall time ~25 min per sandbox driven by the harness, ~1.5 h
  with the write-up. Zero tolerance applies: any wrong label on an `exact` B card is DO-NOT-SHIP for `bakery-v3`
  (the flag stays `bakery-v2`).

---

## 9. PR slices, ordering, routing

| # | Slice | Files | Who | Est. |
|---|---|---|---|---|
| S1 | Script data model + 30 lines + derived v2 + tests + import-boundary test + `scenario-v3.ts` fixture (A/B exact) | `lib/demo/script.ts`, `script.test.ts`, `scripts/eval-fixtures/scenario-v3.ts`, `app/demo/import-boundaries.test.ts` | `developer` (judgement on wording lives in this plan; the shapes are exact) | 3 h |
| S2 | Flag + contract + picker UI + storage + hints | `lib/capture/contract.ts`, `lib/demo/service.ts` (or wherever the profile literal is set), `app/demo/JudgeGuide.tsx`, `lib/demo/guide.ts` (`capture_listening`), `lib/i18n/v2/*`, tests (`JudgeGuide.test.tsx`: default A, switch, lock after mark, re-read shows chosen, v2 id hides picker) | `developer`; `uiux` 1 h on the control at 360 px | 5 h |
| S2b | Remembered choice (localStorage) + "Yesterday you chose" line + reset clears it | `JudgeGuide.tsx`, `ResetDemoButton.tsx` | `developer-junior` | 1 h (optional) |
| S3 | Guide copy generalisation (7.2-7.5), `todoDoneCount` change, watch placeholders per Q4 | `lib/demo/guide.ts`, `guide.test.ts`, `app/proposals/watch-placeholders.ts` + test | `developer-junior` | 2 h |
| S4 | Eval harness: `--paths`, wording rename, B wordings, new checks; `eval:proposal` cases | `scripts/eval-scenario.ts`, `scripts/eval-fixtures/scenario-v3.ts`, `scripts/eval-proposal.ts`, `lib/proposals/testing/rehearsal-fixture.ts` | `developer` | 4 h + 1 h run |
| S5 | Prompt/config de-tuning (8.1) **gated by a green S4 run before and after** | `config/interventions.yaml`, `lib/pipeline/label/prompt.ts`, `lib/proposals/prompt.ts`, `lib/proposals/v4/prompt.ts`, prompt tests | `developer`; tech-lead review mandatory | 2 h + 1 h run |
| S6 | QA live rehearsal (8.5) on `web-develop` with `DEMO_SCRIPT_ID=bakery-v3`; README honesty line; CLAUDE.md section 6 env | `qa`, `dev-ops` (env on staging) | 3 h |

Order: S1 -> S2 -> S3 (S2b any time after S2) -> S4 -> S5 -> S6. S1-S3 can merge to `develop` with the flag unset:
`web-develop` and `web` keep today's guide. Nothing goes to `web` before S6 is SHIP and Rangga sets the env.

Total: ~17 h build + ~2 h eval runs + ~3 h QA; roughly two working days for one engineer with agents, not a
submission-day item (submission is today, 18 Oct; the freeze is in force).

---

## 10. Risks (with blast radius)

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| Label drift on a B card (COMPLAINT -> CUSTOMER_SERVICE; DISRUPTION -> ROUTINE_OPS or SAFETY) | medium (one flip in ~12 real clips on record) | the judge's story silently changes path; the hint becomes a lie | 8.3 bar 5/5 exact; the supervisor's Change category safety net for question-backed threads; hints never promise more than "Bee6 proposes" after a confirmed pair |
| Model proposes on `phone_ok_pair` | low-medium | "a shop doing it right" still gets a proposal, contradicting the hint | 8.4 case 3/3 decline; if it fails, rewrite the B line (more explicit "confirmed, written") before touching the prompt |
| Prompt de-tuning (S5) regresses the A path | low | every judge journey | S5 is its own PR, run the full eval before and after, revert = one PR |
| Judge skips a COMPLAINT/DISRUPTION question | medium | supervisor confirm impossible (`not_reviewable`); the path dies silently | the B hint says "answer Yes tonight"; the Jump-to-tomorrow unanswered confirm already warns; add nothing else |
| Declining PHONE focus eats one of 2 focus slots per Ask | certain on B+B phone | one extra "Ask for another" tap | GENERATE_PER_SANDBOX 8 is enough; document in the hint ("no proposal either way") |
| Supervisor forgets the day-2/3 confirms before Ask | medium | "no clear pattern" / floor not ready on a path the hint promised | 7.4 line on `proposals_ready`; QA path 2 verifies |
| Stale tab across the env switch | low | picker appears mid-day, A selected | contract enum, not literal (3.2) |
| `web` differs from `develop` (`main` lacks #122-#125 and all of this) | certain | release risk compounds | this ships with the next release train, never alone |

---

## 11. Review "after" data (interface only; separate design)

The review stage is plain code (`lib/reviews/metric.ts` counts facts of the metric category per captured day in
`[effective_from_date, review_date - 1]`). For a day-4/5 clip the variant model needs nothing new: a `ScriptDay` of
`4 | 5` with cards whose A = "the change worked" (no fact in the metric category) and B = "the problem persists"
(a fact). What *does* need design: `lib/demo/next-day.ts` G6 blocks the shift once a proposal has content, and the
shift moves data backwards (no clock), so "after" days would have to be captured on real later dates or the review
window computed differently on sandboxes. Out of scope here; the script schema regex `d[1-3]` is the only thing in
this plan that would widen (`d[1-5]`).

---

## 12. Assumptions I made

1. Judging happens after today's submission on a date that leaves >= 2 working days; otherwise only S1-S3 (flag
   off) are worth starting now.
2. A judge reads one option per card (the picker does not allow "read both"); reading both would double the lines
   and is harmless to the server but the hints assume one.
3. The B wordings in section 4 are mine; Rangga may edit them, but any edit re-runs 8.3 for that card.
4. The TTS clip pipeline used in rounds 1-3 is available to QA for the 15 B clips.
5. The watch panel has an acceptable empty state without placeholders (it does on the pilot).
6. `toCaptureConfig` sets `script_id` from `FRESH_DEMO_SESSION` (grep found no other literal); S2 confirms.

---

## 13. Questions for Rangga (answer before S1)

1. **Go/no-go on timing**: build S1-S3 now behind the flag, S4-S6 after submission? Or everything after submission?
2. **DISRUPTION path (oven on d1-c2 / d3-c3)**: keep it (a third proposal type, two more supervisor confirms) or make
   those two B options plain routine ("the bake is late")? My recommendation: keep; it is the only "service
   incident" the existing categories allow and it costs no code.
3. **PHONE B = "done properly" (expected no proposal)**: agree? Alternative = a different phone problem, which would
   give a second phone proposal but fights rule 9 (no customer details) and adds drift risk. My recommendation: keep
   "done properly"; it is the clearest demonstration of goal (2).
4. **Watch placeholders with `bakery-v3`**: none (server rows only) or four pre-drawn rows? My pick: none.
5. **S2b remembered choice** ("Yesterday you chose B here"): worth 1 h? My pick: yes, it halves the hint length.
6. **Prompt de-tuning (S5)**: do it (honesty) or leave the three examples and keep the ai-capabilities 3.2 sentence?
   My pick: do it, but only with the eval before/after; it is the one slice that touches the pilot's label prompt.
7. **Hint wording**: may the hints name "Supervisor must confirm" and "proposal" (they do above), or should they stay
   vaguer ("Bee6 may propose a change")? I wrote them precise; precise hints are only honest if 8.3 is green.
8. Owner of the 15 B clips for QA (QA's TTS, or Rangga/Tiffany voice)?
