#!/usr/bin/env bash
# web-develop staging, Phase 1, STEP 3 only (browser API key referrers). Demo project bee6-playground ONLY.
# Run from the repo root:  bash docs/tasks/R-24-staging-phase1-step3.sh
# Steps 1 and 2 are already done (verified by dev-ops, 17 Oct). This ADDS the 2 staging hosts and keeps the 7 existing ones.
set -euo pipefail

P="bee6-playground"
KEY="0521292e-44ae-4525-be97-c385509af766"
S="https://web-develop-33uzb53tza-et.a.run.app"
S2="https://web-develop-<DEMO_PROJECT_NUMBER>.asia-southeast2.run.app"
BACKUP="$HOME/bee6-api-key-referrers-before.txt"

echo "Project: $P (demo). The pilot project is never used here."
echo "== Current referrers (saved to $BACKUP):"
gcloud services api-keys describe "$KEY" --project="$P" \
  --format="value(restrictions.browserKeyRestrictions.allowedReferrers)" | tee "$BACKUP"

read -r -p "Press Enter to ADD the 2 staging hosts (keeps the 7 existing; skips the 12 Oct denied-probe usage check) ... " _

gcloud services api-keys update "$KEY" --project="$P" \
  --append --no-check-existing-usage \
  --allowed-referrers="$S/*,$S2/*"

echo
echo "== New restrictions (expect 9 referrers and apiTargets identitytoolkit + securetoken):"
gcloud services api-keys describe "$KEY" --project="$P" --format="yaml(restrictions)"

echo
echo "Next:"
echo "  1) sign in once on web (https://web-33uzb53tza-et.a.run.app) to confirm it still works"
echo "  2) wait up to 5 minutes, then open $S and start a demo session"
echo "     (no 'API key not valid' or referer-blocked error in the browser console)"
