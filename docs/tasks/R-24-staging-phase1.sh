#!/usr/bin/env bash
# web-develop staging, Phase 1 (R-24). Demo project bee6-playground ONLY.
# Run from the repo root:  bash docs/tasks/R-24-staging-phase1.sh
# It pauses before each step so you can stop (Ctrl-C). Steps are in docs/tasks/R-24-staging-phase1-steps.md.
set -euo pipefail

P="bee6-playground"
R="asia-southeast2"
KEY="0521292e-44ae-4525-be97-c385509af766"
S="https://web-develop-33uzb53tza-et.a.run.app"
S2="https://web-develop-<DEMO_PROJECT_NUMBER>.asia-southeast2.run.app"
BACKUP="$HOME/bee6-api-key-referrers-before.txt"

echo "Project: $P (demo). The pilot project is never used here."
read -r -p "Press Enter to start step 1 (make web-develop reachable) ... " _

echo "== Step 1: allow unauthenticated invocations on web-develop"
gcloud run services add-iam-policy-binding web-develop \
  --region="$R" --project="$P" \
  --member=allUsers --role=roles/run.invoker

read -r -p "Press Enter to start step 2 (env vars and secrets on web-develop) ... " _

echo "== Step 2: env vars + secrets on web-develop (key copied from web, not printed)"
FB_KEY="$(gcloud run services describe web --region="$R" --project="$P" --format=json \
  | python3 -c "import json,sys;e=json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env'];print(next(x['value'] for x in e if x['name']=='FIREBASE_API_KEY'))")"

gcloud run services update web-develop \
  --region="$R" --project="$P" \
  --update-env-vars="APP_REGION=$R,GOOGLE_CLOUD_PROJECT=$P,DEMO_MODE=true,FIREBASE_PROJECT_ID=$P,FIREBASE_AUTH_DOMAIN=$P.firebaseapp.com,FIREBASE_APP_ID=<DEMO_FIREBASE_APP_ID>,FIREBASE_API_KEY=$FB_KEY,TASKS_INVOKER_SA=tasks-invoker@$P.iam.gserviceaccount.com,PIPELINE_TICK_AUDIENCE=$S/api/internal/pipeline/tick,REVIEW_RUN_AUDIENCE=$S/api/internal/reviews/run,DEMO_MODEL_DAILY_CAP=300,DEMO_SEGMENT_DAILY_CAP=300,DEMO_GENERATE_DAILY_CAP=30,DEMO_SANDBOX_DAILY_CAP=40" \
  --update-secrets="DEMO_IP_SALT=demo-ip-salt:latest,THREAD_HANDLE_KEY=THREAD_HANDLE_KEY:latest" \
  --timeout=1800 --min-instances=0 --max-instances=2

read -r -p "Press Enter to start step 3 (browser API key referrers; --append ADDS the 2 staging hosts and keeps the 7 existing) ... " _

echo "== Step 3: save the current referrer list, then update"
gcloud services api-keys describe "$KEY" --project="$P" \
  --format="value(restrictions.browserKeyRestrictions.allowedReferrers)" | tee "$BACKUP"
echo "(saved to $BACKUP)"

gcloud services api-keys update "$KEY" --project="$P" \
  --append --no-check-existing-usage \
  --allowed-referrers="$S/*,$S2/*"

echo "== New referrer list:"
gcloud services api-keys describe "$KEY" --project="$P" \
  --format="value(restrictions.browserKeyRestrictions.allowedReferrers)"

echo
echo "Done. Now:"
echo "  1) wait ~5 minutes for the key change to propagate"
echo "  2) sign in once on web (https://web-33uzb53tza-et.a.run.app) to confirm it still works"
echo "  3) run the check:"
echo "     for p in / /pair /api/health; do curl -s -o /dev/null -w \"\$p %{http_code}\\n\" $S\$p; done"
echo "     (all three should print 200)"
