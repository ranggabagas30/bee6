# web-develop staging: Phase 1 steps (for Rangga)

Short version of the "web-develop staging checklist (16 Oct)" in `docs/tasks/R-01-gcp-state.md`. Demo project `bee6-playground` only. The pilot project is never touched. These steps change only `web-develop` and the browser API key. `web` is not touched.

**How to run (so the terminal does not split a long command):** do not paste long commands. Run the scripts from the repo root, in your own terminal. They hold the long lines for you:

- `bash docs/tasks/R-24-staging-phase1.sh` runs steps 1, 2 and 3 with a pause before each.
- `bash docs/tasks/R-24-staging-phase1-step3.sh` runs step 3 only.

Short commands below are each ONE line. If your terminal still splits one, run the script instead.

## Status (dev-ops verified read-only, 17 Oct)

| Step | State |
|---|---|
| 1. Public access on `web-develop` | DONE. `allUsers` has `roles/run.invoker`. `/`, `/pair`, `/api/health` return 200. |
| 2. Env vars and secrets on `web-develop` | DONE. Revision `web-develop-00032-nqz` serves 100 percent. 16 env names, secrets `DEMO_IP_SALT` and `THREAD_HANDLE_KEY`, audiences point at its own URL, `FIRESTORE_DATABASE_ID` correctly unset. |
| 3. Browser API key referrers | NOT DONE. The key still has the 7 original referrers. Sign-in on `web-develop` fails with `API_KEY_HTTP_REFERRER_BLOCKED` until this is applied. `web` is still `web-00021-qxv`. |

## Step 1. Let people reach `web-develop` (DONE)

Only re-run if it was undone. It is safe to repeat.

```
gcloud run services add-iam-policy-binding web-develop --region=asia-southeast2 --project=bee6-playground --member=allUsers --role=roles/run.invoker
```

## Step 2. Give `web-develop` the same settings as `web` (DONE)

Do not re-run unless the revision was rolled back. It is in `docs/tasks/R-24-staging-phase1.sh` (step 2), which copies the Firebase web key from `web` without printing it. Do NOT set `FIRESTORE_DATABASE_ID` or `PROPOSAL_AGENT_V4` yet; those come in Phase 2 and the staging QA.

## Step 3. Allow staging on the browser API key (TO DO)

### Why the first attempt failed (harmless)

The first command replaced the whole referrer list. Google refused it: `FAILED_PRECONDITION ... APIKEYS_RESTRICTION_INCOMPATIBLE_WITH_USAGE`, because the key had recent traffic to `firebaseinstallations` and `firestore`. That traffic is 11 requests, all HTTP 403, in one burst on 12 Oct 00:38Z. It was dev-ops' own check after the 12 Oct hardening, not real traffic. The check counts denied requests too. No app code calls those services (the browser imports only `firebase/app` and `firebase/auth`; a test bans anything else), so hard rule 6 holds. The key's real traffic is sign-in and almost all returned 200. Nothing was changed by the failed attempt.

### The fix

Use `--append` so only the 2 staging hosts are added and the 7 existing ones are kept (nothing to mistype), and `--no-check-existing-usage` to skip the 12 Oct probe check. A referrer-only update does not touch the key's allowed services (identitytoolkit and securetoken).

Easiest: run the script. It saves the current list first, asks for Enter, applies, and prints the result.

```
bash docs/tasks/R-24-staging-phase1-step3.sh
```

Or the one-line commands (each is ONE line):

1. Save the current list:

```
gcloud services api-keys describe 0521292e-44ae-4525-be97-c385509af766 --project=bee6-playground --format="value(restrictions.browserKeyRestrictions.allowedReferrers)"
```

2. Add the 2 staging hosts:

```
gcloud services api-keys update 0521292e-44ae-4525-be97-c385509af766 --project=bee6-playground --append --no-check-existing-usage --allowed-referrers="https://web-develop-33uzb53tza-et.a.run.app/*,https://web-develop-<DEMO_PROJECT_NUMBER>.asia-southeast2.run.app/*"
```

3. Show the result (expect 9 referrers and apiTargets still identitytoolkit and securetoken):

```
gcloud services api-keys describe 0521292e-44ae-4525-be97-c385509af766 --project=bee6-playground --format="yaml(restrictions)"
```

Propagation takes up to about 5 minutes.

### Verify after step 3

1. Sign in once on `web` (https://web-33uzb53tza-et.a.run.app). It must still work.
2. Wait up to 5 minutes, open `https://web-develop-33uzb53tza-et.a.run.app`, start a demo session. There must be no "API key not valid" or referer-blocked error in the browser console.
3. Run the check:

```
for p in / /pair /api/health; do curl -s -o /dev/null -w "$p %{http_code}\n" https://web-develop-33uzb53tza-et.a.run.app$p; done
```

All three lines should print 200.

### Rollback of step 3

Re-run the update WITHOUT `--append`, with the 7 original entries (one line):

```
gcloud services api-keys update 0521292e-44ae-4525-be97-c385509af766 --project=bee6-playground --no-check-existing-usage --allowed-referrers="https://web-33uzb53tza-et.a.run.app/*,https://web-<DEMO_PROJECT_NUMBER>.asia-southeast2.run.app/*,https://bee6-playground.firebaseapp.com/*,https://bee6-playground.web.app/*,http://localhost:3000/*,http://localhost:3001/*,http://127.0.0.1:3000/*"
```

Backups with no key string: the script saves the list to `~/bee6-api-key-referrers-before.txt`; dev-ops saved a pre-change copy in its scratchpad (`demo-key-before-staging-17oct.json`); the 12 Oct original is `~/bee6-backups/demo-key-0521292e-original-restrictions.json`.

### Alternative (not recommended)

A second browser key just for staging leaves the key `web` uses untouched. It costs a new key restricted to identitytoolkit and securetoken with its own 2 referrers, another `web-develop` revision to swap `FIREBASE_API_KEY`, and a stray key to delete later. The `--append` update only widens the allow-list, so the risk it avoids is small. Use it only if you want zero change on the `web` key before judging day.

## After Phase 1

1. Tell the PM "Phase 1 done". dev-ops then verifies it read-only.
2. Phase 2 needs a separate "go Phase 2" from Rangga: the named Firestore database `staging`, its indexes and TTL, the seed, `FIRESTORE_DATABASE_ID=staging` on `web-develop`, and paused staging scheduler jobs.
3. Until Phase 2, staging shares the `(default)` database with `web`. Keep QA small, do not run any Scheduler job against it, and do not run it on judging day.

## Rollback of the other Phase 1 changes (staging only)

- **Close public access:**

```
gcloud run services remove-iam-policy-binding web-develop --region=asia-southeast2 --project=bee6-playground --member=allUsers --role=roles/run.invoker
```

- **Remove env and secrets:**

```
gcloud run services update web-develop --region=asia-southeast2 --project=bee6-playground --clear-env-vars --clear-secrets --timeout=300 --max-instances=3
```

## Time limits

- Code freeze: Sat 17 Oct 23:59 WIB. The latest flag-off merge of R-24 to `main` is Sat 17:00.
- If staging is not usable by about Sat 08:00, R-24 stays "spiked, not shipped" and `main` (5a47d02, tag `submission-candidate-1`) remains the submission candidate.

Verified 17 Oct (dev-ops, read-only, 00:50 UTC): browser API key has 9 referrers (7 originals + the two web-develop URLs), apiTargets unchanged (identitytoolkit + securetoken), updateTime 00:46:38Z. `web` untouched (web-00021-qxv 100%, 3 tags, 13 env incl. DEMO_SANDBOX_IP_CAP=60, scheduler jobs ENABLED and 200). `web-develop` serves web-develop-00032-nqz 100% Ready on image `web-develop:eac54ff` (= origin/develop HEAD), 16 env entries (2 are secret refs), audiences = its own URL, no FIRESTORE_DATABASE_ID / PROPOSAL_AGENT_V4, shares `(default)` Firestore, no Scheduler job points at it. `/`, `/pair`, `/api/health` 200; demo/session GET 405, POST {} 422, demo/progress GET 401; tick and review 401. Zero referrer-blocked/auth errors in the last hour of web-develop logs. PASS.
