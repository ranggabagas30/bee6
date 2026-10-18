# Data housekeeping review: what a demo sandbox leaves in Firestore (17 Oct, tech-lead, read-only)

Scope: code at `origin/develop` 09365e6 (read in a detached scratch worktree; nothing edited, no gcloud). Live counts
quoted come from dev-ops entries in `docs/tasks/R-01-gcp-state.md`, not from a fresh read. Question from Rangga: with
many QA runs and many judges creating sandboxes, what accumulates, what cleans it up, and can we hit a limit.

**Short answer:** nothing hits a hard Firestore limit at any plausible judging volume. A sandbox is a few hundred small
documents; 100 judges is tens of thousands of documents and tens of MB. There IS a cleanup path already (lazy, 2 expired
sandboxes deleted per new sandbox, 24 h after expiry) plus TTL on the three high-churn collections. The gaps are
hygiene, not capacity: cleanup only runs while new sandboxes keep being created, Firebase Auth user records for demo
owner/supervisor sign-ins are never deleted, and the `sbx-uitest*` fixtures are themselves swept by the same lazy
cleanup. A sweeper script is worth ~2 h **after** submission, not before the freeze.

## 1. What a sandbox (`sbx-<12 hex>`) creates

### 1a. On clone (`POST /api/v1/demo/session` without a key)
`lib/demo/clone.ts:261-326` (`cloneTemplate`) copies the template outlet into fresh ids. With the current template
(6 threads, 2 sessions, 2 staff, 0 questions: `R-01-gcp-state.md:815`) that is **13 docs**:

| Collection | Docs | Source line |
|---|---|---|
| `outlets/sbx-…` (carries `sandbox.{created_at_ms, expires_at_ms, key_sha256}`) | 1 | clone.ts:262-269 |
| `staff/sbx-…:<staff_id>` (names, for the scrub only) | 2 | clone.ts:272-275 |
| `sop_versions/sbx-…:v1` | 1 | clone.ts:278-279 |
| `devices/sbx-…:jdg-…` (judge phone, `expires_at_ms` = sandbox expiry) | 1 | clone.ts:282-295 |
| `capture_sessions` | 2 | clone.ts:298-301 |
| `threads` | 6 | clone.ts:304-312 |
| `questions` | 0 today (`CARRY_OVER_MAX = 0`, constants.ts:21) | clone.ts:315-325 |

Not cloned: segments, label_units, audit_log, heartbeats (the template's own are left behind, `demo-store.ts:164-213`
reads only outlet/device/sop/staff/sessions/threads/questions). The whole clone is one batched `create`
(`demo-store.ts:237-251`), guarded so only `sbx-` docs can ever be written (line 240-243).

Also written at creation: `demo_counters/sandbox_day:<day>`, `demo_counters/<ip-hash bucket>` (service.ts:129-135) and,
for owner/supervisor, a Firebase custom token with uid `demo-<role>-sbx-…` (service.ts:294-298).

### 1b. During a run (3 demo days, ≤ 20 min capture each: `DEMO_SESSION_MAX_MS`, constants.ts:23)
| Family | Growth per sandbox | Bound | TTL field? |
|---|---|---|---|
| `segments` (redacted text only) | 1 per uploaded segment; measured avg ~15/sandbox (444 segs / 28 sbx on `(default)`, R-01-gcp-state.md:994) | `SEGMENT_PER_SANDBOX = 150` (constants.ts:45) | **yes**, `expires_at` 48 h (schema.ts:374-375, stores.ts:58) |
| `label_units` (per-line ledger) | ~1 per segment | same | no |
| `threads` | measured avg ~20/sandbox (596 / 28) | pipeline-bound | **no** (P4 not shipped; see §3) |
| `questions` (+ the `answer`/`answered_at_ms` fields live ON the question doc, clone.ts:318) | a few per debrief | gate-bound | no |
| `corrections` | 0-few (confirm/override) | small | **yes**, `expires_at` 14 d (schema.ts:618) |
| `proposals` / `proposal_locks` | ≤ 8 proposals (`GENERATE_PER_SANDBOX`, constants.ts:41) + 1 lock doc | | no (lock has `expires_at_ms` number, not a TTL) |
| `sop_versions`, `reviews`, `outcomes`, `constraints` | 1-3 each | | no |
| `audit_log` | ~1 per decision/ship/review + 1 `capture.session_cleanup` per discarded session (tick-store.ts:671) | ~5-20 | no |
| `pipeline_locks/<outlet>:<device>` | exactly 1 doc, overwritten each tick (tick-store.ts:296-317) | 1 | no (bounded) |
| `devices/…/heartbeats/<ts>` | 1 per minute while `/capture` is open (`HEARTBEAT_INTERVAL_MS = 60_000`, browser/session.ts:29; stores.ts:172-178) | ≤ ~60 | no |
| `demo_counters` | ~10-20 per sandbox (switch, segment, redact, generate, next_day, reset, fast_forward, process_now kinds) + up to 1 `charge_once:segment:<outlet>:<seg>` marker per segment (caps.ts:221) | measured 272 counters / 28 sbx | **yes**, `expires_at` +2 d (caps.ts:205, constants.ts:85) |
| Firebase Auth users | 1 per role signed in via custom token (uid `demo-owner-sbx-…`, `demo-supervisor-sbx-…`) | ≤ 2 | never deleted (no `deleteUser` anywhere in `lib/ app/ scripts/`) |
| `users` collection | none for sandboxes (only seed/provision write it: stores.ts:266, seed.ts:376) | 0 | - |

The judge **device** does not create an Auth user: device calls are a bearer token checked against the device doc's
`token_hash` (`lib/http/guard.ts:98-115`), so devices never pile up in Firebase Auth.

**Rough size per sandbox:** 13 docs at clone; after a full 3-day journey roughly 150-400 docs. Documents are small
(threads a few KB with their line arrays; everything else < 1 KB). Call it **~0.3-0.6 MB per sandbox including index
entries**. Not measured live; order of magnitude only.

## 2. Expiry, TTL and what actually deletes a sandbox

**Sandbox expiry (2 h, `SANDBOX_TTL_MS`, constants.ts:16) only blocks access.** Past `sandbox.expires_at_ms`:
role switch is refused 409 `SANDBOX_EXPIRED` (service.ts:252-253), caps refuse (caps.ts), reset refuses
(service.ts:413-414), and the pipeline tick skips the judge device (`tick-store.ts:200`, in-memory filter after reading
every non-revoked device doc). Nothing is deleted at the 2 h mark.

**What deletes it: lazy cleanup, already in develop.** Every successful new-sandbox request runs `cleanupExpired`
(service.ts:137, 187-208): `listExpiredSandboxes` returns at most `CLEANUP_PER_CREATE = 2` outlets whose
`sandbox.expires_at_ms < now - CLEANUP_GRACE_MS` (24 h grace; demo-store.ts:295-303, constants.ts:18, 79), oldest first,
and `deleteSandbox` (demo-store.ts:314-330) removes heartbeats, devices, then every collection in
`SANDBOX_COLLECTIONS` (demo-store.ts:47-67: staff, capture_sessions, threads, questions, sop_versions, proposals,
proposal_locks, constraints, reviews, outcomes, audit_log, corrections, label_units, pipeline_locks, segments, windows,
sales_events, event_cards) by `outlet_id ==`, and the outlet doc last. A failing sandbox is quarantined behind the queue
(`deferSandboxCleanup`, demo-store.ts:305-312). Guards: refuses any id not starting with `sbx-` AND lacking a
`sandbox` object (demo-store.ts:315-316), so `demo-tpl-outlet`, `demo-outlet` and the pilot outlet can never be hit.

Consequences of "lazy":
- Deletion only keeps pace while sandboxes keep being created: 2 deleted per 1 created, so a backlog drains only under
  continued traffic. After judging ends, whatever is left just sits (fictional data; a hygiene point, not a rule).
- The delete rides on a judge's first request: 2 sandboxes × (~20 collection queries + batch commits) sequential
  round-trips. Expect roughly 1-3 s added to `POST /demo/session` when there is a backlog. Not measured; the code itself
  flags it as a follow-up ("move cleanup to a Cloud Tasks job", service.ts:185).
- **Not cleaned with the sandbox:** its `demo_counters` docs (TTL handles them, 2 d) and the two Firebase Auth user
  records (never).

**TTL policies (Firestore `fields ttls`, verified by dev-ops, not by me):** `segments.expires_at`, `corrections.expires_at`
and `demo_counters.expires_at` are ACTIVE on `bee6-playground` `(default)`, on the pilot project, and on the `staging`
database (R-01-gcp-state.md:761, 858, 985). The `docs/HANDOFF.md:112` item "TTL on demo_counters.expires_at" still listed
as an open infra go is stale: R-01-gcp-state.md:570 and :827 record it as already ACTIVE. No other collection has a TTL
field, so nothing else can get a policy without a schema change.

**Owner reset** (`POST /api/v1/demo/reset`, service.ts:395-514) wipes and re-clones ONE sandbox (same id/key/expiry);
it is per-sandbox, not a sweeper.

**`sbx-uitest*` fixtures (branch `feature/uitest-seed`, not on develop):** `scripts/seed-ui-states.ts:735-743` sets the
outlet and device `expires_at_ms` to `--ttl-hours` (1-48). They therefore fall into the lazy cleanup window at most
**72 h after seeding** (48 h + 24 h grace) and will be deleted by the next sandbox creation on `staging`. Not a bug,
but QA should re-seed (`npm run seed:ui-states -- --scenario all`) before a UI run rather than assume they persist. If
Rangga wants them permanent, the sweeper draft below skips the prefix; the lazy cleanup today does not.

## 3. 14-day thread retention (CLAUDE.md §2 7a): NOT implemented
`ThreadSchema` (schema.ts:499-…) has no `expires_at`; `docs/db-schema.md:1276` lists `threads.expires_at` as "not in
ThreadSchema"; `docs/plan.md:220` keeps P4 (expires_at + TTL policy + backfill) as unshipped; CLAUDE.md 7a itself says
"until P4 ships, threads have no expiry". The clone code even carries a warning for when it lands (clone.ts:132-134:
`expires_at` must be excluded from the time shift). So on the pilot, threads, label_units, questions, audit_log and
heartbeats accumulate without bound today. For the demo this is moot: sandbox deletion removes threads with the outlet.
Pilot volume (one phone, one outlet) is small enough that this is a privacy-commitment gap, not a capacity one.

## 4. Growth estimate and where the first real limit is
Baseline on 17 Oct, `(default)` in bee6-playground: 30 outlets (28 sandboxes), 444 segments, 596 threads,
272 demo_counters (R-01-gcp-state.md:994); the `staging` DB had 3 outlets after the proof run (:992).

| Scenario | New docs | Storage | Writes |
|---|---|---|---|
| 100 judge sandboxes, full journey | ~20-40 k | ~30-60 MB | ~50-80 k (incl. counter transactions and ~2 lease writes per tick per live device) |
| Worst case QA: `SANDBOX_DAILY = 300` (constants.ts:36) every day for a week, no cleanup | ~0.5-0.8 M | ~0.5-1 GB before TTL; 48 h segment TTL and 2 d counter TTL take ~40% back | ~1-1.5 M/week |

Both projects are paid (hard rule 4), so the Firestore free quotas (1 GiB, 20 k writes/day, 50 k reads/day) are
billing thresholds, not caps; the judging scenario costs cents. Real hard limits and their distance:
- **1 MiB per document / 40 k index entries per document:** only thread docs grow (line arrays); a 20-min demo day is
  nowhere near it. The pilot (a full shop day) is the only place to watch; still far.
- **500 ops per batch:** respected (`WRITE_BATCH_MAX = 400`, constants.ts:31; `MAX_DELETE_PASSES = 200` guard,
  demo-store.ts:95; the delete throws rather than loops forever at 80 k docs per collection per sandbox).
- **Reads per tick:** `listActiveDevices` reads EVERY non-revoked device doc every 2 min (tick-store.ts:192) and only
  then skips expired ones in memory. Un-swept sandboxes therefore cost ~720 × N device reads per day (N = 200 lingering
  devices → ~150 k reads/day, a few cents) and lengthen the tick. This is the first thing that drifts if cleanup stalls;
  it is cost, not a limit.
- **Transaction contention** on the shared `sandbox_day`/`model_day` counters surfaces as 429 `demo_busy`
  (demo-store.ts:155-160), already handled; a flood of judges hits that long before any storage number.

Conclusion: **no quota or storage limit is reachable at hackathon scale**, with or without the sweeper.

## 5. Existing cleanup tools, and a sweeper draft
Exists today: (a) the lazy cleanup above (develop); (b) `seed-ui-states --delete` for `sbx-uitest*` only (unmerged
branch); (c) owner reset per sandbox. There is **no** bulk sweep script, no admin route, no Scheduler job, and no
deletion of Firebase Auth demo users. `app/api/internal/` has only `pipeline/tick` and `reviews/run`.

### Draft: `scripts/sweep-sandboxes.ts` (`npm run demo:sweep`) — ~1.5 h developer + 0.5 h review, after submission
Reuses `firestoreDemoStore(db)` so no new delete logic: loop `listExpiredSandboxes(now, --limit)` → `deleteSandbox(id)`
until empty, logging id and doc counts only.
- **Guards (all fail closed, before any read):** `DEMO_MODE === "true"`; `GOOGLE_CLOUD_PROJECT` must equal
  `bee6-playground` (constant) and must NOT equal the pilot id (second constant, same pattern as
  `scripts/demo-seed-template.ts`); `--database <id>` required and echoed (`staging` first; `(default)` only with
  `--database default --yes`); `--dry-run` is the default and prints the ids it would delete; `--yes` to execute.
- **Never touched:** anything not prefixed `sbx-` (the store already refuses, demo-store.ts:315-316, so
  `demo-tpl-outlet`, `demo-outlet` and the pilot outlet are safe twice); `--keep-prefix sbx-uitest` default so fixtures
  survive; the store's `sandbox` object check means a malformed outlet is skipped, not deleted.
- **Options:** `--grace-hours` (default 24, same as `CLEANUP_GRACE_MS`; `0` allowed with `--yes` for a full reset of a
  staging DB), `--limit` (default 50).
- **Auth phase (`--auth`):** `adminAuth().listUsers()` paging; delete only uids matching
  `^demo-(owner|supervisor)-sbx-[0-9a-f]{12}$` whose `outlets/<id>` doc no longer exists; dry-run lists them first.
- **Tests:** unit test with a fake store asserting (1) refuses on wrong project / missing database / pilot id,
  (2) skips keep-prefix, (3) dry-run performs no delete, (4) auth deletes only orphaned demo uids.
- Optional later: a Cloud Scheduler-driven `/api/internal/demo/sweep` (OIDC, same pattern as the tick) so cleanup leaves
  the judge's request path. Not needed for judging.

### Recommendation
**Do not build before the freeze.** The lazy cleanup plus the three TTL policies already bound the demo footprint, the
numbers above are far from any limit, and a new destructive script merged in the last hours is exactly the kind of
change that can touch the wrong database. If anything is done tonight, keep it read-only: dev-ops can run a count of
`outlets` where `sandbox.expires_at_ms < now - 24h` on `(default)` and `staging` to size the backlog. Build the sweeper
and run it on `staging` first in the post-submission cleanup, together with P4 (thread retention) for the pilot.

## 6. Not verified / open
- Live doc counts, doc sizes and the actual latency cost of the lazy cleanup (no gcloud, no live reads here).
- Whether the project runs plain Firebase Auth (no user-count charge) or Identity Platform (per-MAU billing above the
  free tier); either way ≤ 2 users per sandbox is harmless, but orphaned uids remain until the `--auth` phase exists.
- The `(default)` sandbox that vanished between 01:13Z-01:20Z on 17 Oct (HANDOFF.md:44): the only code path that deletes
  a sandbox is `cleanupExpired` inside a successful new-sandbox request or a reset; logs reportedly showed neither.
  Unexplained; it is not the pattern of a bug I can see in this code.
- `listExpiredSandboxes` filters and orders on the nested field `sandbox.expires_at_ms`; Firestore's automatic
  single-field index covers this, so no composite index should be needed, but I did not confirm it against the live
  index list on `staging`.
