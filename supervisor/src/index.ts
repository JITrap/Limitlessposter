// Entry point of the Aufseher. Started by Windows Task Scheduler at logon
// (scripts/install.ps1) or manually with `npm start` from the repo root.
import { execFile } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import { loadConfig } from './config.js'
import { preflight, type PreflightResult } from './preflight.js'
import { TaskRepo, nowStamp, todayStamp } from './vault/tasks.js'
import { Ledger } from './budget/ledger.js'
import { BudgetGuard } from './budget/guard.js'
import { loadStations } from './stations/loader.js'
import { runWorker } from './runner/claude.js'
import { Supervisor } from './scheduler.js'
import { defaultPublicDir, startWorld, type WorldHandle } from './world/server.js'
import { writeStatus, type SupervisorState } from './status/writer.js'

const here = dirname(fileURLToPath(import.meta.url))
// dist/index.js → supervisor/dist → repo root; src/index.ts (tsx) → supervisor/src → repo root
const repoRoot = resolve(here, '..', '..')

async function logLine(dataDir: string, line: string): Promise<void> {
  const dir = join(dataDir, 'logs')
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, `${todayStamp(new Date())}.log`), `${nowStamp(new Date())} ${line}\n`, 'utf8')
}

function exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((ok) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20_000 }, (err, stdout) => {
      const code = err && typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as NodeJS.ErrnoException).code as unknown as number) : err ? 1 : 0
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return ok({ code: 127, stdout: '' })
      ok({ code, stdout: String(stdout ?? '') })
    })
  })
}

async function httpOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const smoke = process.argv.includes('--smoke')
  const loaded = await loadConfig(repoRoot)
  // A smoke run must never touch the live supervisor's data (state, ledger, counters):
  // it gets its own data dir, and refuses to run while the live world is answering.
  const cfg = smoke ? { ...loaded, dataDir: join(loaded.dataDir, 'smoke') } : loaded
  const log = (line: string): void => void logLine(cfg.dataDir, line).catch(() => {})

  if (smoke && (await httpOk(`http://127.0.0.1:${cfg.worldPort}/api/state`))) {
    console.error(`Der Aufseher läuft bereits (Welt antwortet auf Port ${cfg.worldPort}). Bitte zuerst stoppen (Stop-ScheduledTask LimitlessOS) oder den Rauch-Test über die Welt beobachten.`)
    process.exit(1)
  }

  const runPreflight = (): Promise<PreflightResult> => preflight(cfg, { exec, env: cfg.env, homeDir: homedir() })
  const pre: PreflightResult = await runPreflight()
  for (const p of pre.problems) log(`PROBLEM: ${p}`)
  for (const w of pre.warnings) log(`Hinweis: ${w}`)

  const repo = new TaskRepo(cfg.vaultRoot)
  const ledger = new Ledger(join(cfg.dataDir, 'ledger.jsonl'))
  const guard = new BudgetGuard(ledger, cfg, join(cfg.dataDir, 'guard.json'))
  await guard.load()
  const stations = await loadStations(cfg.repoRoot)

  // Project `.mcp.json` servers are the ones workers can use (cwd = repo).
  const mcpConfigured = async (name: string): Promise<boolean> => {
    try {
      const { readFile } = await import('node:fs/promises')
      const raw = JSON.parse(await readFile(join(cfg.repoRoot, '.mcp.json'), 'utf8')) as { mcpServers?: Record<string, unknown> }
      return Boolean(raw.mcpServers?.[name])
    } catch {
      return false
    }
  }

  let world: WorldHandle | null = null
  let smokeTaskId: string | undefined
  if (smoke) {
    if (!pre.ok) {
      console.error('Vorab-Prüfung fehlgeschlagen:\n- ' + pre.problems.join('\n- '))
      process.exit(1)
    }
    const t = await repo.create({
      title: 'Rauch-Test',
      station: 'reviewer',
      tier: 'cheap',
      priority: 4,
      origin: 'system',
      auftrag: 'Antworte nur mit OK und schreibe „OK“ unter ## Ergebnis.',
    })
    smokeTaskId = t.fm.id
  }

  const sup = new Supervisor(cfg, {
    repo,
    guard,
    ledger,
    stations,
    run: runWorker,
    clock: () => new Date(),
    probes: { http: httpOk, mcpConfigured },
    onState: (s: SupervisorState) => world?.broadcast({ type: 'state', data: s }),
    log,
    triggers: !smoke,
    only: smokeTaskId,
    healthCheck: smoke ? undefined : async () => {
      const p = await runPreflight()
      return { ok: p.ok, problems: p.problems }
    },
  })
  await sup.init()
  sup.setHealth({ ok: pre.ok, problems: pre.problems })

  if (smoke && smokeTaskId) {
    const t = { fm: { id: smokeTaskId } }
    await sup.tick()
    const deadline = Date.now() + 5 * 60_000
    while (Date.now() < deadline) {
      const cur = await repo.get(t.fm.id)
      if (cur && cur.fm.status !== 'doing' && cur.fm.status !== 'todo') {
        console.log(`Rauch-Test: ${cur.fm.status} · ${cur.fm.tokens_in + cur.fm.tokens_out} Tokens · ${cur.fm.cost_usd} $`)
        process.exit(cur.fm.status === 'done' || cur.fm.status === 'review' ? 0 : 1)
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    console.error('Rauch-Test: Zeitüberschreitung')
    process.exit(1)
  }

  world = await startWorld({
    port: cfg.worldPort,
    getState: () => sup.getState(),
    actions: { approve: (id) => sup.approve(id), pause: () => sup.pause(), resume: () => sup.resume(), refreshKennzahlen: () => sup.refreshKennzahlen() },
    publicDir: defaultPublicDir(cfg.repoRoot),
  })
  log(`Die Welt läuft auf http://127.0.0.1:${world.port}`)

  if (!pre.ok) {
    // Show the problems in the vault and the world, but start no workers.
    await writeStatus(cfg.vaultRoot, sup.getState()).catch(() => {})
    log('Aufseher wartet: Vorab-Prüfung fehlgeschlagen. Nach dem Beheben neu starten.')
  }

  await sup.start()

  let debounce: NodeJS.Timeout | null = null
  const kick = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void sup.tick(), 2000)
  }
  const watcher = chokidar.watch([join(cfg.vaultRoot, 'Aufgaben'), join(cfg.vaultRoot, 'Inbox'), join(cfg.vaultRoot, 'PAUSE')], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  })
  watcher.on('all', kick)

  const shutdown = async (): Promise<void> => {
    log('Aufseher wird beendet')
    await watcher.close()
    await sup.stop()
    await world?.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
