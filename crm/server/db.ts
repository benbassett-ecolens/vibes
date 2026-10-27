import pg from 'pg'
import { config } from './config.js'

const { Pool, types } = pg

// numeric -> number (amounts), int8 -> number (counts). Safe at CRM scale.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))
types.setTypeParser(20, (v) => (v === null ? null : Number(v)))
// Keep timestamps as ISO strings rather than Date objects.
types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()))
types.setTypeParser(1082, (v) => v) // date stays 'YYYY-MM-DD'

function poolConfig(): pg.PoolConfig {
  if (config.databaseUrl) return { connectionString: config.databaseUrl, max: 10 }
  // Cloud Run <-> Cloud SQL over the unix socket mounted by --add-cloudsql-instances.
  return {
    host: `/cloudsql/${config.cloudSql.connectionName}`,
    user: config.cloudSql.user,
    password: config.cloudSql.password,
    database: config.cloudSql.database,
    max: 10,
  }
}

export const pool = new Pool(poolConfig())

export type Queryable = Pick<pg.PoolClient, 'query'>

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = pool,
): Promise<T[]> {
  const res = await client.query<T>(text, params)
  return res.rows
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  client: Queryable = pool,
): Promise<T | null> {
  const rows = await query<T>(text, params, client)
  return rows[0] ?? null
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
