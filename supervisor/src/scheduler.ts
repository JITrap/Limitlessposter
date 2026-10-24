import { access, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from './config.js'
import type { Task, TaskStatus, Tier } from './types.js'
import { TaskRepo, nowStamp, todayStamp } from './vault/tasks.js'
import { parseNote, readSection } from './vault/frontmatter.js'
import { writeFileAtomic } from './vault/atomic.js'
import { BudgetGuard } from './budget/guard.js'
import { Ledger } from './budget/ledger.js'
import { familyOf } from './budget/models.js'
import { nextWeekReset } from './budget/windows.js'
import { checkAvailability, type Availability, type AvailabilityProbes, type Station } from './stations/loader.js'
import { runWorker } from './runner/claude.js'
import type { RunSummary, StreamEvent } from './runner/stream.js'
import { normalizeApprovals, recoverOrphans, selectRunnable, type PatchRow } from './queue/select.js'
import { renderStatusMd, type SupervisorState, type WorkerView, type ZentraleView } from './status/writer.js'
import { loadKennzahlen, type KennzahlenCache } from './kennzahlen.js'
import { printifySummary, type PrintifySummary } from './adapters/printify.js'
import { countForDay, isStale, loadPublogCached, type PublogCache } from './publog.js'
import { loadLimits, parseLimits, totalLimit, type Limits } from './limits.js'
import { computeFabrik, runnableTasks, PLANER_LEER_INTERVAL_MS, type FabrikView } from './fabrik.js'
import { listMedienCached, loadStimmeCached, STIMME_LEER, type MedienCache, type StimmeCache } from './medien.js'
import type { KalenderTag } from './status/writer.js'

export interface SupervisorDeps {
  repo: TaskRepo
  guard: BudgetGuard
  ledger: Ledger
  stations: Station[]
  run: typeof runWorker
  clock: () => Date
  probes: AvailabilityProbes
  /** Called after every tick and every worker completion with the fresh state. */
  onState?: (s: SupervisorState) => void
  log?: (line: string) => void
  /** false = no planner/report triggers (smoke runs); default true. */
  triggers?: boolean
  /** Re-run of the preflight; called on the first tick and every 20 ticks (spec §5.1). */
  healthCheck?: () => Promise<{ ok: boolean; problems: string[] }>
  /** Smoke mode: process only this task id – no approvals, no orphan recovery, no other starts. */
  only?: string
  /** Printify reader for the Zentrale (default: the real adapter); called at most hourly. */
  printify?: (env: NodeJS.ProcessEnv, now: Date) => Promise<PrintifySummary>
}

interface PersistedState {
  inboxSeen: string[]
  /** trigger key → stamp of the firing */
  fired: Record<string, string>
  lastPlannerCreated: string | null
  lastArchive: string | null
  /** task ids already seen once; new tasks of autopilot<2 stations get needs_approval forced */
  known: string[]
}

interface Running {
  task: Task
  station: Station
  startedAt: string
  tokens: number
  rateLimited: boolean
  /** this run may publish (counts against the daily post limit while in flight) */
  publishing: boolean
}

const AVAILABILITY_EVERY_TICKS = 10
const HEALTH_EVERY_TICKS = 20
const PLANNER_MIN_OPEN = 5
const PLANNER_MIN_INTERVAL_MS = 2 * 60 * 60_000
/** Fabrik leer (nichts startbar, niemand arbeitet): Planer spätestens alle 30 min, nicht in der Budget-Pause. */
const PLANNER_EMPTY_INTERVAL_MS = PLANER_LEER_INTERVAL_MS
/** 05:30 – der Planer legt die Produktion für morgen an (Station `produktion`, Fork A). */
const PRODUKTION_TRIGGER_MINUTES = 5 * 60 + 30
const KALENDER_TAGE_ZURUECK = 3
const KALENDER_TAGE_VORAUS = 7
const TICKER_MAX = 50
const ARCHIVE_DAYS = 30
const OUTWARD_STATIONS = new Set(['content', 'shop-analyst', 'pinterest', 'email'])
const KENNZAHLEN_EVERY_HOURS = 6
const PRINTIFY_EVERY_MS = 60 * 60_000
const ZENTRALE_LINKS: ZentraleView['links'] = [
  { name: 'Shopify-Admin', url: 'https://admin.shopify.com/' },
  { name: 'Shop', url: 'https://limitlessposter.com' },
  { name: 'Metricool', url: 'https://app.metricool.com/' },
  { name: 'Printify', url: 'https://printify.com/app/' },
  { name: 'Instagram', url: 'https://www.instagram.com/limitlessposter/' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@limitless.poster' },
  { name: 'Pinterest Business', url: 'https://business.pinterest.com/' },
  { name: 'Google Merchant', url: 'https://merchants.google.com/' },
]
const SECRET_KEY = /(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE)/i

const emptyState = (): PersistedState => ({ inboxSeen: [], fired: {}, lastPlannerCreated: null, lastArchive: null, known: [] })

const de = (n: number): string => n.toLocaleString('de-DE')
const usd = (n: number): string => `${n.toFixed(2).replace('.', ',')} $`

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Worker environment: config env minus secrets (adapters read `.env` themselves), plus run facts. */
export function workerEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith('LIMITLESS_') || !SECRET_KEY.test(k)) out[k] = v
  }
  delete out.ANTHROPIC_API_KEY
  return { ...out, ...extra }
}

/**
 * The Aufseher: one tick every `tickSeconds` (spec §5.1). Pure orchestration –
 * vault access via TaskRepo, budget via BudgetGuard, workers via `run`.
 */
export class Supervisor {
  private readonly running = new Map<string, Running>()
  private availability = new Map<string, Availability>()
  private autopilotOverride = new Map<string, 0 | 1 | 2>()
  private state: PersistedState = emptyState()
  private ticks = 0
  private ticker: string[] = []
  private lastDecision: SupervisorState['decision'] = null
  private pausedView: SupervisorState['paused'] = { active: false, reason: null, until: null }
  private counts: Record<TaskStatus, number> = { todo: 0, doing: 0, review: 0, blocked: 0, done: 0, cancelled: 0 }
  private waiting: SupervisorState['waiting'] = []
  private today: { posts: number; shopChanges: number; byNetwork: Record<string, { used: number; limit: number }>; publogSynced: string | null; publogStale: boolean } = { posts: 0, shopChanges: 0, byNetwork: {}, publogSynced: null, publogStale: true }
  private publog: PublogCache | null = null
  private limits: Limits = {}
  private limitOverride: Limits = {}
  private fabrik: FabrikView = { leer: true, leerSeit: null, grund: 'noch kein Tick', naechsteAusloeser: [], letzterPlaner: null }
  private medien: MedienCache | null = null
  private stimme: StimmeCache | null = null
  private health: SupervisorState['health'] = { ok: true, problems: [] }
  private kennzahlen: KennzahlenCache | null = null
  private printify: PrintifySummary | null = null
  private printifyAt = 0
  private printifyBusy = false
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private lastStatusBody = ''

  constructor(
    private readonly cfg: Config,
    private readonly deps: SupervisorDeps,
  ) {}

  get stateFile(): string {
    return join(this.cfg.dataDir, 'state.json')
  }

  async init(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.stateFile, 'utf8')) as Partial<PersistedState>
      this.state = { ...emptyState(), ...raw, known: Array.isArray(raw.known) ? raw.known : [] }
    } catch {
      this.state = emptyState()
    }
    await this.loadAutopilotOverrides()
    await this.refreshAvailability()
  }

  setHealth(h: SupervisorState['health']): void {
    this.health = h
  }

  async start(): Promise<void> {
    await this.tick()
    this.timer = setInterval(() => void this.tick(), this.cfg.tickSeconds * 1000)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  autopilotOf(station: Station): 0 | 1 | 2 {
    return this.autopilotOverride.get(station.name) ?? station.autopilot
  }

  // ---------------------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      await this.tickInner()
    } catch (err) {
      this.pushTicker(`Fehler im Aufseher: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.ticking = false
    }
  }

  private async tickInner(): Promise<void> {
    const now = this.deps.clock()
    this.ticks++
    if (this.deps.healthCheck && this.ticks % HEALTH_EVERY_TICKS === 1) {
      try {
        this.health = await this.deps.healthCheck()
      } catch (err) {
        this.health = { ok: false, problems: [`Gesundheitsprüfung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`] }
      }
    }
    if (this.ticks % AVAILABILITY_EVERY_TICKS === 1) {
      await this.loadAutopilotOverrides()
      await this.refreshAvailability()
    }

    if (!this.deps.only) await this.scanInbox(now)

    // Snapshot BEFORE the directory scan: a worker that finishes during list()
    // must not look like an orphan (its note still said `doing` in the snapshot).
    const runningBefore = new Set(this.running.keys())
    let tasks = await this.deps.repo.list()
    if (this.deps.only) tasks = tasks.filter((t) => t.fm.id === this.deps.only)

    if (!this.deps.only) {
      let changed = 0
      for (const r of [...this.enforceApprovalOnNewTasks(tasks), ...normalizeApprovals(tasks)]) {
        await this.applyRow(r)
        changed++
      }
      for (const r of recoverOrphans(tasks, runningBefore)) {
        // Conditional: still `doing` on disk and still not running right now.
        const cur = await this.deps.repo.get(r.id)
        if (cur && cur.fm.status === 'doing' && !this.running.has(r.id)) {
          await this.applyRow(r)
          changed++
        }
      }
      if (changed) tasks = await this.deps.repo.list()
      await this.saveStateIfChanged()
    }

    const decision = await this.deps.guard.decide()
    this.lastDecision = decision
    const pauseFile = await this.pauseFileExists()
    this.pausedView = pauseFile
      ? { active: true, reason: 'PAUSE-Datei vorhanden – Not-Aus durch Julius', until: null }
      : decision.mode === 'paused'
        ? { active: true, reason: decision.reason, until: decision.until ? nowStamp(decision.until) : null }
        : { active: false, reason: null, until: null }

    if (this.deps.triggers !== false && !this.deps.only) tasks = await this.fireTriggers(tasks, now)
    this.publog = await loadPublogCached(this.cfg.vaultRoot, this.publog)

    this.updateCounters(tasks, now)
    await this.readShopCounter(now)
    await this.refreshZentrale(now)
    await this.refreshProduktion(now)

    const canStart = this.health.ok && !pauseFile && decision.mode !== 'paused'
    if (canStart) {
      const available = new Set([...this.availability.entries()].filter(([, a]) => a.available).map(([n]) => n))
      const runningTasks = new Map([...this.running.entries()].map(([id, r]) => [id, r.task]))
      const picked = selectRunnable(tasks, {
        available,
        allowedTiers: decision.allowedTiers,
        running: runningTasks,
        maxParallel: this.cfg.maxParallel,
      })
      for (const t of picked) {
        try {
          await this.startWorker(t, now)
        } catch (err) {
          this.pushTicker(`${t.fm.id}: konnte nicht gestartet werden – ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (picked.length) tasks = await this.deps.repo.list()
    }

    if (!this.deps.only) await this.archiveIfDue(now)
    this.updateFabrik(tasks, now)
    await this.publish(now, tasks)
  }

  /** Läuft die Fabrik? Nach dem Starten der Arbeiter gerechnet, damit „leer“ wirklich leer heißt. */
  private updateFabrik(tasks: Task[], now: Date): void {
    const available = new Map([...this.availability.entries()].map(([n, a]) => [n, a.available]))
    this.fabrik = computeFabrik({
      tasks,
      available,
      running: this.running.size,
      paused: { active: this.pausedView.active, reason: this.pausedView.reason },
      budgetMode: this.lastDecision?.mode ?? null,
      healthOk: this.health.ok,
      prevLeerSeit: this.fabrik.leerSeit,
      now,
      nowStamp: nowStamp(now),
      lastPlannerCreated: this.state.lastPlannerCreated,
      produktionGeladen: this.deps.stations.some((s) => s.name === 'produktion'),
    })
  }

  /** Medien-Galerie (Assets/content, alle 30 s) und Stimme (`stimme.json`, nach mtime) für die Welt. */
  private async refreshProduktion(now: Date): Promise<void> {
    try {
      this.medien = await listMedienCached(this.cfg.vaultRoot, this.medien, now)
    } catch {
      // Galerie ist nur Anzeige – ein Lesefehler stoppt nichts
    }
    try {
      this.stimme = await loadStimmeCached(this.cfg.dataDir, this.stimme)
    } catch {
      // dito
    }
  }

  /** Kalender für die Welt: 3 Tage zurück, 7 voraus, aus der Veröffentlichungs-Liste. */
  private kalender(now: Date): KalenderTag[] {
    const entries = this.publog?.value.entries ?? []
    const tage: KalenderTag[] = []
    for (let i = -KALENDER_TAGE_ZURUECK; i < KALENDER_TAGE_VORAUS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      const datum = todayStamp(d)
      const eintraege = entries
        .filter((e) => e.date.startsWith(datum))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({ zeit: e.date.slice(11, 16), netzwerk: e.network, typ: e.type, status: e.status, text: e.text, url: e.url }))
      tage.push({ datum, heute: i === 0, eintraege })
    }
    return tage
  }

  private async applyRow(r: PatchRow): Promise<void> {
    try {
      await this.deps.repo.update(r.id, r.patch, { log: r.log })
      this.pushTicker(`${r.id}: ${r.log}`)
    } catch (err) {
      this.pushTicker(`${r.id}: Änderung fehlgeschlagen – ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Stations with autopilot < 2 always start with needs_approval, whoever created the task (spec §11). */
  private enforceApprovalOnNewTasks(tasks: Task[]): PatchRow[] {
    const rows: PatchRow[] = []
    const known = new Set(this.state.known)
    for (const t of tasks) {
      if (known.has(t.fm.id)) continue
      known.add(t.fm.id)
      const st = this.deps.stations.find((s) => s.name === t.fm.station)
      if (!st) continue
      if (this.autopilotOf(st) < 2 && OUTWARD_STATIONS.has(st.name) && t.fm.status === 'todo' && t.fm.attempts === 0 && !t.fm.needs_approval) {
        rows.push({ id: t.fm.id, patch: { needs_approval: true }, log: `Freigabe nötig (Station ${st.display} auf Autopilot ${this.autopilotOf(st)})` })
      }
    }
    // keep the set bounded to tasks that still exist
    this.state.known = tasks.map((t) => t.fm.id)
    return rows
  }

  // ---------------------------------------------------------------------------

  private async startWorker(task: Task, now: Date): Promise<void> {
    const station = this.deps.stations.find((s) => s.name === task.fm.station)
    if (!station) return
    const attempts = (task.fm.attempts ?? 0) + 1
    const updated = await this.deps.repo.update(
      task.fm.id,
      { status: 'doing', started: nowStamp(now), attempts },
      { log: `Lauf ${attempts} gestartet` },
    )
    this.deps.guard.noteRunStart()

    const autopilot = this.autopilotOf(station)
    const inflightPublishing = [...this.running.values()].filter((r) => r.publishing).length
    const publishAllowed = this.today.posts + inflightPublishing < this.totalPostLimit()
    // Nie wieder Dubletten: the content station may only publish against a fresh Veröffentlichungs-Liste.
    const staleLog = station.name === 'content' && this.today.publogStale
    const gated = autopilot === 0 || updated.fm.needs_approval || !publishAllowed || staleLog
    const publishing = !gated && OUTWARD_STATIONS.has(station.name)
    if (staleLog && autopilot > 0 && !updated.fm.needs_approval) await this.ensurePublogSync(now)

    const entry: Running = { task: updated, station, startedAt: nowStamp(now), tokens: 0, rateLimited: false, publishing }
    this.running.set(task.fm.id, entry)
    const why = staleLog && autopilot > 0 && !updated.fm.needs_approval ? ' (nur Entwurf – Veröffentlichungs-Liste älter als 12 h, Zentrale gleicht ab)' : gated ? ' (nur Entwurf)' : ''
    this.pushTicker(`${station.display} · ${task.fm.title} · Lauf ${attempts} gestartet${why}`)

    const timeoutMs = station.timeoutMin * 60_000
    const extra: Record<string, string> = { LIMITLESS_DAILY_SHOP_CHANGE_LIMIT: String(this.cfg.dailyShopChangeLimit) }
    if (this.cfg.fakeClaude && !this.cfg.env.LIMITLESS_CLAUDE_BIN) {
      extra.LIMITLESS_CLAUDE_BIN = process.execPath
      extra.LIMITLESS_CLAUDE_PREARGS = join(this.cfg.repoRoot, 'supervisor', 'test', 'fixtures', 'fake-claude.mjs')
      extra.FAKE_CLAUDE_FIXTURE = this.cfg.env.FAKE_CLAUDE_FIXTURE ?? join(this.cfg.repoRoot, 'supervisor', 'test', 'fixtures', 'stream', 'success.jsonl')
    }
    const runEnv = workerEnv(this.cfg.env, extra)

    void this.deps
      .run(
        updated,
        station,
        { repoRoot: this.cfg.repoRoot, vaultRoot: this.cfg.vaultRoot, dataDir: this.cfg.dataDir, tiers: this.cfg.tiers },
        { onEvent: (e) => this.handleStreamEvent(task.fm.id, e) },
        { timeoutMs, cwd: this.cfg.repoRoot, env: runEnv, publishAllowed, gated },
      )
      .then((summary) => this.finishWorker(task.fm.id, summary))
      .catch((err: unknown) => {
        this.pushTicker(`${task.fm.id}: Runner-Fehler ${err instanceof Error ? err.message : String(err)}`)
        return this.finishWorker(task.fm.id, {
          ok: false,
          reason: 'error',
          subtype: null,
          isError: true,
          apiErrorStatus: null,
          costUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
          cacheRead: 0,
          cacheWrite: 0,
          modelUsed: null,
          resultText: '',
          permissionDenials: [],
          sessionId: null,
          durationMs: 0,
        })
      })
      .catch((err: unknown) => this.pushTicker(`${task.fm.id}: Abschluss fehlgeschlagen – ${err instanceof Error ? err.message : String(err)}`))
  }

  /** Stream events from a worker; rate-limit signals go straight to the guard (spec §6.2). */
  handleStreamEvent(taskId: string, e: StreamEvent): void {
    const r = this.running.get(taskId)
    if (e.kind === 'rate_limit') {
      this.deps.guard.observe(e.signal).catch((err: unknown) => this.pushTicker(`Budget-Wächter: ${err instanceof Error ? err.message : String(err)}`))
      if (e.signal.status === 'rejected' && r) r.rateLimited = true
      if (e.signal.status !== 'allowed') this.pushTicker(`Claude-Limit: ${e.signal.status} (${e.signal.window})`)
    } else if (e.kind === 'api_retry' && (e.error === 'rate_limit' || e.status === 429) && r) {
      this.pushTicker(`${r.station.display}: Wiederholung wegen Limit`)
    } else if (e.kind === 'init' && e.mcpErrors.length && r) {
      this.pushTicker(`${r.station.display}: MCP-Fehler ${e.mcpErrors.join('; ')}`)
    } else if (e.kind === 'permission_denied' && r) {
      this.pushTicker(`${r.station.display}: Werkzeug ${e.tool} verweigert`)
    }
  }

  private async finishWorker(taskId: string, summary: RunSummary): Promise<void> {
    const r = this.running.get(taskId)
    if (!r) return
    try {
      await this.settleWorker(taskId, r, summary)
    } finally {
      // Only now is the note no longer `doing` from our side; deleting earlier
      // would let recoverOrphans() reset the task while we are still writing it.
      this.running.delete(taskId)
    }
    const tasks = await this.deps.repo.list()
    this.publog = await loadPublogCached(this.cfg.vaultRoot, this.publog)

    this.updateCounters(tasks, this.deps.clock())
    await this.publish(this.deps.clock(), tasks)
  }

  private async settleWorker(taskId: string, r: Running, summary: RunSummary): Promise<void> {
    const now = this.deps.clock()
    const fresh = (await this.deps.repo.get(taskId)) ?? r.task
    const fm = fresh.fm
    const model = summary.modelUsed ?? fm.model_used ?? null

    await this.deps.ledger.append({
      ts: nowStamp(now),
      task: taskId,
      station: r.station.name,
      model: model ?? 'unbekannt',
      family: familyOf(model ?? ''),
      tokens_in: summary.tokensIn,
      tokens_out: summary.tokensOut,
      cache_read: summary.cacheRead,
      cache_write: summary.cacheWrite,
      cost_usd: summary.costUsd,
      duration_ms: summary.durationMs,
      result: summary.reason,
    })

    const totals = {
      cost_usd: Math.round(((fm.cost_usd ?? 0) + summary.costUsd) * 1e6) / 1e6,
      tokens_in: (fm.tokens_in ?? 0) + summary.tokensIn,
      tokens_out: (fm.tokens_out ?? 0) + summary.tokensOut,
      model_used: model,
    }
    const tokens = summary.tokensIn + summary.tokensOut
    const logTail = `${de(tokens)} Tokens · ${usd(summary.costUsd)} · ${summary.reason}`

    // Julius changed the status while the worker ran (cancelled, done, …): keep his
    // decision, only record what the run cost.
    if (fm.status !== 'doing') {
      await this.deps.repo.update(taskId, totals, { log: `Lauf beendet (${summary.reason}), Status „${fm.status}“ von Julius bleibt · ${logTail}` })
      this.pushTicker(`${r.station.display} · ${fm.title} · Status ${fm.status} von Julius beibehalten`)
      return
    }

    if (summary.ok) {
      const toReview = r.task.fm.needs_approval
      const patch = toReview
        ? { ...totals, status: 'review' as const }
        : { ...totals, status: 'done' as const, completed: nowStamp(now) }
      const section =
        !readSection(fresh.body, 'Ergebnis') && summary.resultText
          ? { heading: 'Ergebnis', content: summary.resultText }
          : undefined
      await this.deps.repo.update(taskId, patch, { log: logTail, section })
      this.pushTicker(`${r.station.display} · ${fm.title} · ${toReview ? 'wartet auf Freigabe' : 'erledigt'} · ${usd(summary.costUsd)}`)
      return
    }

    const undoAttempt = { ...totals, status: 'todo' as const, started: null, attempts: Math.max(0, (fm.attempts ?? 1) - 1) }
    if (summary.reason === 'rate_limited' || r.rateLimited) {
      await this.deps.repo.update(taskId, undoAttempt, { log: `Claude-Limit erreicht – Versuch zählt nicht · ${logTail}` })
      this.pushTicker(`${r.station.display} · ${fm.title} · Limit, später erneut`)
      return
    }
    if (summary.reason === 'auth') {
      // Not the task's fault: no attempt counted, workers stop until the login is fixed.
      await this.deps.repo.update(taskId, undoAttempt, { log: `Claude-Login fehlt – Versuch zählt nicht · ${logTail}` })
      this.health = { ok: false, problems: ['Claude-Login abgelaufen oder fehlt – bitte `claude` im Terminal starten und mit dem claude.ai-Konto einloggen'] }
      this.pushTicker('Claude-Login abgelaufen – Arbeiter angehalten, bis der Login erneuert ist')
      return
    }

    const blocked = (fm.attempts ?? 1) >= (fm.max_attempts ?? 3)
    const denials = summary.permissionDenials.length ? ` · verweigerte Werkzeuge: ${summary.permissionDenials.join(', ')}` : ''
    await this.deps.repo.update(
      taskId,
      blocked ? { ...totals, status: 'blocked', started: null } : { ...totals, status: 'todo', started: null },
      { log: `${blocked ? 'blockiert' : 'fehlgeschlagen'}: ${summary.reason}${denials} · ${logTail}` },
    )
    if (blocked) {
      await this.deps.repo.create({
        title: `Blockiert: ${fm.title}`,
        station: 'manual',
        tier: 'cheap',
        priority: 1,
        origin: 'system',
        parent: taskId,
        auftrag: `Die Aufgabe [[Aufgaben/${taskId}|${fm.title}]] ist nach ${fm.attempts} Versuchen blockiert (Grund: ${summary.reason}${denials}). Bitte Protokoll lesen, Ursache beheben und die Aufgabe auf \`status: todo\` setzen oder abbrechen.`,
      })
      this.pushTicker(`${r.station.display} · ${fm.title} · blockiert → Aufgabe für Julius angelegt`)
    } else {
      this.pushTicker(`${r.station.display} · ${fm.title} · fehlgeschlagen (${summary.reason}), erneut später`)
    }
  }

  // ---------------------------------------------------------------------------

  private async fireTriggers(tasks: Task[], now: Date): Promise<Task[]> {
    let created = false
    const has = (pred: (t: Task) => boolean): boolean => tasks.some(pred)

    // Planner: keep the queue filled – only when thin, at most every 2 h (spec §5.1 step 6).
    const openNonManual = tasks.filter((t) => t.fm.status === 'todo' && t.fm.station !== 'manual').length
    const plannerOpen = has((t) => t.fm.station === 'planer' && (t.fm.status === 'todo' || t.fm.status === 'doing'))
    const last = this.state.lastPlannerCreated ? new Date(this.state.lastPlannerCreated).getTime() : null
    const since = last === null ? Infinity : now.getTime() - last
    const plannerAvailable = this.availability.get('planer')?.available ?? false
    if (plannerAvailable && !plannerOpen && openNonManual < PLANNER_MIN_OPEN && since >= PLANNER_MIN_INTERVAL_MS) {
      await this.deps.repo.create({
        title: 'Planung: Warteschlange füllen',
        station: 'planer',
        tier: 'standard',
        priority: 1,
        origin: 'system',
        auftrag: `Prüfe Strategie, Kennzahlen und Kalender und lege die nächsten Aufgaben an (Wertleiter in Strategie.md). Offene Aufgaben: ${openNonManual}. Höchstens ${this.cfg.maxOpenPlannerTasks} offene Aufgaben insgesamt.`,
      })
      this.state.lastPlannerCreated = nowStamp(now)
      this.pushTicker('Planer angestoßen: Warteschlange füllen')
      created = true
    } else if (plannerAvailable && !plannerOpen && since >= PLANNER_EMPTY_INTERVAL_MS && this.lastDecision?.mode !== 'paused' && !this.pausedView.active) {
      // Die Fabrik darf nie stillstehen: nichts startbar und niemand bei der Arbeit → Planer sofort (alle 30 min).
      const available = new Map([...this.availability.entries()].map(([n, a]) => [n, a.available]))
      if (this.running.size === 0 && runnableTasks(tasks, available).length === 0) {
        await this.createPlannerTask(now, 'leer')
        this.pushTicker('Fabrik leer – Planer füllt die Warteschlange')
        created = true
      }
    }

    const fire = async (key: string, cond: boolean, make: () => Promise<void>): Promise<void> => {
      if (!cond || this.state.fired[key]) return
      await make()
      this.state.fired[key] = nowStamp(now)
      created = true
    }
    const day = todayStamp(now)
    const week = isoWeek(now)
    const minutes = now.getHours() * 60 + now.getMinutes()
    const berichterOk = this.availability.get('berichter')?.available ?? false

    // Zentrale: fresh numbers every 6 hours (slot = 0–3), only while nothing of that kind is open.
    const kennzahlenOk = this.availability.get('kennzahlen')?.available ?? false
    const kennzahlenOpen = has((t) => t.fm.station === 'kennzahlen' && (t.fm.status === 'todo' || t.fm.status === 'doing'))
    const slot = Math.floor(now.getHours() / KENNZAHLEN_EVERY_HOURS)
    await fire(`kennzahlen:${day}-${slot}`, kennzahlenOk && !kennzahlenOpen, () =>
      this.createKennzahlenTask(now, 3).then(() => this.pushTicker('Zentrale: Kennzahlen werden gesammelt')),
    )

    await fire(`tagesbericht:${day}`, berichterOk && minutes >= 7 * 60 + 30, () =>
      this.deps.repo
        .create({
          title: 'Tagesbericht',
          station: 'berichter',
          tier: 'cheap',
          priority: 3,
          origin: 'system',
          auftrag: `Schreibe den Tagesbericht für ${day} nach Berichte/${day}-Tag.md.`,
        })
        .then(() => this.pushTicker('Tagesbericht angestoßen')),
    )
    await fire(`wochenbericht:${week}`, berichterOk && now.getDay() === 4 && minutes >= 17 * 60, () =>
      this.deps.repo
        .create({
          title: 'Wochenbericht',
          station: 'berichter',
          tier: 'cheap',
          priority: 2,
          origin: 'system',
          auftrag: `Schreibe den Wochenbericht für ${week} nach Berichte/${week}-Woche.md – vor dem Wochen-Reset um 18:00.`,
        })
        .then(() => this.pushTicker('Wochenbericht angestoßen')),
    )
    // Tagesproduktion: um 05:30 plant der Planer die Beiträge für morgen (Station `produktion` nötig).
    const produktionGeladen = this.deps.stations.some((s) => s.name === 'produktion')
    await fire(`tagesproduktion:${day}`, plannerAvailable && minutes >= PRODUKTION_TRIGGER_MINUTES, async () => {
      if (!produktionGeladen) {
        this.pushTicker('Tagesproduktion: Station „produktion“ nicht geladen – heute keine automatische Produktionsplanung')
        return
      }
      await this.createPlannerTask(now, 'produktion')
      this.pushTicker('Tagesproduktion angestoßen: Planer legt die Beiträge für morgen an')
    })

    await fire(`wochenstrategie:${week}`, plannerAvailable && now.getDay() === 3 && minutes >= 20 * 60, () =>
      this.deps.repo
        .create({
          title: 'Wochenstrategie',
          station: 'planer',
          tier: 'premium',
          priority: 1,
          origin: 'system',
          auftrag: 'Bewerte die Woche anhand der Kennzahlen, passe Wertleiter und Content-Mix in Strategie.md und Pläne/Wochenplan.md an und begründe jede Änderung.',
        })
        .then(() => this.pushTicker('Wochenstrategie angestoßen')),
    )

    if (created) {
      await this.saveState()
      return this.deps.repo.list()
    }
    return tasks
  }

  /**
   * Planer-Aufgabe anlegen. `leer` = die Fabrik steht (Welt-Knopf oder 30-min-Regel), `produktion` =
   * der 05:30-Trigger für morgen. Beide verweisen auf die Soll-Mengen in Strategie.md und die
   * Produktionsnotiz der Station `produktion` (Fork A legt sie an; der Planer prüft selbst, ob sie da ist).
   */
  private async createPlannerTask(now: Date, art: 'leer' | 'produktion'): Promise<void> {
    const morgen = todayStamp(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const auftrag =
      art === 'produktion'
        ? `Plane die Tagesproduktion für ${morgen}: je Netzwerk die Soll-Menge aus Strategie.md (Frontmatter daily_targets, Limits daily_post_limits) als Aufgaben für die Station produktion (Reels, Karussells, Stimme) und danach content (Einplanen). Formate, Slots und Regeln stehen in Pläne/Produktion.md – fehlt die Notiz, plane nach Strategie.md und vermerke das. Dubletten-Schutz: posts.js check vor jeder Aufgabe.`
        : `Die Fabrik steht: keine startbare Aufgabe, niemand arbeitet. Fülle die Warteschlange sofort – zuerst die Tagesproduktion für heute und ${morgen} laut Strategie.md (daily_targets, daily_post_limits) und Pläne/Produktion.md (fehlt die Notiz: nach Strategie.md planen und das vermerken), dann die Wertleiter. Höchstens ${this.cfg.maxOpenPlannerTasks} offene Aufgaben insgesamt. Dubletten-Schutz: posts.js check vor jeder Aufgabe.`
    await this.deps.repo.create({
      title: art === 'produktion' ? `Produktion für ${morgen} planen` : 'Planung: Fabrik leer – Warteschlange füllen',
      station: 'planer',
      tier: 'standard',
      priority: 1,
      origin: 'system',
      auftrag,
      kontext: '[[Strategie]] · [[Pläne/Produktion]] · [[Pläne/Content-Kalender]] · [[Pläne/Veröffentlicht]] · [[Status]]',
    })
    this.state.lastPlannerCreated = nowStamp(now)
  }

  /** Welt-Knopf „Planer jetzt“: Planer-Aufgabe anlegen, wenn keine offen ist. */
  async planNow(): Promise<{ ok: boolean; reason: string | null }> {
    const plannerAvailable = this.availability.get('planer')?.available ?? false
    if (!plannerAvailable) return { ok: false, reason: 'Station Planung nicht verfügbar' }
    const tasks = await this.deps.repo.list()
    if (tasks.some((t) => t.fm.station === 'planer' && (t.fm.status === 'todo' || t.fm.status === 'doing'))) {
      return { ok: false, reason: 'Planer läuft bereits' }
    }
    const now = this.deps.clock()
    await this.createPlannerTask(now, 'leer')
    await this.saveState()
    this.pushTicker('Planer angestoßen (Welt): Warteschlange füllen')
    return { ok: true, reason: null }
  }

  private async createKennzahlenTask(now: Date, priority: 1 | 2 | 3 | 4): Promise<void> {
    await this.deps.repo.create({
      title: 'Kennzahlen sammeln (Zentrale)',
      station: 'kennzahlen',
      tier: 'cheap',
      priority,
      origin: 'system',
      auftrag: `Hole die aktuellen Kennzahlen aus Metricool, Shopify und Printify (letzte 7 und 28 Tage, Stand ${nowStamp(now).replace('T', ' ').slice(0, 16)}) und schreibe Kennzahlen.md neu.`,
      kontext: '[[Marke/Kanäle]] · [[Marke/Produkte]] · [[Kennzahlen]]',
    })
  }

  /** Kennzahlen.md (every tick, by mtime) and Printify (hourly, in the background). */
  private async refreshZentrale(now: Date): Promise<void> {
    this.kennzahlen = await loadKennzahlen(this.cfg.vaultRoot, this.kennzahlen)
    const read = this.deps.printify ?? ((env, at) => printifySummary(env, undefined, at))
    if (!this.printifyBusy && now.getTime() - this.printifyAt >= PRINTIFY_EVERY_MS) {
      this.printifyBusy = true
      this.printifyAt = now.getTime()
      read(this.cfg.env, now)
        .then((p) => {
          const was = this.printify
          this.printify = p
          if (p.ok && !was?.ok) this.pushTicker('Zentrale: Printify verbunden')
          if (!p.ok && was?.ok) this.pushTicker(`Zentrale: Printify nicht erreichbar – ${p.fehler}`)
        })
        .catch((err: unknown) => {
          this.printify = { ...(this.printify ?? { ok: false, fehler: null, stand: nowStamp(now), shop: null, auftraege: { offen: 0, in_produktion: 0, versendet_28t: 0, gesamt_28t: 0, umsatz_28t: 0, kosten_28t: 0, marge_28t: 0, mit_problemen: 0 }, produkte: { gesamt: 0, sichtbar: 0, marge_durchschnitt: null, marge_min: null, marge_max: null } }), ok: false, fehler: err instanceof Error ? err.message : String(err) }
        })
        .finally(() => {
          this.printifyBusy = false
        })
    }
  }

  /** Welt button „Kennzahlen aktualisieren“: one open kennzahlen task at a time. */
  async refreshKennzahlen(): Promise<{ ok: boolean; reason: string | null }> {
    const now = this.deps.clock()
    if (!(this.availability.get('kennzahlen')?.available ?? false)) {
      return { ok: false, reason: this.availability.get('kennzahlen')?.reason ?? 'Station Zentrale nicht verfügbar' }
    }
    const tasks = await this.deps.repo.list()
    if (tasks.some((t) => t.fm.station === 'kennzahlen' && (t.fm.status === 'todo' || t.fm.status === 'doing'))) {
      return { ok: true, reason: 'läuft bereits' }
    }
    await this.createKennzahlenTask(now, 1)
    this.pushTicker('Zentrale: Aktualisierung angestoßen (Julius)')
    this.printifyAt = 0 // next tick re-reads Printify too
    return { ok: true, reason: null }
  }

  private async scanInbox(now: Date): Promise<void> {
    const dir = join(this.cfg.vaultRoot, 'Inbox')
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    let changed = false
    for (const name of entries.sort()) {
      if (name.startsWith('.') || name.toLowerCase() === 'readme.md') continue
      if (this.state.inboxSeen.includes(name)) continue
      try {
        if (!(await stat(join(dir, name))).isFile()) continue
      } catch {
        continue
      }
      await this.deps.repo.create({
        title: `Inbox einordnen: ${name}`,
        station: 'planer',
        tier: 'standard',
        priority: 2,
        origin: 'inbox',
        auftrag: `Lies die neue Inbox-Datei, ordne den Inhalt ein (Marke, Strategie, Ideen, neue Station?) und übertrage ihn an die richtige Stelle im Vault. Lege bei Bedarf Folgeaufgaben an. Lösche die Datei nicht.`,
        kontext: `Datei: Inbox/${name} (eingegangen ${nowStamp(now)})`,
      })
      this.state.inboxSeen.push(name)
      this.pushTicker(`Inbox: ${name} → Planer`)
      changed = true
    }
    if (changed) await this.saveState()
  }

  private updateCounters(tasks: Task[], now: Date): void {
    const counts: Record<TaskStatus, number> = { todo: 0, doing: 0, review: 0, blocked: 0, done: 0, cancelled: 0 }
    const day = todayStamp(now)
    let posts = 0
    const waiting: SupervisorState['waiting'] = []
    for (const t of tasks) {
      counts[t.fm.status] = (counts[t.fm.status] ?? 0) + 1
      if (t.fm.published_at && String(t.fm.published_at).startsWith(day)) posts++
      if (t.fm.status === 'review' || (t.fm.station === 'manual' && t.fm.status === 'todo')) {
        waiting.push({ id: t.fm.id, title: t.fm.title, station: t.fm.station })
      }
    }
    this.counts = counts
    const entries = this.publog?.value.entries ?? []
    const byNetwork: Record<string, { used: number; limit: number }> = {}
    for (const [network, limit] of Object.entries(this.limits)) {
      if (network === 'default') continue
      byNetwork[network] = { used: countForDay(entries, network, day), limit }
    }
    const fromLog = Object.values(byNetwork).reduce((s, v) => s + v.used, 0)
    this.today.byNetwork = byNetwork
    this.today.posts = Math.max(posts, fromLog)
    this.today.publogSynced = this.publog?.value.synced ?? null
    this.today.publogStale = isStale(this.publog?.value ?? null, now)
    this.waiting = waiting
  }

  /** Sum of the per-network limits – the overall cap the prompt line "Veröffentlichen heute erlaubt" reflects. */
  private totalPostLimit(): number {
    const configured = Object.keys(this.cfg.dailyPostLimits ?? {}).length > 0 || Object.keys(this.limitOverride).length > 0
    const t = totalLimit(this.limits)
    return configured && t > 0 ? t : this.cfg.dailyPostLimit
  }

  private async readShopCounter(now: Date): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(join(this.cfg.dataDir, 'counters.json'), 'utf8')) as { date?: string; shopChanges?: number }
      this.today.shopChanges = raw.date === todayStamp(now) ? Number(raw.shopChanges ?? 0) : 0
    } catch {
      this.today.shopChanges = 0
    }
  }

  private async archiveIfDue(now: Date): Promise<void> {
    const day = todayStamp(now)
    if (this.state.lastArchive === day) return
    const moved = await this.deps.repo.archiveOld(ARCHIVE_DAYS)
    if (moved.length) this.pushTicker(`${moved.length} alte Aufgaben archiviert`)
    this.state.lastArchive = day
    await this.saveState()
  }

  /** `Strategie.md` frontmatter `autopilot: {station: 0|1|2}` overrides station.yaml (betrieb.md). */
  private async loadAutopilotOverrides(): Promise<void> {
    const next = new Map<string, 0 | 1 | 2>()
    this.limitOverride = {}
    try {
      const { data } = parseNote(await readFile(join(this.cfg.vaultRoot, 'Strategie.md'), 'utf8'))
      this.limitOverride = parseLimits(data.daily_post_limits)
      const ap = data.autopilot
      if (ap && typeof ap === 'object' && !Array.isArray(ap)) {
        for (const [name, v] of Object.entries(ap as Record<string, unknown>)) {
          const n = Number(v)
          if (n === 0 || n === 1 || n === 2) next.set(name, n)
        }
      }
    } catch {
      // no Strategie.md yet – station.yaml values apply
    }
    this.autopilotOverride = next
    this.limits = await loadLimits(this.cfg.dailyPostLimits, '')
    this.limits = { ...this.limits, ...this.limitOverride }
  }

  /** A stale Veröffentlichungs-Liste blocks publishing; ask the Zentrale to sync it (once per hour). */
  private async ensurePublogSync(now: Date): Promise<void> {
    const key = `publog-sync:${todayStamp(now)}-${now.getHours()}`
    if (this.state.fired[key]) return
    const open = (await this.deps.repo.list()).some((t) => t.fm.station === 'kennzahlen' && (t.fm.status === 'todo' || t.fm.status === 'doing'))
    this.state.fired[key] = nowStamp(now)
    await this.saveState()
    if (open) return
    await this.createKennzahlenTask(now, 1)
    this.pushTicker('Zentrale: Veröffentlichungs-Liste wird mit Metricool abgeglichen (Dubletten-Schutz)')
  }

  private async refreshAvailability(): Promise<void> {
    const next = new Map<string, Availability>()
    for (const st of this.deps.stations) next.set(st.name, await checkAvailability(st, this.cfg.env, this.deps.probes))
    this.availability = next
  }

  private async pauseFileExists(): Promise<boolean> {
    try {
      await access(join(this.cfg.vaultRoot, 'PAUSE'))
      return true
    } catch {
      return false
    }
  }

  private async publish(now: Date, tasks?: Task[]): Promise<void> {
    if (tasks) this.updateCounters(tasks, now)
    const s = this.getState()
    try {
      const md = renderStatusMd(s)
      // Only rewrite Status.md when something other than the timestamp changed (sync/git noise).
      const body = md.replace(/^updated: .*$/m, '')
      if (body !== this.lastStatusBody) {
        await writeFileAtomic(join(this.cfg.vaultRoot, 'Status.md'), md)
        this.lastStatusBody = body
      }
    } catch (err) {
      this.deps.log?.(`Status.md konnte nicht geschrieben werden: ${err instanceof Error ? err.message : String(err)}`)
    }
    this.deps.onState?.(s)
  }

  private lastSavedState = ''

  private async saveState(): Promise<void> {
    const text = JSON.stringify(this.state, null, 2)
    await writeFileAtomic(this.stateFile, text)
    this.lastSavedState = text
  }

  private async saveStateIfChanged(): Promise<void> {
    if (JSON.stringify(this.state, null, 2) !== this.lastSavedState) await this.saveState()
  }

  private pushTicker(line: string): void {
    const now = this.deps.clock()
    const p = (n: number): string => String(n).padStart(2, '0')
    this.ticker.push(`${p(now.getHours())}:${p(now.getMinutes())} ${line}`)
    if (this.ticker.length > TICKER_MAX) this.ticker.splice(0, this.ticker.length - TICKER_MAX)
    this.deps.log?.(line)
  }

  // ---------------------------------------------------------------------------

  getState(): SupervisorState {
    const now = this.deps.clock()
    const workers: WorkerView[] = [...this.running.values()].map((r) => ({
      taskId: r.task.fm.id,
      title: r.task.fm.title,
      station: r.station.name,
      model: this.cfg.tiers[r.task.fm.tier as Tier]?.model ?? r.task.fm.tier,
      startedAt: r.startedAt,
      tokens: r.tokens,
    }))
    return {
      now: nowStamp(now),
      vaultName: this.cfg.vaultName,
      health: this.health,
      paused: this.pausedView,
      decision: this.lastDecision,
      workers,
      counts: this.counts,
      stations: this.deps.stations.map((st) => {
        const a = this.availability.get(st.name)
        return { name: st.name, display: st.display, available: a?.available ?? false, reason: a?.reason ?? null, autopilot: this.autopilotOf(st) }
      }),
      today: {
        posts: this.today.posts,
        postLimit: this.totalPostLimit(),
        byNetwork: this.today.byNetwork,
        publogSynced: this.today.publogSynced,
        publogStale: this.today.publogStale,
        shopChanges: this.today.shopChanges,
        shopLimit: this.cfg.dailyShopChangeLimit,
      },
      nextWeekReset: nowStamp(nextWeekReset(now, this.cfg.weekReset)),
      waiting: this.waiting,
      ticker: [...this.ticker],
      zentrale: {
        kennzahlen: this.kennzahlen?.value ?? null,
        printify: this.printify,
        aktualisierung_laeuft: [...this.running.values()].some((r) => r.station.name === 'kennzahlen'),
        links: ZENTRALE_LINKS,
      },
      fabrik: this.fabrik,
      kalender: { tage: this.kalender(now), heute: this.today.byNetwork },
      medien: this.medien?.value ?? [],
      stimme: this.stimme?.value ?? STIMME_LEER,
    }
  }

  async approve(id: string): Promise<void> {
    const t = await this.deps.repo.get(id)
    if (!t) return
    if (t.fm.status === 'review' || t.fm.needs_approval) {
      await this.deps.repo.update(id, { status: 'todo', needs_approval: false }, { log: 'Freigabe durch Julius (Welt)' })
      this.pushTicker(`${t.fm.title}: freigegeben`)
    }
  }

  async pause(): Promise<void> {
    await writeFile(join(this.cfg.vaultRoot, 'PAUSE'), `Pause durch Julius am ${nowStamp(this.deps.clock())}\n`, 'utf8')
    this.pushTicker('Pause (Not-Aus) aktiviert')
  }

  async resume(): Promise<void> {
    await rm(join(this.cfg.vaultRoot, 'PAUSE'), { force: true })
    this.pushTicker('Pause aufgehoben')
  }
}
