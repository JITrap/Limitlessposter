import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ledger, type LedgerEntry } from '../../src/budget/ledger.js'
import { BudgetGuard, type GuardConfig } from '../../src/budget/guard.js'

const cfg: GuardConfig = {
  reserveForJuliusPct: 30,
  weekReset: { weekday: 4, hour: 18, minute: 0 },
  budget: {
    initialWeeklyCapacityUsd: { opus: 300, sonnet: 600, haiku: 200 },
    sessionFraction: 0.1,
  },
}

// Week: Thu 2026-11-05 18:00 → Thu 2026-11-12 18:00 (no DST change).
// Quarter of the week elapsed = Sat 2026-11-07 12:00.
const QUARTER = new Date('2026-11-07T12:00:00')

const run = (over: Partial<LedgerEntry>): LedgerEntry => ({
  ts: '2026-11-07T11:00:00',
  task: 't',
  station: 'content',
  model: 'claude-sonnet-5-5',
  family: 'sonnet',
  tokens_in: 1,
  tokens_out: 1,
  cache_read: 0,
  cache_write: 0,
  cost_usd: 0,
  duration_ms: 1,
  result: 'success',
  ...over,
})

describe('BudgetGuard', () => {
  let dir: string
  let ledger: Ledger
  let now: Date
  let guard: BudgetGuard

  const make = (): BudgetGuard => new BudgetGuard(ledger, cfg, join(dir, 'state.json'), () => now)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'los-guard-'))
    ledger = new Ledger(join(dir, 'ledger.jsonl'))
    now = QUARTER
    guard = make()
    await guard.load()
  })

  it('allows everything on a fresh week with no usage', async () => {
    const d = await guard.decide()
    expect(d.mode).toBe('normal')
    expect([...d.allowedTiers].sort()).toEqual(['cheap', 'premium', 'standard'])
    expect(d.until).toBeNull()
    // target for sonnet at 25 % of the week with 30 % reserve: 600 * 0.7 * 0.25 = 105
    expect(d.usage.week.sonnet.target).toBeCloseTo(105, 3)
    expect(d.usage.week.sonnet.capacity).toBe(600)
  })

  it('pauses when a family is far over its pacing target', async () => {
    await ledger.append(run({ cost_usd: 200 })) // ratio 200/105 ≈ 1.9
    const d = await guard.decide()
    expect(d.mode).toBe('paused')
    expect(d.until!.getTime()).toBeGreaterThan(now.getTime())
    expect(d.reason).toMatch(/Wochenbudget/)
    expect(d.reason).toMatch(/Sonnet/)
  })

  it('pause lasts until the pacing curve catches up with the usage', async () => {
    await ledger.append(run({ cost_usd: 126 })) // ratio 1.2 exactly at the threshold edge → test 1.3
    await ledger.append(run({ cost_usd: 10.5 })) // total 136.5 → ratio 1.3
    const d = await guard.decide()
    expect(d.mode).toBe('paused')
    // target(t) = 420 * fraction(t); usage 136.5 → fraction 0.325 → 0.325 * 168 h = 54.6 h after Thu 18:00
    const expected = new Date('2026-11-05T18:00:00').getTime() + 54.6 * 3_600_000
    expect(Math.abs(d.until!.getTime() - expected)).toBeLessThan(60_000)
  })

  it('allows only cheap tasks when moderately over target', async () => {
    await ledger.append(run({ cost_usd: 120 })) // ratio ≈ 1.14
    const d = await guard.decide()
    expect(d.mode).toBe('cheap-only')
    expect([...d.allowedTiers]).toEqual(['cheap'])
  })

  it('allows premium at night when well under target', async () => {
    // Sat 03:00 is 33 of 168 hours into the week → target 420 × 0.196 ≈ 82.5; 50 → ratio ≈ 0.61
    await ledger.append(run({ ts: '2026-11-07T01:00:00', cost_usd: 50 }))
    now = new Date('2026-11-07T03:00:00')
    const d = await make().decide()
    expect(d.mode).toBe('normal')
    expect(d.allowedTiers.has('premium')).toBe(true)
  })

  it('removes premium at night when near target', async () => {
    await ledger.append(run({ ts: '2026-11-07T01:00:00', cost_usd: 45 }))
    await ledger.append(run({ ts: '2026-11-07T01:30:00', cost_usd: 30 })) // 75 → ratio ≈ 0.91
    now = new Date('2026-11-07T03:00:00')
    const d = await make().decide()
    expect(d.mode).toBe('normal')
    expect(d.allowedTiers.has('premium')).toBe(false)
    expect(d.allowedTiers.has('standard')).toBe(true)
  })

  it('counts the session window against capacity × sessionFraction', async () => {
    now = new Date('2026-11-07T11:00:00')
    guard.noteRunStart() // anchors the 5-hour window at 11:00
    now = QUARTER
    await ledger.append(run({ ts: '2026-11-07T11:30:00', cost_usd: 45 })) // session capacity 60 → 75 %
    const d = await guard.decide()
    expect(d.usage.session.capacity).toBe(60)
    expect(d.usage.session.used).toBe(45)
    expect(d.mode).toBe('cheap-only')
  })

  it('pauses on a rejected rate limit until resets_at and learns the capacity', async () => {
    now = new Date('2026-11-07T10:00:00')
    guard.noteRunStart()
    now = QUARTER
    await ledger.append(run({ ts: '2026-11-07T11:00:00', cost_usd: 80 }))
    const resetsAt = new Date(now.getTime() + 3_600_000)
    await guard.observe({ family: 'all', window: 'five_hour', status: 'rejected', resetsAt })
    const d = await guard.decide()
    expect(d.mode).toBe('paused')
    expect(d.until).toEqual(resetsAt)
    expect(d.reason).toMatch(/Limit/)
    const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
    expect(state.learned.sonnet.sessionUsd).toBeCloseTo(80, 3)
  })

  it('falls back to a 30-minute pause when the rejection carries no reset time', async () => {
    await guard.observe({ family: 'all', window: 'unknown', status: 'rejected', resetsAt: null })
    const d = await guard.decide()
    expect(d.mode).toBe('paused')
    expect(d.until!.getTime() - now.getTime()).toBe(30 * 60_000)
  })

  it('turns a warning into cheap-only until the window ends', async () => {
    await guard.observe({ family: 'all', window: 'five_hour', status: 'allowed_warning', resetsAt: null })
    const d = await guard.decide()
    expect(d.mode).toBe('cheap-only')
    expect(d.reason).toMatch(/Warnung/)
  })

  it('persists learned capacity and pause across restarts', async () => {
    const resetsAt = new Date(now.getTime() + 3_600_000)
    await guard.observe({ family: 'all', window: 'seven_day', status: 'rejected', resetsAt })
    const again = make()
    await again.load()
    const d = await again.decide()
    expect(d.mode).toBe('paused')
    expect(d.until).toEqual(resetsAt)
  })

  it('lifts the pause once the reset time has passed', async () => {
    const resetsAt = new Date(now.getTime() + 60_000)
    await guard.observe({ family: 'all', window: 'five_hour', status: 'rejected', resetsAt })
    now = new Date(resetsAt.getTime() + 1_000)
    const d = await guard.decide()
    expect(d.mode).toBe('normal')
  })
})
