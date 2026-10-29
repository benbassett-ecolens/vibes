import { afterEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { slackCall } from './client.js'

describe('slackCall', () => {
  afterEach(() => vi.restoreAllMocks())
  it('sends form-encoded params with nested values JSON-stringified', async () => {
    config.slackBotToken = 'xoxb-test'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, user: { id: 'U1' } }), { headers: { 'content-type': 'application/json' } }))
    const r = await slackCall<{ user: { id: string } }>('users.lookupByEmail', { email: 'ben@ecolens.io', blocks: [{ type: 'section' }], skip: undefined })
    expect(r.user.id).toBe('U1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://slack.com/api/users.lookupByEmail')
    expect((init.headers as Record<string, string>)['Content-Type']).toContain('application/x-www-form-urlencoded')
    const params = new URLSearchParams(init.body as string)
    expect(params.get('email')).toBe('ben@ecolens.io')
    expect(JSON.parse(params.get('blocks')!)).toEqual([{ type: 'section' }])
    expect(params.has('skip')).toBe(false)
  })
  it('turns Slack errors into a 502 with the reason', async () => {
    config.slackBotToken = 'xoxb-test'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'users_not_found' })))
    await expect(slackCall('users.info', { user: 'U2' })).rejects.toMatchObject({ status: 502, message: 'Slack users.info: users_not_found' })
  })
})
