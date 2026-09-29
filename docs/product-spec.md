# Product spec: SOP Improvement Agent

## 1. The product in one sentence
A system that holds a small F&B outlet's SOP as a machine-checkable spec, listens to the day, asks staff *why* gaps happened, and proposes versioned SOP improvements that a supervisor and the owner approve, then checks on a scheduled date whether the change worked.

It is not a transcription tool, not a checklist app, and not an SOP writer. It is a **closed improvement loop**: the model stays frozen; the outlet's procedure improves.

## 2. The loop
Listen (ambient, no button) → **Day record** (one timeline) → **Ask why** (evening debrief, ≤ 5 questions, Bahasa Indonesia) → **Pattern + cause** → **Propose** (intervention from the library + rubric criterion + ≥ 2 dated evidence items + known constraints) → **Supervisor check** (feasible? reason required on rejection) → **Owner approves** (cost and brand) → **Ship SOP vN+1** (metric, failure condition, review date) → **Review on date** (worked / revise / revert) → **Outcome memory**.
- The new SOP version is the spec the next day is judged against.
- Outcome memory and rejection reasons feed future proposals.

Hackathon scope: the ambient lane only (photo evidence and reminder lanes come later).

## 3. Rules that shape the code
- **Capture is ambient.** Nobody starts or stops recording. The only taps are the evening debrief answers.
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

Every label also carries `confidence` and a `runner_up` category with the reason it lost (shown in the English judge panel).

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
| Uncertain labels (debrief questions) | Staff answer about their own episodes; supervisors can answer any and override | Daily at close, ≤ 5 questions | Expire "unverified" after 7 days; never become facts |
| Proposals | Supervisor, then owner | As they come (target within a day) | Stay pending; archived after ~14 days |
| Shipped change at review date | Supervisor + owner | On the date (Cloud Scheduler) | Change stays; outcome "unknown", excluded from memory |

- Staff answers on COMPLAINT, CORRECTION and all Incidental threads become facts **only after a supervisor confirms**.
- Disagreements (staff vs model, supervisor vs staff) go to the supervisor queue and are counted separately.

## 7. Confidence and learning
- Models are usually **over**-confident. No category auto-accepts until a gold set exists and measured accuracy supports it.
- Gold set: 60–100 real episodes labelled by supervisors (a Google Sheet for the hackathon).
- Corrections are saved and reused as examples. No fine-tuning.

## 8. POS data (later in the hackathon, if time)
Own canonical `SalesEvent` schema; adapters convert any POS export into it (CSV first). Fields: `schema_version, outlet_id, source, adapter_version, receipt_id, line_no, occurred_at, item_sku, item_name, qty, status (sale|void|refund), ingested_at`. Idempotency key: `source + receipt_id + line_no`.

## 9. Privacy
- No voiceprints. Role comes from mic position and the staff list, not biometrics.
- Owner sees summaries; supervisors see evidence lines; staff see only their own questions.
- Never claim "fully safe". Wording: "Built on Google Cloud's enterprise data terms: paid tier, no training on customer data, audio discarded after transcription."
- DPIA under Indonesia's PP 33/2026 is the next priority after the hackathon.
