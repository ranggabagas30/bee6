# Sandbox sweeper baseline, 17 Oct 2026 (read-only)

Captured: **2026-10-17T11:32:50Z** (now_ms 1792236770707). Project `bee6-playground` (demo). Read-only: Firestore REST
`runAggregationQuery` / list with the gcloud user token, plus one sweeper dry run (no `--yes`). Ids and counts only.

Purpose: before Rangga runs the sweeper with `--yes` on the two sandboxes `sbx-2acefe7f0493` and `sbx-7e127ed2ffb3`, so a later
read-only check can prove only those two disappeared.

**Scope warning.** The command `--database staging --grace-hours 0 --limit 50` selects **8** expired sandboxes, not 2 (list in
section 5). To delete only the two, use `--limit 2`: the selection is oldest-expiry first, so it picks exactly `sbx-2acefe7f0493`
then `sbx-7e127ed2ffb3` (third is `sbx-f06cb4b6cda6`). Without `--limit 2` or a `--keep-prefix` for the other six, the real run
would delete eight.

## 1. staging: outlets (18)

Status vs the capture time above. "n/a" = no `sandbox` object (never swept).

| outlet id | sandbox.expires_at_ms | status |
|---|---|---|
| demo-outlet | none | n/a |
| demo-tpl-outlet | none | n/a (template, never swept) |
| **sbx-2acefe7f0493** | 1792210441438 (2026-10-17T04:14:01Z) | expired, TARGET |
| sbx-37a8a6d91c4b | 1792219812198 (06:50:12Z) | expired |
| **sbx-7e127ed2ffb3** | 1792210645557 (04:17:25Z) | expired, TARGET |
| sbx-87b79b65dc1f | 1792219215248 (06:40:15Z) | expired |
| sbx-8bdab4bdc450 | 1792222086857 (07:28:06Z) | expired |
| sbx-d4b95e403ba0 | 1792220547386 (07:02:27Z) | expired |
| sbx-de195ec44047 | 1792238752478 (~12:05:52Z) | live |
| sbx-f06cb4b6cda6 | 1792210852414 (04:20:52Z) | expired |
| sbx-f0f6c40f1ad9 | 1792220180766 (06:56:20Z) | expired |
| sbx-uitestdebrief | 1792256239505 | live (kept prefix sbx-uitest) |
| sbx-uitestdecided | 1792249127331 | live (kept) |
| sbx-uitestowner | 1792256237069 | live (kept) |
| sbx-uitestproposal1 | 1792251875289 | live (kept) |
| sbx-uitestproposals | 1792251850367 | live (kept) |
| sbx-uitestreviewdue | 1792251883683 | live (kept) |
| sbx-uitesttimeout | 1792249121341 | live (kept) |

Note: `sbx-de195ec44047` expires about 33 min after capture. If it expires before the later check, that is expiry only, not a
sweep, unless Rangga's run includes it (it cannot with `--grace-hours 0` before its expiry).

## 2. staging: counts for the two targets (outlet_id filter)

Collections not listed below were 0 for both targets: windows, pipeline_locks, proposal_locks, constraints, sales_events,
event_cards, outcomes, questions, proposals, reviews, corrections, label_units, segments.

| collection | sbx-2acefe7f0493 | sbx-7e127ed2ffb3 |
|---|---|---|
| devices | 1 | 1 |
| staff | 2 | 2 |
| capture_sessions | 2 | 3 |
| threads | 6 | 6 |
| label_units | 0 | 0 |
| segments | 0 | 0 |
| questions | 0 | 0 |
| proposals | 0 | 0 |
| reviews | 0 | 0 |
| outcomes | 0 | 0 |
| audit_log | 0 | 1 |
| corrections | 0 | 0 |
| sop_versions | 1 | 1 |
| devices/{id}/heartbeats (subcollection) | 0 | 0 |
| outlet doc | 1 | 1 |

These match the sweeper dry-run printout for the same two ids.

### staging: total docs per top-level collection (whole database)

| collection | total |
|---|---|
| outlets | 18 |
| users | 4 |
| staff | 36 |
| devices | 18 |
| segments | 60 |
| capture_sessions | 50 |
| threads | 230 |
| questions | 56 |
| label_units | 8 |
| corrections | 41 |
| sop_versions | 21 |
| proposals | 12 |
| constraints | 3 |
| reviews | 1 |
| audit_log | 56 |
| demo_counters | 89 |
| windows, pipeline_locks, proposal_locks, outcomes, sales_events, event_cards | 0 |

### Expected staging totals after deleting ONLY the two targets

outlets 16, devices 16, staff 32, capture_sessions 45, threads 218, audit_log 55, sop_versions 19. Everything else unchanged:
users 4, segments 60, questions 56, label_units 8, corrections 41, proposals 12, constraints 3, reviews 1, demo_counters 89.
Surviving outlet ids: the 16 in section 1 minus the two bold ones. `demo_counters` and `users` carry no per-outlet delete in the
sweeper, so they should not change. Firebase Auth users are not touched unless `--auth` is passed.

## 3. (default): outlets (30) and totals

Outlets: `demo-outlet`, `demo-tpl-outlet` (neither has a sandbox object), plus 28 `sbx-*` outlets, all expired (no live
sandbox, no `sbx-uitest*`). Ids with expires_at_ms:

sbx-011317babd70 1792088825103 | sbx-148e94c793e5 1792087719599 | sbx-1b0f3e2f2dcf 1792100955705 | sbx-1bfa1ff6a49c 1792106435568 |
sbx-1fdd61ed0354 1792106008702 | sbx-2224cfa36c67 1792106439494 | sbx-337bb9345c07 1792106008693 | sbx-49a8be99692d 1792089817085 |
sbx-4b84551d79cd 1792101119623 | sbx-4f95f6e9b784 1792096410840 | sbx-4fc34f891197 1792106435573 | sbx-518adff219cb 1792101869923 |
sbx-63ae23240db8 1792206880553 | sbx-6585725b8fa2 1792101119406 | sbx-687b957069d0 1792101874820 | sbx-6ffa91e30330 1792096410890 |
sbx-708926de06c5 1792101874473 | sbx-7af31ca61115 1792087683942 | sbx-7daadfccd76a 1792106008719 | sbx-906d301f6671 1792096410957 |
sbx-93a124766ee0 1792106008699 | sbx-94d997bdbae8 1792101874882 | sbx-a42a9b39851f 1792101119388 | sbx-a62e5221bb97 1792096410854 |
sbx-ab638419bd76 1792106439793 | sbx-cac09a73c584 1792101119377 | sbx-e967e257a113 1792101869999 | sbx-f92a3df27b06 1792101870296

Totals per top-level collection in `(default)`: outlets 30, users 4, staff 60, devices 30, segments 442, capture_sessions 140,
threads 596, questions 90, label_units 86, corrections 27, sop_versions 35, proposals 25, constraints 1, reviews 5, audit_log 252,
demo_counters 272; windows, pipeline_locks, proposal_locks, outcomes, sales_events, event_cards all 0.

Expected after the staging sweep: **all unchanged** (the run is `--database staging`).

## 4. Sweeper dry run (no --yes), as run

`DEMO_MODE=true GOOGLE_CLOUD_PROJECT=bee6-playground npm run sweep:sandboxes -- --database staging --grace-hours 0 --limit 50`
from `bee6-sweeper` (commit 42db22d): "8 sandbox(es) selected, 0 skipped ... Dry run done: 8 would be deleted."

## 5. The 8 selected by that dry run (oldest first)

| id | expired at (UTC) | counts shown by sweeper |
|---|---|---|
| sbx-2acefe7f0493 (TARGET) | 04:14:01 | dev1 staff2 cs2 thr6 aud0 seg0 |
| sbx-7e127ed2ffb3 (TARGET) | 04:17:25 | dev1 staff2 cs3 thr6 aud1 seg0 |
| sbx-f06cb4b6cda6 | 04:20:52 | dev1 staff2 cs4 thr6 aud4 seg13 |
| sbx-87b79b65dc1f | 06:40:15 | dev1 staff2 cs3 thr6 aud2 seg6 |
| sbx-37a8a6d91c4b | 06:50:12 | dev1 staff2 cs3 thr6 aud2 seg6 |
| sbx-f0f6c40f1ad9 | 06:56:20 | dev1 staff2 cs5 thr6 aud8 seg6 |
| sbx-d4b95e403ba0 | 07:02:27 | dev1 staff2 cs3 thr6 aud2 seg6 |
| sbx-8bdab4bdc450 | 07:28:06 | dev1 staff2 cs4 thr6 aud5 seg5 |

(cs = capture_sessions, thr = threads, aud = audit_log, seg = segments.)

## 6. Later read-only check

Re-list `outlets` in staging: expect 16 docs, the two target ids absent, all other ids and expires_at_ms identical to section 1
(only `sbx-de195ec44047` may flip live to expired). Re-count per-collection totals against section 2's "expected" row. Check
`(default)` is identical to section 3.

## 7. After the sweep (read-only check, 2026-10-17T11:40Z)

Method: Firestore REST (`runAggregationQuery`, list, `runQuery` on the `heartbeats` collection group) with the gcloud user
token, plus the sweeper dry run (no `--yes`). Run after Rangga's `--database staging --grace-hours 0 --limit 2 --yes`
(2 deleted, 0 failed).

**Result: PASS on every item. No surprises.**

- Both target outlet docs return 404. Every outlet-scoped collection (devices, staff, capture_sessions, threads, label_units,
  segments, questions, proposals, reviews, outcomes, audit_log, corrections, sop_versions, constraints, windows, sales_events,
  event_cards, lock collections) counts 0 for both ids. A full-database orphan sweep (every doc's `outlet_id` against the 16
  live outlets) found 0 orphans. All 10 `heartbeats` docs sit under devices that still exist (none under a deleted device).
- staging totals equal the expected "after" row exactly: outlets 16, devices 16, staff 32, capture_sessions 45, threads 218,
  audit_log 55, sop_versions 19; unchanged: users 4, segments 60, questions 56, label_units 8, corrections 41, proposals 12,
  constraints 3, reviews 1, demo_counters 89. No tick drift.
- Surviving 16 outlets are the section 1 list minus the two targets; expires_at_ms identical. The 7 `sbx-uitest*`, `demo-outlet`,
  `demo-tpl-outlet` and the 6 other expired sandboxes remain. `sbx-de195ec44047` is still live (expires ~12:05:52Z).
- `(default)`: 30 outlets (same ids and expires_at_ms), totals identical to section 3 (staff 60, devices 30, segments 442,
  capture_sessions 140, threads 596, questions 90, label_units 86, corrections 27, sop_versions 35, proposals 25, constraints 1,
  reviews 5, audit_log 252, demo_counters 272). No drift.
- Dry run (`--database staging --grace-hours 0 --limit 50`): 6 selected (f06cb4b6cda6, 87b79b65dc1f, 37a8a6d91c4b,
  f0f6c40f1ad9, d4b95e403ba0, 8bdab4bdc450), with per-sandbox counts identical to section 5. Neither deleted id appears.
- Services: `web-develop` /api/health 200 (revision 00041-rrt, deployed 11:13Z, before baseline); `web` /api/health 200
  (revision 00021-qxv, last changed 2026-10-16T03:24Z, untouched). No ERROR-or-worse Cloud Run logs in the prior ~12 min.
  `pipeline-tick-staging` ticks every 2 min, latest 11:40:04Z POST /api/internal/pipeline/tick 200 (scheduler status 200).

## 8. After the full sweep (read-only check, 2026-10-17T11:46Z)

Context: Rangga then ran (a) `--database staging --grace-hours 0 --yes` (6 sandboxes deleted, 0 failed: f06cb4b6cda6, 87b79b65dc1f,
37a8a6d91c4b, f0f6c40f1ad9, d4b95e403ba0, 8bdab4bdc450) and (b) the same plus `--auth --yes` (10 Firebase Auth users deleted, 0 failed).
Method: Firestore REST full document list of every collection in both databases, a `heartbeats` collection-group query, an
outlet_id orphan scan, Identity Toolkit `accounts:batchGet` (uid, provider, claims only; no emails or tokens read out), and two
sweeper dry runs (no `--yes`). Nothing written.

**Result: PASS on all 6 items. No surprises.**

1. Outlets gone, zero orphans: PASS. None of the 6 ids is in the staging outlet list. Orphan scan over every doc of every
   outlet-scoped collection (staff, devices, segments, capture_sessions, threads, questions, label_units, corrections,
   sop_versions, proposals, constraints, reviews, audit_log, windows, locks, outcomes, sales_events, event_cards) against the 10
   live staging outlets: 0 orphans. `heartbeats`: 2 docs, both under existing devices, 0 under a missing device (was 10 before).
2. Outlet count and totals: PASS (actual = expected). 10 outlets: 7 `sbx-uitest*`, `demo-outlet`, `demo-tpl-outlet`,
   `sbx-de195ec44047` (still live). Expected = section 7 totals minus the six sandboxes' sweeper-reported counts (devices 6, staff 12,
   capture_sessions 22, threads 36, audit_log 23, segments 42, sop_versions 6):

   | collection | section 7 | removed | expected | actual |
   |---|---|---|---|---|
   | outlets | 16 | 6 | 10 | 10 |
   | devices | 16 | 6 | 10 | 10 |
   | staff | 32 | 12 | 20 | 20 |
   | capture_sessions | 45 | 22 | 23 | 23 |
   | threads | 218 | 36 | 182 | 182 |
   | audit_log | 55 | 23 | 32 | 32 |
   | segments | 60 | 42 | 18 | 18 |
   | sop_versions | 19 | 6 | 13 | 13 |
   | users / questions / label_units / corrections / proposals / constraints / reviews / demo_counters | 4 / 56 / 8 / 41 / 12 / 3 / 1 / 89 | 0 | same | 4 / 56 / 8 / 41 / 12 / 3 / 1 / 89 |
   | windows, locks, outcomes, sales_events, event_cards | 0 | 0 | 0 | 0 |

   No other difference: no live-activity or TTL drift.
3. Kept outlets unchanged: PASS. All 7 `sbx-uitest*` have the same expires_at_ms as section 1 (debrief 1792256239505, decided
   1792249127331, owner 1792256237069, proposal1 1792251875289, proposals 1792251850367, reviewdue 1792251883683, timeout
   1792249121341); `sbx-de195ec44047` 1792238752478 (live, expires ~12:05:52Z); `demo-outlet` and `demo-tpl-outlet` have no sandbox object.
4. `(default)` unchanged: PASS. 30 outlets (same ids and expires_at_ms as section 3), totals identical (staff 60, devices 30,
   segments 442, capture_sessions 140, threads 596, questions 90, label_units 86, corrections 27, sop_versions 35, proposals 25,
   constraints 1, reviews 5, audit_log 252, demo_counters 272, users 4); 455 heartbeats, 0 orphan; 0 orphan docs.
5. Auth: PASS. The 10 deleted users map to six sandbox ids (af24fdc55221, cab0f50131ce, dcbc40f8ae31, f06cb4b6cda6, 720c19a50427,
   75efac5dcef1). None exists as an outlet in `(default)` or `staging` now. The sweeper deletes only uids matching
   `demo-(owner|supervisor)-sbx-<12 hex>` whose outlet is absent in every known database, so it cannot match a real password account.
   Remaining Auth users: **22** = 2 password users (1 owner, 1 supervisor, both claimed to `demo-outlet`, untouched) + 8
   `demo-owner-sbx-*` + 12 `demo-supervisor-sbx-*` = 20 demo-* custom-token users, 0 other custom-token device users. Every remaining
   `demo-*-sbx-*` maps to a live outlet: 5 hex ids (1b0f3e2f2dcf, 6ffa91e30330, 7af31ca61115, 906d301f6671, ab638419bd76) plus
   148e94c793e5, 49a8be99692d, a62e5221bb97 in `(default)`, and 6 uitest fixtures in staging. The two password uids equal the
   `uid` of the `demo-outlet` owner and supervisor `users` docs in `(default)`; they are stable accounts with different uids from
   any `demo-<role>-sbx-*`, so demo owner/supervisor email sign-in is unaffected (conceptually; no sign-in attempted).
   Observation, not caused by the sweep: the 4 staging `users` docs have `uid = null` (users total unchanged at 4; the sweeper does not touch `users`).
   Dry run `--auth` now: "0 orphaned demo user(s)".
6. Services: PASS. `web-develop` /api/health 200 (revision 00041-rrt, 2026-10-17T11:13Z, unchanged since section 7); `web` /api/health
   200 (revision 00021-qxv, 2026-10-16T03:24Z, untouched). 0 ERROR-or-worse Cloud Run logs in the last 10 min. `pipeline-tick-staging`
   ENABLED, `*/2`, latest ticks 11:40, 11:42, 11:44Z all POST /api/internal/pipeline/tick 200. Staging dry run
   (`--grace-hours 0 --limit 50`): "0 sandbox(es) selected" (only `sbx-de195ec44047` is non-expired; the `sbx-uitest*` prefix is kept).
