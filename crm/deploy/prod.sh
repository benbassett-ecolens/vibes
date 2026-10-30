#!/usr/bin/env bash
# Deploy the latest code to PRODUCTION. Run from Cloud Shell:
#   ~/vibes/crm/deploy/prod.sh
# Optional: BASE_URL=https://ecolens-crm-1011912444533.us-central1.run.app ~/vibes/crm/deploy/prod.sh
#   (use that while crm.ecolens.io is not live yet; omit it afterwards)
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch origin
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
git reset --hard "origin/${BRANCH}" >/dev/null
echo "Deploying $(git log -1 --oneline) to production"
export PROJECT_ID=ecolens-crm REGION=us-central1 \
  GOOGLE_CLIENT_ID=1011912444533-o27okt6hp2qh5ig03960ovdppjvjfj0u.apps.googleusercontent.com \
  ADMIN_EMAILS=ben@ecolens.io DOMAIN=crm.ecolens.io
[ -n "${BASE_URL:-}" ] && export APP_BASE_URL="$BASE_URL"
exec ./deploy/setup-gcp.sh
