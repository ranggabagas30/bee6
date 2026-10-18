# Day-2 debrief shows 1 question: is that correct? (tech-lead, 17 Oct, read-only; code = `origin/develop` 09365e6)

## Answer first

**Yes. One question on day 2 is the designed happy path, not a bug** — provided that one question is the
phone-call one ("Around HH:MM there was a phone call. Is that right?"). Day 2 of the `bakery-v2` script has
exactly one moment that can never be an automatic fact (card d2-c3, PHONE_CALL, `ALWAYS_QUESTION`). Every other
day-2 card (3 routine cards → ROUTINE_OPS, card d2-c2 → CUSTOMER_SERVICE) becomes a **fact** when the label
model's confidence is ≥ 0.9 and it cites ≥ 1 evidence line, and so asks nothing. There is no minimum question
count, no carried day-1 question (`CARRY_OVER_MAX = 0`, and the jump expires day 1's open questions), and day 2
does not change thresholds, windowing or the gate.

Expected range on day 2: **1 (happy path) to 5 (phone cap)**. QA's recorded rehearsals agree: round 3 (16 Oct)
logged "one debrief question per phone day, 5/5 phone days" and the 15 Oct live run logged "day 2: one question,
then complete".

It would be a bug if: (a) day 2 showed **0** questions (phone call missed or labelled as something else), or
(b) the single question is not the phone call (then the PHONE_CALL thread was lost and some other thread failed
the gate instead). Check the supervisor Day record for day 2: expect a ROUTINE_OPS fact (1-3 threads), a
CUSTOMER_SERVICE fact, and one PHONE_CALL row that reads "Fact, confirmed by staff" after Yes.

## 1. How many questions per day, and what makes a question (verified in code)

| Rule | Where |
|---|---|
| **One `gate` question per thread** whose gate verdict is `question`; id `q_thread_{thread_id}` (structural dedupe: a thread can never own two questions). | `lib/pipeline/tick/service.ts:405-418`, `lib/pipeline/question-ids.ts:6-8` |
| **One `unlabelled_unit` question per label unit** whose model call failed validation/retries (the "failure becomes a question" rule). | `lib/pipeline/tick/service.ts:296-327`, `:449-497` |
| A thread continued across units keeps its existing question and stays `open` (never promoted to fact by a merge). | `lib/pipeline/tick/service.ts:359-369` |
| **Gate v1 rules, in precedence**: `invalid_label` → `label_conflict` → `always_question` (PHONE_CALL only) → `needs_supervisor_confirm` (COMPLAINT, CORRECTION, SAFETY_INCIDENT, SECURITY_INCIDENT, DISRUPTION) → `no_evidence` (< 1 cited line) → `below_threshold` (confidence < 0.9, every category) → `passed` = fact. | `lib/pipeline/gate.ts:167-174, 213-232`; sets and thresholds `lib/pipeline/categories.ts:36-50, 85-98` |
| So on `bakery-v2` only PHONE_CALL is *guaranteed* a question; ROUTINE_OPS and CUSTOMER_SERVICE are facts unless confidence < 0.9, no evidence, or a label conflict. | spec: `docs/specs/pipeline-and-agents.md` T-306 (line 233); `docs/tasks/R-19-demo-v2.md` §A.1 |
| **Caps**: server returns ≤ 10 (`DEBRIEF_LIST_SERVER_CAP`), phone shows ≤ 5 per debrief (`DEBRIEF_SHOW_MAX`). **No minimum.** Zero open questions renders "No questions today". | `lib/debrief/constants.ts:20-23`, `lib/debrief/rank.ts:36`; tech spec §8.10 ("at most 5 of this device's open questions") |
| **Ordering**: tier 0 incidents (SAFETY/SECURITY/DISRUPTION) → tier 1 other evidence-eligible gate questions (PHONE_CALL, CUSTOMER_SERVICE, …) → tier 2 ROUTINE_OPS and `unlabelled_unit`; then oldest `window_start_ms`, then id. | `lib/debrief/rank.ts:11-37` |
| **Listing scope**: only `status == "open"` questions of **this device**, only while this device's `debrief_ends_at_ms` is in the future. | `lib/debrief/service.ts:73-80, 104-107` |
| **Thread merging** (why 5 cards ≠ 5 questions): lines join one thread when the model links them and, across units, when the category matches and the gap ≤ `GRACE_MS` (2 min for ROUTINE_OPS / CUSTOMER_SERVICE / PHONE_CALL). A 3-minute day read at script pace typically collapses the three routine cards into 1-2 ROUTINE_OPS threads. | `lib/pipeline/threads.ts:92-106, 263-290`; `lib/pipeline/categories.ts:60-74` |
| Windowing: close on 90 s silence or 6 min cap; windows with no text make no call. | `lib/pipeline/windowing.ts:3-7, 59-63`; T-302 |

**Carried questions from day 1 — none, by design.**
- `CARRY_OVER_MAX = 0` (`lib/demo/constants.ts:21`), so `cloneTemplate` reopens nothing: every template
  question stays `unverified` (`lib/demo/clone.ts:239-248, 314-325`; R-19 §6.4). The clone's expired
  `last_ended` is only there so Start is offered at sign-in.
- "Jump to tomorrow" shifts data one day back and then calls `expireOpenQuestions(…, shifted debrief end)`, so any
  day-1 question still `open` (skipped, or created late) becomes `unverified` before day 2 starts
  (`lib/demo/next-day.ts:372-375`; R-19 §4.2 step 4: "so day 2's debrief never shows day-1 questions").
- The questions route then lists `open` only, so an `unverified` day-1 question cannot count toward day 2
  (`lib/debrief/service.ts:104`). The "Earlier day" chip code path exists but can only fire on a sandbox with a
  carried question, i.e. never now (`service.ts:87-90, 120`).

**What the judge is told to do** (`lib/demo/guide.ts:231-250`, R-19 §A): read the 5 cards word for word; the
`debrief_question` card on days 2-3 says "The phone order did happen, so answer Yes and type a few words why".
The day-1 variant of that card (`guide.ts:402-414`) deliberately does not mention a phone order because day 1
has none. R-19 §A.1 states the design: "Each day has 5 cards, so at most 5 work moments, so at most 5 debrief
questions"; §10.2 pass criterion: "debrief questions (count ≤ 5, PHONE_CALL present on days 2-3)";
`scripts/eval-scenario.ts:8-11, 305-306` asserts A (egg tart) lands as a **fact** in ≥ 60 % of runs, i.e. the
designed day-2 outcome is one question (B) most of the time.

## 2. Day-2 specifics (verified)

- **Day 2 changes nothing in the pipeline.** The next-day shift is "time only: no label, summary, line text,
  category, confidence, gate decision or fact status changes" (`lib/demo/next-day.ts:24-25`). The tick, gate,
  thresholds and windowing never read `next_day_count` or the day number. Thresholds are static constants.
- **No "deviation from SOP" or "repeats" logic in the gate.** The gate is per thread, plain code, and does not
  compare against the SOP. Repetition only matters later, at the **proposal** stage (per-category day floor:
  A needs 2 days, B needs 2 days — R-19 §A.1, §3.2), which is why nothing is proposable after day 1.
- **Day-1 history cannot influence day 2's gate.** The only cross-unit memory is the open-thread pool, which
  offers a stored thread for continuation only when the gap from its `last_line_end_ms` to the unit's first
  line is within that category's grace (≤ 10 min max; `lib/pipeline/threads.ts:370-380`,
  `lib/pipeline/tick/service.ts:63, 262-264`). After the shift, day-1 threads sit ≥ 1 day back, so they are
  never offered. Template threads (routine-only, R-19 §A.5) are facts/unverified and are likewise out of range.
- The demo `preparing` flag (`lib/debrief/preparing.ts`, R-19 §6.2) only delays the list while unlabelled text
  lines remain; it never adds or removes questions.

## 3. Plausibility verdict

| Observation | Reading |
|---|---|
| 1 question, and it is "phone call" | **Correct.** Routine + egg-tart threads passed the gate as facts (confidence ≥ 0.9, evidence cited). This is the intended demo path and matches QA round 3 (`docs/tasks/QA-live-rehearsal-16oct-round3.md:47`) and 15 Oct (`QA-live-rehearsal-15oct.md:61`). |
| 2 questions (phone call + egg tart or + routine) | Also correct: that thread scored < 0.9 or cited no evidence (gate `below_threshold` / `no_evidence`). Yes in the debrief turns it into a fact (`staff_confirmed`). Before the R-21 card rewrite, round 2 saw 2 (PHONE_CALL + a split CORRECTION) — that split is what R-21 removed. |
| 1 question but it is *not* the phone call | **Investigate.** The PHONE_CALL thread was lost or mislabelled (contamination). Check the day-2 threads on the Day record; the safety net is the supervisor "Change label" (R-19 §10.3). |
| 0 questions on day 2 | **Investigate** the same way; PHONE_CALL can never be an auto-fact, so 0 means the phone card was not heard or not labelled PHONE_CALL. |
| "Between HH:MM and HH:MM there was work going on" | An `unlabelled_unit` question = a label call failed after retries; not a cap/dedupe issue, check tick logs. |

Not a bug candidate in any of these: there is no cap of 1 anywhere (`DEBRIEF_SHOW_MAX = 5`), dedupe is
one-question-per-thread by id (cannot collapse two threads), and ROUTINE_OPS questions are ranked last but never
dropped below the 10/5 caps.

## Verified vs inferred

- **Verified in code/spec:** everything in §1-§2 (file:line cited); the QA counts quoted from the task docs.
- **Inferred (not visible from here):** that Rangga's single question was the phone-call one, and that the
  egg-tart and routine threads were facts on his run — only the sandbox's Day record or the thread docs show that.
