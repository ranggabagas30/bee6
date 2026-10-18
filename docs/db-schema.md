# bee6 Firestore schema: ERD and collection reference

> **Status: point-in-time reference, not binding.** Generated on **11 Oct 2026** from `lib/firestore/schema.ts`
> and `lib/firestore/collections.ts` as they exist on **`origin/develop` @ `50a2301`** (R-08 merged, PR #33), plus
> the `lib/firestore/*-store.ts` query code on the same ref. **The real schema file is the source of truth and wins on
> any discrepancy.** If this page and `schema.ts` disagree, `schema.ts` is right and this page is stale.
>
> Which ref: the shared checkout is on an old branch (`feature/r-05b-label-call-pr2`) and `main` / `origin/main`
> (`31161e6`) carry an earlier subset (no full `proposals`, `constraints`, `sop_versions`, `proposal_locks` schemas,
> no `day-store` / `proposal-store` / `constraint-store`). `origin/develop` is the newest integrated state, so this
> page documents that. "Live today" below means "defined and written by code on `origin/develop`", not "deployed
> to the pilot".
>
> R-09's additions (`supervisor_review`, `owner_decision`, the `owner_rejection` constraint source) are **planned,
> not yet built** and are kept apart in §7.1.

Database: Cloud Firestore (Native mode), `asia-southeast2`. Two separate GCP projects with the same schema: pilot
(real shop data) and demo (fictional data only).
Domain: shop-floor speech → redacted work notes → evidence-gated facts / debrief questions → SOP change proposals
approved by supervisor then owner.

Contents: §1 conventions · §2 ERD · §3 collections (live) · §4 stub collections · §5 relationships · §5A sample
data trail (fictional, one document per collection) · §6 indexes and TTL · §7 planned, not yet built · §8 NoSQL
design rationale · §9 personal-data map · §10 quality checklist · §11 discrepancies noticed while generating this
page.

---

## 1. Conventions that apply to every collection

- **Every document carries `outlet_id`.** It is the tenant key. Browsers never touch Firestore (hard rule #6); every
  read and write goes through a server route that checks the caller's `outlet_id` and `role` claims first. Stores
  also re-check `outlet_id` on documents fetched by id and skip foreign ones.
- **Every schema is a strict zod object** (`.strict()`): an unknown key fails the parse. Several also carry a
  `superRefine` with cross-field invariants (noted per collection).
- **Two timestamp styles, on purpose.**
  - ISO 8601 strings (`created_at`, `received_at`, `ts`, ...) for admin/transport-facing fields.
  - Epoch milliseconds (`*_ms`) for pipeline-internal fields that are compared against other `_ms` values.
  - Exception: TTL fields (`segments.expires_at`, `corrections.expires_at`) are ISO strings in the domain type but
    written as **native Firestore `Timestamp`s** by the store layer, because Firestore TTL policies only act on
    native timestamps.
- **Document ids are deterministic composites**, not random, wherever idempotency matters (a re-upload or a
  replayed request lands on the same doc). Only `audit_log` uses auto ids.
- **Notation in the tables below:** `?` = key may be absent (zod `.optional()`); `| null` = key present, value may
  be null (zod `.nullable()`). Both together = `?` and `| null`.

---

## 2. Entity relationship diagram (Firestore collections)

Firestore has no foreign keys and no joins. Lines below are **logical references by shared id fields**, enforced
only by application code. `1 ── *` = one-to-many. Stub collections (§4) are omitted.

```
                                    ┌──────────────────────┐
                                    │ outlets              │
                                    │ PK doc id = outlet_id│
                                    └──────────┬───────────┘
                     every collection below has outlet_id (1 outlet ── * docs)
   ┌──────────────┬──────────────┬─────────────┼──────────────┬───────────────────┬──────────────────┐
   ▼              ▼              ▼             ▼              ▼                   ▼                  ▼
┌────────┐  ┌──────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────┐ ┌───────────┐
│ users  │  │ staff        │ │ devices  │ │ sop_versions │ │ constraints  │ │ proposal_locks│ │ audit_log │
│ owner/ │  │ ONLY place a │ │ shop     │ │ immutable    │ │ permanent    │ │ 1 per outlet  │ │ role-only │
│ superv.│  │ name lives   │ │ phone    │ │ v1, v2, ...  │ │ outlet rules │ └───────────────┘ │ actor     │
└────────┘  └──────────────┘ └────┬─────┘ └──────▲───────┘ └──────▲───────┘                   └───────────┘
  (no link to any                 │ device_id      │ generator.       │ source_proposal_id
   other collection)              │                │ sop_version_id   │ (iff a rejection)
                                  │                │                  │
        ┌────────────────┬────────┼──────────┬─────┴──────────┐       │
        ▼                ▼        ▼          ▼                │       │
 ┌─────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────┐     │
 │ heartbeats  │ │capture_      │ │ segments   │ │pipeline_locks│     │
 │ (subcoll.   │ │sessions      │ │ redacted   │ │1 per device  │     │
 │ of devices) │ │1 per Mulai   │ │ lines, 48h │ └──────────────┘     │
 └─────────────┘ └──────┬───────┘ │ TTL        │                      │
                        │session_id└─────┬──────┘                     │
                        └───────────────►│  line ids "<seg_id>#<n>"   │
                                         ▼                             │
                               ┌──────────────────┐                    │
                               │ label_units      │ per-line ledger    │
                               └──────────────────┘                    │
                                         │ (same line ids)             │
                                         ▼                             │
                               ┌──────────────────┐   evidence[].thread_id   ┌─────────────┐
                               │ threads          │◄─────────────────────────┤ proposals   ├─┘
                               │ category, gate,  │                          │ status flow │
                               │ redacted lines   │                          └─────────────┘
                               └────────┬─────────┘
                                        │ thread_id (null for unlabelled_unit)
                                        ▼
                               ┌──────────────────┐
                               │ questions        │ debrief questions
                               └────────┬─────────┘
                                        │ question_id (= correction doc id)
                                        ▼
                               ┌──────────────────┐
                               │ corrections      │ one answer per question;
                               │ (answered_device │ device id only, no person
                               │  _id, TTL)       │
                               └──────────────────┘
```

Cardinalities (logical):
- `outlets` 1 ── * every other collection (via `outlet_id`).
- `devices` 1 ── * `heartbeats` (true subcollection), `capture_sessions`, `segments`, `label_units`, `threads`,
  `questions` (via `device_id`); `devices` 1 ── 0..1 `pipeline_locks`.
- `capture_sessions` 1 ── * `segments` (via `session_id`; null on pre-P1 segments).
- `segments` 1 ── * thread lines / ledger lines (via line id `"<seg_id>#<lineIndex>"`, embedded copies, no doc ref).
- `threads` 1 ── 0..1 gate `questions` (question id `q_thread_<thread_id>`); `unlabelled_unit` questions have no thread.
- `questions` 1 ── 0..1 `corrections` (correction doc id = `question_id`).
- `sop_versions` 1 ── * `proposals` (via `generator.sop_version_id`); `proposals` 0..1 ── 1 `sop_versions` (via
  `source_proposal_id`, R-10, not yet written).
- `proposals` * ── * `threads` (via embedded `content.evidence[].thread_id`, 2..10 refs, no text copied).
- `proposals` * ── * `constraints` (via `content.constraint_ids_acknowledged[]`); `constraints` * ── 0..1 `proposals`
  (via `source_proposal_id`, rejection-derived only).

---

## 3. Collection reference (live today on `origin/develop`)

Field tables only. For a complete example document per collection, all from one fictional day that
cross-references, see §5A.

### 3.1 `outlets`
Doc id: `outlet_id`. Written by `scripts/seed.ts`. Read by almost every service (calendar, timezone, retention).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | = doc id |
| `name` | string | the shop's name (a business, not a person) |
| `project_kind` | `"pilot" \| "demo"` | |
| `timezone` | string | IANA, e.g. `Asia/Jakarta` |
| `weekly_hours` | `{ mon..sun: { open: "HH:MM", close: "HH:MM" } \| null }` ? | `null` weekday = closed. Refined: ≥ 1 open day, open ≥ 01:00, close ≤ 01:00 next day, ≥ 4 h open, a day's auto-stop never passes the next day's opening |
| `opening_time` | `"HH:MM"` | legacy fallback when `weekly_hours` absent |
| `closing_time` | `"HH:MM"` | legacy fallback |
| `retention_days` | int 1-90 ? | callers default to 14 |
| `created_at` | ISO | |

Read via `parseOutletDoc()`, which strips a legacy `consent_complete` key from pre-7b docs before the strict parse
(hard rule #7b: no consent flag in MVP 1).

### 3.2 `users` (owner / supervisor accounts)
Doc id: `<outlet_id>:<email>` (seed). Written by `scripts/seed.ts` / `scripts/provision-web-user.ts`.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `uid` | string \| null | Firebase Auth uid; null until first sign-in |
| `email` | email | sign-in identity; never copied into any other collection |
| `role` | `"owner" \| "supervisor"` | |
| `created_at` | ISO | |

### 3.3 `staff` (the only place a person's name lives)
Doc id: `<outlet_id>:<staff_id>`. Written by `scripts/seed.ts`. Read only by the staff-name scrub (tick, debrief
reason scrub, constraint text scrub) and transcription vocabulary.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `staff_id` | string | never stored in any other collection (hard rule #7) |
| `name` | string | a person's name; **must never be copied elsewhere** |
| `name_key` | string | normalised `name` (trim, casefold, collapsed spaces) |
| `role` | `"owner" \| "supervisor" \| "staff"` | job role |
| `pin_hash` | string | dormant in MVP 1 (no staff sign-in) |
| `failed_attempts` | int ≥ 0 | dormant PIN lockout |
| `locked_until` | ISO \| null | dormant PIN lockout |
| `created_at` | ISO | |

### 3.4 `devices` (the paired shop phone)
Doc id: `<outlet_id>:<device_id>`. Written by seed, the pairing route, and the session end/discard transaction
(`last_ended`).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `device_id` | string | |
| `label` | string | a device label (e.g. a placement), never a person's name |
| `token_hash` | string \| null | bcrypt of the device token; null until paired |
| `last_ended` | `{ business_date: "YYYY-MM-DD", end_reason, ended_at_ms, debrief_ends_at_ms: int \| null }` ? | latest ended business day of **this** device; an older date never overwrites a newer one |
| `paired_at` | ISO \| null | |
| `revoked` | boolean | |
| `pairing_code` | 6-digit string \| null | single-use; null when not pairing |
| `pairing_code_expires_at` | ISO \| null | |
| `created_at` | ISO | |

`end_reason` enum (shared with `capture_sessions`): `"selesai" | "auto_stop" | "lost" | "discarded"`.

### 3.5 `devices/{device doc}/heartbeats` (subcollection)
Doc id: the heartbeat `ts` (ISO). Written by the heartbeat route (device role).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `device_id` | string | |
| `ts` | ISO | = doc id |
| `mic_source` | fixed enum (`MIC_SOURCE_CLASSES`) | a class, never a raw device label |
| `sample_rate` | int > 0 | |
| `speech_pct` | 0-100 | |
| `queue_size` | int ≥ 0 | |
| `battery` | 0-100 \| null | |
| `screen_awake` | boolean | |

This is the only subcollection in the schema: heartbeats are only ever read per device, and grow unboundedly, so
they live under the device rather than in the device doc.

### 3.6 `capture_sessions` (one Mulai → Selesai / auto-stop / lost / discard)
Doc id: `<device_id>:<session_id>`. Written by the capture session routes (device role) inside transactions.
**No actor field**: who tapped Mulai/Selesai is never recorded.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `device_id` | string | the claims device, never from the path/body |
| `session_id` | uuid | generated on the phone |
| `started_at_ms` | int ≥ 0 | device clock |
| `ended_at_ms` | int \| null | refined: null or ≥ `started_at_ms` |
| `end_reason` | end_reason enum \| null | `discarded` = tombstone |
| `local_date` | `"YYYY-MM-DD"` | server-computed business date, never recomputed |
| `auto_stop_at_ms` | int ≥ 0 | server-computed: close + 60 min |
| `debrief_ends_at_ms` | int \| null | set by the end transaction |
| `received_start_at` | ISO | server time |
| `received_end_at` | ISO \| null | server time |
| `cleanup_done_at_ms` | int \| null ? | discard cleanup marker |

No TTL in MVP 1 (known gap, web spec §6.6.3).

### 3.7 `segments` (redacted transcript lines; never audio)
Doc id: `<outlet_id>:<device_id>:<seg_id>`. Written once by the segment `PUT` route via `docRef.create()` /
`tx.create()` (a re-upload collides instead of overwriting). Deleted by TTL, or by a session discard.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `device_id` | string | |
| `seg_id` | string | |
| `session_id` | uuid \| null ? | from `X-Session-Id`; null/absent on pre-P1 bundles |
| `received_at` | ISO | |
| `device_start` / `device_end` | ISO | |
| `model` | string | transcription model id |
| `location` | string | read from `config/regions.yaml`, never hard-coded |
| `lines` | `[{ text, start, end }]` | `text` already SDP-redacted before write; `start`/`end` seconds |
| `expires_at` | ISO in domain, **native Timestamp** in Firestore | TTL field: deleted 48 h later |

No audio, no base64, no raw transcript (hard rules #2, #3). **After labelling, NON_WORK lines are blanked in
place:** the tick's `writeUnitResult` (`lib/firestore/tick-store.ts`, `blank_line_ids`) sets those lines' `text` to
`""` inside the same transaction, keeping `start`/`end`, so a stored segment can hold empty-text lines.

### 3.8 `label_units` (per-line labelling ledger)
Doc id: `unit_key`. Written by the pipeline tick.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `device_id` | string | |
| `unit_key` | string | `unit_id`, or a `~late~`-suffixed id for a late-arriving slice |
| `line_ids` | string[] | `"<seg_id>#<lineIndex>"` |
| `status` | `"pending" \| "done" \| "failed"` | |
| `attempts` | int ≥ 0 | |
| `labelled_at_ms` | int \| null | |

Ensures each transcript line is labelled exactly once even when segments arrive late. No TTL (known gap flagged in
`tick-store.ts`).

### 3.9 `pipeline_locks` (single-flight tick lease)
Doc id: `<outlet_id>:<device_id>`. Acquired/released by the tick inside `runTransaction`; a malformed or expired
doc counts as free.

| Field | Type |
|---|---|
| `outlet_id` | string |
| `device_id` | string |
| `acquired_at_ms` | int ≥ 0 |
| `expires_at_ms` | int ≥ 0 (crash backstop only) |

### 3.10 `threads` (a run of related work lines, labelled and gated)
Doc id: `thread_id` (built as `<unit_id>:<model thread id>`, or an existing thread's id when continued). Written by
the pipeline tick; updated by the debrief answer transaction (staff YES/NO) and `POST /api/v1/threads/{id}/confirm`
(supervisor confirm / override / reject).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `thread_id` | string | = doc id |
| `device_id` | string | the capture device, not a person |
| `category` | Category enum (12 values incl. `NON_WORK`) | |
| `confidence` | number | `min(stored, new)` on continuation |
| `line_ids` | string[] | |
| `evidence_line_ids` | string[] | |
| `lines` | `[{ line_id, start_ms, end_ms, text }]` | embedded copy of already-redacted, staff-name-scrubbed work lines |
| `first_line_start_ms` / `last_line_end_ms` | int ≥ 0 | |
| `summary` | string | |
| `fields` | record\<string, unknown\> ? | model-extracted fields |
| `runner_up` | `{ category, why_not }` ? | |
| `label_conflict` | boolean | |
| `status` | `"fact" \| "open" \| "unverified"` | from the evidence gate (plain code, hard rule #10) |
| `gate` | GateDecision (see below) | the full gate verdict, for audit/explainability |
| `created_at_ms` / `updated_at_ms` | int ≥ 0 | |
| `label_source` | `"model" \| "staff_confirmed" \| "supervisor_confirmed" \| "supervisor_rejected"` ? | |
| `confirmed_category` | Category ? | only with a `*_confirmed` source (kept on a supervisor reject) |
| `excluded_from_evidence` | boolean ? | staff NO or supervisor reject |

`gate` (embedded, `GateDecisionSchema`): `verdict: "fact" | "question"`, `fired_rule`, `checks: [{ rule, passed,
waived? }]`, `category`, `confidence`, `threshold`, `evidence_count`, `gate_version: "1" | "2" | "3"`,
`question_id?`, `model_category?`.

No `expires_at` yet (thread retention, hard rule #7a, ships in capture phase P4; see §7.2).

### 3.11 `questions` (debrief questions)
Doc id: `q_thread_<thread_id>` (kind `gate`) or `q_<unit_id>` (kind `unlabelled_unit`). Written by the pipeline
tick; answered by the debrief answer transaction; expired to `unverified` at debrief end.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `question_id` | string | = doc id |
| `device_id` | string | the capture device the moment came from |
| `thread_id` | string \| null | null for `unlabelled_unit` |
| `kind` | `"gate" \| "unlabelled_unit"` | |
| `status` | `"open" \| "unverified" \| "answered"` | |
| `category` | Category \| null | null for `unlabelled_unit` |
| `window_start_ms` / `window_end_ms` | int ≥ 0 | |
| `created_at_ms` | int ≥ 0 | |
| `answer` | `"yes" \| "no"` \| null ? | |
| `answered_at_ms` | int \| null ? | |
| `expired_by_debrief_end_ms` | int \| null ? | lets a late in-window answer replace `unverified` |

Read-side `QuestionDocSchema` invariant: `status === "answered"` iff `answer` and `answered_at_ms` are both set.
Questions are **role-agnostic** (no target role, no addressee).

### 3.12 `corrections` (one debrief answer)
Doc id: `question_id` (so one answer per question; `tx.create` rejects a second). Written by the debrief answer
route inside the same transaction that answers the question.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `correction_id` | string | = `question_id` |
| `question_id` | string | |
| `thread_id` | string \| null | null for `unlabelled_unit` |
| `answer` | `"yes" \| "no"` | |
| `reason_text` | string, 1..`CORRECTION_TEXT_MAX_CHARS` | staff-name-scrubbed, then SDP-redacted, before parse |
| `answered_device_id` | string | from claims; **never returned to supervisor/owner screens** |
| `debrief_business_date` | `"YYYY-MM-DD"` | |
| `answered_at_ms` / `received_at_ms` | int ≥ 0 | |
| `needs_supervisor_confirm` | boolean | |
| `expires_at` | ISO in domain, **native Timestamp** in Firestore | retention (outlet `retention_days`, default 14) |
| `created_at` | ISO | |

No `answered_by`, no role, no uid, no staff id, no name (hard rule #7).

### 3.13 `sop_versions` (immutable SOP versions)
Doc id: `sop_version_id` = `<outlet_id>:v<version>`. Today only `scripts/seed.ts` writes v1 (fictional on demo);
R-10 will write v2+ from approved proposals. No endpoint edits an SOP in place (hard rule #9).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `sop_version_id` | string | refined: must equal `<outlet_id>:v<version>` |
| `version` | int > 0 | |
| `steps` | `[{ step_id, title (≤80), text (≤600), role }]`, 1..200 | `role` is a job role; unique `step_id`s (refined) |
| `source` | `"seed" \| "proposal"` | |
| `source_proposal_id` | string \| null | refined: null when `source === "seed"` |
| `created_at_ms` | int ≥ 0 | |

### 3.14 `constraints` (permanent outlet rules fed into every proposal)
Doc id: `constraint_id` (uuid). Written by `createConstraint` (R-08 manual route today) in a transaction with its
audit entry. Never edited or deleted.

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `constraint_id` | uuid | = doc id |
| `text` | string 1..500 | digit-masked, staff-name-scrubbed, SDP-redacted |
| `source` | `"supervisor_rejection" \| "manual"` | (R-09 adds `"owner_rejection"`, §7.1) |
| `source_proposal_id` | uuid \| null | refined: non-null iff `source === "supervisor_rejection"` |
| `created_by_role` | `"supervisor" \| "owner"` | a role, never a name or id |
| `created_at_ms` | int ≥ 0 | |

### 3.15 `proposals` (SOP change proposals)
Doc id: `proposal_id` (uuid). Written by R-08's generate service in a transaction with its audit entry. Status
moves past `awaiting_supervisor` are R-09 (§7.1).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `proposal_id` | uuid | = doc id |
| `status` | `"suppressed" \| "blocked" \| "awaiting_supervisor" \| "awaiting_owner" \| "approved" \| "rejected"` | |
| `requested_by_role` | `"supervisor" \| "owner"` | role only |
| `range` | `{ from_date, to_date }` (`YYYY-MM-DD`) | |
| `generator` | `{ kind: "adk" \| "direct", model, location, agent_version, gate_version: "pgate-v1", library_version: { interventions, rubric }, sop_version_id, attempts: 0..2 }` | `location` from `config/regions.yaml` |
| `gate` | `{ passed, fired_rule: ProposalRule \| null, checks: [{ rule, passed }] }` | proposal gate (plain code), 11 rules in precedence order |
| `counts` | `{ candidate_facts, candidate_dates, constraints }` | |
| `suppression` | `{ reason: "insufficient_evidence" \| "model_declined", model_reason: enum \| null, followup: { categories (≤3), have_facts, have_dates, need_facts, need_dates } }` \| null | |
| `content` | ProposalContent \| null | see below |
| `created_at_ms` / `updated_at_ms` | int ≥ 0 | |

`content` (embedded): `intervention_id`, `rubric_criterion_ids` (1..6), `target_step_id` (null = new step),
`change_title` (≤160), `change_text` (≤800), `rationale` (≤800), `metric: { category (work), direction:
"decrease" | "increase", description, baseline_count, baseline_days }`, `failure_condition` (≤480),
`review_after_days` (7..28), `review_date`, `evidence: [{ thread_id, local_date, category, first_line_start_ms }]`
(2..10, **ids and times only, no text**), `constraint_ids_acknowledged: uuid[]`, `censored_floor: true`.

Invariants (`superRefine`): `suppression` set iff `status === "suppressed"`; `content` null iff status is
`suppressed` or `blocked`; `blocked` requires `gate.fired_rule`; `awaiting_*` requires `gate.passed === true`.

### 3.16 `proposal_locks` (single-flight generation lease)
Doc id: `outlet_id` (one per outlet). Acquired/released inside `runTransaction` by R-08's generate service.

| Field | Type |
|---|---|
| `outlet_id` | string (= doc id) |
| `lease_token` | uuid |
| `acquired_at_ms` | int ≥ 0 |
| `expires_at_ms` | int ≥ 0 |

### 3.17 `audit_log`
Doc id: Firestore auto id. Written alongside the action it records (usually in the same transaction).

| Field | Type | Notes |
|---|---|---|
| `outlet_id` | string | |
| `ts` | ISO | |
| `actor_role` | `"owner" \| "supervisor" \| "staff" \| "device" \| "system"` | a role, never a person |
| `action` | string | e.g. `device.pair`, `capture.session_end`, `constraint.created` |
| `target_type` | string | |
| `target_id` | string \| null | |
| `details` | record\<string, unknown\> ? | by convention never a name or staff id, and (R-08/R-09) never proposal/reason content. May carry a `device_id` (`debrief.answer_uploaded`), which is not person data and is never returned by any route |

---

## 4. Stub collections (schema placeholder, nothing writes them today)

Each is `{ outlet_id, <id field> }`, strict, so it is queryable and an accidental extra field fails loudly.

| Collection | Stub fields | Filled in |
|---|---|---|
| `windows` | `window_id` | **never persisted by design**: windows are recomputed from `segments` every tick |
| `reviews` | `review_id` | R-11 (ReviewAgent) |
| `outcomes` | `outcome_id` | R-11 (outcome memory) |
| `sales_events` | `sales_event_id` | P1 (POS CSV import) |
| `event_cards` | `event_card_id` | a later task |

---

## 5. Relationships (logical references; no foreign keys exist)

| From (field) | To | Kind | Enforced by |
|---|---|---|---|
| every doc `.outlet_id` | `outlets` | many-to-one, tenant key | RBAC guard + store re-checks |
| `heartbeats` (path) | `devices` | subcollection | document path |
| `capture_sessions.device_id`, `segments.device_id`, `label_units.device_id`, `threads.device_id`, `questions.device_id`, `pipeline_locks.device_id` | `devices.device_id` | many-to-one | claims device id at write time |
| `segments.session_id` | `capture_sessions.session_id` | many-to-one (nullable) | segment write transaction reads the session (tombstone check) |
| `threads.lines[].line_id`, `threads.line_ids[]`, `label_units.line_ids[]` | a line inside a `segments` doc (`"<seg_id>#<n>"`) | embedded copy + id | tick; segments expire after 48 h, the thread copy survives |
| `questions.thread_id` | `threads.thread_id` | many-to-one (nullable), in practice 0..1 per thread | tick builds id `q_thread_<thread_id>` |
| `corrections.question_id` (= doc id) | `questions` | one-to-one | debrief transaction (`tx.create`) |
| `corrections.thread_id` | `threads` | many-to-one (nullable) | debrief transaction |
| `proposals.content.evidence[].thread_id` | `threads` | many-to-many, embedded refs | proposal gate `evidence_unknown` / `evidence_stale` rules |
| `proposals.generator.sop_version_id` | `sop_versions` | many-to-one | generate service |
| `proposals.content.target_step_id` | a step inside that `sop_versions` doc | embedded id | proposal gate `step_unknown` |
| `proposals.content.constraint_ids_acknowledged[]` | `constraints` | many-to-many | proposal gate `constraints_unacknowledged` |
| `constraints.source_proposal_id` | `proposals` | many-to-one (nullable) | schema invariant + `createConstraint` |
| `sop_versions.source_proposal_id` | `proposals` | one-to-one (nullable) | R-10 (not yet written) |
| `proposal_locks` doc id, `pipeline_locks` doc id | `outlets` / `devices` | one-to-one | doc id construction |

`users` and `staff` are deliberately **not referenced** by any other collection.

---

## 5A. Sample data trail (fictional demo outlet)

**Every value below is fictional.** The outlet, people, device and SOP come from the built-in demo seed
(`DEMO_SEED` in `scripts/seed.ts`: "Demo Bakehouse", `demo-outlet`, `demo-phone`, the 5-step placeholder SOP).
The ids, quotes and timestamps were made up for this page. None of it is Proofed data (hard rule #8). Field names
and types follow `lib/firestore/schema.ts` on `origin/develop`. Blocks are `jsonc` so a `//` comment can mark a
field whose stored type is not what the JSON suggests (native Firestore `Timestamp`s) or a document that only
exists for a moment. Bcrypt hashes and Firebase uids are fake placeholders.

Timestamp styles used below, per §1: ISO strings for `created_at`, `received_*`, `ts`, `device_*`; epoch ms for
every `*_ms`; native Timestamps for `segments.expires_at` and `corrections.expires_at`. All times are in UTC.
The outlet is `Asia/Jakarta` (UTC+7), so 10:12 at the shop is `03:12Z`. A business day can begin on the
previous UTC date (see `capture_sessions.local_date`).

### 5A.0 How to read this trail

On **Thursday 8 Oct 2026** the paired phone `demo-phone` at `demo-outlet` gets a Mulai tap at 06:52 shop time. That
opens capture session `5a7e2c91-…` (`capture_sessions` doc `demo-phone:5a7e2c91-…`). At 10:12 a customer asks for a
croissant and is told they are sold out. The phone uploads that 45-second stretch as segment `8d2f4b7a-…`, and
the segment doc's `session_id` points back to the session. Only the redacted text is stored, never the audio.
The pipeline tick takes that segment's lines as label unit `unit_demo-phone_w_8d2f4b7a-…` (`label_units` doc,
same id) and builds thread `unit_demo-phone_w_8d2f4b7a-…:T1` from lines `8d2f4b7a-…#0..#2`. The thread is a
CUSTOMER_SERVICE moment at 0.84 confidence, below the 0.9 threshold, so the plain-code gate makes it a question.
The tick also writes question `q_thread_<that thread id>`. The staff tap Selesai at 21:50, the debrief runs until
22:50, and at 22:06 someone at the shop answers YES on the phone. That writes correction `q_thread_<…>`: same id
as the question, device id only, no person. The same transaction flips the thread to `status: "fact"`
(`label_source: "staff_confirmed"`). On 9 Oct the supervisor generates proposal `3f1c9a2e-…`, which cites this
thread and a 6 Oct one in `content.evidence[]`, and then rejects it. That rejection becomes constraint
`9a8b7c6d-…`, whose `source_proposal_id` is `3f1c9a2e-…`. On 10 Oct the owner generates proposal `6d2e8f4a-…`,
which cites three facts (including the same thread) and lists `9a8b7c6d-…` in `constraint_ids_acknowledged`. The
owner approves it on 11 Oct, and it ships as `sop_versions/demo-outlet:v2` with `source_proposal_id: "6d2e8f4a-…"`.
Every one of these links is a **plain string field the app reads and writes**. Firestore does not enforce any of
them, has no joins, and does not cascade deletes (§5).

> **Not live yet:** the `rejected` → constraint and `approved` → `sop_versions` v2 steps are R-09 / R-10 (§7). The
> schema already accepts those statuses and a `source: "proposal"` version, but no code on `origin/develop` writes
> them yet. Those samples show what R-09 / R-10 will write under the **current** schema. They omit R-09's planned
> `supervisor_review` / `owner_decision` fields (§7.1).

Id cheat-sheet for the trail:

| Thing | Id |
|---|---|
| outlet | `demo-outlet` |
| device | `demo-phone` (doc `demo-outlet:demo-phone`) |
| capture session, 8 Oct | `5a7e2c91-4b3d-4f6e-8a1b-2c3d4e5f6a7b` |
| capture session, 6 Oct | `1e9d3b70-6c2a-4d8f-9e1b-7a5c3d2f0e64` |
| segment (the croissant moment) | `8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3` |
| label unit = `unit_key` | `unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3` |
| thread | `unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1` |
| question = correction id | `q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1` |
| proposal, rejected by supervisor | `3f1c9a2e-7b4d-4e8a-9c21-5d6f0a1b2c3d` |
| constraint from that rejection | `9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d` |
| manual constraint (owner) | `0b4f6d8a-2c1e-4a3b-9d5f-6e7a8b9c0d1e` |
| proposal, approved by owner | `6d2e8f4a-0b1c-4d3e-a5f6-7a8b9c0d1e2f` |
| SOP versions | `demo-outlet:v1` (seed), `demo-outlet:v2` (from the approved proposal) |

### 5A.1 `outlets/demo-outlet`

```jsonc
{
  "outlet_id": "demo-outlet",
  "name": "Demo Bakehouse",
  "project_kind": "demo",
  "timezone": "Asia/Jakarta",
  "weekly_hours": {
    "mon": { "open": "07:00", "close": "21:45" },
    "tue": { "open": "07:00", "close": "21:45" },
    "wed": { "open": "07:00", "close": "21:45" },
    "thu": { "open": "07:00", "close": "21:45" },
    "fri": { "open": "07:00", "close": "21:45" },
    "sat": { "open": "07:00", "close": "21:45" },
    "sun": null                                      // closed: no Mulai window, no session
  },
  "opening_time": "07:00",                           // legacy fallback, used only if weekly_hours is absent
  "closing_time": "21:45",
  "retention_days": 14,
  "created_at": "2026-10-01T08:55:00.000Z"
}
```
Links: the doc id **is** `outlet_id`, and every other document below repeats `"outlet_id": "demo-outlet"`. The
seed itself writes no `weekly_hours` (it is optional). It is filled in here to show the shape: auto-stop =
close + 60 min = 22:45.

### 5A.2 `users/demo-outlet:demo-supervisor@example.com` (and the owner)

```jsonc
{
  "outlet_id": "demo-outlet",
  "uid": "Fk2mVx9LbT0sWnE4yHc1ZdPa83q7",             // fake; null until first sign-in
  "email": "demo-supervisor@example.com",
  "role": "supervisor",
  "created_at": "2026-10-01T08:55:00.000Z"
}
```
```jsonc
// users/demo-outlet:demo-owner@example.com
{
  "outlet_id": "demo-outlet",
  "uid": "Rq8nWc3JxV5aTe0LpK7yHd2ZmB41",
  "email": "demo-owner@example.com",
  "role": "owner",
  "created_at": "2026-10-01T08:55:00.000Z"
}
```
Links: none outbound, and **nothing points here**. A supervisor or owner action elsewhere is recorded only as a
role (`requested_by_role`, `created_by_role`, `audit_log.actor_role`), never as this email or uid.

### 5A.3 `staff/demo-outlet:demo-staff-1`

```jsonc
{
  "outlet_id": "demo-outlet",
  "staff_id": "demo-staff-1",
  "name": "Ari Demo",                                // the ONLY collection a person's name may appear in
  "name_key": "ari demo",
  "role": "staff",
  "pin_hash": "$2b$10$FAKEHASHFORDOCSONLYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",  // dormant in MVP 1
  "failed_attempts": 0,
  "locked_until": null,
  "created_at": "2026-10-01T08:55:00.000Z"
}
```
Links: **none, by design**. `staff_id` and `name` never appear in any other document. The tick and the debrief
use this name only to replace it with `[STAFF]` before text is stored, and as transcription vocabulary.

### 5A.4 `devices/demo-outlet:demo-phone`

```jsonc
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "label": "Demo shop phone",                        // a placement label, never a person's name
  "token_hash": "$2b$10$FAKEDEVICETOKENHASHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "last_ended": {
    "business_date": "2026-10-08",
    "end_reason": "selesai",
    "ended_at_ms": 1791471030000,                    // 21:50:30 WIB
    "debrief_ends_at_ms": 1791474630000              // ended + 60 min
  },
  "paired_at": "2026-10-01T09:12:40.000Z",
  "revoked": false,
  "pairing_code": null,                              // already used; a 6-digit string only while pairing
  "pairing_code_expires_at": null,
  "created_at": "2026-10-01T08:55:00.000Z"
}
```
Links: doc id = `<outlet_id>:<device_id>`. `device_id: "demo-phone"` is what `capture_sessions`, `segments`,
`label_units`, `pipeline_locks`, `threads` and `questions` carry in their own `device_id`, and what
`corrections.answered_device_id` carries. `last_ended` repeats the 8 Oct session's end (5A.6).

### 5A.5 `devices/demo-outlet:demo-phone/heartbeats/2026-10-08T03:15:00.000Z`

```jsonc
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "ts": "2026-10-08T03:15:00.000Z",                  // = doc id; 10:15 WIB
  "mic_source": "built-in",                          // one of built-in | bluetooth | usb | unknown, never a raw label
  "sample_rate": 16000,
  "speech_pct": 37.5,
  "queue_size": 0,
  "battery": 82,
  "screen_awake": true
}
```
Links: the parent is the document path (`devices/{device doc}/heartbeats`), not a field. `device_id` repeats it.

### 5A.6 `capture_sessions/demo-phone:5a7e2c91-4b3d-4f6e-8a1b-2c3d4e5f6a7b` (ended by Selesai)

```jsonc
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "session_id": "5a7e2c91-4b3d-4f6e-8a1b-2c3d4e5f6a7b",
  "started_at_ms": 1791417130000,                    // Mulai, 06:52:10 WIB (device clock)
  "ended_at_ms": 1791471030000,                      // Selesai, 21:50:30 WIB
  "end_reason": "selesai",
  "local_date": "2026-10-08",                        // the business date, although received_start_at is 7 Oct in UTC
  "auto_stop_at_ms": 1791474300000,                  // close 21:45 + 60 min = 22:45 WIB
  "debrief_ends_at_ms": 1791474630000,               // ended + 60 min
  "received_start_at": "2026-10-07T23:52:10.812Z",
  "received_end_at": "2026-10-08T14:50:31.204Z"
  // cleanup_done_at_ms absent: only a discarded session gets it
}
```
A second branch: the 6 Oct session, which nobody ended, so the auto-stop closed it.
```jsonc
// capture_sessions/demo-phone:1e9d3b70-6c2a-4d8f-9e1b-7a5c3d2f0e64
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "session_id": "1e9d3b70-6c2a-4d8f-9e1b-7a5c3d2f0e64",
  "started_at_ms": 1791244860000,                    // 07:01 WIB
  "ended_at_ms": 1791301500000,                      // = auto_stop_at_ms
  "end_reason": "auto_stop",
  "local_date": "2026-10-06",
  "auto_stop_at_ms": 1791301500000,
  "debrief_ends_at_ms": 1791305100000,
  "received_start_at": "2026-10-06T00:01:00.390Z",
  "received_end_at": "2026-10-06T15:45:02.117Z"
}
```
Links: `device_id` → `devices`. `session_id` is what `segments.session_id` points to. No actor field: who tapped
Mulai or Selesai is never stored.

### 5A.7 `segments/demo-outlet:demo-phone:8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3`

As stored after the tick has labelled it:
```jsonc
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "seg_id": "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3",  // generated on the phone (crypto.randomUUID)
  "session_id": "5a7e2c91-4b3d-4f6e-8a1b-2c3d4e5f6a7b",
  "received_at": "2026-10-08T03:12:48.530Z",
  "device_start": "2026-10-08T03:12:00.000Z",        // 10:12:00 WIB
  "device_end": "2026-10-08T03:12:45.000Z",
  "model": "gemini-3.5-transcribe-preview",
  "location": "global",                              // read from config/regions.yaml at call time
  "lines": [
    { "text": "Mbak [PERSON_NAME], croissant-nya masih ada?", "start": 2.1, "end": 5.4 },
    { "text": "Maaf Kak, croissant-nya sudah habis. Tray berikutnya keluar jam sebelas.", "start": 6.0, "end": 10.2 },
    { "text": "Yah, ya sudah. Kopi susu satu aja, Mbak.", "start": 11.0, "end": 14.8 },
    { "text": "", "start": 20.0, "end": 23.5 }      // labelled NON_WORK, so the tick blanked its text
  ],
  "expires_at": "2026-10-10T03:12:48.530Z"           // stored as a native Firestore Timestamp (TTL), not a string
}
```
Notes: `[PERSON_NAME]` is the Sensitive Data Protection placeholder (the infoType in brackets). The other
placeholders are `[PHONE_NUMBER]`, `[EMAIL_ADDRESS]` and `[STREET_ADDRESS]`. The staff-name scrub writes `[STAFF]`.
`start` / `end` are seconds from `device_start`. No audio, no base64, ever.
Links: `session_id` → `capture_sessions.session_id`. Each line's identity elsewhere is
`"<seg_id>#<index>"`, e.g. `8d2f4b7a-…#1` is the "sudah habis" line. That id string is how `label_units` and
`threads` refer to a line. The segment expires 48 h after write, but the thread keeps its own copy of the text.

### 5A.8 `label_units/unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3`

```jsonc
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "unit_key": "unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3",  // unit_<device_id>_<first window_id>; window_id = w_<seg_id>
  "line_ids": [
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#0",
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#1",
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#2",
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#3"     // the NON_WORK line too: the ledger covers every line
  ],
  "status": "done",
  "attempts": 1,
  "labelled_at_ms": 1791429246000                    // 10:14:06 WIB
}
```
A second branch: a 15:30 unit whose label call failed. It produced no thread, only an `unlabelled_unit`
question (5A.11, second example).
```jsonc
// label_units/unit_demo-phone_w_c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "unit_key": "unit_demo-phone_w_c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c",
  "line_ids": [
    "c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c#0",
    "c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c#1",
    "c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c#2"
  ],
  "status": "failed",
  "attempts": 2,
  "labelled_at_ms": null                             // always null on a failed unit
}
```
Links: `line_ids[]` → lines inside `segments` docs (by the `<seg_id>#<n>` convention). `unit_key` is the prefix of
every thread id built from this unit, and of the `q_<unit_id>` question id when the unit fails.

### 5A.9 `pipeline_locks/demo-outlet:demo-phone` (exists only while a tick runs)

```jsonc
{
  "outlet_id": "demo-outlet",
  "device_id": "demo-phone",
  "acquired_at_ms": 1791429245000,                   // 10:14:05 WIB; also the release token
  "expires_at_ms": 1791431045000                     // + 30 min crash backstop (DEFAULT_LEASE_TTL_MS)
}
```
Links: the doc id = `<outlet_id>:<device_id>`. The tick deletes it on release (and only if `acquired_at_ms` still
matches), so on a normal day you usually find no doc at all.

### 5A.10 `threads/unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1`

As stored **after** the staff YES answer at 22:06:
```jsonc
{
  "outlet_id": "demo-outlet",
  "thread_id": "unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",  // <unit_id>:<model's new-thread alias>
  "device_id": "demo-phone",
  "category": "CUSTOMER_SERVICE",
  "confidence": 0.84,
  "line_ids": [
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#0",
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#1",
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#2"
  ],
  "evidence_line_ids": [
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#0",
    "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#1"
  ],
  "lines": [                                         // its own copy: already redacted and staff-name-scrubbed; no NON_WORK lines
    { "line_id": "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#0", "start_ms": 1791429122100, "end_ms": 1791429125400,
      "text": "Mbak [PERSON_NAME], croissant-nya masih ada?" },
    { "line_id": "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#1", "start_ms": 1791429126000, "end_ms": 1791429130200,
      "text": "Maaf Kak, croissant-nya sudah habis. Tray berikutnya keluar jam sebelas." },
    { "line_id": "8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3#2", "start_ms": 1791429131000, "end_ms": 1791429134800,
      "text": "Yah, ya sudah. Kopi susu satu aja, Mbak." }
  ],
  "first_line_start_ms": 1791429122100,              // device_start + 2.1 s
  "last_line_end_ms": 1791429134800,
  "summary": "A customer asked for a croissant around 10:12; it was sold out and the next tray was due at 11:00. The customer bought a milk coffee instead.",
  "fields": {                                        // per-category field shapes: lib/pipeline/label/fields.ts
    "unmet_request": { "item": "croissant", "reason": "sold_out" },
    "sale": true
  },
  "runner_up": { "category": "COMPLAINT", "why_not": "The customer accepted an alternative and did not express dissatisfaction." },
  "label_conflict": false,
  "status": "fact",
  "gate": {
    "verdict": "fact",
    "fired_rule": "staff_confirmed",
    "checks": [
      { "rule": "invalid_label", "passed": true },
      { "rule": "label_conflict", "passed": true, "waived": true },
      { "rule": "always_question", "passed": true, "waived": true },
      { "rule": "needs_supervisor_confirm", "passed": true },
      { "rule": "no_evidence", "passed": true },
      { "rule": "below_threshold", "passed": false, "waived": true },  // 0.84 < 0.9, waived because a person confirmed it
      { "rule": "staff_confirmed", "passed": true }
    ],
    "category": "CUSTOMER_SERVICE",
    "confidence": 0.84,
    "threshold": 0.9,
    "evidence_count": 2,
    "gate_version": "2",
    "question_id": "q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",
    "model_category": "CUSTOMER_SERVICE"
  },
  "created_at_ms": 1791429246000,                    // tick, 10:14:06 WIB
  "updated_at_ms": 1791471974000,                    // answer received, 22:06:14 WIB
  "label_source": "staff_confirmed",
  "confirmed_category": "CUSTOMER_SERVICE"
  // excluded_from_evidence absent: only a staff NO or a supervisor reject sets it
}
```
The same thread **before** the answer, as the 10:14 tick wrote it, differed only in these keys:
```jsonc
{
  "status": "open",
  "gate": {
    "verdict": "question",
    "fired_rule": "below_threshold",
    "checks": [
      { "rule": "invalid_label", "passed": true },
      { "rule": "label_conflict", "passed": true },
      { "rule": "always_question", "passed": true },
      { "rule": "needs_supervisor_confirm", "passed": true },
      { "rule": "no_evidence", "passed": true },
      { "rule": "below_threshold", "passed": false },
      { "rule": "passed", "passed": false }
    ],
    "category": "CUSTOMER_SERVICE", "confidence": 0.84, "threshold": 0.9, "evidence_count": 2,
    "gate_version": "1"                              // v1 has no question_id / model_category
  },
  "updated_at_ms": 1791429246000
  // no label_source, no confirmed_category
}
```
Links: `device_id` → `devices`. `line_ids[]`, `evidence_line_ids[]` and `lines[].line_id` → segment lines (the text
is copied, so it outlives the segment's 48 h TTL). The `gate.question_id` / `questions.thread_id` pair ties it to its
question. `proposals.content.evidence[].thread_id` points here (both proposals below). There is no field for a
person: `label_source: "staff_confirmed"` says a person confirmed it, not who.

The other two facts the proposals cite have the same shape: `unit_demo-phone_w_2b6a9e13-5f7c-4d1a-a3e8-9c0b1d2e3f45:T1`
(6 Oct 09:41, croissant sold out) and `unit_demo-phone_w_7f3c0d58-2a4b-4e9c-b1d6-3e5f7a9c0b2d:T2` (9 Oct 10:05,
same story).

### 5A.11 `questions/q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1` (answered)

```jsonc
{
  "outlet_id": "demo-outlet",
  "question_id": "q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",  // q_thread_<thread_id>
  "device_id": "demo-phone",                         // the device the moment was captured on
  "thread_id": "unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",
  "kind": "gate",
  "status": "answered",
  "category": "CUSTOMER_SERVICE",                    // the thread's category when the question was created
  "window_start_ms": 1791429122100,                  // = thread first_line_start_ms
  "window_end_ms": 1791429134800,                    // = thread last_line_end_ms
  "created_at_ms": 1791429246000,
  "answer": "yes",
  "answered_at_ms": 1791471972000,                   // 22:06:12 WIB, phone clock
  "expired_by_debrief_end_ms": null
}
```
A second branch: the failed 15:30 unit's question, which nobody answered before the debrief closed at 22:50.
```jsonc
// questions/q_unit_demo-phone_w_c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c
{
  "outlet_id": "demo-outlet",
  "question_id": "q_unit_demo-phone_w_c4e71a2b-9d3f-4a6e-8b5c-1d2e3f4a5b6c",  // q_<unit_id>
  "device_id": "demo-phone",
  "thread_id": null,                                 // no thread was ever built
  "kind": "unlabelled_unit",
  "status": "unverified",
  "category": null,
  "window_start_ms": 1791448201500,                  // min / max over the unit's lines
  "window_end_ms": 1791448238000,
  "created_at_ms": 1791448560000,                    // 15:36 WIB
  "expired_by_debrief_end_ms": 1791474630000         // = the session's debrief_ends_at_ms
  // answer / answered_at_ms absent: QuestionDocSchema allows them only when status is "answered"
}
```
Links: `thread_id` → `threads.thread_id` (null for `unlabelled_unit`). The doc id is what `corrections` uses as its
own id. No target role and no addressee: anyone at the shop may answer.

### 5A.12 `corrections/q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1`

```jsonc
{
  "outlet_id": "demo-outlet",
  "correction_id": "q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",  // = question_id = doc id
  "question_id": "q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",
  "thread_id": "unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",
  "answer": "yes",
  "reason_text": "Iya, croissant habis sekitar jam sepuluh, tray kedua belum masuk oven. [STAFF] lagi pegang kasir.",  // name-scrubbed, then SDP-redacted
  "answered_device_id": "demo-phone",                // claims device; never shown to supervisor/owner
  "debrief_business_date": "2026-10-08",
  "answered_at_ms": 1791471972000,
  "received_at_ms": 1791471974000,
  "needs_supervisor_confirm": false,                 // CUSTOMER_SERVICE is not in NEEDS_SUPERVISOR_CONFIRM
  "expires_at": "2026-10-22T15:06:12.000Z",          // native Firestore Timestamp; answered_at_ms + retention_days (14)
  "created_at": "2026-10-08T15:06:14.000Z"
}
```
Links: the doc id = `question_id` → `questions` (one answer per question: `tx.create` rejects a second).
`thread_id` → `threads`. `answered_device_id` → `devices.device_id`. No `answered_by`, role, uid, staff id or name.

### 5A.13 `sop_versions/demo-outlet:v1` (seed) and `demo-outlet:v2` (from the approved proposal)

```jsonc
{
  "outlet_id": "demo-outlet",
  "sop_version_id": "demo-outlet:v1",                // must equal <outlet_id>:v<version>
  "version": 1,
  "steps": [
    { "step_id": "open-01",  "title": "Open the shop",    "text": "Turn on the oven and the display lights. Check the float in the till.", "role": "staff" },
    { "step_id": "bake-01",  "title": "Morning bake",     "text": "Bake the first tray of each bread by opening time.", "role": "staff" },
    { "step_id": "stock-01", "title": "Display check",    "text": "Check the display every hour and refill items that are running low.", "role": "staff" },
    { "step_id": "serve-01", "title": "Serve a customer", "text": "Greet, take the order, confirm it back, take payment.", "role": "staff" },
    { "step_id": "close-01", "title": "Close the shop",   "text": "Count the till, clean the oven, log leftover items.", "role": "supervisor" }
  ],
  "source": "seed",
  "source_proposal_id": null,                        // must be null for a seed version
  "created_at_ms": 1790844900000                     // 2026-10-01T08:55:00Z, seed time
}
```
```jsonc
// sop_versions/demo-outlet:v2 (R-10 writer, not built yet; shape per the current schema)
{
  "outlet_id": "demo-outlet",
  "sop_version_id": "demo-outlet:v2",
  "version": 2,
  "steps": [
    { "step_id": "open-01",  "title": "Open the shop",    "text": "Turn on the oven and the display lights. Check the float in the till.", "role": "staff" },
    { "step_id": "bake-01",  "title": "Morning bake",     "text": "Bake the first tray of each bread by opening time.", "role": "staff" },
    { "step_id": "stock-01", "title": "Display check",    "text": "Check the display every hour. When any bread is down to 4 pieces, start the next tray straight away and write the oven start time on the tray label.", "role": "staff" },
    { "step_id": "serve-01", "title": "Serve a customer", "text": "Greet, take the order, confirm it back, take payment.", "role": "staff" },
    { "step_id": "close-01", "title": "Close the shop",   "text": "Count the till, clean the oven, log leftover items.", "role": "supervisor" }
  ],
  "source": "proposal",
  "source_proposal_id": "6d2e8f4a-0b1c-4d3e-a5f6-7a8b9c0d1e2f",
  "created_at_ms": 1791682230000                     // 11 Oct 08:30:30 WIB, right after owner approval
}
```
Links: `proposals.generator.sop_version_id` → this doc (both proposals were generated against `demo-outlet:v1`).
`proposals.content.target_step_id` → a `steps[].step_id` inside it. In v2, `source_proposal_id` → the approved
proposal. Versions are immutable: v2 is a new document and v1 is never edited.

### 5A.14 `constraints` (one from a supervisor rejection, one manual)

```jsonc
// constraints/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d (from the rejection; the R-09 write path is not built yet)
{
  "outlet_id": "demo-outlet",
  "constraint_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "text": "No shift may start before 06:00: the building is locked until then.",  // digit-masked (6+ digit runs only), scrubbed, redacted
  "source": "supervisor_rejection",
  "source_proposal_id": "3f1c9a2e-7b4d-4e8a-9c21-5d6f0a1b2c3d",  // required for a rejection
  "created_by_role": "supervisor",
  "created_at_ms": 1791537000000                     // 9 Oct 16:10 WIB, same moment as the rejection
}
```
```jsonc
// constraints/0b4f6d8a-2c1e-4a3b-9d5f-6e7a8b9c0d1e (R-08 manual route)
{
  "outlet_id": "demo-outlet",
  "constraint_id": "0b4f6d8a-2c1e-4a3b-9d5f-6e7a8b9c0d1e",
  "text": "Ovens stay off after 20:00 except for cleaning.",
  "source": "manual",
  "source_proposal_id": null,                        // must be null when source is manual
  "created_by_role": "owner",
  "created_at_ms": 1790928000000                     // 2 Oct 15:00 WIB
}
```
Links: `source_proposal_id` → `proposals.proposal_id` (rejection-derived only). The reverse link is
`proposals.content.constraint_ids_acknowledged[]`, which points here from every later proposal.

### 5A.15 `proposals` (rejected by the supervisor, then approved by the owner)

```jsonc
// proposals/3f1c9a2e-7b4d-4e8a-9c21-5d6f0a1b2c3d (rejected by the supervisor)
{
  "outlet_id": "demo-outlet",
  "proposal_id": "3f1c9a2e-7b4d-4e8a-9c21-5d6f0a1b2c3d",
  "status": "rejected",                              // R-08 wrote "awaiting_supervisor"; the move to rejected is R-09
  "requested_by_role": "supervisor",
  "range": { "from_date": "2026-10-02", "to_date": "2026-10-08" },
  "generator": {
    "kind": "adk",
    "model": "gemini-3.5-flash",
    "location": "asia-southeast1",                   // from config/regions.yaml
    "agent_version": "proposal-v1",
    "gate_version": "pgate-v1",
    "library_version": { "interventions": 1, "rubric": 1 },  // config/interventions.yaml, config/rubric.yaml
    "sop_version_id": "demo-outlet:v1",
    "attempts": 1
  },
  "gate": {
    "passed": true,
    "fired_rule": null,
    "checks": [
      { "rule": "intervention_unknown", "passed": true },
      { "rule": "rubric_missing", "passed": true },
      { "rule": "rubric_unknown", "passed": true },
      { "rule": "evidence_unknown", "passed": true },
      { "rule": "evidence_min", "passed": true },    // >= 2 threads on >= 2 dates
      { "rule": "step_unknown", "passed": true },
      { "rule": "constraints_unacknowledged", "passed": true },
      { "rule": "metric_not_in_evidence", "passed": true },
      { "rule": "evidence_stale", "passed": true }   // re-checked in the commit transaction
    ]
  },
  "counts": { "candidate_facts": 6, "candidate_dates": 4, "constraints": 1 },
  "suppression": null,                               // set only when status is "suppressed"
  "content": {
    "intervention_id": "shift_schedule",
    "rubric_criterion_ids": ["time_bound", "single_owner"],
    "target_step_id": "bake-01",
    "change_title": "Start the first staff shift at 05:30 so a second croissant tray is out by 09:30",
    "change_text": "Move the opening staff shift from 06:30 to 05:30. The opening staff member bakes a second croissant tray and puts it on the display by 09:30.",
    "rationale": "On 2 of the last 4 open days a customer asked for croissants after they had sold out, between 09:40 and 10:20. The first tray covers only the early rush. This changes paid hours, so the owner decides.",
    "metric": {
      "category": "CUSTOMER_SERVICE",
      "direction": "decrease",
      "description": "Customer-service facts in which a customer asked for an item that was already sold out.",
      "baseline_count": 4,                           // CUSTOMER_SERVICE candidates in range
      "baseline_days": 4                             // distinct local_date across all candidates
    },
    "failure_condition": "Croissant sold-out requests still appear on 2 or more days before the review date.",
    "review_after_days": 14,
    "review_date": "2026-10-23",                     // generation day + 14
    "evidence": [                                    // ids and times only, never thread text
      { "thread_id": "unit_demo-phone_w_2b6a9e13-5f7c-4d1a-a3e8-9c0b1d2e3f45:T1", "local_date": "2026-10-06",
        "category": "CUSTOMER_SERVICE", "first_line_start_ms": 1791254480000 },
      { "thread_id": "unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1", "local_date": "2026-10-08",
        "category": "CUSTOMER_SERVICE", "first_line_start_ms": 1791429122100 }
    ],
    "constraint_ids_acknowledged": ["0b4f6d8a-2c1e-4a3b-9d5f-6e7a8b9c0d1e"],
    "censored_floor": true
  },
  "created_at_ms": 1791516000000,                    // 9 Oct 10:20 WIB
  "updated_at_ms": 1791537000000                     // 9 Oct 16:10 WIB, the supervisor rejection
}
```
```jsonc
// proposals/6d2e8f4a-0b1c-4d3e-a5f6-7a8b9c0d1e2f (approved by the owner)
{
  "outlet_id": "demo-outlet",
  "proposal_id": "6d2e8f4a-0b1c-4d3e-a5f6-7a8b9c0d1e2f",
  "status": "approved",                              // via awaiting_supervisor -> awaiting_owner -> approved (R-09)
  "requested_by_role": "owner",
  "range": { "from_date": "2026-10-03", "to_date": "2026-10-09" },
  "generator": {
    "kind": "adk", "model": "gemini-3.5-flash", "location": "asia-southeast1",
    "agent_version": "proposal-v1", "gate_version": "pgate-v1",
    "library_version": { "interventions": 1, "rubric": 1 },
    "sop_version_id": "demo-outlet:v1",
    "attempts": 2                                    // the first model answer failed the gate and was retried once
  },
  "gate": {
    "passed": true,
    "fired_rule": null,
    "checks": [
      { "rule": "intervention_unknown", "passed": true }, { "rule": "rubric_missing", "passed": true },
      { "rule": "rubric_unknown", "passed": true },       { "rule": "evidence_unknown", "passed": true },
      { "rule": "evidence_min", "passed": true },         { "rule": "step_unknown", "passed": true },
      { "rule": "constraints_unacknowledged", "passed": true }, { "rule": "metric_not_in_evidence", "passed": true },
      { "rule": "evidence_stale", "passed": true }
    ]
  },
  "counts": { "candidate_facts": 7, "candidate_dates": 5, "constraints": 2 },
  "suppression": null,
  "content": {
    "intervention_id": "change_trigger",
    "rubric_criterion_ids": ["observable", "time_bound", "single_owner", "failure_path"],
    "target_step_id": "stock-01",                    // null would mean a NEW step
    "change_title": "Start the next tray when the display is down to 4 pieces",
    "change_text": "Check the display every hour. When any bread is down to 4 pieces, start the next tray straight away and write the oven start time on the tray label.",
    "rationale": "On 3 of the last 5 open days a customer asked for croissants after they had sold out. The hourly check is a clock trigger, so a tray that empties between checks is not restocked in time. A stock-level trigger needs no earlier shift and no oven use after 20:00.",
    "metric": {
      "category": "CUSTOMER_SERVICE",
      "direction": "decrease",
      "description": "Customer-service facts in which a customer asked for an item that was already sold out.",
      "baseline_count": 5,
      "baseline_days": 5
    },
    "failure_condition": "Sold-out requests still appear on 3 or more days before the review date, or leftover bread logged at closing goes up.",
    "review_after_days": 14,
    "review_date": "2026-10-24",
    "evidence": [
      { "thread_id": "unit_demo-phone_w_2b6a9e13-5f7c-4d1a-a3e8-9c0b1d2e3f45:T1", "local_date": "2026-10-06",
        "category": "CUSTOMER_SERVICE", "first_line_start_ms": 1791254480000 },
      { "thread_id": "unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1", "local_date": "2026-10-08",
        "category": "CUSTOMER_SERVICE", "first_line_start_ms": 1791429122100 },
      { "thread_id": "unit_demo-phone_w_7f3c0d58-2a4b-4e9c-b1d6-3e5f7a9c0b2d:T2", "local_date": "2026-10-09",
        "category": "CUSTOMER_SERVICE", "first_line_start_ms": 1791515130000 }
    ],
    "constraint_ids_acknowledged": [
      "0b4f6d8a-2c1e-4a3b-9d5f-6e7a8b9c0d1e",
      "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"        // the constraint born from the rejected proposal above
    ],
    "censored_floor": true
  },
  "created_at_ms": 1791597900000,                    // 10 Oct 09:05 WIB
  "updated_at_ms": 1791682200000                     // 11 Oct 08:30 WIB, the owner approval
}
```
Links: `content.evidence[].thread_id` → `threads` (2..10 refs; only ids, dates, categories and times are copied).
`generator.sop_version_id` → `sop_versions`. `content.target_step_id` → a step in that version.
`content.constraint_ids_acknowledged[]` → `constraints`. `proposal_id` is the key that the reverse links point to:
`constraints.source_proposal_id` (on a rejection) and `sop_versions.source_proposal_id` (on an approval). The
actor is a role only (`requested_by_role`). Who reviewed or approved is recorded, once R-09 lands, in role-named
slots and in `audit_log.actor_role`.

### 5A.16 `proposal_locks/demo-outlet` (exists only while a proposal is being generated)

```jsonc
{
  "outlet_id": "demo-outlet",                        // = doc id
  "lease_token": "e2c4a6b8-1d3f-4a5c-9e7b-0d2f4a6c8e1b",
  "acquired_at_ms": 1791597900000,
  "expires_at_ms": 1791598080000                     // + PROPOSAL_LEASE_MS (180 s)
}
```
Links: the doc id = `outlet_id`, one per outlet. It is deleted on release, and only by the holder of `lease_token`.

### 5A.17 `audit_log` (auto ids; four entries from the trail)

```jsonc
// audit_log/<auto id>: Selesai on 8 Oct
{ "outlet_id": "demo-outlet", "ts": "2026-10-08T14:50:31.204Z", "actor_role": "device",
  "action": "capture.session_end", "target_type": "capture_session",
  "target_id": "5a7e2c91-4b3d-4f6e-8a1b-2c3d4e5f6a7b" }
```
```jsonc
// audit_log/<auto id>: the debrief answer (written in the same transaction as the correction)
{ "outlet_id": "demo-outlet", "ts": "2026-10-08T15:06:14.000Z", "actor_role": "device",
  "action": "debrief.answer_uploaded", "target_type": "question",
  "target_id": "q_thread_unit_demo-phone_w_8d2f4b7a-1c3e-4f5a-b6d7-e8f9a0b1c2d3:T1",
  "details": { "device_id": "demo-phone" } }
```
```jsonc
// audit_log/<auto id>: proposal generated (no proposal text in details)
{ "outlet_id": "demo-outlet", "ts": "2026-10-09T03:20:00.000Z", "actor_role": "supervisor",
  "action": "proposal.generated", "target_type": "proposal",
  "target_id": "3f1c9a2e-7b4d-4e8a-9c21-5d6f0a1b2c3d",
  "details": { "status": "awaiting_supervisor", "fired_rule": null, "candidate_facts": 6, "candidate_dates": 4, "attempts": 1 } }
```
```jsonc
// audit_log/<auto id>: constraint created from the rejection (no constraint text in details)
{ "outlet_id": "demo-outlet", "ts": "2026-10-09T09:10:00.000Z", "actor_role": "supervisor",
  "action": "constraint.created", "target_type": "constraint",
  "target_id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "details": { "source": "supervisor_rejection" } }
```
Links: `target_type` + `target_id` name the document acted on (a session id, a question id, a proposal id, a
constraint id). This is a free-form pair, not a typed reference. `actor_role` is always a role. R-09 adds
`proposal.supervisor_rejected` / `proposal.approved` entries (§7.1). They are not shown because nothing writes them
yet.

### 5A.18 Stub collections

```jsonc
// reviews/<id>: the same shape applies to outcomes, sales_events, event_cards (with their own id field)
{ "outlet_id": "demo-outlet", "review_id": "rev-6d2e8f4a-2026-10-24" }   // illustrative only; nothing writes these today
```
`windows` is never persisted: windows are recomputed from `segments` on every tick.

---

## 6. Indexes and TTL

### 6.1 Composite indexes (created and `READY`, both projects, 10 Oct)
Source: `docs/tasks/R-01-gcp-state.md`. Three index definitions × two projects = the 6 confirmed indexes.

| Collection group | Fields (index order) | Serves | Demo id | Pilot id |
|---|---|---|---|---|
| `threads` | `outlet_id` ASC, `first_line_start_ms` ASC | `day-store` `listThreadsIndexed`, `proposal-store` thread range read (equality + range + orderBy) | `CICAgOjXh4EK` | `CICAgOjXh4EL` |
| `questions` | `outlet_id` ASC, `kind` ASC, `window_start_ms` ASC | `day-store` `listUnlabelledQuestions` | `CICAgJiUpoMK` | `CICAgJiUpoMJ` |
| `questions` | `outlet_id` ASC, `kind` ASC, `status` ASC, `answered_at_ms` DESC | `day-store` `listAnsweredGateQuestions` | `CICAgJim14AK` | `CICAgJim14AK` |

There is no `firestore.indexes.json` in the repo; indexes are created by dev-ops with `gcloud`, per project.

### 6.2 Queries served by automatic single-field indexes (equality-only, index merging)
- `devices`: `pairing_code ==`; `device_id ==`; `outlet_id ==`; `revoked ==`.
- `staff`: `outlet_id ==` (+ `name_key ==` / `staff_id ==`).
- `users`: `email ==`.
- `segments`: `outlet_id == && device_id ==` (tick); `outlet_id == && device_id == && session_id ==` (discard cleanup).
- `capture_sessions`: `outlet_id == && local_date in [...]` (day/proposal stores); `outlet_id == && device_id == &&
  local_date == && end_reason in [...]` (debrief).
- `label_units`: `outlet_id == && device_id == && status in ["done","failed"]`.
- `questions`: `outlet_id == && device_id == && status == "open"` (tick, debrief).
- `sop_versions`, `constraints`: `outlet_id ==`.
- `proposals`: `outlet_id == && range.from_date == && range.to_date ==`.

### 6.3 Query that likely needs a composite index not in §6.1 (verify)
`tick-store` `listRecentThreads`: `threads` where `outlet_id ==` **and** `device_id ==` **and**
`last_line_end_ms >=`. Firestore normally requires a composite index when equality filters are combined with a
range filter on a different field; `(outlet_id, device_id, last_line_end_ms)` is not among the 6. If the deployed
tick returns `FAILED_PRECONDITION`, this is the index to add (dev-ops, both projects). Not verified live while
writing this page.

### 6.4 TTL fields
| Collection | Field | Intended policy | Note |
|---|---|---|---|
| `segments` | `expires_at` (native Timestamp) | delete 48 h after write | policy setup tracked in R-02/R-04 notes; live state not re-verified here |
| `corrections` | `expires_at` (native Timestamp) | delete after `retention_days` (default 14) | TTL policy is a P4 dev-ops item (`R-07-plan.md`) |
| `threads` | none yet | 14-day retention (hard rule #7a) | ships in P4, §7.2 |
| `capture_sessions`, `label_units`, `heartbeats`, `audit_log` | none | | known gaps |

---

## 7. Planned, not yet built

### 7.1 R-09 approval decisions (`docs/tasks/R-09.md` plan v2, 11 Oct) — **not merged, not live**

**`proposals` gains two optional, nullable fields** (absent on R-08-era docs = null):

```
supervisor_review?: {
  decision: "feasible" | "rejected",
  reason: string(1..500) | null,             // non-null iff rejected; the redacted text createConstraint stored
  acknowledged_constraint_ids: uuid[] (≤200), // late constraints this actor confirmed checking; [] on a rejection
  decided_at_ms: int ≥ 0,
  constraint_id: uuid | null,                 // non-null iff rejected
} | null

owner_decision?: {
  decision: "approved" | "rejected",
  reason: string(1..500) | null,              // non-null iff rejected
  acknowledged_constraint_ids: uuid[] (≤200),
  decided_at_ms: int ≥ 0,
  constraint_id: uuid | null,                 // non-null iff rejected (owner rejections also become constraints)
} | null
```

The actor is identified only by the slot (`supervisor_review` = the supervisor role, `owner_decision` = the owner
role) and by `audit_log.actor_role`. No uid, email, name, staff id or device id.

New `ProposalSchema` invariant (status ↔ decisions):

| `status` | `supervisor_review` | `owner_decision` |
|---|---|---|
| `suppressed`, `blocked`, `awaiting_supervisor` | null | null |
| `awaiting_owner` | `feasible` | null |
| `approved` | `feasible` | `approved` |
| `rejected` | `rejected` | null |
| `rejected` | `feasible` | `rejected` |

Plus: `approved` / `rejected` require `gate.passed === true`. "Nothing ships without both approvals" is therefore
a schema-level invariant, not only a route check.

**`constraints.source` gains `"owner_rejection"`**: `["supervisor_rejection", "owner_rejection", "manual"]`.
`source_proposal_id` becomes non-null iff the source is either rejection. Existing docs are unaffected.

**`audit_log` new actions**: `proposal.feasible`, `proposal.supervisor_rejected`, `proposal.approved`,
`proposal.owner_rejected` (no reason text in audit details).

**Indexes:** none new per the plan (new reads are equality-only, e.g. `outlet_id` + `status`).

### 7.2 Spec-planned, not in `schema.ts` yet
From `docs/specs/web-backend-rbac.md` §6.4 / §6.6; listed so readers do not assume they exist.

| Item | Spec | State |
|---|---|---|
| `capture_gaps/{device_id}:{gap_id}` collection | §6.6.7 (P2) | not in `COLLECTIONS` or `schema.ts` |
| `insight_runs` collection | §6.6.8 (P5) | not in `COLLECTIONS` or `schema.ts` |
| `threads.expires_at` (native Timestamp, TTL) | §6.6.2, hard rule #7a (P4) | not in `ThreadSchema` |
| `outlets.insight_reminder_weekday` | §6.6.2 | not in `OutletSchema` |
| `heartbeats.session_id`, `queued_ms`, `oldest_queued_ms`, `answers_pending`, `answers_pending_oldest_date` | §6.6.2 | not in `HeartbeatSchema` |
| `sop_versions` v2+ writes, `proposals` → `sop_versions.source_proposal_id` link | R-10 | schema ready, no writer |

---

## 8. NoSQL design rationale

**Query-first design.** Every collection is shaped around a small, known set of server-side queries (§6). The
dominant access pattern is "everything for one outlet (and often one device) in a time range", so `outlet_id` is
on every doc and leads every composite index, and time fields are stored as sortable `_ms` integers.

**Flat top-level collections, not nesting under `outlets`.** Firestore subcollections would make outlet scoping
implicit in the path, but the pipeline tick and Cloud Tasks handlers iterate across devices and outlets, and
composite indexes are per collection group anyway. Flat collections plus an explicit `outlet_id` field keep the
RBAC check a single equality the guard can verify. The one exception, `heartbeats`, is a subcollection because it
is high-volume, unbounded, and only ever read per device.

**Embed vs reference.**
- *Embedded* when the child is only read with the parent and is bounded: thread `lines` (copied from segments),
  `gate` verdicts, proposal `content` / `generator` / `gate` / `suppression`, SOP `steps`, device `last_ended`.
- *Copied rather than referenced* when the source expires: segments live 48 h, but a thread must keep its evidence
  for its retention period, so a thread embeds its own redacted, scrubbed line text instead of pointing at a
  segment that will disappear.
- *Referenced by id only* when the target is independently queried or carries text that must not be duplicated:
  `proposals.content.evidence[]` holds `thread_id` + date + category + time, never thread text, so redacted shop
  speech is not fanned out into proposals; `constraint_ids_acknowledged[]` likewise.

**Denormalisation, deliberately small.** `outlet_id` and `device_id` are repeated on every child so each query is a
single-collection equality scan (no joins exist). `questions.category` repeats the thread's category at question time, so a
question doc is self-describing (likely rationale; not stated in code). `sop_version_id` encodes outlet and version so the latest version is
addressable by id.

**Deterministic ids for idempotency.** Segment ids, capture session ids, question ids (`q_thread_<thread_id>`,
`q_<unit_id>`), correction id = question id, lock ids = outlet/device. Combined with `create()` (fails on an
existing doc) this makes phone retries, Cloud Tasks redelivery and duplicate debrief submissions safe without a
separate dedupe table.

**Single-flight leases as documents** (`pipeline_locks`, `proposal_locks`). Firestore has no advisory locks; a lease
doc with `expires_at_ms`, acquired in a transaction that treats a malformed or expired doc as free, gives
one-at-a-time processing that self-heals after a crash.

**Document size.** The only arrays that can grow are thread `lines` / `line_ids` (bounded by thread continuation
grace windows), `segments.lines` (one upload), `sop_versions.steps` (≤ 200), proposal `evidence` (≤ 10) and
acknowledged constraint ids. All stay far below the 1 MiB document limit at shop scale.

**Consistency.** Multi-document invariants (question + correction + thread update; proposal + audit; constraint +
audit; session end + device `last_ended` + audit) are written in one transaction. Reads used for display tolerate
eventual consistency; malformed docs are skipped and logged so one bad doc never blocks a device or a screen.

**Why threads and questions are role-agnostic, and why no names appear outside `staff` (hard rule #7).** The product
records *what happened at work*, not *who did it*. A thread is "a run of work speech from this device"; a question
is "did this moment happen, and why", answerable by anyone at the shop. Storing a target role or an addressee on a
question would let the system profile individuals. So:
- the only personal identifiers in the database live in `staff` (names, used only for the scrub and vocabulary)
  and `users` (owner/supervisor email + Firebase uid for sign-in);
- shop speech is staff-name-scrubbed and SDP-redacted before it reaches `segments`, `threads`, `corrections` or
  `constraints`;
- an answer records only the answering device id and timestamps; supervisors and owners never see that id;
- where an actor must be recorded (proposals, constraints, audit) it is a role.

**Why the evidence gate is stored as data.** `threads.gate` and `proposals.gate` keep the full plain-code verdict
(rule checks, threshold, version), so every fact or blocked proposal is explainable and reproducible without
re-running any model (hard rule #10).

---

## 9. Personal-data map (hard rule #7)

| Collection | Person-identifying fields | Device id | Actor recorded as |
|---|---|---|---|
| `staff` | `name`, `name_key`, `staff_id` (+ dormant PIN fields) | none | n/a |
| `users` | `email`, `uid` | none | `role` |
| `devices`, `heartbeats` | none | `device_id` | n/a |
| `capture_sessions` | none | `device_id` | nobody (no actor field) |
| `segments`, `label_units`, `pipeline_locks` | none | `device_id` | n/a |
| `threads` | none | `device_id` (capture device) | `label_source` (model / staff / supervisor, as a role class) |
| `questions` | none | `device_id` (capture device) | nobody |
| `corrections` | none | `answered_device_id` (never shown to supervisor/owner) | nobody (no role, no `answered_by`) |
| `sop_versions` | none | none | steps carry a job `role` |
| `constraints` | none | none | `created_by_role` |
| `proposals` | none | none | `requested_by_role` (R-09 adds role slots, §7.1) |
| `proposal_locks` | none | none | n/a |
| `audit_log` | none | `details.device_id` on `debrief.answer_uploaded` (operational metadata, as web spec §2a specifies; the actor is still `actor_role: "device"`); `device_id` in the doc id of `capture.session_discarded`. No route returns audit entries | `actor_role` |

**`threads`, `questions`, `corrections`, `proposals`, `constraints` and `audit_log` carry no name and no staff id.**
Free-text fields (`threads.lines[].text`, `summary`, `fields`, `corrections.reason_text`, `constraints.text`,
proposal `content` text, `audit_log.details`) are protected by the scrub + redaction pipeline and by convention,
not by schema shape: zod cannot prove a string contains no name.

---

## 10. Output quality checklist (adapted for Firestore)

SQL-only items (normalisation forms, foreign-key constraints, migration scripts, rollback) do not apply: Firestore
has no DDL, no FKs, and no migrations. Schema evolution here is "add optional fields so old docs still parse"
(`weekly_hours?`, `last_ended?`, `label_source?`, R-09's decision fields), or a read-side shim (`parseOutletDoc`).

- [x] Designed for access patterns: every index and query in §6 traced to a store function.
- [x] Embed vs reference decided per relationship, with reasons (§8).
- [x] Denormalisation is deliberate and listed (§8).
- [x] Indexes listed: 3 composite × 2 projects, plus single-field coverage; one likely gap flagged (§6.3).
- [x] Document size limits considered (§8).
- [x] Eventual consistency / transactions considered (§8).
- [x] Constraints: strict zod objects plus `superRefine` invariants documented per collection.
- [x] Types: enums, int bounds, ISO vs `_ms` vs native Timestamp documented (§1).
- [x] Timestamps on every written collection (`created_at[_ms]`, `ts`, or `received_*`).
- [x] Relationships explicit despite no FKs (§2, §5).
- [x] Naming: snake_case collections and fields, `*_id` ids, `*_ms` epoch ms, consistent across collections.
- [x] Retention / TTL documented, gaps called out (§6.4).
- [x] Personal data boundaries documented (§9).
- [n/a] Migration scripts / rollback: not applicable to Firestore.

---

## 11. Discrepancies noticed while generating this page

Recorded for whoever owns them; this page does not resolve them.

1. **Likely missing composite index**: `threads (outlet_id, device_id, last_line_end_ms)` for the tick's
   `listRecentThreads` (§6.3).
2. **Stale comments in `schema.ts`**: the `users` section says "Google sign-in" and `GoogleUserRoleSchema` lives in
   `lib/auth/roles.ts`, but auth moved to email + password on 9 Oct (CLAUDE.md §3). Comment only, no schema impact.
3. **Spec vs code drift** (§7.2): the web spec says `consent_complete` becomes `optional()`; the code instead strips it
   in `parseOutletDoc`. Same outcome, different mechanism. The heartbeat, outlet and thread additions in web spec
   §6.6.2 are not in the schema yet.
4. **`devices.label`**: hard rule #7 says device docs hold no person's name and web spec §6.4 says "no person's name
   or label", yet `label` is a required string. It is a placement label by convention; nothing in the schema
   enforces that.
5. **`staff.role` and PIN fields** remain required although staff sign-in is dormant in MVP 1 (seed writes them).
6. **No TTL** on `label_units`, `capture_sessions`, `heartbeats`, `audit_log` (known gaps; `label_units` is flagged in
   `tick-store.ts` as a scaling concern).
