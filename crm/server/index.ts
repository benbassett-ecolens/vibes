import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertConfig, config } from './config.js'
import { pool } from './db.js'
import { runMigrations } from './migrate.js'
import { requireAuth } from './auth.js'
import { errorMiddleware } from './http.js'
import { authRouter } from './routes/auth.js'
import { usersRouter } from './routes/users.js'
import { lostReasonsRouter, pipelinesRouter } from './routes/pipelines.js'
import { companiesRouter } from './routes/companies.js'
import { contactsRouter } from './routes/contacts.js'
import { dealsRouter } from './routes/deals.js'
import { activitiesRouter } from './routes/activities.js'
import { auditRouter } from './routes/audit.js'
import { reportsRouter } from './routes/reports.js'
import { exportsRouter } from './routes/exports.js'
import { googleRouter, internalRouter } from './google/routes.js'
import { syncAll } from './google/sync.js'
import { runMaintenance } from './maintenance.js'
import { slackRouter, slackWebhookRouter } from './slack/routes.js'
import { productsRouter } from './routes/products.js'
import { importRouter } from './routes/importer.js'
import { linkerRouter } from './routes/linker.js'

export function createApp(): express.Express {
  const app = express()
  app.set('trust proxy', true) // Cloud Run terminates TLS in front of us.
  app.disable('x-powered-by')
  app.use(cookieParser())
  // Slack posts form-encoded payloads and needs the raw body for signature checks.
  app.use('/api/slack/webhooks', slackWebhookRouter)
  app.use(express.json({ limit: '8mb' }))

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  })

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRouter)
  app.use('/api/internal', internalRouter) // shared-secret, for Cloud Scheduler
  app.use('/api/google', googleRouter) // handles its own auth (OAuth callback has no session header)
  app.use('/api/slack', slackRouter)

  // Everything else behind the domain-gated session.
  app.use('/api', requireAuth)
  app.use('/api/users', usersRouter)
  app.use('/api/pipelines', pipelinesRouter)
  app.use('/api/lost-reasons', lostReasonsRouter)
  app.use('/api/companies', companiesRouter)
  app.use('/api/contacts', contactsRouter)
  app.use('/api/deals', dealsRouter)
  app.use('/api/products', productsRouter)
  app.use('/api/import', importRouter)
  app.use('/api/link', linkerRouter)
  app.use('/api/activities', activitiesRouter)
  app.use('/api/audit', auditRouter)
  app.use('/api/reports', reportsRouter)
  app.use('/api/export', exportsRouter)
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
  app.use(errorMiddleware)

  // Static client (production build). In dev, Vite serves the client and proxies /api here.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const clientDir = path.resolve(here, '..', '..', 'client')
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }))
  app.get('*splat', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(clientDir, 'index.html'), (err) => {
      if (err) res.status(404).send('Client build not found. Run `npm run build`.')
    })
  })
  return app
}

async function main(): Promise<void> {
  assertConfig()
  const ran = await runMigrations()
  if (ran.length) console.log(`Applied migrations: ${ran.join(', ')}`)
  const app = createApp()
  if (config.syncIntervalMinutes > 0) {
    const tick = () => syncAll('scheduled').then(() => runMaintenance()).catch((e) => console.error('scheduled sync failed', e))
    setInterval(tick, config.syncIntervalMinutes * 60 * 1000).unref()
    setTimeout(tick, 15_000).unref()
  }
  const server = app.listen(config.port, () => {
    console.log(`Ecolens CRM listening on :${config.port} (${config.isProduction ? 'production' : 'development'}; domain gate: @${config.allowedDomain})`)
  })
  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isEntry) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
