/**
 * "What's the news on this VAR?" — a natural-language question answered by Claude with web search.
 * One Messages API call with the server-side web_search tool; pause_turn is resumed; citations come
 * back as sources. No agent loop, no tools of our own.
 */
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import { HttpError } from '../http.js'

export interface NewsCompany {
  name: string
  domain?: string | null
  website?: string | null
  ecosystems?: string[] | null
  partner_type?: string | null
  notes?: string | null
}
export interface NewsSource {
  url: string
  title: string | null
}
export interface NewsAnswer {
  answer: string
  sources: NewsSource[]
  model: string
  refused: boolean
}

export function aiConfigured(): boolean {
  return !!config.anthropicApiKey
}

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 240_000, maxRetries: 2 })
  return client
}

const SYSTEM = `You are a research assistant inside Ecolens's CRM. Ecolens sells ERP implementation services
and the EcoNet partner network to value-added resellers (VARs) and ISVs in the Microsoft Dynamics, Acumatica,
NetSuite, Sage and SAP Business One ecosystems.

The user asks about one or more VARs that Ecolens works with or is prospecting. Use web search to find
current, relevant news: acquisitions, mergers, funding, leadership changes, new partnerships, product
launches, awards, hiring, layoffs, office openings, events they are sponsoring, and anything that changes
how Ecolens should approach them. Prefer the last 12 months. Prefer primary sources (the company's own site,
press releases, trade press) over aggregators.

Answer in plain Markdown. Lead with the most useful finding. Give dates. Group by company when asked about
several. Say plainly when you found nothing recent for a company: do not pad. Keep it under 400 words unless
the question asks for detail.`

export function describeCompanies(companies: NewsCompany[]): string {
  return companies
    .map((c) => {
      const bits = [c.website || c.domain ? `site: ${c.website ?? c.domain}` : null, c.ecosystems?.length ? `ecosystems: ${c.ecosystems.join(', ')}` : null, c.partner_type ? `type: ${c.partner_type}` : null, c.notes ? `notes: ${c.notes.replace(/\s+/g, ' ').slice(0, 300)}` : null].filter(Boolean)
      return `- ${c.name}${bits.length ? ` (${bits.join('; ')})` : ''}`
    })
    .join('\n')
}

/** Pull every cited or searched URL out of a response, de-duplicated, cited ones first. */
export function collectSources(content: Anthropic.ContentBlock[]): NewsSource[] {
  const seen = new Map<string, NewsSource>()
  for (const b of content) {
    if (b.type === 'text') {
      for (const c of b.citations ?? []) {
        if (c.type === 'web_search_result_location' && !seen.has(c.url)) seen.set(c.url, { url: c.url, title: c.title })
      }
    }
  }
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (!seen.has(r.url)) seen.set(r.url, { url: r.url, title: r.title })
    }
  }
  return [...seen.values()].slice(0, 20)
}

/** Turn SDK failures into a readable 502 instead of a bare "Internal server error". */
export function toHttpError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(502, 'Claude API rejected the key (401). Check the crm-anthropic-api-key secret and redeploy.')
  if (e instanceof Anthropic.PermissionDeniedError) return new HttpError(502, `Claude API: permission denied (403): ${e.message}`)
  if (e instanceof Anthropic.RateLimitError) return new HttpError(502, 'Claude API rate limit hit (429). Try again in a minute.')
  if (e instanceof Anthropic.BadRequestError) return new HttpError(502, `Claude API rejected the request (400): ${e.message}`)
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(502, 'Claude API timed out. Try a narrower question.')
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Claude API error ${e.status ?? ''}: ${e.message}`)
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, `Could not reach the Claude API: ${e.message}`)
  return e instanceof Error ? e : new Error(String(e))
}

export async function askNews(question: string, companies: NewsCompany[]): Promise<NewsAnswer> {
  if (!aiConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured')
  const api = getClient()
  const model = config.aiModel
  const user = `Companies:\n${describeCompanies(companies)}\n\nToday is ${new Date().toISOString().slice(0, 10)}.\n\nQuestion: ${question}`
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }]
  const params = {
    model,
    max_tokens: 16000,
    system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: Math.min(12, 3 + companies.length * 2) }],
    output_config: { effort: 'medium' as const },
  }
  let response: Anthropic.Message
  try {
    response = await api.messages.stream({ ...params, messages }).finalMessage()
    // Server-side search loop paused: resend as-is and let it continue (bounded).
    for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
      messages.push({ role: 'assistant', content: response.content })
      response = await api.messages.stream({ ...params, messages }).finalMessage()
    }
  } catch (e) {
    throw toHttpError(e)
  }
  if (response.stop_reason === 'refusal') {
    return { answer: `The model declined to answer this question${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`, sources: [], model: response.model, refused: true }
  }
  const answer = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim()
  return { answer: answer || 'No answer was produced.', sources: collectSources(response.content), model: response.model, refused: false }
}
