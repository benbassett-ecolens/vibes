# Ecolens CRM

A self-hosted CRM for Ecolens, built to run on Google Cloud (Cloud Run + Cloud SQL) at a
subdomain such as `crm.ecolens.io`, with sign-in restricted to `@ecolens.io` Google Workspace
accounts.

The feature set was chosen after looking at how HubSpot, Salesforce, Pipedrive, Attio, Close and
Zoho handle the same problems; the parts that matter for a small B2B team are built in, the
enterprise sprawl is not.

## Features

| Area | What you get |
| --- | --- |
| **Deals** | Kanban board per pipeline with drag-and-drop between stages, a sortable list view, search, owner filter, won/lost filter. Cards show amount, days in stage, next activity, overdue-task count, owner, and **rotting** (red edge when a deal sits idle past the stage's limit, as in Pipedrive). |
| **Stages** | Any number of pipelines; each stage has a win probability (feeds the weighted pipeline), a kind (open / won / lost), a **forecast category** (pipeline / best case / commit, as in Salesforce), a rot-after-days limit, a colour, and drag-to-reorder. Moving a deal to a lost stage prompts for a lost reason. |
| **Timestamps on everything** | Every table has `created_at` / `updated_at`. Every create, update, archive, delete, stage move and task completion is written to an **audit log** with the actor and a field-by-field before/after diff. Every stage move is also written to **deal stage history** with entered/exited times, so time-in-stage is exact. Deal, contact and company pages show a merged timeline of activities, stage moves and edits. |
| **Contacts & companies** | Sortable, searchable tables; detail pages with timeline, related deals and contacts; archive/restore. |
| **Activities** | Notes, calls, emails, meetings and tasks against any deal/contact/company. Tasks and meetings have due dates and an assignee; the Tasks page shows open / overdue / today / completed, per owner. Logging activity resets a deal's rot timer. |
| **Reports** | Pipeline by stage (value, weighted, average days in stage), won vs lost by month, win rate, average deal size, average sales cycle, sales velocity, forecast categories, funnel conversion, lost reasons, per-owner leaderboard with activity counts, activity mix, rotting deals. Filter by pipeline, owner and date range. |
| **Sorting** | Every list endpoint accepts `sort` + `dir` against a per-endpoint whitelist; every table header toggles it. |
| **Export** | CSV for deals, contacts, companies, activities, stage history and the full audit log. |
| **Gmail & Calendar sync** | Each person connects their own Google account (Settings). Emails and calendar invites that involve a CRM contact are logged automatically as email/meeting activities on the right deal, with a link back to Gmail/Calendar. Senders we cannot match are listed so you can create the contact in one click. Customer emails reset a deal's rot timer. |
| **Slack to-dos** | Every task assigned to you is mirrored to a Slack DM with a **Mark done** button. Done in Slack = done in the CRM; done in the CRM updates the Slack card. `/todo <what> \| <when>` in Slack creates a CRM task. A nudge lands in the card's thread when the task comes due. |
| **Products** | A product catalogue (one-time, monthly, or percent-of-basis pricing). Add lines to a deal and the deal amount becomes the sum of the lines; reports show revenue by product. |
| **Required fields** | A deal cannot be created without a company, a main contact that has an email address, an expected close date, a lead source, a deal type (new business / renewal / upsell) and a scheduled next activity (date + description). Contract length is optional at creation and required to close won. |
| **Flags** | Every open deal is checked for: close date overdue, overdue activity, no next step, rotting. Flags appear on board cards, in the list (with a filter), on the deal page, on the dashboard and in Reports. |
| **Renewals** | Closing won records the contract start date (defaults to the close date). 45 days into the contract (`RENEWAL_LEAD_DAYS`) the scheduled job creates the renewal deal: same company, contact, owner and products, expected close = contract end date, and a task 90 days before the end to start the renewal conversation. |
| **Users & roles** | Anyone with an `@ecolens.io` Workspace account is created on first sign-in as a member. Admins (seeded from `ADMIN_EMAILS`, or promoted in Settings) manage pipelines, stages, lost reasons and users, and can deactivate accounts. |

## The login gate

1. The browser uses Google Identity Services to get an ID token.
2. The server verifies the token's signature and audience with `google-auth-library`, then
   **additionally** requires `email_verified = true`, `hd = ecolens.io` (the hosted-domain claim
   Google only sets for Workspace accounts) and an `@ecolens.io` address. Consumer Gmail accounts
   and other Workspace domains are rejected before a user row is created.
3. A signed, `HttpOnly`, `SameSite=Lax`, `Secure` session cookie is issued (`SESSION_HOURS`).
   Every API request re-reads the user, so deactivating someone takes effect immediately.
4. Everything under `/api` except `/api/auth/*` and `/api/health` requires the session; the SPA
   itself renders only the login page without one.

Optional belt-and-braces: put [Identity-Aware Proxy](https://cloud.google.com/iap/docs/enabling-cloud-run)
in front of the Cloud Run service with an `ecolens.io` domain principal. The app's own gate still
applies behind it.

## Gmail & Calendar sync

Per-user OAuth, read-only scopes (`gmail.readonly`, `calendar.readonly`). We store the refresh
token encrypted (AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY` or `SESSION_SECRET`) and keep only
message headers + Gmail's ~200-character snippet, never bodies or attachments. Purely internal
threads (all `@ecolens.io`) are ignored.

- **Gmail**: every run lists messages since the last watermark (minus a day of overlap) excluding
  spam, trash, promotions, social and updates; one activity per RFC `Message-ID`, so two reps on
  the same thread produce one record. Direction (sent/received) comes from the From header.
- **Calendar** (off by default; set `CALENDAR_SYNC=on` to enable): initial window is 30 days back / 90 days ahead, then incremental via the API's
  `syncToken`; cancelled events remove the meeting, time changes update it, past meetings are
  marked completed. Dedup key is `iCalUID`.
- **Matching**: external addresses → `contacts.email`; the activity attaches to the newest open
  deal naming that contact (else one at their company). If no contact matches but the sender's
  domain belongs to a company (`companies.domain`), a contact is created automatically and the
  item is logged. Everything else is kept as an unmatched sender, grouped by domain in Settings,
  with "Create contact" (which also teaches the company its domain) and "Ignore domain"
  (team-wide; common vendor/system domains are pre-ignored).
- **Scheduling**: Cloud Scheduler calls `POST /api/internal/sync` every 10 minutes with
  `Authorization: Bearer $SYNC_SECRET` (set up by `deploy/setup-gcp.sh`). The same endpoint runs
  retention maintenance. Locally, set `SYNC_INTERVAL_MINUTES=10` for an in-process timer.

Setup: on the OAuth client add `https://crm.ecolens.io/api/google/callback` as an **Authorized
redirect URI**, enable the **Gmail API** and **Google Calendar API** in the project, and set
`GOOGLE_CLIENT_SECRET` and `APP_BASE_URL`. Because the consent screen is *Internal*, Google's
restricted-scope verification is not required.

## Slack to-dos

Create a Slack app from this manifest (api.slack.com/apps → Create New App → From manifest),
install it to the workspace, and set `SLACK_BOT_TOKEN` (xoxb-…) and `SLACK_SIGNING_SECRET`:

```yaml
display_information:
  name: Ecolens CRM
features:
  bot_user: { display_name: Ecolens CRM, always_online: true }
  slash_commands:
    - command: /todo
      url: https://crm.ecolens.io/api/slack/webhooks/commands
      description: Add a to-do to the CRM
      usage_hint: "Send proposal to Acme | tomorrow 9am"
oauth_config:
  scopes:
    bot: [chat:write, im:write, users:read, users:read.email, commands]
settings:
  interactivity:
    is_enabled: true
    request_url: https://crm.ecolens.io/api/slack/webhooks/interactions
```

How it stays in sync: the CRM posts a Block Kit card (with the task's deal, contact, due date and a
**Mark done** button) to the assignee's DM when a task is created or assigned, and stores the
message id on the activity. Completing or reopening in the CRM calls `chat.update` on that card.
Pressing the button sends a signed interaction to `/api/slack/webhooks/interactions`; the server
verifies the Slack signature, maps the Slack user to the CRM user by email, completes the task,
writes the audit entry (`via: slack`) and updates the card. Slack's own "Later / To-do" list has no
public API, so the card-in-DM is the integration point. Users link their Slack account by email
automatically; Settings has a "Send test DM" and "Send my open tasks to Slack" button.

## Products & deal value

Settings → Products. The deal's **amount is its first-year value**, computed from its product lines:

| Type | First-year value | Contract value |
| --- | --- | --- |
| One-time $ | quantity × dollar value | same |
| Monthly $ | quantity × monthly amount × 12 | quantity × monthly amount × contract months |
| % of basis | basis amount × percent | same |

So a deal with a $2,500 retainer, $15,000 of SQL work and an $8,000 Closed Won estimate is worth
$53,000 in year one, and $113,000 over a 36-month contract (shown on the deal page once a contract
length is set). Core ERP SQL and Core ERP Closed Won % are entered as dollar values per deal. Once
a deal has any line, its amount is derived from the lines and the Amount field becomes read-only.

## Importing deals

Settings → **Import deals from CSV** (admins). Export the pipeline sheet with File → Download →
CSV and upload it. Columns are matched by header name; the Ecolens pipeline sheet's columns
(Director/CPM, Prospect Name, Function, Ecolens BU, ISV/VAR/Other, Ecosystem, Retainer ACV,
Performance ACV, Total Contract Value, Deal Stage, Close Date, Notes) all map automatically, as do
generic ones (owner, company, stage, close date, amount, notes, contact name/email, lead source,
deal type, contract length). The preview shows owners that need an email (a placeholder user is
created and claimed on their first Google sign-in), stages that need mapping, and problem rows.
Retainer ACV becomes the monthly retainer product at ACV ÷ 12 per month (EcoNet or AI products when
the BU says so), Performance ACV becomes Core ERP Closed Won %, closed deals are dated by their close
date, and re-importing skips deals whose title already exists.

## Stages

A fresh deployment starts with Ecolens's stages: Cold Prospect 5%, Introduction Made 10%, Demo of
Ecolens 30%, Proposal 50%, Contract Sent 80%, Closed Won, Closed Lost, Deferred 10% (forecast
"omitted"). Edit names, probabilities, rot limits and order in Settings.

## Dark mode

The sidebar has Light / Auto / Dark. Auto follows the operating system. The choice is per browser.

## Start fresh

Settings → **Start fresh** (admins) deletes every deal, company, contact and activity plus the
unmatched-sender list, rewinds the Google sync, and keeps users, pipelines, stages, products, lost
reasons, ignored domains, connections and the audit log. Type `RESET` to enable the button.

## Retention

`AUDIT_RETENTION_MONTHS` (default 12) purges `audit_log` rows older than that on each scheduled
run; `0` keeps everything. Stage history, activities and synced emails are never purged (reports
depend on them). `UNMATCHED_RETENTION_DAYS` (default 90) trims the unmatched-sender list. Export
the audit log CSV before lowering retention if you want an archive.

## Architecture

```
crm/
  server/          Express 5 + pg (TypeScript, ESM)
    index.ts       app wiring, static hosting of the built client
    auth.ts        Google ID-token verification, hd/domain gate, session cookie, user upsert
    audit.ts       audit_log writer + field diff
    routes/        auth, users, pipelines(+stages, lost reasons), companies, contacts, deals,
                   activities, audit feed, reports, csv exports
    google/        OAuth connect flow, Gmail/Calendar sync engine, token encryption
    slack/         Slack task cards, interactions + slash-command webhooks
    maintenance.ts retention purges + Slack due-now nudges
    migrate.ts     forward-only SQL migrator (runs on boot)
    seed.ts        demo data for local development
  migrations/      001 schema · 002 Google sync · 003 products, Slack · 004 deal type, contract, renewals · 005 contract start
  shared/types.ts  API types shared by server and client
  src/             React 18 + Vite + react-router + recharts
    pages/         Dashboard, Deals (board + list), DealDetail, Contacts, ContactDetail,
                   Companies, CompanyDetail, Activities, Reports, Settings
    components/    Timeline, ActivityComposer, Forms, Pickers, ui
  Dockerfile, cloudbuild.yaml, deploy/setup-gcp.sh
```

Data model: `users`, `pipelines`, `stages`, `companies`, `contacts`, `deals`,
`deal_stage_history`, `activities`, `audit_log`, `lost_reasons`. Deletes of deals cascade to
their activities and stage history; companies/contacts are archived rather than deleted.

## Local development

Requires Node 22 and a Postgres 14+ database.

```bash
cd crm
npm install
cp .env.example .env            # edit DATABASE_URL; AUTH_DEV_MODE=true enables password-less dev login
npm run migrate                 # or just start the server; it migrates on boot
npm run seed                    # optional demo data
npm run dev                     # API on :8080, Vite on :5173 (proxies /api)
npm test                        # unit tests (auth gate, session tokens, report math, CSV, formatting)
npm run build && npm start      # production build served by the API on :8080
```

With `AUTH_DEV_MODE=true` (ignored when `NODE_ENV=production`) the login page shows a dev form
that signs in any `@ecolens.io` address without Google. Use `GOOGLE_CLIENT_ID` to test the real
button locally (add `http://localhost:5173` and `http://localhost:8080` as authorized origins).

## Deploying to GCP

### 1. Create the OAuth client (once)

Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**:

- Application type: **Web application**
- Authorized JavaScript origins: `https://crm.ecolens.io` (plus the `*.run.app` URL you get in
  step 2, and localhost origins for development)
- No redirect URI is needed (Google Identity Services uses a popup/one-tap flow).
- On the OAuth consent screen choose **Internal** so only your Workspace can even see the prompt.

Copy the client ID; it becomes `GOOGLE_CLIENT_ID`.

### 2. Provision and deploy

Easiest from **Cloud Shell** (the terminal icon in the GCP console; `gcloud` is already signed in):

```bash
git clone https://github.com/benbassett-ecolens/vibes.git && cd vibes/crm
read -rsp 'Google client secret: ' GOOGLE_CLIENT_SECRET; echo
read -rsp 'Slack bot token (blank to skip): ' SLACK_BOT_TOKEN; echo
read -rsp 'Slack signing secret (blank to skip): ' SLACK_SIGNING_SECRET; echo
export GOOGLE_CLIENT_SECRET SLACK_BOT_TOKEN SLACK_SIGNING_SECRET
PROJECT_ID=ecolens-crm REGION=us-central1 \
  GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
  ADMIN_EMAILS=ben@ecolens.io DOMAIN=crm.ecolens.io ./deploy/setup-gcp.sh
```

`read -rsp` prompts without echoing, so secrets never land in shell history. The script is safe to
re-run; it prints a fix when the organization policy blocks public Cloud Run services and skips the
custom domain until `gcloud domains verify ecolens.io` has been completed.

The script enables APIs, creates an Artifact Registry repo, a Cloud SQL Postgres 16 instance
(`db-f1-micro`, auto-backups), the database and user, stores the DB password and a session
secret in Secret Manager, builds the image with Cloud Build, deploys to Cloud Run
(`min-instances=0`, Cloud SQL socket attached), and creates the domain mapping. It prints the DNS
record to add for `crm.ecolens.io`; Cloud Run issues the certificate once DNS resolves.

Expected cost at Ecolens scale: Cloud Run scale-to-zero is pennies; `db-f1-micro` is roughly
$10/month. Bump `SQL_TIER` later if needed.

### Staging sandbox

A second service with its own database on the same Cloud SQL instance, scaled to zero when idle
(effectively free). Deploy from any branch you want to try out:

```bash
cd ~/vibes && git fetch origin && git checkout <branch> && cd crm
SERVICE=ecolens-crm-staging DB_NAME=crm_staging APP_ENV=staging DOMAIN= WITH_SLACK=0 \
  PROJECT_ID=ecolens-crm REGION=us-central1 GOOGLE_CLIENT_ID=... ADMIN_EMAILS=... ./deploy/setup-gcp.sh
```

With no `DOMAIN`, the script uses the service's own run.app URL as the base URL automatically and
prints it. Add that URL to the OAuth client's JavaScript origins (and `<url>/api/google/callback`
to its redirect URIs if you want Gmail sync in staging). The app shows a yellow STAGING banner.
`WITH_SLACK=0` keeps Slack off staging so test tasks never message real people.

### Day-to-day deploys (no setup needed)

```bash
~/vibes/crm/deploy/prod.sh        # production, latest code on the current branch
~/vibes/crm/deploy/staging.sh     # the sandbox
```

Both pull the latest code first. While `crm.ecolens.io` is not live, prefix the production one with
`BASE_URL=https://<run.app URL>`. The Google client secret is read from Secret Manager once stored,
so no secrets need typing on later runs.

### 3. Continuous deploys (optional)

Once the services exist (step 2 ran once for production and once for staging), Cloud Build deploys
on every push. One-time setup, in Cloud Shell:

```bash
PN=$(gcloud projects describe ecolens-crm --format='value(projectNumber)')
SA="${PN}-compute@developer.gserviceaccount.com"
for r in roles/run.admin roles/iam.serviceAccountUser roles/cloudsql.client roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding ecolens-crm --member="serviceAccount:$SA" --role="$r" --condition=None >/dev/null
done
```

Then in the console: Cloud Build → **Repositories** → **Connect repository** (GitHub, authorize,
pick `benbassett-ecolens/vibes`). Then **Triggers** → **Create trigger**, twice:

| | production | staging |
| --- | --- | --- |
| Name | `crm-production` | `crm-staging` |
| Event | Push to a branch | Push to a branch |
| Branch (regex) | `^main$` | `^staging$` |
| Included files filter | `crm/**` | `crm/**` |
| Configuration | Cloud Build configuration file, `crm/cloudbuild.yaml` | same |
| Substitution `_SERVICE` | `ecolens-crm` | `ecolens-crm-staging` |
| Substitution `_SQL_INSTANCE` | `ecolens-crm:us-central1:ecolens-crm-db` | same |

Workflow from then on: branch from `main`, merge into `staging` to try it in the sandbox, merge into
`main` to ship. Env vars and secrets on each service persist across revisions; change them with
`deploy/setup-gcp.sh` or `gcloud run services update`.

### Runtime configuration

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth web client ID (required in production) |
| `ALLOWED_DOMAIN` | Workspace domain allowed to sign in (`ecolens.io`) |
| `ADMIN_EMAILS` | Comma-separated emails that are admins on login |
| `SESSION_SECRET` | 32+ random bytes; signs the session cookie (Secret Manager) |
| `SESSION_HOURS` | Session lifetime (default 72) |
| `DATABASE_URL` **or** `CLOUD_SQL_CONNECTION_NAME` + `DB_USER` + `DB_PASSWORD` + `DB_NAME` | Postgres connection |
| `AUTH_DEV_MODE` | Dev-only password-less login; ignored in production |
| `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL` | Enable Gmail/Calendar sync (OAuth code exchange + redirect URI) |
| `TOKEN_ENCRYPTION_KEY` | Encrypts stored Google refresh tokens (defaults to `SESSION_SECRET`) |
| `SYNC_SECRET` | Bearer token Cloud Scheduler uses for `POST /api/internal/sync` |
| `SYNC_INTERVAL_MINUTES` | Optional in-process sync timer (needs `min-instances=1`) |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | Enable Slack to-do sync |
| `AUDIT_RETENTION_MONTHS`, `UNMATCHED_RETENTION_DAYS` | Retention (12 months / 90 days by default) |
| `RENEWAL_LEAD_DAYS` | Days after contract start at which the renewal deal is created (45) |

## API sketch

All JSON, all behind the session cookie. List endpoints take `q`, `sort`, `dir`, `limit`,
`offset` and entity-specific filters and return `{ items, total, limit, offset }`.

```
GET  /api/auth/config            POST /api/auth/google  POST /api/auth/logout  GET /api/auth/me
GET  /api/users                  PATCH /api/users/:id                      (admin)
GET  /api/pipelines              POST/PATCH/DELETE /api/pipelines/:id       (admin)
POST/PATCH/DELETE /api/pipelines/:id/stages[/:stageId]   POST .../stages/reorder
GET/POST/DELETE /api/lost-reasons
GET/POST /api/companies   GET/PATCH /api/companies/:id   POST /api/companies/:id/archive[?restore=true]
GET/POST /api/contacts    GET/PATCH /api/contacts/:id    POST /api/contacts/:id/archive
GET/POST /api/deals       GET /api/deals/board?pipeline_id=…   GET/PATCH/DELETE /api/deals/:id
   list filters: q, owner_id, stage_id, status, deal_type, flag=close_overdue|activity_overdue|no_next_step|rotting
POST /api/deals/:id/move {stage_id, position, lost_reason, contract_months, contract_start_date}     GET /api/deals/:id/timeline
GET/POST /api/activities  PATCH/DELETE /api/activities/:id ({completed: true} marks done)
GET  /api/audit?entity_type&entity_id&actor_id
GET/POST/PATCH/DELETE /api/deals/:id/products[/:lineId]
GET /api/products   POST/PATCH/DELETE /api/products/:id             (admin)
GET /api/google/connect → Google → /api/google/callback   GET /api/google/status   POST /api/google/sync
PATCH/DELETE /api/google/connection   GET /api/google/unmatched   POST /api/google/unmatched/:id/{dismiss|create-contact}
GET /api/slack/status  POST /api/slack/{link|test|resend}   POST /api/slack/webhooks/{interactions|commands}  (Slack-signed)
POST /api/internal/sync                                          (Bearer SYNC_SECRET; sync all + maintenance)
GET  /api/reports/summary?pipeline_id&owner_id&from&to
GET  /api/export/{deals|contacts|companies|activities|stage_history|audit_log}.csv
```
