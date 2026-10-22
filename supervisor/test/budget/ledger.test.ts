import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, type LedgerEntry } from '../../src/budget/ledger.js'

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  ts: '2026-10-22T10:00:00',
  task: 't1',
  station: 'content',
  model: 'claude-sonnet-5-5',
  family: 'sonnet',
  tokens_in: 1000,
  tokens_out: 200,
  cache_read: 0,
  cache_write: 0,
  cost_usd: 0.05,
  duration_ms: 1000,
  result: 'success',
  ...over,
})

describe('Ledger', () => {
  let file: string
  let ledger: Ledger

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-ledger-'))
    file = join(dir, 'ledger.jsonl')
    ledger = new Ledger(file)
  })

  it('appends entries and loads them back in order', async () => {
    await ledger.append(entry({ task: 'a' }))
    await ledger.append(entry({ task: 'b' }))
    const all = await ledger.load()
    expect(all.map((e) => e.task)).toEqual(['a', 'b'])
  })

  it('loads an empty list when the file does not exist', async () => {
    expect(await ledger.load()).toEqual([])
  })

  it('sums cost since a point in time, optionally per family', async () => {
    await ledger.append(entry({ ts: '2026-10-20T10:00:00', cost_usd: 1 }))
    await ledger.append(entry({ ts: '2026-10-22T10:00:00', cost_usd: 2 }))
    await ledger.append(entry({ ts: '2026-10-22T11:00:00', cost_usd: 4, family: 'opus', model: 'claude-opus-5-5' }))
    const since = new Date('2026-10-21T00:00:00')
    expect(await ledger.sumCostSince(since)).toBe(6)
    expect(await ledger.sumCostSince(since, 'sonnet')).toBe(2)
    expect(await ledger.sumCostSince(since, 'opus')).toBe(4)
  })

  it('counts entries since a point in time with a predicate', async () => {
    await ledger.append(entry({ ts: '2026-10-22T10:00:00', result: 'success' }))
    await ledger.append(entry({ ts: '2026-10-22T10:05:00', result: 'timeout' }))
    const since = new Date('2026-10-22T00:00:00')
    expect(await ledger.countSince(since)).toBe(2)
    expect(await ledger.countSince(since, (e) => e.result === 'timeout')).toBe(1)
  })

  it('skips corrupt lines instead of throwing', async () => {
    await ledger.append(entry({ task: 'ok' }))
    await appendFile(file, 'das ist kein json\n', 'utf8')
    await ledger.append(entry({ task: 'ok2' }))
    expect((await ledger.load()).map((e) => e.task)).toEqual(['ok', 'ok2'])
  })
})
