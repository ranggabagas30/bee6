# R-01 GCP runbook (Rangga-only, interactive)

The code scaffold is done and reviewed. These steps need **your** Google account (interactive
OAuth) + a billing account, so no agent can run them. Do them in one sitting. Region is
`asia-southeast2` (Jakarta) throughout.

> Tip: you can run any of these from the Claude Code prompt by prefixing with `! ` so the output
> lands in the session, e.g. `! gcloud auth list`. Interactive logins (browser popups) are best
> run directly in your terminal.

## 0. Variables (edit these first)
```bash
# Project IDs must be GLOBALLY unique. If create fails as "already exists",
# append a short suffix, e.g. bee6-pilot-gati, and use that everywhere below.
export PILOT=bee6-pilot
export DEMO=bee6-playground

# Get your billing account id from: gcloud billing accounts list
export BILLING=XXXXXX-XXXXXX-XXXXXX

export REGION=asia-southeast2
```

## 1. Authenticate
```bash
gcloud auth login                         # your Google account (browser)
gcloud auth application-default login      # ADC, so the local probe/SDK can call Gemini
firebase login                             # for Firebase Auth setup
```

## 2. Create both projects
```bash
gcloud projects create "$PILOT" --name="bee6 Pilot"
gcloud projects create "$DEMO"  --name="bee6 Demo"
```

## 3. Link billing
```bash
gcloud billing projects link "$PILOT" --billing-account="$BILLING"
gcloud billing projects link "$DEMO"  --billing-account="$BILLING"
```

## 4. Budget alerts (50 / 90 / 100%)
Set a monthly cap you're comfortable with (plan estimates ~$60-65 through judging; example uses
$100). Needs the budgets API enabled once:
```bash
gcloud services enable billingbudgets.googleapis.com --project="$PILOT"
for P in "$PILOT" "$DEMO"; do
  gcloud billing budgets create \
    --billing-account="$BILLING" \
    --display-name="$P monthly" \
    --budget-amount=100USD \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 \
    --filter-projects="projects/$P"
done
```

## 5. Enable APIs on BOTH projects
```bash
APIS="run.googleapis.com \
firestore.googleapis.com \
cloudbuild.googleapis.com \
artifactregistry.googleapis.com \
secretmanager.googleapis.com \
dlp.googleapis.com \
cloudscheduler.googleapis.com \
cloudtasks.googleapis.com \
aiplatform.googleapis.com \
firebase.googleapis.com \
identitytoolkit.googleapis.com"

for P in "$PILOT" "$DEMO"; do
  gcloud services enable $APIS --project="$P"
done
```
(`aiplatform.googleapis.com` = Gemini Enterprise Agent Platform, formerly Vertex AI.
`dlp.googleapis.com` = Sensitive Data Protection. `identitytoolkit` backs Firebase Auth.)

## 6. Artifact Registry repo (holds the container image Cloud Build pushes)
```bash
for P in "$PILOT" "$DEMO"; do
  gcloud artifacts repositories create bee6 \
    --repository-format=docker --location="$REGION" --project="$P"
done
```

## 7. Service accounts (no keys — least privilege)
On BOTH projects: a runtime SA for the `web` service, and an invoker SA for Cloud Tasks/Scheduler.
```bash
for P in "$PILOT" "$DEMO"; do
  gcloud iam service-accounts create web-runtime \
    --display-name="bee6 web runtime" --project="$P"
  gcloud iam service-accounts create tasks-invoker \
    --display-name="bee6 Cloud Tasks/Scheduler invoker" --project="$P"

  SA="web-runtime@${P}.iam.gserviceaccount.com"
  for ROLE in \
    roles/datastore.user \
    roles/secretmanager.secretAccessor \
    roles/aiplatform.user \
    roles/cloudtasks.enqueuer \
    roles/dlp.user \
    roles/logging.logWriter; do
    gcloud projects add-iam-policy-binding "$P" \
      --member="serviceAccount:${SA}" --role="$ROLE" --condition=None
  done

  # Let the invoker SA call the private /api/internal/* routes on Cloud Run.
  gcloud projects add-iam-policy-binding "$P" \
    --member="serviceAccount:tasks-invoker@${P}.iam.gserviceaccount.com" \
    --role="roles/run.invoker" --condition=None
done
```

## 8. Firestore (Native mode, Jakarta) on BOTH projects
```bash
for P in "$PILOT" "$DEMO"; do
  gcloud firestore databases create --location="$REGION" \
    --type=firestore-native --project="$P"
done
```

## 9. Firebase Auth
```bash
firebase projects:addfirebase "$PILOT"
firebase projects:addfirebase "$DEMO"
```
Then **in the Firebase console** (one manual step CLI can't fully do): for each project →
Authentication → Sign-in method → enable **Google**. Add your owner + supervisor Google emails
as test users if needed. Copy the web app config (apiKey, authDomain, etc.) into `.env.local`
(gitignored) using the `FIREBASE_*` names from CLAUDE.md §7.

## 10. Cloud Build → Cloud Run trigger (deploy on push to main)
2nd-gen triggers need a one-time GitHub connection (installs the Cloud Build GitHub App). Easiest
in the **console**: Cloud Build → Triggers → Connect repository → GitHub → authorize
`ranggabagas30/bee6`. Then:
```bash
gcloud builds triggers create github \
  --project="$PILOT" \
  --name="bee6-web-main" \
  --repo-owner=ranggabagas30 --repo-name=bee6 \
  --branch-pattern='^main$' \
  --build-config=cloudbuild.yaml \
  --region="$REGION"
```
(Point the trigger at the PILOT project for the live pilot. The demo project deploy can be a
manual `gcloud builds submit` or a second trigger later, for R-12.)

## 11. First deploy + probe
```bash
# Push the reviewed scaffold (Rangga does the push after review):
git push -u origin main          # fires the trigger → deploys `web` to Cloud Run

# Region probe (fills config/regions.yaml with real locations):
echo "GOOGLE_CLOUD_PROJECT=$PILOT" >> .env.local
npm run probe
```

## ⚠️ Gap to close before step 11's probe returns real data
`scripts/probe.ts` currently **stubs** the `@google/genai` call (it had no project to call), so
`npm run probe` today writes `UNPROBED`/`NOT_CONFIGURED` for every model. To get real Jakarta /
Singapore / global results, a small follow-up build task must:
1. add `@google/genai` as a dependency,
2. implement the real per-model call inside `probe.ts`'s attempt function (a 1-line prompt; a ~2s
   clip for audio models), keeping the existing retry/fallback/error-recording structure.

This is agent-buildable and I can queue it as **R-01c** — but it can only be *tested* once steps
1-9 above exist, because it needs a real project + ADC. Recommended order: you run steps 1-10,
tell me the project is live, I build R-01c, then you run `npm run probe`.

## Done when (R-01 fully complete)
- Push to `main` deploys a hello page to Cloud Run in Jakarta (curl the URL + `/api/health`).
- `config/regions.yaml` lists a real location for all four models (after R-01c + probe).
- No API keys anywhere — service accounts only.
