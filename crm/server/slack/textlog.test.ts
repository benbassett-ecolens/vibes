import { describe, expect, it } from 'vitest'
import { confirmBlocks, dismissedBlocks, pickerBlocks, type Candidate, type InboxRow } from './textlog.js'

const row: InboxRow = {
  id: 'inbox-1', event_id: 'Ev1', user_id: 'u1', slack_user_id: 'U1', channel: 'D1', ts: '1.1', card_ts: null,
  text: 'Hey Ben, Rockton can do Friday for the demo', files: [], status: 'pending', activity_id: null, created_at: new Date().toISOString(),
}
const cands: Candidate[] = [
  { id: 'd1', title: 'Rockton Software', company_name: 'Rockton Software', score: 2 },
  { id: 'd2', title: 'Tasklet', company_name: 'Tasklet', score: 0 },
  { id: 'd3', title: 'eveXso', company_name: 'eveXso', score: 0 },
  { id: 'd4', title: 'AttivoERP', company_name: 'AttivoERP', score: 0 },
  { id: 'd5', title: 'Fazeshift', company_name: 'Fazeshift', score: 0 },
]

describe('text-log picker card', () => {
  it('shows the top four deals as buttons, best match highlighted, the rest in a select', () => {
    const blocks = pickerBlocks(row, cands) as Array<{ type: string; elements?: Array<{ type: string; style?: string; value?: string; options?: unknown[] }> }>
    const buttons = blocks[1].elements!
    expect(buttons).toHaveLength(4)
    expect(buttons[0].style).toBe('primary')
    expect(buttons[0].value).toBe('inbox-1:d1')
    const more = blocks[2].elements!
    expect(more[0].type).toBe('static_select')
    expect(more[0].options).toHaveLength(5)
    expect(more[1].value).toBe('inbox-1') // Not a deal
  })
  it('does not highlight when nothing in the text matched', () => {
    const blocks = pickerBlocks(row, cands.map((c) => ({ ...c, score: 0 }))) as Array<{ elements?: Array<{ style?: string }> }>
    expect(blocks[1].elements![0].style).toBeUndefined()
  })
  it('explains when the rep has no open deals', () => {
    const blocks = pickerBlocks(row, []) as Array<{ type: string }>
    expect(blocks.map((b) => b.type)).toEqual(['section', 'context', 'actions'])
  })
  it('quotes the text and lists screenshots', () => {
    const blocks = pickerBlocks({ ...row, text: '', files: [{ id: 'F1', name: 'IMG_1.png', mimetype: 'image/png', url_private: '', size: 10 }] }, cands) as Array<{ text?: { text: string } }>
    expect(blocks[0].text!.text).toContain('IMG_1.png')
  })
  it('confirmation and dismissal cards keep the quote and offer a way back', () => {
    const c = confirmBlocks(row, { id: 'd1', title: 'Rockton Software' }, null) as Array<{ text?: { text: string }; elements?: Array<{ action_id: string }> }>
    expect(c[0].text!.text).toContain('Rockton Software')
    expect(c[1].elements!.map((e) => e.action_id)).toEqual(['log_followup', 'log_change', 'log_open'])
    const d = dismissedBlocks(row) as Array<{ elements?: Array<{ action_id: string }> }>
    expect(d[1].elements![0].action_id).toBe('log_change')
  })
})
