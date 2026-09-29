# R-01 GCP — provisioned state (as of 30 Sep 2026)

Canonical project IDs (use these everywhere — env, triggers, seed, probe):

| Role | Project ID | Name | Billing |
|---|---|---|---|
| **PILOT** (real Proofed data) | `project-a10437b4-b198-402e-97e` | bee6 Pilot | ✅ |
| **DEMO** (fictional/judges) | `bee6-playground` | bee6 Demo | ✅ |

Billing account: `019612-9B317A-0C08A8` (My Billing Account).
Region: `asia-southeast2` (Jakarta) everywhere.

Duplicate to clean up: `project-a575fdee-a05f-466f-88d` ("bee6 Demo", empty, no billing) — the
abandoned demo project. Safe for **Rangga** to delete: `gcloud projects delete project-a575fdee-a05f-466f-88d`.

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
- [x] Both projects under org **wearegati-org** (957669223173); demo migrated from No-Organization.
- [x] Firebase enabled on both projects; web apps created; SDK config pulled.
- [x] Cloud Tasks queue `pipeline` created in asia-southeast2 on both.
- [x] R-01c: real `@google/genai` Vertex-mode probe wired + run live (committed locally).

## Firebase web apps
| Project | App ID | apiKey (public client id) |
|---|---|---|
| PILOT | `1:959020386278:web:479a081099f93e2e927827` | AIzaSyDwi6tJoJOYreCdVXk9iEnox7X91kvU_S0 |
| DEMO  | `1:934166416062:web:70f010e0913869ffed2cef` | AIzaSyDXlnz45ViQquUupRYQJdiUV_ETJvcnAAo |
Pilot config is in `.env.local`. Demo config recorded here for R-12 (demo deploy).

## Region probe results (live, 2026-09-29) — from R-01c
| Model | Resolved location | Note |
|---|---|---|
| `gemini-3.5-flash` | **asia-southeast1** (Singapore) | Jakarta returned 400 FAILED_PRECONDITION → fell back to Singapore |
| `gemini-3.5-flash-lite` | **global** | Jakarta 400 → Singapore 404 → global OK |
| `gemini-3.5-transcribe` | **UNPROBED** | 404 in all regions — model id wrong or preview not granted |
| `gemini-live-debrief` | **UNPROBED** | 404 (placeholder id; Live API uses websockets, not generateContent) |

## OPEN DECISIONS for Rangga (from the probe)
1. **`gemini-3.5-transcribe` 404 everywhere** — the transcription model is CORE to R-04. Either the
   model id is wrong or preview access isn't granted to this project. **Decide/confirm the real id
   or request preview access before R-04.** This is now an R-04 risk.
2. **Real Live debrief model id** — needed for R-16; current name is a placeholder.
3. **Jakarta serves no Gemini `generateContent`** (400 FAILED_PRECONDITION for both text models).
   Data + services stay in Jakarta; model calls fall back to Singapore/global per regions.yaml
   (working as designed). Confirm this is acceptable, or investigate enabling Jakarta.

## Remaining for R-01 — CONSOLE-ONLY (Rangga)
- [ ] **Firebase Auth → Google provider.** Auth isn't initialized yet (CONFIGURATION_NOT_FOUND).
      In the Firebase console for each project: Authentication → Get started → Sign-in method →
      enable **Google**. (Requires the OAuth consent screen; Firebase auto-provisions the OAuth
      client. This genuinely can't be scripted cleanly — I tried the Identity Toolkit Admin API.)
- [ ] **Cloud Build → GitHub connection.** Cloud Build → Triggers → Connect repository → GitHub →
      authorize `ranggabagas30/bee6` (installs the Cloud Build GitHub App).
- [ ] **Then I can run (CLI):** `gcloud builds triggers create github --project=project-a10437b4-b198-402e-97e --name=bee6-web-main --repo-owner=ranggabagas30 --repo-name=bee6 --branch-pattern='^main$' --build-config=cloudbuild.yaml --region=asia-southeast2`
- [ ] **Rangga:** `git push -u origin main` (after reviewing the scaffold) → first Cloud Run deploy.

## Remaining for R-01 (blocking "done")
- [ ] **Rangga (console-only):** Firebase → each project → Authentication → Sign-in method →
      enable **Google**. Then paste the web-app config (FIREBASE_API_KEY, AUTH_DOMAIN, APP_ID)
      into `.env.local`.
- [ ] **Rangga (console-only):** Cloud Build → Triggers → Connect repository → GitHub → authorize
      `ranggabagas30/bee6` (installs the Cloud Build GitHub App).
- [ ] **Then (I can run):** create the trigger:
      `gcloud builds triggers create github --project=project-a10437b4-b198-402e-97e --name=bee6-web-main --repo-owner=ranggabagas30 --repo-name=bee6 --branch-pattern='^main$' --build-config=cloudbuild.yaml --region=asia-southeast2`
- [ ] **R-01c (agent-buildable now):** wire the real `@google/genai` call into `scripts/probe.ts`
      (add dep; implement the per-model, per-region attempt), then run `npm run probe` to fill
      `config/regions.yaml`. ADC is already set, so the probe can run once R-01c lands.
- [ ] **Rangga:** `git push -u origin main` (after reviewing the scaffold) → first Cloud Run deploy.
