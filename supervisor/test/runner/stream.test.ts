import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStreamLine, summarizeResult, type StreamEvent } from '../../src/runner/stream.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = async (name: string): Promise<string[]> =>
  (await readFile(join(here, '..', 'fixtures', 'stream', `${name}.jsonl`), 'utf8')).split('\n').filter(Boolean)

interface Replay {
  events: StreamEvent[]
  result: Record<string, unknown> | null
  rateLimited: boolean
  denials: string[]
}

async function replay(name: string): Promise<Replay> {
  const events: StreamEvent[] = []
  let result: Record<string, unknown> | null = null
  let rateLimited = false
  const denials: string[] = []
  for (const line of await fixture(name)) {
    const ev = parseStreamLine(line)
    if (!ev) continue
    events.push(ev)
    if (ev.kind === 'result') result = ev.raw
    if (ev.kind === 'rate_limit' && ev.signal.status === 'rejected') rateLimited = true
    if (ev.kind === 'permission_denied') denials.push(ev.tool)
  }
  return { events, result, rateLimited, denials }
}

describe('parseStreamLine', () => {
  it('returns null for invalid JSON and unknown shapes', () => {
    expect(parseStreamLine('kein json')).toBeNull()
    expect(parseStreamLine('')).toBeNull()
    expect(parseStreamLine('42')).toBeNull()
  })

  it('classifies init with MCP errors', async () => {
    const { events } = await replay('permission_denied')
    const init = events.find((e) => e.kind === 'init')
    expect(init).toEqual({ kind: 'init', mcpErrors: ['metricool: OAuth token expired'] })
  })

  it('parses rate_limit_event with epoch seconds and ISO resets_at', async () => {
    const { events } = await replay('rate_limited_no_result')
    const limits = events.filter((e) => e.kind === 'rate_limit')
    expect(limits).toHaveLength(2)
    const [warn, rej] = limits as Extract<StreamEvent, { kind: 'rate_limit' }>[]
    expect(warn.signal).toEqual({
      family: 'all',
      window: 'five_hour',
      status: 'allowed_warning',
      resetsAt: new Date(1761152400 * 1000),
    })
    expect(rej.signal.status).toBe('rejected')
    expect(rej.signal.resetsAt).toEqual(new Date('2026-10-22T18:00:00+02:00'))
  })

  it('maps unknown rate_limit_type to unknown and opus/sonnet types to a family', () => {
    const a = parseStreamLine('{"type":"rate_limit_event","rate_limit_type":"seven_day_opus","status":"rejected"}')
    expect(a).toEqual({ kind: 'rate_limit', signal: { family: 'opus', window: 'seven_day', status: 'rejected', resetsAt: null } })
    const b = parseStreamLine('{"type":"rate_limit_event","rate_limit_type":"sonstiges","status":"allowed"}')
    expect(b).toEqual({ kind: 'rate_limit', signal: { family: 'all', window: 'unknown', status: 'allowed', resetsAt: null } })
  })

  it('classifies api_retry and permission_denied system events', async () => {
    const { events, denials } = await replay('rate_limited_no_result')
    expect(events.some((e) => e.kind === 'api_retry' && e.error === 'rate_limit')).toBe(true)
    const perm = await replay('permission_denied')
    expect(perm.denials).toEqual(['Bash'])
    expect(denials).toEqual([])
  })

  it('classifies assistant/user chatter as other', async () => {
    const { events } = await replay('success')
    expect(events.filter((e) => e.kind === 'other').length).toBe(3)
  })
})

describe('summarizeResult', () => {
  it('summarizes a successful run from modelUsage', async () => {
    const r = await replay('success')
    const s = summarizeResult(r.result, { rateLimited: r.rateLimited, denials: r.denials })
    expect(s).toMatchObject({
      ok: true,
      reason: 'success',
      subtype: 'success',
      isError: false,
      apiErrorStatus: null,
      costUsd: 0.0612,
      tokensIn: 12000,
      tokensOut: 2200,
      cacheRead: 8000,
      cacheWrite: 1000,
      modelUsed: 'claude-sonnet-5-5',
      resultText: 'Entwurf fertig. Ergebnis in der Notiz.',
      permissionDenials: [],
      sessionId: 'sess-success',
      durationMs: 61000,
    })
  })

  it('maps error subtypes to reasons', async () => {
    const t = await replay('max_turns')
    expect(summarizeResult(t.result, { rateLimited: false, denials: [] })).toMatchObject({ ok: false, reason: 'max_turns', costUsd: 0.9 })
    const b = await replay('budget')
    const s = summarizeResult(b.result, { rateLimited: false, denials: [] })
    expect(s.reason).toBe('max_budget')
    expect(s.costUsd).toBeCloseTo(6.2, 6)
    expect(s.tokensIn).toBe(200000)
    expect(s.modelUsed).toBe('claude-opus-5-5') // highest costUSD wins
  })

  it('reports rate_limited when the stream ended without a result after a rejection', async () => {
    const r = await replay('rate_limited_no_result')
    expect(r.result).toBeNull()
    const s = summarizeResult(null, { rateLimited: true, denials: [] })
    expect(s).toMatchObject({ ok: false, reason: 'rate_limited', costUsd: 0, modelUsed: null, sessionId: null })
  })

  it('reports no_result when the stream ended without a result and no rejection', () => {
    expect(summarizeResult(null, { rateLimited: false, denials: [] }).reason).toBe('no_result')
  })

  it('collects permission denials from the stream and the result', async () => {
    const r = await replay('permission_denied')
    const s = summarizeResult(r.result, { rateLimited: false, denials: r.denials })
    expect(s.ok).toBe(true)
    expect(s.permissionDenials).toEqual(['Bash'])
  })

  it('treats api_error_status 429 as rate_limited and 401/403 as auth', () => {
    const base = { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'x', duration_ms: 1, errors: ['x'] }
    expect(summarizeResult({ ...base, api_error_status: 429 }, { rateLimited: false, denials: [] }).reason).toBe('rate_limited')
    expect(summarizeResult({ ...base, api_error_status: 401 }, { rateLimited: false, denials: [] }).reason).toBe('auth')
    expect(summarizeResult({ ...base, api_error_status: 500 }, { rateLimited: false, denials: [] }).reason).toBe('error')
  })
})
