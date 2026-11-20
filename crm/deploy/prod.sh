#!/usr/bin/env bash
# Deploy the latest code to PRODUCTION. Run from Cloud Shell:
#   ~/vibes/crm/deploy/prod.sh
# The run.app address is the permanent URL (decision: no custom domain). To map a domain later,
# run with DOMAIN=crm.ecolens.io BASE_URL=https://crm.ecolens.io.
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch origin
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
git reset --hard "origin/${BRANCH}" >/dev/null
echo "Deploying $(git log -1 --oneline) to production"
export PROJECT_ID=ecolens-crm REGION=us-central1 \
  GOOGLE_CLIENT_ID=1011912444533-o27okt6hp2qh5ig03960ovdppjvjfj0u.apps.googleusercontent.com \
  ADMIN_EMAILS=ben@ecolens.io
export DOMAIN="${DOMAIN:-}"
export APP_BASE_URL="${BASE_URL:-https://ecolens-crm-1011912444533.us-central1.run.app}"
exec ./deploy/setup-gcp.sh
