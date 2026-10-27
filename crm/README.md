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

## Architecture

```
crm/
  server/          Express 5 + pg (TypeScript, ESM)
    index.ts       app wiring, static hosting of the built client
    auth.ts        Google ID-token verification, hd/domain gate, session cookie, user upsert
    audit.ts       audit_log writer + field diff
    routes/        auth, users, pipelines(+stages, lost reasons), companies, contacts, deals,
                   activities, audit feed, reports, csv exports
    migrate.ts     forward-only SQL migrator (runs on boot)
    seed.ts        demo data for local development
  migrations/      001_init.sql — schema, triggers, default pipeline
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

```bash
PROJECT_ID=your-gcp-project GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com \
  ADMIN_EMAILS=ben@ecolens.io DOMAIN=crm.ecolens.io ./deploy/setup-gcp.sh
```

The script enables APIs, creates an Artifact Registry repo, a Cloud SQL Postgres 16 instance
(`db-f1-micro`, auto-backups), the database and user, stores the DB password and a session
secret in Secret Manager, builds the image with Cloud Build, deploys to Cloud Run
(`min-instances=0`, Cloud SQL socket attached), and creates the domain mapping. It prints the DNS
record to add for `crm.ecolens.io`; Cloud Run issues the certificate once DNS resolves.

Expected cost at Ecolens scale: Cloud Run scale-to-zero is pennies; `db-f1-micro` is roughly
$10/month. Bump `SQL_TIER` later if needed.

### 3. Continuous deploys (optional)

Create a Cloud Build trigger on this repo (branch `main`, included files `crm/**`, config
`crm/cloudbuild.yaml`) and set the `_SQL_INSTANCE` substitution to the instance connection name.
Each push then builds and deploys. Environment variables and secrets set in step 2 persist across
revisions.

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
POST /api/deals/:id/move {stage_id, position, lost_reason}     GET /api/deals/:id/timeline
GET/POST /api/activities  PATCH/DELETE /api/activities/:id ({completed: true} marks done)
GET  /api/audit?entity_type&entity_id&actor_id
GET  /api/reports/summary?pipeline_id&owner_id&from&to
GET  /api/export/{deals|contacts|companies|activities|stage_history|audit_log}.csv
```
