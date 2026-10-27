import { Router } from 'express'
import { query } from '../db.js'
import { toCsv } from '../csv.js'
import { badRequest, wrap } from '../http.js'
import { DEAL_SELECT } from './deals.js'

export const exportsRouter = Router()

const EXPORTS: Record<string, { sql: string; columns: string[] }> = {
  deals: {
    sql: `${DEAL_SELECT} WHERE d.archived_at IS NULL ORDER BY d.created_at`,
    columns: ['id', 'title', 'stage_name', 'stage_kind', 'amount', 'currency', 'weighted_amount', 'probability', 'company_name', 'contact_name', 'owner_name', 'expected_close_date', 'closed_at', 'lost_reason', 'stage_entered_at', 'last_activity_at', 'next_activity_at', 'created_at', 'updated_at'],
  },
  contacts: {
    sql: `SELECT ct.*, co.name AS company_name, o.name AS owner_name FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id LEFT JOIN users o ON o.id = ct.owner_id WHERE ct.archived_at IS NULL ORDER BY ct.created_at`,
    columns: ['id', 'first_name', 'last_name', 'email', 'phone', 'title', 'company_name', 'owner_name', 'created_at', 'updated_at'],
  },
  companies: {
    sql: `SELECT c.*, o.name AS owner_name FROM companies c LEFT JOIN users o ON o.id = c.owner_id WHERE c.archived_at IS NULL ORDER BY c.created_at`,
    columns: ['id', 'name', 'domain', 'website', 'industry', 'phone', 'address', 'owner_name', 'created_at', 'updated_at'],
  },
  activities: {
    sql: `SELECT a.*, o.name AS owner_name, cb.name AS created_by_name, d.title AS deal_title, co.name AS company_name,
            NULLIF(TRIM(CONCAT(ct.first_name, ' ', ct.last_name)), '') AS contact_name
          FROM activities a LEFT JOIN users o ON o.id = a.owner_id LEFT JOIN users cb ON cb.id = a.created_by
          LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN companies co ON co.id = a.company_id LEFT JOIN contacts ct ON ct.id = a.contact_id
          ORDER BY a.created_at`,
    columns: ['id', 'type', 'subject', 'body', 'deal_title', 'contact_name', 'company_name', 'owner_name', 'created_by_name', 'due_at', 'completed_at', 'created_at'],
  },
  stage_history: {
    sql: `SELECT h.*, d.title AS deal_title, f.name AS from_stage_name, t.name AS to_stage_name, u.name AS changed_by_name,
            EXTRACT(EPOCH FROM (COALESCE(h.exited_at, now()) - h.entered_at)) / 86400.0 AS days_in_stage
          FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id LEFT JOIN stages f ON f.id = h.from_stage_id
          JOIN stages t ON t.id = h.to_stage_id LEFT JOIN users u ON u.id = h.changed_by ORDER BY h.entered_at`,
    columns: ['deal_id', 'deal_title', 'from_stage_name', 'to_stage_name', 'changed_by_name', 'entered_at', 'exited_at', 'days_in_stage'],
  },
  audit_log: {
    sql: `SELECT l.*, u.name AS actor_name FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.created_at`,
    columns: ['id', 'entity_type', 'entity_id', 'action', 'actor_name', 'summary', 'changes', 'created_at'],
  },
}

exportsRouter.get(
  '/:entity.csv',
  wrap(async (req, res) => {
    const spec = EXPORTS[req.params.entity as string]
    if (!spec) throw badRequest(`Unknown export. Try: ${Object.keys(EXPORTS).join(', ')}`)
    const rows = await query(spec.sql)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(toCsv(rows, spec.columns))
  }),
)
