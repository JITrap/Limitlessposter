// The Zentrale: 6-hour kennzahlen trigger, manual refresh, Kennzahlen.md → state, hourly Printify.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Supervisor, type SupervisorDeps } from '../src/scheduler.js'
import type { Config } from '../src/config.js'
import { TaskRepo } from '../src/vault/tasks.js'
import { Ledger } from '../src/budget/ledger.js'
import { BudgetGuard } from '../src/budget/guard.js'
import type { Station } from '../src/stations/loader.js'
import type { RunSummary } from '../src/runner/stream.js'
import type { runWorker, RunOptions } from '../src/runner/claude.js'
import type { Task } from '../src/types.js'
import type { PrintifySummary } from '../src/adapters/printify.js'

function station(name: string, over: Partial<Station> = {}): Station {
  return {
    name,
    display: name,
    description: name,
    tier: 'cheap',
    maxTurns: 30,
    timeoutMin: 15,
    tools: ['Read', 'Write'],
    context: [],
    requires: { mcp: ['metricool'], env: [], services: [], any: [] },
    autopilot: 2,
    cooldownHours: 0,
    outputsDir: null,
    dir: `/repo/stations/${name}`,
    skillPath: `/repo/stations/${name}/SKILL.md`,
    ...over,
  }
}

const ok = (): RunSummary => ({
  ok: true,
  reason: 'success',
  subtype: 'success',
  isError: false,
  apiErrorStatus: null,
  costUsd: 0.01,
  tokensIn: 100,
  tokensOut: 10,
  cacheRead: 0,
  cacheWrite: 0,
  modelUsed: 'claude-haiku-5-5',
  resultText: 'Fertig.',
  permissionDenials: [],
  sessionId: 's',
  durationMs: 10,
})

const printifyOk = (): PrintifySummary => ({
  ok: true,
  fehler: null,
  stand: '2026-11-06T10:00:00.000Z',
  shop: { id: 1, titel: 'LimitlessPoster', kanal: 'shopify' },
  auftraege: { offen: 1, in_produktion: 2, versendet_28t: 3, gesamt_28t: 6, umsatz_28t: 400, kosten_28t: 150, marge_28t: 250, mit_problemen: 0 },
  produkte: { gesamt: 125, sichtbar: 120, marge_durchschnitt: 55.5, marge_min: 50, marge_max: 60 },
})

const KZ = `---
type: kennzahlen
updated: 2026-11-06T08:00:00
shop:
  bestellungen_7t: 2
  umsatz_7t: 164.98
  bestellungen_28t: 3
  umsatz_28t: 244.97
  produkte_aktiv: 125
  produkte_englisch: 12
  waehrung: EUR
netzwerke:
  instagram: { follower: 12, follower_7t: 2, reichweite_7t: 260, interaktionen_7t: 12, posts_7t: 5 }
geplant_7t: 3
---
## Woche in Sätzen
- Instagram ist um 2 Follower gewachsen.
`

describe('Zentrale', () => {
  let vault: string
  let dataDir: string
  let repo: TaskRepo
  let now: Date
  let cfg: Config
  let runs: { task: Task; station: Station; opts: RunOptions; resolve: (s: RunSummary) => void }[]
  let printifyCalls: Date[]
  let mcpOk: boolean
  const clock = (): Date => now
  const fakeRun: typeof runWorker = (task, st, _cfg, _hooks, opts) => new Promise<RunSummary>((resolve) => void runs.push({ task, station: st, opts, resolve }))
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

  async function build(over: Partial<SupervisorDeps> = {}): Promise<Supervisor> {
    const ledger = new Ledger(join(dataDir, 'ledger.jsonl'))
    const guard = new BudgetGuard(ledger, cfg, join(dataDir, 'guard.json'), clock)
    await guard.load()
    const s = new Supervisor(cfg, {
      repo,
      guard,
      ledger,
      stations: [station('kennzahlen'), station('studio', { requires: { mcp: [], env: [], services: [], any: [] } })],
      run: fakeRun,
      clock,
      probes: { http: async () => false, mcpConfigured: async () => mcpOk },
      triggers: true,
      printify: async (_env, at) => {
        printifyCalls.push(at)
        return printifyOk()
      },
      ...over,
    })
    await s.init()
    return s
  }

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-zentrale-'))
    vault = join(root, 'MeinVault', 'LimitlessOS')
    await mkdir(join(vault, 'Aufgaben'), { recursive: true })
    dataDir = join(root, 'data')
    await mkdir(dataDir, { recursive: true })
    now = new Date('2026-11-06T10:00:00')
    runs = []
    printifyCalls = []
    mcpOk = true
    repo = new TaskRepo(vault, clock)
    cfg = {
      repoRoot: root,
      vaultRoot: vault,
      vaultName: 'MeinVault',
      dataDir,
      maxParallel: 2,
      reserveForJuliusPct: 30,
      weekReset: { weekday: 4, hour: 18, minute: 0 },
      dailyPostLimit: 3,
      dailyShopChangeLimit: 5,
      maxOpenPlannerTasks: 15,
      worldPort: 0,
      tickSeconds: 30,
      tiers: {
        cheap: { model: 'haiku', maxBudgetUsd: 0.3 },
        standard: { model: 'sonnet', maxBudgetUsd: 1.5 },
        premium: { model: 'opus', maxBudgetUsd: 6, fallbackModel: 'sonnet' },
      },
      budget: { initialWeeklyCapacityUsd: { opus: 300, sonnet: 600, haiku: 200 }, sessionFraction: 0.1 },
      fakeClaude: true,
      env: {},
    }
  })

  const kennzahlenTasks = async (): Promise<Task[]> => (await repo.list()).filter((t) => t.fm.station === 'kennzahlen')

  it('creates one cheap kennzahlen task per 6-hour slot, never two open ones', async () => {
    const sup = await build()
    await sup.tick() // 10:00 → slot 1
    let ts = await kennzahlenTasks()
    expect(ts).toHaveLength(1)
    expect(ts[0].fm).toMatchObject({ tier: 'cheap', priority: 3, origin: 'system', needs_approval: false, status: 'doing' })
    expect(ts[0].body).toContain('Kennzahlen.md')
    now = new Date('2026-11-06T11:30:00')
    await sup.tick() // same slot → nothing new
    expect(await kennzahlenTasks()).toHaveLength(1)
    runs.find((r) => r.station.name === 'kennzahlen')!.resolve(ok())
    const deadline = Date.now() + 3000
    while (sup.getState().workers.length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    await flush()
    now = new Date('2026-11-06T12:05:00')
    await sup.tick() // slot 2 → next one
    ts = await kennzahlenTasks()
    expect(ts).toHaveLength(2)
    expect(sup.getState().ticker.join('\n')).toContain('Kennzahlen werden gesammelt')
  })

  it('creates nothing while the station is not connected', async () => {
    mcpOk = false
    const sup = await build()
    await sup.tick()
    expect(await kennzahlenTasks()).toHaveLength(0)
    expect(await sup.refreshKennzahlen()).toMatchObject({ ok: false })
  })

  it('refreshKennzahlen creates a priority-1 task once and reports a running one', async () => {
    now = new Date('2026-11-06T10:00:00')
    const sup = await build({ triggers: false })
    expect(await sup.refreshKennzahlen()).toEqual({ ok: true, reason: null })
    const ts = await kennzahlenTasks()
    expect(ts).toHaveLength(1)
    expect(ts[0].fm.priority).toBe(1)
    expect(await sup.refreshKennzahlen()).toEqual({ ok: true, reason: 'läuft bereits' })
    expect(await kennzahlenTasks()).toHaveLength(1)
  })

  it('exposes Kennzahlen.md in the state, re-reads it on change and writes a Zentrale section to Status.md', async () => {
    const sup = await build({ triggers: false })
    await sup.tick()
    expect(sup.getState().zentrale.kennzahlen).toBeNull()
    await writeFile(join(vault, 'Kennzahlen.md'), KZ, 'utf8')
    await sup.tick()
    const k = sup.getState().zentrale.kennzahlen!
    expect(k.shop.umsatz_7t).toBe(164.98)
    expect(k.netzwerke.instagram.follower).toBe(12)
    expect(k.saetze[0]).toMatch(/Instagram/)
    const status = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(status).toContain('## Zentrale')
    expect(status).toContain('2 Bestellungen / 164,98 EUR (7 T)')
    expect(status).toContain('instagram: 12 Follower (+2)')
    await writeFile(join(vault, 'Kennzahlen.md'), KZ.replace('follower: 12', 'follower: 15'), 'utf8')
    const later = new Date(Date.now() + 5000)
    await utimes(join(vault, 'Kennzahlen.md'), later, later)
    await sup.tick()
    expect(sup.getState().zentrale.kennzahlen!.netzwerke.instagram.follower).toBe(15)
  })

  it('reads Printify through the injected reader at most once an hour and shows it in state and Status.md', async () => {
    const sup = await build({ triggers: false })
    await sup.tick()
    await flush()
    expect(printifyCalls).toHaveLength(1)
    expect(sup.getState().zentrale.printify?.ok).toBe(true)
    expect(sup.getState().zentrale.printify?.auftraege.in_produktion).toBe(2)
    now = new Date('2026-11-06T10:30:00')
    await sup.tick()
    await flush()
    expect(printifyCalls).toHaveLength(1)
    now = new Date('2026-11-06T11:01:00')
    await sup.tick()
    await flush()
    expect(printifyCalls).toHaveLength(2)
    await sup.tick()
    const status = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(status).toContain('Printify: 1 offen · 2 in Produktion · 3 versendet (28 T)')
    expect(sup.getState().zentrale.links.map((l) => l.name)).toContain('Metricool')
  })

  it('keeps the state usable when the Printify reader reports an error', async () => {
    const sup = await build({ triggers: false, printify: async () => ({ ...printifyOk(), ok: false, fehler: 'Printify 401: Token ungültig' }) })
    await sup.tick()
    await flush()
    expect(sup.getState().zentrale.printify?.ok).toBe(false)
    const status = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(status).toContain('Printify: Printify 401: Token ungültig')
  })
})
