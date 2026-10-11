# R-01 GCP — provisioned state (as of 30 Sep 2026)

Canonical project IDs (use these everywhere — env, triggers, seed, probe):

| Role | Project ID | Name | Billing |
|---|---|---|---|
| **PILOT** (real Proofed data) | `<PILOT_PROJECT_ID>` | bee6 Pilot | ✅ |
| **DEMO** (fictional/judges) | `<DEMO_PROJECT_ID>` | bee6 Demo | ✅ |

Billing account: `<BILLING_ACCOUNT_ID>` (My Billing Account).
Region: `asia-southeast2` (Jakarta) everywhere.

Duplicate to clean up: `<ABANDONED_DEMO_PROJECT_ID>` ("bee6 Demo", empty, no billing) — the
abandoned demo project. Safe for **Rangga** to delete: `gcloud projects delete <ABANDONED_DEMO_PROJECT_ID>`.

## Done (I ran these via gcloud)
- [x] Billing linked on both projects.
- [x] 11 APIs enabled on both: run, firestore, cloudbuild, artifactregistry, secretmanager,
      dlp, cloudscheduler, cloudtasks, aiplatform, firebase, identitytoolkit.
- [x] Artifact Registry docker repo `bee6` in asia-southeast2 on both.
- [x] Service accounts on both: `web-runtime@<project>` (roles: datastore.user,
      secretmanager.secretAccessor, aiplatform.user, cloudtasks.enqueuer, dlp.user,
      logging.logWriter) and `tasks-invoker@<project>` (roles/run.invoker).
- [x] Firestore Native databases created in asia-southeast2 on both.
- [x] `.env.local` written (untracked) with pilot GOOGLE_CLOUD_PROJECT + tasks-invoker SA + Firebase web config.
- [x] Both projects under org **wearegati-org** (<ORG_ID>); demo migrated from No-Organization.
- [x] Firebase enabled on both projects; web apps created; SDK config pulled.
- [x] Cloud Tasks queue `pipeline` created in asia-southeast2 on both.
- [x] R-01c: real `@google/genai` Vertex-mode probe wired + run live (committed locally).

## Firebase web apps
| Project | App ID | apiKey (public client id) |
|---|---|---|
| PILOT | `<FIREBASE_APP_ID_PILOT>` | <FIREBASE_WEB_API_KEY_PILOT> |
| DEMO  | `<FIREBASE_APP_ID_DEMO>` | <FIREBASE_WEB_API_KEY_DEMO> |
Pilot config is in `.env.local`. Demo config recorded here for R-12 (demo deploy).

## Region probe results (live, 2026-09-29) — from R-01c
| Model | Resolved location | Note |
|---|---|---|
| `gemini-3.5-flash` | **asia-southeast1** (Singapore) | Jakarta returned 400 FAILED_PRECONDITION → fell back to Singapore |
| `gemini-3.5-flash-lite` | **global** | Jakarta 400 → Singapore 404 → global OK |
| `gemini-3.5-transcribe` | **UNPROBED** | 404 in all regions — model id wrong or preview not granted |
| `gemini-live-debrief` | **UNPROBED** | 404 (placeholder id; Live API uses websockets, not generateContent) |

## OPEN DECISIONS for Rangga (from the probe)
1. **`gemini-3.5-transcribe` 404 everywhere** — RESOLVED. The real id is `gemini-3.5-transcribe-preview`
   (no `-preview` → 404). `config/regions.yaml` now resolves it to `global` with `error: null`.
2. **Real Live debrief model id** — needed for R-16; current name is a placeholder.
3. **Jakarta serves no Gemini `generateContent`** (400 FAILED_PRECONDITION for both text models).
   Data + services stay in Jakarta; model calls fall back to Singapore/global per regions.yaml
   (working as designed). Confirm this is acceptable, or investigate enabling Jakarta.
4. **RESOLVED (1 Oct).** The original theory here — "Jakarta has no DLP regional endpoint" — was
   **wrong**, traced back to a bad doc fetch. A second, independent dev-ops investigation confirmed
   `asia-southeast2` IS a supported DLP region, and DLP was already enabled on `<DEMO_PROJECT_ID>`.
   The real root cause of the `/capture` redaction failures: the local machine's `gcloud` ADC
   `quota_project_id` pointed at a deleted project, unrelated to region support entirely — fixed by
   Rangga running `gcloud auth application-default set-quota-project <DEMO_PROJECT_ID>`. Separately
   and correctly, `lib/redact/dlp.ts` was ALSO hardcoding its region (`DEFAULT_REGION`/`APP_REGION`
   env read) instead of going through `config/regions.yaml`'s probed fallback — a genuine hard
   rule #5 gap, fixed on `fix/dlp-region-fallback` (PR #5). See the "Verified" entry below for the
   IAM follow-up on this same PR.

## Verified (dev-ops, 2 Oct 2026): `web-runtime@<DEMO_PROJECT_ID>` IAM for PR #5
PR #5 (DLP region fallback) flagged a known gap: it was tested under Rangga's personal ADC
(Owner), never under the Cloud Run runtime SA, so a missing `roles/dlp.user` grant on
`web-runtime@<DEMO_PROJECT_ID>` couldn't have been caught. Checked live via
`gcloud projects get-iam-policy <DEMO_PROJECT_ID> --flatten="bindings[].members" --filter="bindings.members:web-runtime@<DEMO_PROJECT_ID>.iam.gserviceaccount.com"`:
the SA has `roles/aiplatform.user`, `roles/cloudtasks.enqueuer`, `roles/datastore.user`,
`roles/dlp.user`, `roles/logging.logWriter`, `roles/secretmanager.secretAccessor` — matches what's
documented above as provisioned; no drift.
- **DLP:** `roles/dlp.user`'s actual permission set is narrow (`dlp.kms.encrypt`,
  `dlp.locations.get`/`list`, `serviceusage.services.use` — confirmed via
  `gcloud iam roles describe roles/dlp.user` and cross-checked against
  `docs.cloud.google.com/sensitive-data-protection/docs/iam-permissions`). It does **not** include
  `dlp.jobs.*`, `dlp.deidentifyTemplates.*`, or any `dlp.inspectTemplates.*` permission. This is
  still sufficient for `lib/redact/dlp.ts`'s `DlpServiceClient.deidentifyContent` call (inline
  `InspectConfig`/`DeidentifyConfig`, no stored templates, no jobs, no KMS wrapping) — that specific
  method only requires `serviceusage.services.use` on the parent project per Google's REST
  reference. **If DLP usage ever grows to stored templates, job triggers, or KMS-wrapped crypto
  keys, this SA will need `roles/dlp.editor` or `roles/dlp.admin` added — flag that decision to
  Rangga when it comes up, don't assume `dlp.user` still covers it.**
- **Vertex AI:** `roles/aiplatform.user` includes `aiplatform.endpoints.predict`, the permission
  Vertex AI's `generateContent`/`predict` calls check for publisher (Gemini) models — sufficient for
  transcribe/label/ProposalAgent/CriticAgent/ReviewAgent calls.
- **Firestore:** `roles/datastore.user` includes `datastore.entities.create/get/update/delete/list`
  and `datastore.databases.get` — sufficient for Native-mode Firestore reads/writes (Firestore
  Native mode is still governed by the `datastore.*` permission namespace).
- **Conclusion: no IAM gap found.** PR #5's "needs manual verification on first live deploy" gap is
  closed for IAM — nothing to grant, nothing proposed. (Runtime *behavior* — actually PUTting a
  segment with a phone number through the deployed Cloud Run service and checking Cloud Run logs
  for `[PHONE_NUMBER]` — is still unverified and needs a real deploy + live test, which is separate
  from the IAM question this entry answers.)

## Demo project (<DEMO_PROJECT_ID>) first deploy attempt, 3 Oct

Neither project had a Cloud Build trigger or any deployed Cloud Run `web` service before today — the
"Remaining for R-01 — CONSOLE-ONLY" items below were apparently never actually finished despite R-01
being marked done. Standing this up live, 3 Oct:
- Classic ("1st-gen") GitHub trigger creation (`--repo-owner`/`--repo-name`) is rejected outright by the
  API now (`400 INVALID_ARGUMENT`, no detail, confirmed via `--log-http` on both the request and the
  bare response) — switched to the "2nd-gen" Cloud Build connection model instead.
- 2nd-gen connection setup needed one extra IAM grant not previously documented: Cloud Build's P4SA
  (`service-<PROJECT_NUMBER>@gcp-sa-cloudbuild.iam.gserviceaccount.com`) needs `roles/secretmanager.admin`
  on the project to store the GitHub OAuth token as a Secret Manager secret during connection setup.
- Trigger creation via CLI (`gcloud builds triggers create github --repository=... --region=...`) also
  failed with the same bare `400 INVALID_ARGUMENT` even with the correct 2nd-gen payload — worked fine
  via the Console wizard instead. Cause never fully diagnosed (Console succeeded, so not pursued further).
- Trigger's service account: `<DEMO_PROJECT_NUMBER>-compute@developer.gserviceaccount.com` (demo project's default
  Compute Engine SA) — chosen pragmatically for the hackathon over provisioning a new least-privilege
  build SA; Rangga explicitly accepted the Console's "broad permissions" warning. **Actual live roles on
  `<DEMO_PROJECT_ID>`** (verified via `get-iam-policy`, not just what was granted): `roles/artifactregistry
  .reader`, `roles/artifactregistry.writer`, `roles/editor`, `roles/run.developer`, plus
  `roles/iam.serviceAccountUser` scoped on `web-runtime@<DEMO_PROJECT_ID>.iam.gserviceaccount.com`
  specifically (needed since the deploy step runs `gcloud run deploy --service-account=web-runtime@...`).
  Note it already holds `roles/editor` from the Console default — stricter than what was separately
  granted on top of it.
- **First build (`<BUILD_ID>`) failed at step 2/3 ("deploy").** Root cause:
  `cloudbuild.yaml`'s step 2 `name:` field (`gcr.io/google-cloud-sdk/slim`) is not a real Google-hosted
  image path — confirmed via dev-ops read-only investigation (IAM state checked directly, org policies
  at both project and org level checked and ruled out, Google's own current docs/GitHub cited). **Not an
  IAM or org-policy gap** — the `roles/artifactregistry.reader` grant added while debugging this did not
  and could not have fixed it (a grant on our project can't reach into a different Google-owned project's
  Artifact Registry repo). Fix is a one-line `cloudbuild.yaml` code change (→
  `gcr.io/google.com/cloudsdktool/cloud-sdk:slim`), dispatched to `developer` with the normal tech-lead +
  QA gates, not an infra/IAM action. If this exact error recurs after that fix lands, look at the image
  path first — org-policy and IAM were already ruled out once, no need to re-investigate that angle.

## Pilot deploy rule from the Sun 11 switch-over (reconciled 4 Oct)
The `main` → Cloud Run trigger below auto-deploys on every merge. That is fine for the demo project and for
the pilot until the Sun 11 Oct sign-off. From the switch-over, pilot deploys must run **only after that
night's debrief has ended** (auto-stop + 1 h, at the latest 03:00 on the pilot's hours) **and before the next
opening**: never between closing and the auto-stop, never during the debrief hour, never "after the calendar
day ends". dev-ops switches the pilot trigger to manual or approval-gated at the switch-over
(`docs/plan.md` §5a risk 7).
The pilot is deployed with two revisions on Mon 5 (A = pre-P1 capture-only fallback, B = P1); rollback is a
traffic switch (`docs/plan.md` §6, go-live step 3).

## Remaining for R-01 — CONSOLE-ONLY (Rangga)
- [ ] **Firebase Auth → Google provider.** Auth isn't initialized yet (CONFIGURATION_NOT_FOUND).
      In the Firebase console for each project: Authentication → Get started → Sign-in method →
      enable **Google**. (Requires the OAuth consent screen; Firebase auto-provisions the OAuth
      client. This genuinely can't be scripted cleanly — I tried the Identity Toolkit Admin API.)
- [ ] **Cloud Build → GitHub connection.** Cloud Build → Triggers → Connect repository → GitHub →
      authorize `ranggabagas30/bee6` (installs the Cloud Build GitHub App).
- [ ] **Then I can run (CLI):** `gcloud builds triggers create github --project=<PILOT_PROJECT_ID> --name=bee6-web-main --repo-owner=ranggabagas30 --repo-name=bee6 --branch-pattern='^main$' --build-config=cloudbuild.yaml --region=asia-southeast2`
- [ ] **Rangga:** `git push -u origin main` (after reviewing the scaffold) → first Cloud Run deploy.

## Remaining for R-01 (blocking "done")
- [ ] **Rangga (console-only):** Firebase → each project → Authentication → Sign-in method →
      enable **Google**. Then paste the web-app config (FIREBASE_API_KEY, AUTH_DOMAIN, APP_ID)
      into `.env.local`.
- [ ] **Rangga (console-only):** Cloud Build → Triggers → Connect repository → GitHub → authorize
      `ranggabagas30/bee6` (installs the Cloud Build GitHub App).
- [ ] **Then (I can run):** create the trigger:
      `gcloud builds triggers create github --project=<PILOT_PROJECT_ID> --name=bee6-web-main --repo-owner=ranggabagas30 --repo-name=bee6 --branch-pattern='^main$' --build-config=cloudbuild.yaml --region=asia-southeast2`
- [ ] **R-01c (agent-buildable now):** wire the real `@google/genai` call into `scripts/probe.ts`
      (add dep; implement the per-model, per-region attempt), then run `npm run probe` to fill
      `config/regions.yaml`. ADC is already set, so the probe can run once R-01c lands.
- [ ] **Rangga:** `git push -u origin main` (after reviewing the scaffold) → first Cloud Run deploy.
