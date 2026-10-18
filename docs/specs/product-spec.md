# Product spec: SOP Improvement Agent

> **Reconciled 9 Oct 2026 (tech-lead).** Marked what is shipped versus planned against `docs/tasks/R-06.md` v3
> (day record, confirm / override, runner-up, unlabelled rows, questions queue, owner home: all planned, none built),
> made the debrief bilingual (English default), and aligned §9 with the owner facts-only decision (Rangga, 9 Oct)
> and CLAUDE.md §2 #7. Nothing in this file names a sign-in method or a go-live date, so the 9 Oct auth change
> (email + password, `docs/plan.md` §10 #37) needed no edit here.
>
> **Reconciled 4 Oct 2026 (tech-lead).** Session model and staff journey:
> `docs/specs/technical-specification.md` §8 (rules) and `docs/specs/web-backend-rbac.md` §6.6 (routes and
> data) are the source of truth and override this file. Changed here: capture is manual (Mulai/Selesai), the debrief follows Selesai or the auto-stop and lasts
> 1 h, questions expire per device at the debrief end, supervisors do not answer device questions.

## 1. The product in one sentence
A system that holds a small F&B outlet's SOP as a machine-checkable spec, listens to the day, asks staff *why* gaps happened, and proposes versioned SOP improvements that a supervisor and the owner approve, then checks on a scheduled date whether the change worked.

It is not a transcription tool, not a checklist app, and not an SOP writer. It is a **closed improvement loop**: the model stays frozen; the outlet's procedure improves.

## 2. The loop
Listen (staff tap Mulai, then ambient until Selesai or the auto-stop) → **Day record** (one timeline) → **Ask why** (1-hour debrief after Selesai or the auto-stop, ≤ 5 questions per device, English by default with a Bahasa Indonesia toggle) → **Pattern + cause** (an insight run a supervisor or owner starts over a date range; plain-code sufficiency check first; technical spec §7.9) → **Propose** (intervention from the library + rubric criterion + ≥ 2 dated evidence items + known constraints) → **Supervisor check** (feasible? reason required on rejection) → **Owner approves** (cost and brand) → **Ship SOP vN+1** (metric, failure condition, review date) → **Review on date** (worked / revise / revert) → **Outcome memory**.
- The new SOP version is the spec the next day is judged against.
- Outcome memory and rejection reasons feed future proposals.

Hackathon scope: the ambient lane only (photo evidence and reminder lanes come later).

## 3. Rules that shape the code
- **Capture is ambient between two taps.** Staff tap Mulai when work starts and Selesai when it ends (the hard auto-stop at close + 1 h is the only automatic stop; technical spec §8.3). Between them nobody touches the phone; the other taps are the debrief answers.
- **We don't keep recordings.** Transcribe, keep work notes, drop audio. Work vs private can only be decided *after* transcription; say it in that order.
- **A low-confidence fragment never becomes a fact.** It becomes a debrief question.
- **Proposals need evidence:** ≥ 1 rubric criterion **and** ≥ 2 dated evidence items, or no proposal (log the suppression).
- **Interventions come from an authored library:** change quantity/time, change trigger, add failure path, capture unmet request, shift schedule, add script. The model picks; it doesn't invent.
- **Unmet demand is censored:** an observed floor, never true demand. Proposals must say so.
- **Every shipped change has** a metric, a review date and a failure condition. Default is no change.
- **Rejection reasons become permanent constraints** (e.g., "the oven only holds 2.5 kg").
- **No fine-tuning.** Learning = outcome memory + constraints + library + corrected debrief answers used as few-shot examples.
- **Process, not person.** No per-person scores; questions are about the step ("was the 15:00 restock done?"), never "why didn't you…".
- **Not a sales tool.** No upselling or promotion coaching.

## 4. Windows and threads
- **Segments** (≤ 15 s of speech) are transcribed as they arrive.
- **Windows** group segments for reasoning: a window closes after ≥ 90 s of silence or at ~6 min (cut at a pause). Tiny windows (< 10 s) are batched every few minutes. Empty windows make no model call.
- **Incident keywords** (e.g., *kebakaran, api, maling, jatuh, luka, gas bocor*) skip the wait and are processed at once.
- **Threads = what happened.** The model outputs, per line, which earlier line it replies to; plain code builds threads as connected components. Every line belongs to exactly one thread (or is private). Threads can overlap in time.
- **Silence never closes a thread by itself.** Grace periods: Training ~10 min, Customer service ~2 min, Complaint ~5 min. A thread spanning windows keeps one label.
- Training threads < 10 min apart share a `training_session_id` (grouping only).

## 5. Categories: one per thread
Rule: the category is **what is happening**, not what is being talked about. Hypotheticals ("misalnya…", "kalau nanti…") and retellings never trigger incident or complaint categories.

| # | Category | Definition | Parent |
|---|---|---|---|
| 1 | ROUTINE_OPS | Everyday work: SOP steps, stock, handoffs, content work (`ops_type`) | Normal |
| 2 | CUSTOMER_SERVICE | Serving a customer who isn't dissatisfied (incl. `unmet_request`; `sale: false` for directions etc.) | Normal |
| 3 | TRAINING | Teaching by a supervisor/senior, or what-if discussion; nothing live being handled | Normal |
| 4 | STAFF_CONSULT | Staff asking how to handle a situation happening now | Normal |
| 5 | CORRECTION | Supervisor correcting a mistake just made (records the step, not the person) | Normal |
| 6 | PHONE_CALL | Staff on a phone call; one side audible → always a debrief question | Normal |
| 7 | EVENT | Work that exists only because of a planned event (`event_id`, `phase`) | Planned |
| 8 | COMPLAINT | Customer expressing dissatisfaction | Incidental |
| 9 | SAFETY_INCIDENT | Someone hurt or at risk, or staff find a product hazard | Incidental |
| 10 | SECURITY_INCIDENT | Possible theft/fraud/threat; never names a suspect; a human confirms | Incidental |
| 11 | DISRUPTION | Operations stopped by equipment, utility or outside event (`cause`) | Incidental |
| — | NON_WORK | Private talk: deleted, only counted | — |

**Decision order (first yes wins):** NON_WORK → SAFETY_INCIDENT → SECURITY_INCIDENT → DISRUPTION → COMPLAINT → EVENT → PHONE_CALL → CORRECTION → STAFF_CONSULT → TRAINING → CUSTOMER_SERVICE → ROUTINE_OPS.

**Fields (evidence, not categories):** `ops_type` (sop_step/stock/handoff/content) · `unmet_request` (item + reason: sold_out/not_on_menu/wrong_time/wrong_size) · `sale` · `complaint_type` (missing_item, wrong_item, foreign_object, spoiled, taste_texture, wait_time, price, attitude, unavailable) · `customer_request` (replacement/refund/apology/none) · `hazard_type` (burn/cut/slip/gas_fire/product) · `cause` (equipment/utility/natural/external) · `event_id` + `phase` · `extracted_rules` (TRAINING, CORRECTION, STAFF_CONSULT).

Every label also carries `confidence` and a `runner_up` category with the reason it lost (`why_not`, name-scrubbed and redacted before storage). Both are stored today (R-05b). **Planned, not yet built (R-06 Task 11):** the supervisor's day record shows the runner-up as a closed-by-default "Second choice" block on the thread card, hidden when it equals the thread's current category (after any staff or supervisor change). Owners never see it. R-06 marks it the first item to drop if its PR runs late.

Example:
```json
{"thread_id":"T1","category":"TRAINING","parent":"Normal","confidence":0.86,
 "evidence":[3,5],
 "runner_up":{"category":"CUSTOMER_SERVICE","why_not":"hypothetical framing, no customer"},
 "extracted_rules":["Other items may sell out; pastry must never sell out"]}
```

## 6. Review cadence
| What | Who | When | If skipped |
|---|---|---|---|
| Uncertain labels (debrief questions) | Whoever holds the paired device answers that device's questions (*Yes* / *No* + a required reason, or *Skip*); supervisors do not answer, they confirm or override on the thread side (planned, R-06 Task 10) | In the 1-hour debrief after Selesai or the auto-stop, ≤ 5 questions | Expire "unverified" at that device's debrief end; never become facts (technical spec §8.10) |
| Proposals (planned: R-08, R-09; insight runs P5) | Supervisor, then owner | After an insight run produces one (target: reviewed within a day) | Stay pending; archived after ~14 days |
| Shipped change at review date (planned: R-11) | Supervisor + owner | On the date (Cloud Scheduler) | Change stays; outcome "unknown", excluded from memory |

**Shipped today:** the debrief (questions, Yes / No + reason, Skip, per-device expiry) and the gate rule that
keeps staff answers on sensitive threads out of the facts. **Everything a supervisor or owner does is planned,
not yet built:** the day record, confirm / override and the queue (R-06), proposals and approvals (R-08, R-09).

- Staff answers on COMPLAINT, CORRECTION and all Incidental threads become facts **only after a supervisor
  confirms**. Today such a thread never becomes a fact (the gate never waives the supervisor check). **Planned
  (R-06 Task 10):** supervisor confirm / override, as a new gate input in plain code (hard rule #10). Proposed
  rule, awaiting Rangga (R-06 §12 Q-B): a supervisor can act only after the staff answered the thread's question,
  so a moment nobody answered in the debrief can never become a fact.
- Moments the labeller could not label at all become a debrief question about a time block ("Between HH:MM and
  HH:MM there was work. Is that right?"); that question is shipped. An answer is stored as a reason only and
  never becomes a fact. **Planned (R-06 Task 12):** these show as read-only rows on the supervisor's day record,
  never on the owner's.
- **Planned (R-06 Task 13):** a supervisor questions queue listing every answered debrief question of the last
  14 days whose thread is still open: *waiting for supervisor* (a complaint, correction or incident the staff
  confirmed), *answered*, and *rejected by staff* (staff said No to the model's label). The supervisor acts on
  them with confirm / override; overriding a staff answer is the supervisor-vs-staff case. There is **no
  supervisor reject action** in the plan (open, R-06 §12 Q-C): a row the supervisor thinks is wrong stays
  waiting, is never a fact, and sits in the queue until it ages out after 14 days. A separate count of
  disagreements is not in any current plan.
- Tech-lead recommends building Tasks 12 and 13 after submission (R-06 §10; Rangga to decide, R-06 §12 Q-E).

## 7. Confidence and learning
- Models are usually **over**-confident. No category auto-accepts until a gold set exists and measured accuracy supports it.
- Gold set: 60–100 real episodes labelled by supervisors (a Google Sheet for the hackathon).
- Corrections are saved and reused as examples. No fine-tuning.

## 8. POS data (later in the hackathon, if time)
Own canonical `SalesEvent` schema; adapters convert any POS export into it (CSV first). Fields: `schema_version, outlet_id, source, adapter_version, receipt_id, line_no, occurred_at, item_sku, item_name, qty, status (sale|void|refund), ingested_at`. Idempotency key: `source + receipt_id + line_no`.

## 9. Privacy
- No voiceprints. Role comes from mic position, not biometrics. The staff list is used only for the name scrub
  and the transcription vocabulary (CLAUDE.md §2 #7), never to work out who spoke.
- **Staff (shipped):** there is no staff sign-in; the paired phone shows only that device's debrief questions,
  which are role-agnostic. An answer stores the device id and timestamps only.
- **Supervisors (planned, R-06):** see the redacted evidence lines, "a staff member answered" (never who) and the
  runner-up; never a device id.
- **Owner (planned, R-06; decided by Rangga 9 Oct):** sees **confirmed facts only**, as summaries: no quoted
  lines, no question, answered, waiting, rejected or unverified rows, and no question count. A planned owner home
  (R-06 Task 14a, `/home`) shows "today in 5 lines" built from the same facts-only view. Tech-lead recommends it
  after submission and, until then, landing the owner on the R-09 approvals list (Rangga to decide, R-06 §12 Q-E
  and Q-G). Its proposals and review-date tiles depend on R-09 and R-11; a cost tile needs a usage ledger that
  does not exist yet (Q-F).
- Never claim "fully safe". Wording: "Built on Google Cloud's enterprise data terms: paid tier, no training on customer data, audio discarded after transcription."
- DPIA under Indonesia's PP 33/2026 is the next priority after the hackathon.
