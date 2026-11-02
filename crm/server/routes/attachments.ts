import { Router } from 'express'
import { one } from '../db.js'
import { notFound, wrap } from '../http.js'

export const attachmentsRouter = Router()

/** Serve a stored attachment (screenshots shared from Slack). Auth is applied by the mount. */
attachmentsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const a = await one<{ filename: string; mimetype: string; data: Buffer }>('SELECT filename, mimetype, data FROM attachments WHERE id = $1', [String(req.params.id)])
    if (!a) throw notFound('Attachment not found')
    const safe = /^(image\/|application\/pdf|text\/plain)/.test(a.mimetype) ? a.mimetype : 'application/octet-stream'
    res.setHeader('Content-Type', safe)
    res.setHeader('Content-Disposition', `${safe.startsWith('image/') ? 'inline' : 'attachment'}; filename="${a.filename.replace(/[^\w.\-]+/g, '_')}"`)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(a.data)
  }),
)
