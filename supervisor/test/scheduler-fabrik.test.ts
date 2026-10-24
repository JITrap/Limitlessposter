// „Die Fabrik läuft immer“: Planer-Anstoß bei leerer Fabrik (alle 30 min), Tagesproduktion um 05:30,
// Welt-Knopf „Planer jetzt“ und die neuen State-Felder (fabrik, kalender, medien, stimme).
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
import { readSection } from '../src/vault/frontmatter.js'
import { savePublog } from '../src/publog.js'

const T0 = new Date('2026-11-06T10:00:00') // a Friday

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

describe('Fabrik läuft immer', () => {
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

  const planners = async (): Promise<Task[]> => (await repo.list()).filter((t) => t.fm.station === 'planer')
  const ticker = (): string => sup.getState().ticker.join('\n')

  /** Persisted supervisor state as the tick finds it on start. */
  async function seedState(over: { fired?: Record<string, string>; lastPlannerCreated?: string | null }): Promise<void> {
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'state.json'),
      JSON.stringify({ inboxSeen: [], fired: over.fired ?? {}, lastPlannerCreated: over.lastPlannerCreated ?? null, lastArchive: null, known: [] }),
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
      triggers: true,
      ...over,
    })
    await s.init()
    return s
  }

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-fabrik-'))
    vault = join(root, 'MeinVault', 'LimitlessOS')
    await mkdir(join(vault, 'Aufgaben'), { recursive: true })
    dataDir = join(root, 'data')
    now = T0
    runs = []
    repo = new TaskRepo(vault, clock)
    stations = [station('planer', { autopilot: 2 }), station('studio', { tier: 'cheap', autopilot: 2 })]
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

  it('an empty factory gets a planner after 30 minutes – and not again before the next 30 minutes', async () => {
    await seedState({ fired: { 'tagesproduktion:2026-11-06': 'seed' }, lastPlannerCreated: '2026-11-06T09:50:00' })
    sup = await build()
    expect(sup.getState().fabrik.grund).toBe('noch kein Tick')

    await sup.tick() // 10:00 – planner 10 min ago → wait
    expect(await planners()).toHaveLength(0)
    expect(sup.getState().fabrik).toMatchObject({ leer: true, leerSeit: '2026-11-06T10:00:00', grund: 'keine Aufgaben', letzterPlaner: '2026-11-06T09:50:00' })

    now = new Date('2026-11-06T10:05:00')
    await sup.tick()
    expect(sup.getState().fabrik.leerSeit).toBe('2026-11-06T10:00:00') // still empty since the first tick

    now = new Date('2026-11-06T10:21:00')
    await sup.tick() // 31 min → planner
    const first = await planners()
    expect(first).toHaveLength(1)
    expect(first[0].fm).toMatchObject({ title: 'Planung: Fabrik leer – Warteschlange füllen', station: 'planer', tier: 'standard', priority: 1, origin: 'system' })
    expect(readSection(first[0].body, 'Auftrag')).toContain('Strategie.md')
    expect(readSection(first[0].body, 'Auftrag')).toContain('Pläne/Produktion.md')
    expect(runs.map((r) => r.task.fm.id)).toContain(first[0].fm.id)
    expect(ticker()).toContain('Fabrik leer – Planer füllt die Warteschlange')
    expect(sup.getState().fabrik).toMatchObject({ leer: false, leerSeit: null, grund: 'läuft', letzterPlaner: '2026-11-06T10:21:00' })

    now = new Date('2026-11-06T10:25:00')
    await sup.tick() // planner still running → no second one
    expect(await planners()).toHaveLength(1)

    runs.find((r) => r.task.fm.id === first[0].fm.id)!.resolve(ok())
    await settle()
    now = new Date('2026-11-06T10:40:00')
    await sup.tick() // empty again, but only 19 min since the last planner
    expect(await planners()).toHaveLength(1)
    expect(sup.getState().fabrik).toMatchObject({ leer: true, leerSeit: '2026-11-06T10:40:00' })

    now = new Date('2026-11-06T10:52:00')
    await sup.tick() // 31 min → next planner
    expect(await planners()).toHaveLength(2)
  })

  it('does not nudge the planner while something is runnable or the system is paused', async () => {
    await seedState({ fired: { 'tagesproduktion:2026-11-06': 'seed' }, lastPlannerCreated: '2026-11-06T09:00:00' })
    sup = await build()
    await repo.create({ title: 'S', station: 'studio', tier: 'cheap', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick() // the studio task starts – the factory is not empty
    expect(await planners()).toHaveLength(0)
    expect(runs).toHaveLength(1)
    expect(sup.getState().fabrik).toMatchObject({ leer: false, grund: 'läuft' })
    runs[0].resolve(ok())
    await settle()

    await writeFile(join(vault, 'PAUSE'), 'Not-Aus', 'utf8')
    now = new Date('2026-11-06T10:05:00')
    await sup.tick() // empty, but paused → nothing
    expect(await planners()).toHaveLength(0)
    expect(sup.getState().fabrik.grund).toContain('Pause')
    await rm(join(vault, 'PAUSE'))

    now = new Date('2026-11-06T10:06:00')
    await sup.tick()
    expect(await planners()).toHaveLength(1)
  })

  it('a task for a station that is not connected counts as standing still, with the station named', async () => {
    await seedState({ fired: { 'tagesproduktion:2026-11-06': 'seed' }, lastPlannerCreated: '2026-11-06T09:55:00' })
    sup = await build({ stations: [...stations, station('voice', { requires: { mcp: [], env: ['VOICE_KEY'], services: [], any: [] } })] })
    await repo.create({ title: 'V', station: 'voice', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'x' })
    await sup.tick()
    expect(runs).toHaveLength(0)
    expect(sup.getState().fabrik).toMatchObject({ leer: true, grund: 'Stationen nicht verbunden: voice' })
  })

  it("plans tomorrow's production at 05:30 once a day – only when the produktion station is loaded", async () => {
    await seedState({ lastPlannerCreated: '2026-11-06T05:20:00' })
    now = new Date('2026-11-06T05:25:00')
    sup = await build()
    await sup.tick()
    expect(await planners()).toHaveLength(0)
    now = new Date('2026-11-06T05:31:00')
    await sup.tick()
    expect(await planners()).toHaveLength(0)
    expect(ticker()).toContain('Station „produktion“ nicht geladen')
    expect(sup.getState().fabrik.naechsteAusloeser.map((a) => a.name)).not.toContain('Tagesproduktion planen')

    await seedState({ lastPlannerCreated: '2026-11-06T05:20:00' })
    sup = await build({ stations: [...stations, station('produktion', { autopilot: 2 })] })
    await sup.tick()
    const p = await planners()
    expect(p).toHaveLength(1)
    expect(p[0].fm).toMatchObject({ title: 'Produktion für 2026-11-07 planen', station: 'planer', priority: 1, origin: 'system' })
    expect(readSection(p[0].body, 'Auftrag')).toContain('daily_targets')
    expect(readSection(p[0].body, 'Auftrag')).toContain('Pläne/Produktion.md')
    expect(ticker()).toContain('Tagesproduktion angestoßen')

    now = new Date('2026-11-06T05:35:00')
    await sup.tick()
    expect(await planners()).toHaveLength(1)
    expect(sup.getState().fabrik.naechsteAusloeser.find((a) => a.name === 'Tagesproduktion planen')!.wann).toBe('2026-11-07T05:30:00')
  })

  it('exposes Fabrik, Kalender (−3/+7 days), Medien and Stimme in the world state', async () => {
    await savePublog(vault, {
      synced: '2026-11-06T09:30:00',
      entries: [
        { date: '2026-11-06T18:30', network: 'instagram', type: 'reel', status: 'geplant', text: 'Poster im Raum', key: 'k1', media: ['reel.mp4'], url: 'https://app.metricool.com/p/1', quelle: 'metricool' },
        { date: '2026-11-06T09:00', network: 'tiktok', type: 'video', status: 'veröffentlicht', text: 'Früh am Tag', key: 'k2', media: [], url: '', quelle: 'metricool' },
        { date: '2026-11-04T12:00', network: 'tiktok', type: 'video', status: 'veröffentlicht', text: 'Vorgestern', key: 'k3', media: [], url: '', quelle: 'metricool' },
        { date: '2026-11-13T09:00', network: 'instagram', type: 'post', status: 'geplant', text: 'Zu weit weg', key: 'k4', media: [], url: '', quelle: 'metricool' },
      ],
    })
    await mkdir(join(vault, 'Assets', 'content', 't9'), { recursive: true })
    await writeFile(join(vault, 'Assets', 'content', 't9', 'slide-1.png'), Buffer.alloc(3))
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'stimme.json'),
      JSON.stringify({ installed: true, engine: 'piper', cuda: false, voices: ['de_DE-thorsten'], lastSample: 'Assets\\content\\stimme\\probe.wav', updated: '2026-11-06T09:00:00' }),
      'utf8',
    )
    await seedState({ fired: { 'tagesproduktion:2026-11-06': 'seed' }, lastPlannerCreated: '2026-11-06T09:50:00' })
    sup = await build()
    await sup.tick()
    const s = sup.getState()

    expect(s.fabrik).toMatchObject({ leer: true, grund: 'keine Aufgaben', letzterPlaner: '2026-11-06T09:50:00' })
    const names = s.fabrik.naechsteAusloeser.map((a) => a.name)
    expect(names).toEqual(expect.arrayContaining(['Planer (Fabrik leer)', 'Tagesbericht', 'Zentrale: Kennzahlen', 'Wochenbericht', 'Wochenstrategie']))
    expect(s.fabrik.naechsteAusloeser.find((a) => a.name === 'Planer (Fabrik leer)')!.wann).toBe('2026-11-06T10:20:00')
    expect(s.fabrik.naechsteAusloeser.find((a) => a.name === 'Zentrale: Kennzahlen')!.wann).toBe('2026-11-06T12:00:00')
    expect(s.fabrik.naechsteAusloeser.find((a) => a.name === 'Tagesbericht')!.wann).toBe('2026-11-07T07:30:00')
    expect(s.fabrik.naechsteAusloeser.map((a) => a.wann)).toEqual([...s.fabrik.naechsteAusloeser.map((a) => a.wann)].sort())

    expect(s.kalender.tage).toHaveLength(10)
    expect(s.kalender.tage[0].datum).toBe('2026-11-03')
    expect(s.kalender.tage[9].datum).toBe('2026-11-12')
    const heute = s.kalender.tage.find((t) => t.heute)!
    expect(heute.datum).toBe('2026-11-06')
    expect(heute.eintraege).toEqual([
      { zeit: '09:00', netzwerk: 'tiktok', typ: 'video', status: 'veröffentlicht', text: 'Früh am Tag', url: '' },
      { zeit: '18:30', netzwerk: 'instagram', typ: 'reel', status: 'geplant', text: 'Poster im Raum', url: 'https://app.metricool.com/p/1' },
    ])
    expect(s.kalender.tage.find((t) => t.datum === '2026-11-04')!.eintraege[0].text).toBe('Vorgestern')
    expect(s.kalender.tage.some((t) => t.eintraege.some((e) => e.text === 'Zu weit weg'))).toBe(false)

    expect(s.medien.map((m) => m.pfad)).toEqual(['Assets/content/t9/slide-1.png'])
    expect(s.medien[0]).toMatchObject({ url: '/media/Assets/content/t9/slide-1.png', typ: 'bild', aufgabe: 't9' })
    expect(s.stimme).toMatchObject({ installed: true, engine: 'piper', cuda: false, voices: ['de_DE-thorsten'], lastSample: 'Assets/content/stimme/probe.wav' })
  })

  it('planNow (world button) creates one planner task and refuses while one is open or the station is missing', async () => {
    await seedState({ fired: { 'tagesproduktion:2026-11-06': 'seed' }, lastPlannerCreated: '2026-11-06T09:59:00' })
    sup = await build()
    await sup.tick()
    expect(await planners()).toHaveLength(0)
    expect(await sup.planNow()).toEqual({ ok: true, reason: null })
    const p = await planners()
    expect(p).toHaveLength(1)
    expect(p[0].fm.title).toBe('Planung: Fabrik leer – Warteschlange füllen')
    expect(await sup.planNow()).toEqual({ ok: false, reason: 'Planer läuft bereits' })
    expect(await planners()).toHaveLength(1)
    expect(ticker()).toContain('Planer angestoßen (Welt)')
    await sup.tick()
    expect(sup.getState().fabrik.letzterPlaner).toBe('2026-11-06T10:00:00')

    const ohnePlaner = await build({ stations: [station('studio', { tier: 'cheap', autopilot: 2 })] })
    await ohnePlaner.tick()
    expect(await ohnePlaner.planNow()).toEqual({ ok: false, reason: 'Station Planung nicht verfügbar' })
  })
})
