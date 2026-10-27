import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

/**
 * Minimal forward-only migrator: applies migrations/*.sql in filename order,
 * recording each in schema_migrations. Safe to run on every boot.
 */
export async function runMigrations(): Promise<string[]> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // Works both from source (server/) and from the build (dist/server/server/).
  const candidates = [path.join(here, '..', 'migrations'), path.join(here, '..', '..', '..', 'migrations')]
  let dir: string | null = null
  for (const c of candidates) {
    try {
      await readdir(c)
      dir = c
      break
    } catch {
      /* try next */
    }
  }
  if (!dir) throw new Error('migrations directory not found')

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  )
  const ran: string[] = []
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(dir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      ran.push(file)
    } catch (e) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`)
    } finally {
      client.release()
    }
  }
  return ran
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date')
      return pool.end()
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
