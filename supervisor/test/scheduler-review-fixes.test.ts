// Regression tests for the findings of the final code review (approval
// semantics, Julius' edits during a run, orphan race, hard publish gating,
// autopilot enforcement, auth handling, robustness against odd notes).
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
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
import { readSection, stringifyNote } from '../src/vault/frontmatter.js'

const T0 = new Date('2026-11-06T10:00:00')

function station(name: string, over: Partial<Station> = {}): Station {
  return {
    name,
    display: name,
    description: name,
    tier: 'standard',
    maxTurns: 40,
    timeoutMin: 25,
    tools: ['Read', 'Write'],
    context: [],
    requires: { mcp: [], env: [], services: [], any: [] },
    autopilot: 1,
    cooldownHours: 0,
    outputsDir: null,
    dir: `/repo/stations/${name}`,
    skillPath: `/repo/stations/${name}/SKILL.md`,
    ...over,
  }
}

const ok = (over: Partial<RunSummary> = {}): RunSummary => ({
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
  modelUsed: 'claude-sonnet-5-5',
  resultText: 'Fertig.',
  permissionDenials: [],
  sessionId: 's',
  durationMs: 10,
  ...over,
})

describe('review fixes', () => {
  let vault: string
  let dataDir: string
  let repo: TaskRepo
  let now: Date
  let cfg: Config
  let runs: { task: Task; station: Station; opts: RunOptions; resolve: (s: RunSummary) => void }[]
  let sup: Supervisor
  let stations: Station[]
  const clock = (): Date => now

  const fakeRun: typeof runWorker = (task, st, _cfg, _hooks, opts) =>
    new Promise<RunSummary>((resolve) => void runs.push({ task, station: st, opts, resolve }))

  const settle = async (): Promise<void> => {
    const deadline = Date.now() + 3000
    while (sup.getState().workers.length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 30))
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
      triggers: false,
      ...over,
    })
    await s.init()
    return s
  }

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-fix-'))
    vault = join(root, 'MeinVault', 'LimitlessOS')
    await mkdir(join(vault, 'Aufgaben'), { recursive: true })
    dataDir = join(root, 'data')
    now = T0
    runs = []
    repo = new TaskRepo(vault, clock)
    stations = [station('content'), station('studio', { tier: 'cheap', autopilot: 2 }), station('draft-only', { autopilot: 0 })]
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
    sup = await build()
  })

  it('a reviewer ZURÜCK (status todo, needs_approval kept) re-runs as a draft, never as an approved run', async () => {
    const t = await repo.create({ title: 'Reel', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x', needs_approval: true })
    await sup.tick()
    runs[0].resolve(ok())
    await settle()
    expect((await repo.get(t.fm.id))!.fm.status).toBe('review')
    // reviewer sends it back exactly as SKILL.md instructs
    await repo.update(t.fm.id, { status: 'todo' }, { log: 'ZURÜCK: Hashtags 11 > 8' })
    await sup.tick()
    const again = (await repo.get(t.fm.id))!.fm
    expect(again.needs_approval).toBe(true)
    expect(runs).toHaveLength(2)
    expect(runs[1].task.fm.needs_approval).toBe(true)
    expect(runs[1].opts.gated).toBe(true)
    runs[1].resolve(ok())
    await settle()
    expect((await repo.get(t.fm.id))!.fm.status).toBe('review')
  })

  it('passes a hard gate to the runner whenever approval is pending, the station is draft-only, or the daily limit is reached', async () => {
    const pending = await repo.create({ title: 'A', station: 'content', tier: 'standard', priority: 1, origin: 'planer', auftrag: 'x', needs_approval: true })
    const draftOnly = await repo.create({ title: 'B', station: 'draft-only', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x', needs_approval: false })
    await sup.tick()
    const byId = Object.fromEntries(runs.map((r) => [r.task.fm.id, r.opts]))
    expect(byId[pending.fm.id].gated).toBe(true)
    expect(byId[draftOnly.fm.id].gated).toBe(true)
  })

  it('counts in-flight publishing runs against the daily post limit', async () => {
    cfg.dailyPostLimit = 1
    // content on autopilot 2: tasks may publish without approval, so the limit is the only gate
    sup = await build({ stations: [station('content', { autopilot: 2 })] })
    await repo.create({ title: 'P1', station: 'content', tier: 'standard', priority: 1, origin: 'planer', auftrag: 'x', needs_approval: false })
    await repo.create({ title: 'P2', station: 'content', tier: 'standard', priority: 1, origin: 'planer', auftrag: 'x', needs_approval: false })
    await sup.tick()
    expect(runs).toHaveLength(2)
    const gates = runs.map((r) => r.opts.publishAllowed).sort()
    expect(gates).toEqual([false, true])
  })

  it('forces needs_approval on a new task of an autopilot<2 station when the creator forgot it', async () => {
    const t = await repo.create({ title: 'Vergessen', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x', needs_approval: false })
    await sup.tick()
    expect((await repo.get(t.fm.id))!.fm.needs_approval).toBe(true)
    expect(runs[0].opts.gated).toBe(true)
    runs[0].resolve(ok())
    await settle()
    // Julius approves → the approval sticks (not re-forced)
    await sup.approve(t.fm.id)
    await sup.tick()
    expect(runs[1].task.fm.needs_approval).toBe(false)
    expect(runs[1].opts.gated).toBe(false)
  })

  it('reads autopilot overrides from Strategie.md frontmatter', async () => {
    await writeFile(join(vault, 'Strategie.md'), stringifyNote({ type: 'strategie', autopilot: { content: 2, studio: 0 } }, '# S\n'), 'utf8')
    sup = await build()
    const st = sup.getState().stations
    expect(st.find((s) => s.name === 'content')!.autopilot).toBe(2)
    expect(st.find((s) => s.name === 'studio')!.autopilot).toBe(0)
  })

  it('keeps a status Julius set during the run (cancelled) and only adds totals and the log', async () => {
    const t = await repo.create({ title: 'Abbruch', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    await repo.update(t.fm.id, { status: 'cancelled' }, { log: 'Julius: nicht mehr nötig' })
    runs[0].resolve(ok())
    await settle()
    const fm = (await repo.get(t.fm.id))!.fm
    expect(fm.status).toBe('cancelled')
    expect(fm.cost_usd).toBe(0.01)
    await sup.tick()
    expect(runs).toHaveLength(1)
  })

  it('does not treat a task that finished during the directory scan as an orphan', async () => {
    const t = await repo.create({ title: 'Race', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(runs).toHaveLength(1)
    // Simulate the race: list() returns a stale snapshot taken while the worker was still running.
    const stale = await repo.list()
    const racyRepo = Object.create(repo) as TaskRepo
    racyRepo.list = async () => stale
    runs[0].resolve(ok())
    await settle()
    expect((await repo.get(t.fm.id))!.fm.status).toBe('done')
    sup = await build({ repo: racyRepo })
    await sup.tick()
    expect((await repo.get(t.fm.id))!.fm.status).toBe('done')
    expect(runs).toHaveLength(1)
  })

  it('does not count a login failure as an attempt and turns health red', async () => {
    const t = await repo.create({ title: 'Login', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    runs[0].resolve(ok({ ok: false, reason: 'auth', subtype: 'error_during_execution', apiErrorStatus: 401 }))
    await settle()
    const fm = (await repo.get(t.fm.id))!.fm
    expect(fm.status).toBe('todo')
    expect(fm.attempts).toBe(0)
    expect(sup.getState().health.ok).toBe(false)
    expect(sup.getState().health.problems.join(' ')).toMatch(/Claude-Login/)
    await sup.tick()
    expect(runs).toHaveLength(1)
  })

  it('re-checks health periodically and recovers when the check passes again', async () => {
    let healthy = false
    sup = await build({ healthCheck: async () => (healthy ? { ok: true, problems: [] } : { ok: false, problems: ['Nicht angemeldet'] }) })
    await repo.create({ title: 'H', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick() // first tick runs the health check → red
    expect(sup.getState().health.ok).toBe(false)
    expect(runs).toHaveLength(0)
    healthy = true
    for (let i = 0; i < 20; i++) await sup.tick() // health re-check every 20 ticks
    expect(sup.getState().health.ok).toBe(true)
    expect(runs).toHaveLength(1)
  })

  it('tolerates a hand-made note with missing fields and a renamed note', async () => {
    await writeFile(
      join(vault, 'Aufgaben', 'handgemacht.md'),
      stringifyNote({ type: 'task', id: 'handgemacht', title: 'Von Hand', status: 'todo', station: 'studio', priority: 2, tier: 'cheap' }, '## Auftrag\nx\n'),
      'utf8',
    )
    const t = await repo.create({ title: 'Umbenannt', station: 'studio', tier: 'cheap', priority: 1, origin: 'julius', auftrag: 'y' })
    await rename(t.path, join(vault, 'Aufgaben', 'Mein eigener Name.md'))
    await sup.tick()
    expect(runs.map((r) => r.task.fm.id).sort()).toEqual(['handgemacht', t.fm.id].sort())
    for (const r of runs) r.resolve(ok())
    await settle()
    const renamed = (await repo.list()).find((x) => x.fm.id === t.fm.id)!
    expect(renamed.fm.status).toBe('done')
    expect(renamed.path.endsWith('Mein eigener Name.md')).toBe(true)
    expect(sup.getState().ticker.join(' ')).not.toMatch(/Fehler im Aufseher/)
  })

  it('isolates a broken note so the other tasks still run', async () => {
    await writeFile(join(vault, 'Aufgaben', 'kaputt.md'), '---\ntype: task\nid: kaputt\ntitle: Kaputt\nstatus: todo\nstation: studio\npriority: abc\ntier: cheap\n---\n', 'utf8')
    await repo.create({ title: 'Gut', station: 'studio', tier: 'cheap', priority: 1, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(runs.map((r) => r.task.fm.title)).toContain('Gut')
  })

  it('planner trigger fires only when the queue is thin and at most every two hours', async () => {
    sup = await build({ triggers: true, stations: [...stations, station('planer', { autopilot: 2 }), station('berichter', { tier: 'cheap', autopilot: 2 })] })
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'state.json'), JSON.stringify({ inboxSeen: [], fired: { 'tagesbericht:2026-11-06': 'seed' }, lastPlannerCreated: null, lastArchive: null, known: [] }), 'utf8')
    sup = await build({ triggers: true, stations: [...stations, station('planer', { autopilot: 2 }), station('berichter', { tier: 'cheap', autopilot: 2 })] })
    for (let i = 0; i < 6; i++) await repo.create({ title: `T${i}`, station: 'studio', tier: 'cheap', priority: 3, origin: 'planer', auftrag: 'x' })
    await sup.tick() // 6 open → not thin → no planner
    expect((await repo.list()).filter((t) => t.fm.station === 'planer')).toHaveLength(0)
    for (const r of runs) r.resolve(ok())
    await settle()
    now = new Date('2026-11-06T10:01:00')
    await sup.tick() // 4 open (2 done) → thin → planner
    expect((await repo.list()).filter((t) => t.fm.station === 'planer')).toHaveLength(1)
    const plannerRun = runs.find((r) => r.station.name === 'planer')!
    plannerRun.resolve(ok())
    for (const r of runs) if (r !== plannerRun && r.station.name === 'studio') r.resolve(ok())
    await settle()
    now = new Date('2026-11-06T11:30:00')
    await sup.tick() // thin again but < 2 h → no second planner
    expect((await repo.list()).filter((t) => t.fm.station === 'planer')).toHaveLength(1)
  })

  it('writes Status.md only when its content changed', async () => {
    await sup.tick()
    const first = await readFile(join(vault, 'Status.md'), 'utf8')
    now = new Date('2026-11-06T10:00:30')
    await sup.tick()
    const second = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(second).toBe(first)
  })

  it('passes the configured daily shop change limit to workers', async () => {
    cfg.dailyShopChangeLimit = 7
    sup = await build()
    await repo.create({ title: 'S', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(runs[0].opts.env.LIMITLESS_DAILY_SHOP_CHANGE_LIMIT).toBe('7')
  })

  it('strips secrets from the worker environment', async () => {
    cfg.env = { SHOPIFY_CLIENT_SECRET: 'geheim', SHOPIFY_CLIENT_ID: 'cid', METRICOOL_USER_TOKEN: 'tok', PATH: '/bin', LIMITLESS_CLAUDE_BIN: '/x' }
    sup = await build()
    await repo.create({ title: 'S', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    const env = runs[0].opts.env
    expect(env.SHOPIFY_CLIENT_SECRET).toBeUndefined()
    expect(env.METRICOOL_USER_TOKEN).toBeUndefined()
    expect(env.SHOPIFY_CLIENT_ID).toBe('cid')
    expect(env.PATH).toBe('/bin')
    expect(env.LIMITLESS_CLAUDE_BIN).toBe('/x')
    expect(readSection((await repo.list())[0].body, 'Auftrag')).toBe('x')
  })
})
