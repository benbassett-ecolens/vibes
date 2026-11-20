import { describe, expect, it } from 'vitest'
import { collectSources, describeCompanies } from './news.js'

describe('VAR news helpers', () => {
  it('describes companies compactly', () => {
    const s = describeCompanies([{ name: 'Rockton Software', website: 'https://rocktonsoftware.com', ecosystems: ['Microsoft'], partner_type: 'ISV', notes: 'Met at  Summit\n2026' }])
    expect(s).toBe('- Rockton Software (site: https://rocktonsoftware.com; ecosystems: Microsoft; type: ISV; notes: Met at Summit 2026)')
  })
  it('collects cited sources first, then searched ones, without duplicates', () => {
    const content = [
      { type: 'text', text: 'A', citations: [{ type: 'web_search_result_location', url: 'https://a.com/x', title: 'A', cited_text: '', encrypted_index: '' }] },
      { type: 'web_search_tool_result', tool_use_id: 't', caller: { type: 'direct' }, content: [{ type: 'web_search_result', url: 'https://b.com', title: 'B', encrypted_content: '', page_age: null }, { type: 'web_search_result', url: 'https://a.com/x', title: 'A again', encrypted_content: '', page_age: null }] },
      { type: 'web_search_tool_result', tool_use_id: 't2', caller: { type: 'direct' }, content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    ]
    expect(collectSources(content as never)).toEqual([{ url: 'https://a.com/x', title: 'A' }, { url: 'https://b.com', title: 'B' }])
  })
})
