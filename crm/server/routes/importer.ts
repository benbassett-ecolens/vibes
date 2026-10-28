import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { parse, wrap } from '../http.js'
import { commitImport, previewImport } from '../importer/deals.js'
import { one } from '../db.js'

export const importRouter = Router()
importRouter.use(requireAdmin)

const base = z.object({ csv: z.string().min(1).max(5_000_000), pipeline_id: z.string().uuid().optional() })

async function pipelineFor(id?: string): Promise<string> {
  if (id) return id
  const p = await one<{ id: string }>('SELECT id FROM pipelines ORDER BY is_default DESC, position LIMIT 1')
  if (!p) throw new Error('No pipeline')
  return p.id
}

importRouter.post(
  '/preview',
  wrap(async (req, res) => {
    const b = parse(base, req.body)
    res.json(await previewImport(b.csv, await pipelineFor(b.pipeline_id)))
  }),
)

importRouter.post(
  '/commit',
  wrap(async (req, res) => {
    const b = parse(
      base.extend({
        owner_map: z.record(z.string()).optional(),
        stage_map: z.record(z.string().uuid()).optional(),
        default_lead_source: z.string().trim().min(1).max(120).optional(),
        skip_existing: z.boolean().optional(),
      }),
      req.body,
    )
    const result = await commitImport(b.csv, {
      pipelineId: await pipelineFor(b.pipeline_id),
      actorId: req.user.id,
      ownerMap: b.owner_map ?? {},
      stageMap: b.stage_map ?? {},
      defaultLeadSource: b.default_lead_source ?? 'Import',
      skipExistingDeals: b.skip_existing ?? true,
    })
    res.json(result)
  }),
)
