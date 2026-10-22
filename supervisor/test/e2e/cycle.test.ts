import { describe, it, expect } from 'vitest'
import { cp, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Supervisor } from '../../src/scheduler.js'
import type { Config } from '../../src/config.js'
import { TaskRepo } from '../../src/vault/tasks.js'
import { Ledger } from '../../src/budget/ledger.js'
import { BudgetGuard } from '../../src/budget/guard.js'
import { loadStations } from '../../src/stations/loader.js'
import type { RunSummary } from '../../src/runner/stream.js'
import type { runWorker } from '../../src/runner/claude.js'
import { readSection } from '../../src/vault/frontmatter.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const ok = (over: Partial<RunSummary> = {}): RunSummary => ({
  ok: true,
  reason: 'success',
  subtype: 'success',
  isError: false,
  apiErrorStatus: null,
  costUsd: 0.05,
  tokensIn: 9000,
  tokensOut: 1500,
  cacheRead: 0,
  cacheWrite: 0,
  modelUsed: 'claude-sonnet-5-5',
  resultText: 'Erledigt.',
  permissionDenials: [],
  sessionId: 's',
  durationMs: 500,
  ...over,
})

describe('end-to-end cycle with the real stations and vault template', () => {
  it('plans, produces, waits for approval, publishes after approval and reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-e2e-'))
    const vault = join(root, 'MeinVault', 'LimitlessOS')
    await cp(join(repoRoot, 'vault-template', 'LimitlessOS'), vault, { recursive: true })
    const dataDir = join(root, 'data')
    let now = new Date('2026-11-06T09:00:00') // Friday
    const clock = (): Date => now
    const repo = new TaskRepo(vault, clock)
    const cfg: Config = {
      repoRoot,
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
    const ledger = new Ledger(join(dataDir, 'ledger.jsonl'))
    const guard = new BudgetGuard(ledger, cfg, join(dataDir, 'guard.json'), clock)
    await guard.load()
    const stations = await loadStations(repoRoot)

    const seen: { taskId: string; station: string; publishAllowed: boolean }[] = []
    // The fake worker behaves like the real stations would on the vault.
    const run: typeof runWorker = async (task, station, _cfg, _hooks, opts) => {
      seen.push({ taskId: task.fm.id, station: station.name, publishAllowed: opts.publishAllowed })
      if (station.name === 'planer') {
        const studio = await repo.create({
          title: 'Studio: Slides für „Ein Poster, 5 Räume“',
          station: 'studio',
          tier: 'cheap',
          priority: 2,
          origin: 'planer',
          auftrag: 'Sechs Slides rendern.',
        })
        await repo.create({
          title: 'Karussell „Ein Poster, 5 Räume“',
          station: 'content',
          tier: 'standard',
          priority: 2,
          origin: 'planer',
          needs_approval: true,
          parent: studio.fm.id,
          auftrag: 'Karussell-Texte schreiben und planen.',
        })
        await repo.update(task.fm.id, {}, { section: { heading: 'Ergebnis', content: '- 2 Aufgaben angelegt' } })
      }
      if (station.name === 'studio') {
        await repo.update(task.fm.id, { outputs: ['Assets/content/x/slide-1.png'] }, { section: { heading: 'Ergebnis', content: '### Erzeugt\n- slide-1.png' } })
      }
      if (station.name === 'content') {
        const content = opts.publishAllowed && !task.fm.needs_approval ? '### Veröffentlichung\nGeplant: https://app.metricool.com/planner/1' : '### Veröffentlichung\nNicht geplant – wartet auf Freigabe'
        const patch = opts.publishAllowed && !task.fm.needs_approval ? { published_at: '2026-11-06T09:40:00' } : {}
        await repo.update(task.fm.id, patch, { section: { heading: 'Ergebnis', content } })
      }
      return ok({ modelUsed: station.tier === 'cheap' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5' })
    }

    const sup = new Supervisor(cfg, {
      repo,
      guard,
      ledger,
      stations,
      run,
      clock,
      probes: { http: async () => false, mcpConfigured: async (name) => name === 'metricool' },
    })
    await sup.init()
    const settle = async (): Promise<void> => {
      const deadline = Date.now() + 3000
      while (sup.getState().workers.length > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
      await new Promise((r) => setTimeout(r, 30))
    }

    // Tick 1: empty queue → planner + daily report triggers fire and run.
    await sup.tick()
    await settle()
    let tasks = await repo.list()
    expect(tasks.map((t) => t.fm.station).sort()).toEqual(['berichter', 'content', 'planer', 'studio'])
    expect(tasks.find((t) => t.fm.station === 'planer')!.fm.status).toBe('done')
    expect(tasks.find((t) => t.fm.station === 'berichter')!.fm.status).toBe('done')

    // Tick 2: studio (cheap) and content (standard) run; content needs approval → review.
    now = new Date('2026-11-06T09:05:00')
    await sup.tick()
    await settle()
    tasks = await repo.list()
    const content = tasks.find((t) => t.fm.station === 'content')!
    const studio = tasks.find((t) => t.fm.station === 'studio')!
    expect(studio.fm.status).toBe('done')
    expect(studio.fm.outputs).toEqual(['Assets/content/x/slide-1.png'])
    expect(content.fm.status).toBe('review')
    expect(content.fm.published_at).toBeNull()
    expect(readSection(content.body, 'Ergebnis')).toContain('wartet auf Freigabe')
    expect(sup.getState().waiting.map((w) => w.id)).toEqual([content.fm.id])
    const status = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(readSection(status, 'Wartet auf dich')).toContain(content.fm.title)

    // Julius approves in the world → next run may publish.
    await sup.approve(content.fm.id)
    now = new Date('2026-11-06T09:40:00')
    await sup.tick()
    await settle()
    const published = (await repo.get(content.fm.id))!
    expect(published.fm.status).toBe('done')
    expect(published.fm.published_at).toBe('2026-11-06T09:40:00')
    expect(seen.filter((s) => s.taskId === content.fm.id).map((s) => s.publishAllowed)).toEqual([true, true])
    expect(sup.getState().today.posts).toBe(1)
    expect(sup.getState().waiting).toEqual([])

    // Ledger: one entry per run. The planner ran once – the queue was thin at 09:40
    // as well, but the planner fires at most every two hours (spec §5.1).
    const entries = (await readFile(join(dataDir, 'ledger.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { station: string })
    const byStation = entries.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.station]: (acc[e.station] ?? 0) + 1 }), {})
    expect(byStation).toEqual({ planer: 1, berichter: 1, studio: 1, content: 2 })

    // Three hours later the thin queue lets the planner run again; the daily report does not fire twice.
    now = new Date('2026-11-06T12:00:00')
    await sup.tick()
    await settle()
    expect((await repo.list()).filter((t) => t.fm.station === 'berichter')).toHaveLength(1)
    expect((await repo.list()).filter((t) => t.fm.station === 'planer')).toHaveLength(2)
  }, 30_000)
})
