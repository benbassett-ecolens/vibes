#!/usr/bin/env bash
# Deploy the current branch to the STAGING sandbox (separate service + database, no Slack).
#   ~/vibes/crm/deploy/staging.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch origin
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
git reset --hard "origin/${BRANCH}" >/dev/null
echo "Deploying $(git log -1 --oneline) to staging"
export PROJECT_ID=ecolens-crm REGION=us-central1 SERVICE=ecolens-crm-staging DB_NAME=crm_staging \
  APP_ENV=staging DOMAIN= WITH_SLACK=0 \
  GOOGLE_CLIENT_ID=1011912444533-o27okt6hp2qh5ig03960ovdppjvjfj0u.apps.googleusercontent.com \
  ADMIN_EMAILS=ben@ecolens.io
exec ./deploy/setup-gcp.sh
