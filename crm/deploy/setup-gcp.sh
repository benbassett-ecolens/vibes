#!/usr/bin/env bash
# One-time GCP setup for Ecolens CRM: Cloud SQL (Postgres) + Secret Manager + Artifact Registry
# + Cloud Run service, then a custom subdomain. Idempotent-ish: safe to re-run.
#
# Prereqs: gcloud authenticated as a project owner; billing enabled.
# Usage:   PROJECT_ID=my-project ./deploy/setup-gcp.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-ecolens-crm}"
REPO="${REPO:-apps}"
SQL_INSTANCE="${SQL_INSTANCE:-ecolens-crm-db}"
SQL_TIER="${SQL_TIER:-db-f1-micro}"          # fine for a small team; bump to db-g1-small+ later
DB_NAME="${DB_NAME:-crm}"
DB_USER="${DB_USER:-crm}"
DOMAIN="${DOMAIN:-crm.ecolens.io}"
# Public origin the app uses for OAuth callbacks and Slack links. Defaults to the custom domain;
# set it to the run.app URL while DNS is not live yet, then re-run without it.
APP_BASE_URL="${APP_BASE_URL:-https://$DOMAIN}"
ALLOWED_DOMAIN="${ALLOWED_DOMAIN:-ecolens.io}"
ADMIN_EMAILS="${ADMIN_EMAILS:-ben@ecolens.io}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"      # create under APIs & Services > Credentials (see README)
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"  # same OAuth client; enables Gmail/Calendar sync
SLACK_BOT_TOKEN="${SLACK_BOT_TOKEN:-}"        # optional: Slack to-do sync (see README)
SLACK_SIGNING_SECRET="${SLACK_SIGNING_SECRET:-}"
SYNC_SCHEDULE="${SYNC_SCHEDULE:-*/10 * * * *}" # Cloud Scheduler cadence for sync + maintenance
AUDIT_RETENTION_MONTHS="${AUDIT_RETENTION_MONTHS:-12}"

gcloud config set project "$PROJECT_ID" >/dev/null

echo "▶ Enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com compute.googleapis.com cloudscheduler.googleapis.com \
  gmail.googleapis.com calendar-json.googleapis.com >/dev/null

echo "▶ Artifact Registry repo: $REPO"
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --location="$REGION" --repository-format=docker

echo "▶ Cloud SQL instance: $SQL_INSTANCE (this takes a few minutes the first time)"
if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --edition=enterprise --tier="$SQL_TIER" \
    --region="$REGION" --storage-auto-increase --backup-start-time=03:00 --availability-type=zonal
fi
gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

DB_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
  gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
else
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
fi
CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"

echo "▶ Secrets"
upsert_secret() { # name value
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null
  fi
}
upsert_secret crm-db-password "$DB_PASSWORD"
gcloud secrets describe crm-session-secret >/dev/null 2>&1 || upsert_secret crm-session-secret "$(openssl rand -hex 48)"
if [ "${ROTATE_SYNC_SECRET:-0}" = "1" ] || ! gcloud secrets describe crm-sync-secret >/dev/null 2>&1; then
  upsert_secret crm-sync-secret "$(openssl rand -hex 32)"
fi
[ -n "$GOOGLE_CLIENT_SECRET" ] && upsert_secret crm-google-client-secret "$GOOGLE_CLIENT_SECRET"
[ -n "$SLACK_BOT_TOKEN" ] && upsert_secret crm-slack-bot-token "$SLACK_BOT_TOKEN"
[ -n "$SLACK_SIGNING_SECRET" ] && upsert_secret crm-slack-signing-secret "$SLACK_SIGNING_SECRET"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# New projects run Cloud Build as the compute service account, which needs these to build and push.
for role in roles/logging.logWriter roles/artifactregistry.writer roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role="$role" --condition=None >/dev/null
done
SECRET_BINDINGS="DB_PASSWORD=crm-db-password:latest,SESSION_SECRET=crm-session-secret:latest,SYNC_SECRET=crm-sync-secret:latest"
for s in crm-db-password crm-session-secret crm-sync-secret; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor >/dev/null
done
for pair in "crm-google-client-secret:GOOGLE_CLIENT_SECRET" "crm-slack-bot-token:SLACK_BOT_TOKEN" "crm-slack-signing-secret:SLACK_SIGNING_SECRET"; do
  name="${pair%%:*}"; var="${pair##*:}"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$name" --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor >/dev/null
    SECRET_BINDINGS="$SECRET_BINDINGS,$var=$name:latest"
  fi
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUN_SA" --role=roles/cloudsql.client --condition=None >/dev/null

echo "▶ Building and pushing image"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
gcloud builds submit --tag "$IMAGE" "$(dirname "$0")/.."

echo "▶ Deploying Cloud Run service: $SERVICE"
gcloud run deploy "$SERVICE" --image="$IMAGE" --region="$REGION" --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-env-vars="NODE_ENV=production,CLOUD_SQL_CONNECTION_NAME=${CONNECTION_NAME},DB_USER=${DB_USER},DB_NAME=${DB_NAME},ALLOWED_DOMAIN=${ALLOWED_DOMAIN},ADMIN_EMAILS=${ADMIN_EMAILS},GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},APP_BASE_URL=${APP_BASE_URL},AUDIT_RETENTION_MONTHS=${AUDIT_RETENTION_MONTHS}" \
  --set-secrets="$SECRET_BINDINGS" \
  --min-instances=0 --max-instances=3 --memory=512Mi --cpu=1 --port=8080

# The app enforces @ecolens.io sign-in itself, so the service must be reachable without a Google IAM check.
# Organizations created recently enforce "domain restricted sharing", which blocks allUsers; detect and explain.
if ! gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" --member=allUsers --role=roles/run.invoker >/dev/null 2>&1; then
  cat <<MSG

!! Could not make the service publicly reachable. Your organization's policy
   "constraints/iam.allowedPolicyMemberDomains" blocks allUsers. An Organization
   Policy Administrator can allow it for this project only (a reset is NOT enough on
   newer organizations; the managed default is the restriction):

     cat > /tmp/allow-public.yaml <<YAML
     name: projects/$PROJECT_ID/policies/iam.allowedPolicyMemberDomains
     spec:
       rules:
         - allowAll: true
     YAML
     gcloud org-policies set-policy /tmp/allow-public.yaml
     sleep 90
     gcloud run services add-iam-policy-binding $SERVICE --region=$REGION --member=allUsers --role=roles/run.invoker

   (The CRM still requires an @${ALLOWED_DOMAIN} Google sign-in.)

MSG
fi

echo "▶ Cloud Scheduler: Gmail/Calendar sync + maintenance every '$SYNC_SCHEDULE'"
gcloud services enable cloudscheduler.googleapis.com >/dev/null
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
SYNC_SECRET_VALUE="$(gcloud secrets versions access latest --secret=crm-sync-secret)"
if gcloud scheduler jobs describe crm-sync --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http crm-sync --location="$REGION" --schedule="$SYNC_SCHEDULE" --uri="${SERVICE_URL}/api/internal/sync" --http-method=POST --update-headers="Authorization=Bearer ${SYNC_SECRET_VALUE}" >/dev/null
else
  gcloud scheduler jobs create http crm-sync --location="$REGION" --schedule="$SYNC_SCHEDULE" --uri="${SERVICE_URL}/api/internal/sync" --http-method=POST --headers="Authorization=Bearer ${SYNC_SECRET_VALUE}" --attempt-deadline=600s >/dev/null
fi

echo "▶ Custom domain: $DOMAIN"
ROOT_DOMAIN="$(echo "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')"
if gcloud domains list-user-verified --format='value(id)' 2>/dev/null | grep -qx "$ROOT_DOMAIN"; then
  gcloud beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" >/dev/null 2>&1 || \
    gcloud beta run domain-mappings create --service="$SERVICE" --domain="$DOMAIN" --region="$REGION"
  echo
  echo "Add this DNS record at your DNS provider (then wait for the managed certificate):"
  gcloud beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" --format='value(status.resourceRecords)'
else
  cat <<MSG

!! $ROOT_DOMAIN is not yet verified for your Google account, so the custom domain was skipped.
   Run:  gcloud domains verify $ROOT_DOMAIN
   It opens Search Console with a TXT record to add at your DNS provider. Once verified, re-run this script;
   it will create the mapping and print the DNS record for $DOMAIN. The service works at the run.app URL meanwhile.

MSG
fi
echo
echo "Service URL: $(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
echo "App base URL in use: ${APP_BASE_URL}"
echo "OAuth client must list ${APP_BASE_URL} under Authorized JavaScript origins and"
echo "${APP_BASE_URL}/api/google/callback under Authorized redirect URIs (Gmail/Calendar sync)."
echo "Slack app URLs: interactivity ${APP_BASE_URL}/api/slack/webhooks/interactions, slash command ${APP_BASE_URL}/api/slack/webhooks/commands"
