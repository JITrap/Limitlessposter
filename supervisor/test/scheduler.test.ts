import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Supervisor, type SupervisorDeps } from '../src/scheduler.js'
import type { Config } from '../src/config.js'
import { TaskRepo } from '../src/vault/tasks.js'
import { Ledger } from '../src/budget/ledger.js'
import { BudgetGuard } from '../src/budget/guard.js'
import type { Station } from '../src/stations/loader.js'
import type { RunSummary } from '../src/runner/stream.js'
import type { runWorker } from '../src/runner/claude.js'
import { readSection } from '../src/vault/frontmatter.js'

const T0 = new Date('2026-11-06T10:00:00') // Friday

function station(name: string, over: Partial<Station> = {}): Station {
  return {
    name,
    display: name[0].toUpperCase() + name.slice(1),
    description: name,
    tier: 'standard',
    maxTurns: 40,
    timeoutMin: 25,
    tools: [],
    context: [],
    requires: { mcp: [], env: [], services: [] },
    autopilot: 1,
    cooldownHours: 0,
    outputsDir: null,
    dir: `/repo/stations/${name}`,
    skillPath: `/repo/stations/${name}/SKILL.md`,
    ...over,
  }
}

const okSummary = (over: Partial<RunSummary> = {}): RunSummary => ({
  ok: true,
  reason: 'success',
  subtype: 'success',
  isError: false,
  apiErrorStatus: null,
  costUsd: 0.06,
  tokensIn: 12000,
  tokensOut: 2200,
  cacheRead: 0,
  cacheWrite: 0,
  modelUsed: 'claude-sonnet-5-5',
  resultText: 'Fertig.',
  permissionDenials: [],
  sessionId: 's',
  durationMs: 1000,
  ...over,
})

describe('Supervisor', () => {
  let vault: string
  let repo: TaskRepo
  let dataDir: string
  let now: Date
  let cfg: Config
  let runs: { taskId: string; publishAllowed: boolean; resolve: (s: RunSummary) => void }[]
  let sup: Supervisor
  let stations: Station[]

  const clock = (): Date => now

  const fakeRun: typeof runWorker = (task, _station, _cfg, _hooks, opts) =>
    new Promise<RunSummary>((resolve) => {
      runs.push({ taskId: task.fm.id, publishAllowed: opts.publishAllowed, resolve })
    })

  /** Wait until the supervisor has processed every finished worker (completion handlers are async). */
  const settle = async (): Promise<void> => {
    const deadline = Date.now() + 3000
    while (sup.getState().workers.length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 30))
  }

  /** Most tests are not about triggers: mark today's report as fired and the planner as just created. */
  async function seedQuietState(): Promise<void> {
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'state.json'),
      JSON.stringify({ inboxSeen: [], fired: { 'tagesbericht:2026-11-06': 'seed' }, lastPlannerCreated: '2026-11-06T09:50:00', lastArchive: null }),
      'utf8',
    )
  }

  async function build(over: Partial<SupervisorDeps> = {}): Promise<Supervisor> {
    const ledger = new Ledger(join(dataDir, 'ledger.jsonl'))
    const guard = new BudgetGuard(ledger, cfg, join(dataDir, 'guard.json'), clock)
    await guard.load()
    const s = new Supervisor(cfg, {
      repo,
      guard,
      ledger,
      stations,
      run: fakeRun,
      clock,
      probes: { http: async () => false, mcpConfigured: async () => true },
      ...over,
    })
    await s.init()
    return s
  }

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-sched-'))
    vault = join(root, 'MeinVault', 'LimitlessOS')
    await mkdir(join(vault, 'Inbox'), { recursive: true })
    dataDir = join(root, 'data')
    now = T0
    runs = []
    repo = new TaskRepo(vault, clock)
    stations = [station('planer', { autopilot: 2 }), station('content'), station('studio', { tier: 'cheap', autopilot: 2 }), station('berichter', { tier: 'cheap', autopilot: 2 }), station('voice', { requires: { mcp: [], env: ['VOICE_KEY'], services: [] } })]
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
    await seedQuietState()
    sup = await build()
  })

  it('runs a content task through doing → review and records ledger and protocol', async () => {
    const t = await repo.create({ title: 'Karussell', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x', needs_approval: true })
    await sup.tick()
    expect(runs.map((r) => r.taskId)).toEqual([t.fm.id])
    let fm = (await repo.get(t.fm.id))!.fm
    expect(fm.status).toBe('doing')
    expect(fm.attempts).toBe(1)
    expect(fm.started).toBe('2026-11-06T10:00:00')
    expect(sup.getState().workers.map((w) => w.taskId)).toEqual([t.fm.id])

    now = new Date('2026-11-06T10:06:00')
    runs[0].resolve(okSummary())
    await settle()
    const after = (await repo.get(t.fm.id))!
    fm = after.fm
    expect(fm.status).toBe('review')
    expect(fm.cost_usd).toBe(0.06)
    expect(fm.tokens_in).toBe(12000)
    expect(fm.model_used).toBe('claude-sonnet-5-5')
    expect(readSection(after.body, 'Ergebnis')).toBe('Fertig.')
    expect(readSection(after.body, 'Protokoll')!.split('\n')).toHaveLength(2)
    expect(readSection(after.body, 'Protokoll')).toMatch(/review · claude-sonnet-5-5 · 14\.200 Tokens · 0,06 \$ · success/)
    const ledger = (await readFile(join(dataDir, 'ledger.jsonl'), 'utf8')).trim().split('\n')
    expect(ledger).toHaveLength(1)
    expect(JSON.parse(ledger[0])).toMatchObject({ task: t.fm.id, station: 'content', family: 'sonnet', cost_usd: 0.06 })
    expect(sup.getState().workers).toEqual([])
    expect(sup.getState().waiting.map((w) => w.id)).toEqual([t.fm.id])
  })

  it('approve moves a review task to todo and the next run completes it', async () => {
    const t = await repo.create({ title: 'Reel', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x', needs_approval: true })
    await sup.tick()
    runs[0].resolve(okSummary())
    await settle()
    expect((await repo.get(t.fm.id))!.fm.status).toBe('review')
    await sup.approve(t.fm.id)
    const approved = (await repo.get(t.fm.id))!.fm
    expect(approved.status).toBe('todo')
    expect(approved.needs_approval).toBe(false)
    await sup.tick()
    expect(runs).toHaveLength(2)
    expect(runs[1].publishAllowed).toBe(true)
    runs[1].resolve(okSummary())
    await settle()
    const done = (await repo.get(t.fm.id))!.fm
    expect(done.status).toBe('done')
    expect(done.completed).toBe('2026-11-06T10:00:00')
    expect(done.attempts).toBe(2)
  })

  it('does not start anything while the PAUSE file exists, and pause()/resume() toggle it', async () => {
    await repo.create({ title: 'X', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await writeFile(join(vault, 'PAUSE'), '', 'utf8')
    await sup.tick()
    expect(runs).toHaveLength(0)
    expect(sup.getState().paused).toMatchObject({ active: true, reason: expect.stringMatching(/PAUSE/) })
    await sup.resume()
    await expect(access(join(vault, 'PAUSE'))).rejects.toThrow()
    await sup.tick()
    expect(runs).toHaveLength(1)
    await sup.pause()
    await access(join(vault, 'PAUSE'))
  })

  it('returns a rate-limited task to todo without counting the attempt and pauses the guard', async () => {
    const t = await repo.create({ title: 'RL', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    const resetsAt = new Date(now.getTime() + 3_600_000)
    // the runner reports the official signal through hooks before the summary
    sup.handleStreamEvent(t.fm.id, { kind: 'rate_limit', signal: { family: 'all', window: 'five_hour', status: 'rejected', resetsAt } })
    runs[0].resolve(okSummary({ ok: false, reason: 'rate_limited', costUsd: 0.01, tokensIn: 100, tokensOut: 10 }))
    await settle()
    const fm = (await repo.get(t.fm.id))!.fm
    expect(fm.status).toBe('todo')
    expect(fm.attempts).toBe(0)
    expect(fm.started).toBeNull()
    await sup.tick()
    expect(runs).toHaveLength(1) // guard paused → nothing new
    expect(sup.getState().decision!.mode).toBe('paused')
  })

  it('blocks a task after max_attempts failures and creates a manual task for Julius', async () => {
    const t = await repo.create({ title: 'Kaputt', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    for (let i = 0; i < 3; i++) {
      await sup.tick()
      runs[runs.length - 1].resolve(okSummary({ ok: false, reason: 'error', subtype: 'error_during_execution' }))
      await settle()
    }
    const fm = (await repo.get(t.fm.id))!.fm
    expect(fm.status).toBe('blocked')
    expect(fm.attempts).toBe(3)
    const manual = (await repo.list()).find((x) => x.fm.station === 'manual')
    expect(manual).toBeDefined()
    expect(manual!.fm.title).toBe('Blockiert: Kaputt')
    expect(manual!.fm.parent).toBe(t.fm.id)
    await sup.tick()
    expect(runs).toHaveLength(3)
  })

  it('creates the planner trigger when the queue is thin, not twice within 2 h', async () => {
    await rm(join(dataDir, 'state.json'))
    sup = await build()
    await sup.tick()
    let planners = (await repo.list()).filter((x) => x.fm.station === 'planer')
    expect(planners).toHaveLength(1)
    expect(planners[0].fm).toMatchObject({ title: 'Planung: Warteschlange füllen', tier: 'standard', priority: 1, origin: 'system' })
    expect(runs.map((r) => r.taskId)).toContain(planners[0].fm.id)
    runs.find((r) => r.taskId === planners[0].fm.id)!.resolve(okSummary())
    await settle()
    expect((await repo.get(planners[0].fm.id))!.fm.status).toBe('done') // autopilot 2, no approval

    now = new Date('2026-11-06T10:10:00')
    await sup.tick()
    planners = (await repo.list()).filter((x) => x.fm.station === 'planer')
    expect(planners).toHaveLength(1)

    now = new Date('2026-11-06T12:01:00')
    await sup.tick()
    planners = (await repo.list()).filter((x) => x.fm.station === 'planer')
    expect(planners).toHaveLength(2)
  })

  it('respects maxParallel and the premium cap', async () => {
    for (let i = 0; i < 4; i++) await repo.create({ title: `S${i}`, station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(runs).toHaveLength(2)
    await sup.tick()
    expect(runs).toHaveLength(2)
  })

  it('turns a new Inbox file into one planner task', async () => {
    await writeFile(join(vault, 'Inbox', 'Mein Chat.md'), 'Tagesplanung …', 'utf8')
    await writeFile(join(vault, 'Inbox', 'README.md'), 'Anleitung', 'utf8')
    await sup.tick()
    const inbox = (await repo.list()).filter((x) => x.fm.title.startsWith('Inbox einordnen'))
    expect(inbox).toHaveLength(1)
    expect(inbox[0].fm.title).toBe('Inbox einordnen: Mein Chat.md')
    expect(inbox[0].fm.origin).toBe('inbox')
    expect(readSection(inbox[0].body, 'Kontext')).toContain('Mein Chat.md')
    await sup.tick()
    expect((await repo.list()).filter((x) => x.fm.title.startsWith('Inbox einordnen'))).toHaveLength(1)
    // persisted across restart
    const again = await build()
    await again.tick()
    expect((await repo.list()).filter((x) => x.fm.title.startsWith('Inbox einordnen'))).toHaveLength(1)
  })

  it('fires the daily and weekly report triggers once', async () => {
    await rm(join(dataDir, 'state.json'))
    sup = await build()
    now = new Date('2026-11-06T07:31:00') // Friday 07:31
    await sup.tick()
    let reports = (await repo.list()).filter((x) => x.fm.station === 'berichter')
    expect(reports.map((r) => r.fm.title)).toEqual(['Tagesbericht'])
    now = new Date('2026-11-06T09:00:00')
    await sup.tick()
    reports = (await repo.list()).filter((x) => x.fm.station === 'berichter')
    expect(reports).toHaveLength(1)
    now = new Date('2026-11-12T17:05:00') // Thursday 17:05
    await sup.tick()
    reports = (await repo.list()).filter((x) => x.fm.station === 'berichter')
    expect(reports.map((r) => r.fm.title).sort()).toEqual(['Tagesbericht', 'Tagesbericht', 'Wochenbericht'])
    now = new Date('2026-11-11T20:30:00') // Wednesday 20:30 → Wochenstrategie (premium)
    await sup.tick()
    const strategy = (await repo.list()).find((x) => x.fm.title === 'Wochenstrategie')
    expect(strategy).toBeDefined()
    expect(strategy!.fm.tier).toBe('premium')
  })

  it('counts published posts today and withholds publishing at the limit', async () => {
    for (let i = 0; i < 3; i++) {
      const t = await repo.create({ title: `P${i}`, station: 'content', tier: 'standard', priority: 3, origin: 'planer', auftrag: 'x' })
      await repo.update(t.fm.id, { status: 'done', published_at: '2026-11-06T09:00:00' })
    }
    const t = await repo.create({ title: 'Neu', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(sup.getState().today.posts).toBe(3)
    expect(runs.find((r) => r.taskId === t.fm.id)!.publishAllowed).toBe(false)
  })

  it('reports unavailable stations and skips their tasks', async () => {
    await repo.create({ title: 'Stimme', station: 'voice', tier: 'standard', priority: 1, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(runs.map((r) => r.taskId)).not.toContain('voice')
    const v = sup.getState().stations.find((s) => s.name === 'voice')!
    expect(v).toMatchObject({ available: false, reason: 'Umgebungsvariable VOICE_KEY fehlt' })
  })

  it('recovers orphaned doing tasks on the first tick after a restart', async () => {
    const t = await repo.create({ title: 'Verwaist', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await repo.update(t.fm.id, { status: 'doing', started: '2026-11-06T09:00:00' })
    const fresh = await build()
    await fresh.tick()
    const fm = (await repo.get(t.fm.id))!.fm
    expect(fm.status).toBe('doing') // recovered to todo and immediately started again
    expect(fm.started).toBe('2026-11-06T10:00:00')
  })

  it('writes Status.md on every tick', async () => {
    await sup.tick()
    const status = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(status).toContain('## Budget')
    expect(status).toContain('## Wartet auf dich')
  })

  it('archives old done tasks once a day', async () => {
    const t = await repo.create({ title: 'Alt', station: 'studio', tier: 'cheap', priority: 3, origin: 'planer', auftrag: 'x' })
    await repo.update(t.fm.id, { status: 'done', completed: '2026-09-01T10:00:00' })
    await sup.tick()
    expect(await repo.get(t.fm.id)).toBeNull()
    await rm(join(vault, 'Archiv', `${t.fm.id}.md`))
  })
})
