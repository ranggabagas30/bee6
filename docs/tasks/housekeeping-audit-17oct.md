# Housekeeping audit, bee6-playground (demo), 17 Oct 2026

READ-ONLY. Nothing was created, changed, enabled or deleted. Every command below marked DRAFT was NOT run.
Measured live on 17 Oct ~11:00 UTC with `gcloud`, the Firestore/Monitoring/Identity Toolkit REST APIs (read-only calls), and the repo at `origin/main` (5a47d02).
Pilot project `<PILOT_PROJECT_ID>`: SKIPPED on purpose (not inspected routinely, holds real data). Only `gcloud billing projects describe` was run: billing enabled. Run the same audit there after submission if Rangga wants it.

## Verdict

Nothing here can hit a hard limit before or on judging day (18 Oct). Every hard limit is far away (see "Limits vs usage"). The real exposure is cost creep and three small safety gaps. Nothing needs to be changed before judging unless Rangga wants the two cheap safety items (budget alert, Firestore delete protection).

Judging-day relevant (do before 18 Oct only if Rangga agrees, both low risk):
1. No budget and no alert policy exist (billing budget API is not even enabled). A runaway loop or a judge-day flood would be silent. Draft in section B1.
2. `(default)` DB (used by `web`, the judged service) has delete protection OFF, PITR OFF, no backup schedule. Draft in section B2.

Everything else can wait until after submission.

## Summary table

| # | Resource | Current size/count | Growth | Risk vs limit | Recommended retention | 
|---|---|---|---|---|---|
| 1 | Artifact Registry repo `bee6` (asia-southeast2) | 26.5 GB (API "Repository Size"), 56 images: `web` 17 (~9.0 GB listed), `web-develop` 39 (~24.5 GB listed; layers are shared so real total is 26.5 GB). All images ~0.45 to 0.63 GB, all tagged with a short SHA. No cleanup policy. | web-develop: 39 images in 6 days (17 on 15 Oct, 4 on 16 Oct, 8 on 17 Oct) = about 5 GB/day gross when active | LOW (no hard limit; cost only, ~$0.10/GB-month assumed, first 0.5 GB free, so ~$2.6/month now. Unverified rate: pricing page was truncated) | keep latest 5 to 8 per package + explicitly protected digests; delete the rest after 7 days |
| 2 | Cloud Run revisions `web` | 21 revisions; 4 addressable (00021 at 100%, plus tags good-1015-1624 on 00015, good-1015-2006 on 00016, candidate-1016 on 00020); 17 at 0% with no tag | ~1 to 3 per day | LOW. Cloud Run limit: "1000 per service, after which non-addressable revisions are automatically deleted in historical order"; 4000 serving-traffic revisions per project+region | nothing to do; optional prune after submission |
| 2 | Cloud Run revisions `web-develop` | 41 revisions; only 00041-rrt serves traffic; 00040-zbm (rollback) has NO tag; 40 at 0% with no tag | ~10 per day on busy days | LOW (same 1000 auto-prune). Risk is the opposite: the 1000 auto-prune only keeps addressable ones, so tag the rollback revision | tag 00040 `rollback-1017` so it is addressable and visible |
| 3 | Cloud Build | 95 build records (53 SUCCESS, 41 FAILURE, 1 CANCELLED), avg success ~7.0 min; 2 triggers (`bee6-web-main`, `bee6-web-develop`); logging is `CLOUD_LOGGING_ONLY` so no log bucket | 8 builds on 17 Oct, 22 on 15 Oct | LOW | build history is free metadata; keep. Free tier of build minutes is in the billing console, not measured |
| 3 | GCS | exactly 1 bucket: `gs://bee6-playground_cloudbuild` (US multi-region, STANDARD, no lifecycle, 7-day soft delete), 1 object: a 1.23 MiB source tgz from 12 Oct | none (the CI trigger does not use it; it came from a one-off source deploy on 12 Oct) | LOW. No audio or unexpected buckets. Note: bucket is in US, outside `asia-southeast2`; it only holds build source (public repo code), not shop data, so hard rules 2 and 5 are not touched, but it is a deviation worth deleting later | delete the object and bucket after submission, or add 30-day lifecycle (draft B5) |
| 4 | Firestore `(default)` (used by `web`) | ~2,553 docs across 16 top-level collections + `heartbeats` subcollection (455); 4 composite indexes (limit 1000); TTL on `segments`, `corrections`, `demo_counters` (all ACTIVE) | see "Firestore detail" | LOW | see below |
| 4 | Firestore `staging` (used by `web-develop`) | ~777 docs; same 4 indexes, same 3 TTLs ACTIVE | same | LOW | same |
| 4 | Sandboxes (`sbx-*`) | `(default)`: 28 sandbox outlets (27 are past expiry + 24 h grace and still not deleted); `staging`: 17 (8 expired, none past grace; 6 are `sbx-uitest*` QA fixtures) | `(default)`: 27 created 15 Oct, 1 on 17 Oct | LOW | cleanup exists in code but is lazy (see below) |
| 5 | Firebase Auth | 32 users in the project (shared by both DBs): 30 custom-token (sandbox/judge devices), 2 email+password. Created 10-15: 16, 10-17: 9, 10-13: 3, 10-10: 2, 10-12: 2 | about 1 per sandbox | LOW (Identity Platform free tier is 50k MAU; custom tokens are not auto-deleted) | delete judge/sandbox users after submission if wanted |
| 5 | Cloud Scheduler | `pipeline-tick` */2 ENABLED, `review-run` 09:00 ENABLED, `pipeline-tick-staging` */2 ENABLED, `review-run-staging` PAUSED | fixed | LOW. NOTE: HANDOFF says staging jobs were left PAUSED; `pipeline-tick-staging` is ENABLED now (every 2 min against web-develop). May be intentional, flag only | pause staging tick when staging is idle |
| 5 | Cloud Tasks | 1 queue `pipeline`, RUNNING, 0 queued tasks | none | LOW | none |
| 5 | Secret Manager | 2 secrets (`THREAD_HANDLE_KEY`, `demo-ip-salt`), 1 enabled version each, 0 old versions | none | LOW | none |
| 5 | Cloud Logging | `_Default` 30 days, `_Required` 400 days (locked); no custom sinks, no exclusions checked (exclusions listing not supported by this gcloud) | ingest 4.5 to 6.7 MB/day normal, 13.3 MB (17 Oct), 24.5 MB (16 Oct load test) | LOW (50 GiB/month free per project is the usual allowance, not re-verified in docs this run) | keep 30 days, fine |
| 5 | Budget / alerts | NONE found: alert policies `{}`, notification channels `{}`; Billing Budget API not enabled on the project so budgets could not be listed | n/a | MED (silent cost or flood) | create one budget with 50/90/100% alerts (B1) |
| 6 | Cloud Run `web` min instances | `minScale=1`, maxScale 3, 1 vCPU / 512 Mi, concurrency 80, startup CPU boost | fixed cost, always on | LOW (my rough estimate ~$7 to $9/month idle; not billed-checked) | keep 1 through judging, set to 0 after |
| 6 | Firestore ops (project-wide, both DBs) | reads/day: 15.7k, 19.3k, 15.0k, **136k (16 Oct)**, 76k (17 Oct so far); writes/day: 881, 957, 756, **10.2k (16 Oct)**, 2.8k; deletes/day: 724, 842, 747, 2.7k, 1.7k | spikes on QA/load-test days | LOW (billing enabled, so free-tier overage is billed at cents; see below) | none |

## 1. Artifact Registry detail

- One repo `asia-southeast2-docker.pkg.dev/bee6-playground/bee6` (DOCKER, Google-managed key). `list-cleanup-policies`: `[]`, "Dry run is disabled" (i.e. no policies, nothing deletes). Vulnerability scanning is disabled (API not enabled), which also avoids scan cost.
- Images tagged only by short commit SHA; there is no `latest`/stable tag. That means a policy based on "untagged" would delete nothing, and a policy based on age would also delete the rollback images unless they are protected explicitly.
- Cloud Run does NOT hold a reference that stops Artifact Registry deleting an image. A deleted image breaks only when Cloud Run needs to pull it (new instance, scale-out, or re-deploy of that revision). The docs fetched did not state any protection either way, so treat the images behind live revisions as unprotected.

### Digests that MUST be kept (all verified against the live revision list and traffic config)

| Service | Revision / tag | Short SHA tag | Full digest |
|---|---|---|---|
| web | 00021-qxv (100% traffic) and 00020-p9p tag `candidate-1016` (same image) | `5a47d02` (main, submission candidate) | `sha256:aec6db5e1a3f1020bb961ac5c7ebd6f6ed795d75ca0c84405aaa4f81407203ea` |
| web | 00016-z72 tag `good-1015-2006` | `4414d79` | `sha256:9361ad8ba433268809ffed8cec43f93ff83271b35f9648169fb3ad7fa589079d` |
| web | 00015-9tt tag `good-1015-1624` | `326288f` | `sha256:b77afcc01d27ecc26ba5732a70f33cb3b86b035e87766b066aee745b167abc67` |
| web-develop | 00041-rrt (100% traffic, current) | `09365e6` | `sha256:2ff7be683ec00174dbc3e7c072c884e49ebfa2b58f6a02d18c6c75110f32f09c` |
| web-develop | 00040-zbm (rollback, no tag) | `e84a0a3` | `sha256:146685f37b8593137697a1c6920a323574aa42f0a5ccdcd2787e8c7aadf7c02e` |

Also worth keeping as a buffer: the newest 5 `web` images (all 15 Oct: `4414d79`, `bc54898`, `8214be6`, `4a93a9e`, `5a47d02`) and the newest ~8 `web-develop` images.

### What is safe to delete (not run)

With "keep protected + newest 5 `web` / newest 8 `web-develop`":
- `web`: delete 11 of 17 images, about 5.2 GB listed (keeps 6, 3.8 GB).
- `web-develop`: delete 31 of 39 images, about 19.4 GB listed (keeps 8, 5.1 GB).
- Real saving is lower than the listed sum because layers are shared (repo reports 26.5 GB vs 33.5 GB sum of listed sizes). Expect roughly 15 to 20 GB freed.

### Recommended retention policy

Keep (a) anything tagged `keep-*`, (b) the 6 newest versions per package, (c) delete everything else older than 7 days. Keep always wins over delete in Artifact Registry. Order of work: protect first, dry-run second, enforce last, and not before submission (no benefit before judging, and a mistake can break a rollback).

## 2. Cloud Run revisions detail

- `web`: 21 revisions total, 4 addressable (00021 100%, three tags). 17 old revisions are plain history. A revision with 0% traffic and no min instance costs nothing.
- `web-develop`: 41 revisions, 1 serving. 00040-zbm is the rollback but has no tag, so it is only reachable by its name. It will not be auto-deleted before 1000 revisions, but a tag makes the intent visible and makes it immune to any later manual prune of "untagged" revisions.
- Limits (docs.cloud.google.com/run/quotas, fetched today): 1000 revisions per service before non-addressable ones are auto-deleted in historical order; 4000 serving-traffic revisions per project and region. At current rates (about 10 per day on a busy day) neither is close.
- Protected tags on `web`: `good-1015-1624`, `good-1015-2006`, `candidate-1016`. Do not remove these tags before the submission is final.

## 3. Cloud Build and Cloud Storage detail

- 95 build records since 3 Oct. 41 failed, mostly 9 to 11 Oct while the trigger was being set up (9, 5, 15 failures per day). Since 12 Oct builds are healthy (4 of 4, 8 of 8, 22 of 22, 4 of 4, 8 of 8 successful). Recent successful build time 6.6 to 7.5 min.
- Triggers: `bee6-web-main` (push to `^main$`, GitHub connection `bee6-github`, runs as the default compute SA `<DEMO_PROJECT_NUMBER>-compute@developer.gserviceaccount.com`) and `bee6-web-develop`.
- `logging: CLOUD_LOGGING_ONLY` in the build options, so there is NO `*_cloudbuild`/logs bucket growth. The only bucket is `bee6-playground_cloudbuild`, created 12 Oct 14:23 UTC (the same day as the `fixtest1` manual image), holding one 1.23 MiB source archive. No lifecycle rule. Soft-delete retention is 7 days.
- No audio and no unexpected buckets: confirmed, one bucket in the whole project.

## 4. Firestore detail

Document counts (count aggregation, collection-group counts, so `heartbeats` is the subcollection under `devices`):

| Collection | `(default)` | `staging` | TTL? |
|---|---|---|---|
| threads | 596 | 230 | NO (no doc carries `expires_at`; hard rule 7a retention, capture phase P4, not live) |
| segments | 444 | 60 | YES `expires_at` ACTIVE (48 h) |
| demo_counters | 272 | 89 | YES `expires_at` ACTIVE (2 days) |
| audit_log | 252 | 56 | no (known gap) |
| capture_sessions | 140 | 50 | no (known gap) |
| questions | 90 | 56 | no |
| label_units | 86 | 8 | no (flagged in code as a scaling concern) |
| staff | 60 | 36 | no |
| sop_versions | 35 | 21 | no |
| devices | 30 | 18 | no |
| outlets | 30 | 18 | no |
| corrections | 27 | 41 | YES `expires_at` ACTIVE |
| proposals | 25 | 12 | no |
| reviews | 5 | 1 | no |
| users | 4 | 4 | no |
| constraints | 1 | 3 | no |
| heartbeats (subcoll.) | 455 | 10 | no |
| **Total** | **~2,552** | **~713** | |

- TTL works: no `segments`/`corrections`/`demo_counters` doc is more than 24 h past its expiry in either DB. TTL fields present: `segments.expires_at`, `corrections.expires_at`, `demo_counters.expires_at`, identical in both DBs. Limit is 1000 TTL configs per DB.
- Indexes: 4 composite per DB, all READY, identical in both (2x `threads`, 2x `questions`). Limit is 1000 composite per DB with billing, 200 without. Includes the `threads (outlet_id, device_id, last_line_end_ms)` index that db-schema.md still lists as "likely missing"; it exists.
- Estimated storage: NOT measurable (Firestore exposes no per-database storage metric through the APIs I used). Estimate: ~2,550 + ~710 docs at ~1 to 3 KB plus index entries is on the order of 10 to 30 MB, far below the 1 GiB free storage. Treat as an estimate, not a measurement.
- Billing is ENABLED on `bee6-playground` (billing account <BILLING_ACCOUNT_ID>). The free daily quota (1 GiB stored, 50k reads, 20k writes, 20k deletes per day) applies to ONE database per project and resets at midnight Pacific. With billing on, going over it is billed, not blocked. 16 Oct (136k reads, 10.2k writes) exceeded the 50k read free allowance and cost cents, not an outage. Nothing will be blocked by "free tier exhausted" on judging day.

### Sandbox (`sbx-*`) lifecycle

- A sandbox outlet carries `sandbox.expires_at_ms` (2 h after creation, `SANDBOX_TTL_MS`). There is no Firestore TTL on it (it is an integer ms field, not a Timestamp, and the outlet and its related docs are not TTL-covered).
- Deletion is the code path `cleanupExpired` in `lib/demo/service.ts`: run lazily on each NEW sandbox request, deletes at most `CLEANUP_PER_CREATE = 2` expired sandboxes, and only after an extra 24 h grace (`CLEANUP_GRACE_MS`). The code itself notes: "Follow-up (not now): move cleanup to a Cloud Tasks job".
- Observed effect: `(default)` still has 27 sandboxes beyond expiry + grace (all from 15 Oct). Cleanup removes 2 per new sandbox, so it keeps shrinking only while judges create sandboxes. If nobody creates a sandbox the backlog just sits there, which is harmless: about 85 docs per sandbox on average (2,552 docs / 30 outlets, rough), so 27 sandboxes is ~2,000 docs, ~ a few MB.
- Worst case on judging day: `SANDBOX_DAILY = 300` sandboxes/day, `SANDBOX_IP_DAILY = 30`; each sandbox up to ~400 docs at template size or more as segments accumulate (`SEGMENT_PER_SANDBOX = 150`). 300 x ~500 docs = 150k docs, still well under 1 GiB, and the writes would cost cents. No limit is at risk.
- `staging` has 6 `sbx-uitest*` fixtures from QA that never expire naturally (QA created with fixed ids); they are harmless but will be skipped by lazy cleanup only if they are past expiry + grace.

## 5. Other services

- Cloud Tasks: queue `pipeline` RUNNING, 500 dispatches/s max, 100 max attempts, 0 tasks queued. No backlog.
- Cloud Scheduler (see table): HANDOFF said `pipeline-tick-staging` should be PAUSED; it is ENABLED, `lastAttemptTime` 11:00 today, target `https://web-develop-33uzb53tza-et.a.run.app/api/internal/pipeline/tick`. Its Firestore read cost is tiny when no device is active (10-11 baseline was ~1k reads/day), but it keeps `web-develop` warm-ish.
- Secret Manager: 2 secrets, 1 enabled version each, nothing to prune.
- Logging: `_Default` 30 days, `_Required` 400 days locked, no custom sinks. Daily ingest 4.5 to 24.5 MB. LOW.
- No budget and no alerting (see B1). Cloud Billing Budget API is not enabled on the project, so I could not list budgets; absence of enablement plus the empty alert-policy/notification-channel lists is strong but not absolute proof that no budget exists on the billing account (a budget can be created in the console without the API being enabled on this project). Verify in console: Billing > Budgets & alerts.
- Firebase Auth: 32 users (30 custom-token / anonymous-style device users, 2 password users). No limit risk.
- Cloud Run `web` billable instance time metric: average ~1.0 instance on 15 Oct (the min-instance floor), higher on 16/17 Oct with load. I did not trust the metric enough to quote exact cost.

## Limits vs usage (so nothing here is a surprise)

| Limit | Value | Current |
|---|---|---|
| Cloud Run revisions per service before auto-prune | 1000 | 21 (`web`), 41 (`web-develop`) |
| Firestore composite indexes per DB (billing on) | 1000 | 4 |
| Firestore TTL configs per DB | 1000 | 3 |
| Firestore free storage | 1 GiB, one DB per project | est. 10 to 30 MB total |
| Firestore free ops/day | 50k reads, 20k writes, 20k deletes | exceeded 16/17 Oct reads; billed in cents because billing is on |
| Identity Platform free MAU | 50k | 32 users |
| Artifact Registry | no hard limit relevant; 0.5 GB free | 26.5 GB (cost ~ a few dollars/month) |

## What can hurt judging day (18 Oct) vs what can wait

Can matter on 18 Oct:
- No budget alert: a model/loop runaway would be silent until the invoice. App-level guards exist (`DAILY_TOKEN_CEILING`, `MODEL_DAILY = 5000`, `SANDBOX_DAILY = 300`, per-IP caps), so risk is bounded, but there is no outside net. MED, cheap fix (B1).
- `(default)` DB: delete protection OFF, PITR OFF, no backups. One bad `firestore databases delete` or a wrong-database script (the staging work used `FIRESTORE_DATABASE_ID`) could destroy the judged data with no restore. Delete protection is free and reversible (B2). PITR costs storage; optional.
- Do NOT apply any Artifact Registry cleanup, revision pruning or tag removal before submission is final. A wrong delete of `5a47d02`'s image would break `web` scale-out and rollback.
- Keep `web` at `minScale=1` through judging so there is no cold start.

Can wait until after submission: Artifact Registry cleanup policy, revision pruning, tagging 00040 (optional but cheap, B3), deleting the US build-source bucket, deleting stale sandboxes and judge auth users, pausing `pipeline-tick-staging`, adding `threads.expires_at` TTL once P4 ships, moving sandbox cleanup to Cloud Tasks (code, hand to developer), pilot audit.

## B. Drafted commands (NONE RUN; each needs Rangga's explicit go)

B1. Budget alert (needs enabling an API; billing account is shared by both projects, `<AMOUNT>` is Rangga's decision):
```
gcloud services enable billingbudgets.googleapis.com --project=bee6-playground
gcloud billing budgets create --billing-account=<BILLING_ACCOUNT_ID> \
  --display-name="bee6 monthly guard" --budget-amount=<AMOUNT>USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```
Cost: free. Risk: none; a budget only notifies, it does not stop spend. Default alert recipients are billing admins by email. Rangga decides the amount.

B2. `(default)` delete protection (reversible):
```
gcloud firestore databases update --database='(default)' --delete-protection --project=bee6-playground
```
Optional later: also on `staging`. Optional PITR (stores 7 days of versions; small cost on this data size): `--enable-pitr`.

B3. Tag the web-develop rollback revision (affects only revision tags; does not change traffic; `--set-tags` can also create a tag URL):
```
gcloud run services update-traffic web-develop --region=asia-southeast2 --project=bee6-playground \
  --set-tags=rollback-1017=web-develop-00040-zbm
```

B4. Artifact Registry retention (do AFTER submission, in this order):

Step 1, tag-protect the five digests (adds a tag only; no deletion):
```
R=asia-southeast2-docker.pkg.dev/bee6-playground/bee6
gcloud artifacts docker tags add $R/web@sha256:aec6db5e1a3f1020bb961ac5c7ebd6f6ed795d75ca0c84405aaa4f81407203ea $R/web:keep-submission
gcloud artifacts docker tags add $R/web@sha256:9361ad8ba433268809ffed8cec43f93ff83271b35f9648169fb3ad7fa589079d $R/web:keep-good-1015-2006
gcloud artifacts docker tags add $R/web@sha256:b77afcc01d27ecc26ba5732a70f33cb3b86b035e87766b066aee745b167abc67 $R/web:keep-good-1015-1624
gcloud artifacts docker tags add $R/web-develop@sha256:2ff7be683ec00174dbc3e7c072c884e49ebfa2b58f6a02d18c6c75110f32f09c $R/web-develop:keep-current
gcloud artifacts docker tags add $R/web-develop@sha256:146685f37b8593137697a1c6920a323574aa42f0a5ccdcd2787e8c7aadf7c02e $R/web-develop:keep-rollback
```
Step 2, policy file `cleanup.json`:
```
[
  { "name": "keep-protected", "action": {"type": "Keep"},
    "condition": {"tagState": "tagged", "tagPrefixes": ["keep-"]} },
  { "name": "keep-newest-6", "action": {"type": "Keep"},
    "mostRecentVersions": {"packageNamePrefixes": ["web"], "keepCount": 6} },
  { "name": "delete-old", "action": {"type": "Delete"},
    "condition": {"tagState": "any", "olderThan": "604800s"} }
]
```
Step 3, dry run first, then inspect Audit Logs (Artifact Registry "would delete" entries) before enforcing:
```
gcloud artifacts repositories set-cleanup-policies bee6 --project=bee6-playground --location=asia-southeast2 --policy=cleanup.json --dry-run
```
Step 4, enforce only after the dry-run output matches the "safe to delete" list above (11 `web`, 31 `web-develop` images, minus anything that became newer):
```
gcloud artifacts repositories set-cleanup-policies bee6 --project=bee6-playground --location=asia-southeast2 --policy=cleanup.json --no-dry-run
```
Caveats to check in the dry-run: whether `keepCount` is applied per package (docs say per package; prefix `web` also matches `web-develop`); and confirm the exact `olderThan` unit format accepted by the CLI (duration seconds shown above, the docs example used `30d`). Rollback of enforcement: `set-cleanup-policies ... --policy=empty.json` with `[]` (images already deleted are not recoverable).

B5. Old build-source bucket (after submission):
```
gcloud storage rm -r gs://bee6-playground_cloudbuild
```
or, to keep it, a 30-day lifecycle: `echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lc.json && gcloud storage buckets update gs://bee6-playground_cloudbuild --lifecycle-file=lc.json`. Soft delete keeps removed objects 7 more days.

B6. Prune old plain Cloud Run revisions (optional, after submission; keeps the 4 `web` addressable ones and all tagged ones; list first, delete only the printed names):
```
# list candidates: 0% traffic and not tagged, oldest first, excluding the newest 5
gcloud run revisions list --service=web --region=asia-southeast2 --project=bee6-playground --format="value(name)" | tail -n +6
# then, per revision Rangga approves:
gcloud run revisions delete <REVISION> --region=asia-southeast2 --project=bee6-playground --quiet
```
Never delete 00015-9tt, 00016-z72, 00020-p9p, 00021-qxv on `web`, nor 00040-zbm, 00041-rrt on `web-develop`.

B7. Pause the staging tick when not testing (reversible):
```
gcloud scheduler jobs pause pipeline-tick-staging --location=asia-southeast2 --project=bee6-playground
```

B8. After submission, stale demo auth users: list with Identity Toolkit `accounts:batchGet`, delete custom-token users created before the cut-off by uid with `accounts:batchDelete`. Not drafted in full because the uid selection needs Rangga's cut-off date.

## Handed to the PM for the developer (not infra)

- Sandbox cleanup rides on judge requests and deletes only 2 per create. If a post-submission tidy is wanted, the follow-up already noted in `lib/demo/service.ts` (a Cloud Tasks or Scheduler-driven sweep) removes the dependency on traffic. Not needed for judging.
- `threads` has no `expires_at`/TTL (hard rule 7a, P4). On the demo project this is only sandbox data (fictional); on the pilot it matters for real retention. That is a P4 item, not housekeeping.

## Could not measure (honest list)

- Firestore stored bytes (no API); estimate only.
- Existence of billing-account budgets (API not enabled; console check needed).
- Exact Artifact Registry and Cloud Run idle cost (rates not verified from truncated pricing pages; figures marked estimates).
- Logging exclusions (gcloud version lacks the command); Logging free allowance not re-verified in docs this run.
- The pilot project, intentionally skipped.
- Per-database split of the Firestore read/write metrics (the metric returned one project-wide series).
