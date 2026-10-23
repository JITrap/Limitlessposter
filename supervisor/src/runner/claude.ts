import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Task } from '../types.js'
import type { Station } from '../stations/loader.js'
import { modelForTier, type TierTable } from '../budget/models.js'
import { parseStreamLine, summarizeResult, type RunSummary, type StreamEvent } from './stream.js'

export interface RunnerConfig {
  repoRoot: string
  vaultRoot: string
  /** `supervisor/data` – raw streams go to `<dataDir>/runs/`. */
  dataDir: string
  tiers: TierTable
}

export interface RunnerHooks {
  onEvent: (e: StreamEvent) => void
  onLine?: (line: string) => void
}

export interface RunOptions {
  timeoutMs: number
  cwd: string
  env: NodeJS.ProcessEnv
  publishAllowed: boolean
  /**
   * Hard gate (spec §11): when true the publishing/changing tools are removed from
   * the worker via --disallowedTools, regardless of what the prompt says.
   * Set by the supervisor when approval is pending, the station is draft-only, or
   * the daily limit is reached.
   */
  gated?: boolean
  /** Time between SIGINT and SIGTERM on timeout (default 30 s). */
  killGraceMs?: number
}

/** Tools that publish or change something outward-facing; blocked while gated. */
export const OUTWARD_TOOLS = [
  'mcp__metricool__createScheduledPost',
  'mcp__metricool__updateScheduledPost',
  'mcp__shopify__update-product',
  'Bash(node supervisor/dist/adapters/shopify.js update-product*)',
  'Bash(node supervisor/dist/adapters/shopify.js upload-file*)',
]

/** Bare `Write`/`Edit` rules are scoped to the vault so a worker can never touch the repo (spec §11). */
export function scopeTools(tools: string[], vaultRoot: string): string[] {
  const root = vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  return tools.map((t) => (t === 'Write' || t === 'Edit' || t === 'MultiEdit' ? `${t}(//${root}/**)` : t))
}

/** `LIMITLESS_CLAUDE_BIN` wins; otherwise the native install's binary name per platform. */
export function resolveClaudeBin(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const fromEnv = env.LIMITLESS_CLAUDE_BIN?.trim()
  if (fromEnv) return fromEnv
  return platform === 'win32' ? 'claude.exe' : 'claude'
}

/** The worker's task prompt (German). The station's SKILL.md is appended as system prompt separately. */
export function buildPrompt(
  task: Task,
  opts: { publishAllowed: boolean; vaultRoot: string; statusPath: string },
): string {
  const ja = (b: boolean): string => (b ? 'ja' : 'nein')
  return [
    `Du arbeitest an der Aufgabe „${task.fm.title}“ (Station ${task.fm.station}).`,
    `Aufgaben-Notiz: ${task.path}`,
    `Vault: ${opts.vaultRoot} – schreibe ausschließlich innerhalb dieses Ordners.`,
    `Aktueller Systemstatus (Budget, Limits, Zähler): ${opts.statusPath}`,
    '',
    `Freigabe nötig: ${ja(task.fm.needs_approval)}`,
    `Veröffentlichen heute erlaubt: ${ja(opts.publishAllowed)}`,
    '',
    'Vorgehen:',
    '1. Lies die Aufgaben-Notiz vollständig (Abschnitte „## Auftrag“ und „## Kontext“).',
    '2. Erledige den Auftrag nach den Regeln deiner Station.',
    '3. Schreibe das Ergebnis in die Aufgaben-Notiz unter „## Ergebnis“ und offene Punkte unter „## Offene Fragen an Julius“.',
    '4. Ändere KEINE Frontmatter-Felder außer `outputs` und – nur wenn du tatsächlich veröffentlicht hast – `published_at`.',
    '5. Wenn „Freigabe nötig: ja“, dann nur Entwürfe anlegen, nichts veröffentlichen oder im Shop ändern.',
    '6. Steht unter „## Ergebnis“ bereits ein freigegebener Entwurf (Freigabe nötig: nein), veröffentliche genau diesen Text unverändert – nicht neu schreiben.',
    '7. Antworte zum Schluss mit einer Zeile Zusammenfassung.',
  ].join('\n')
}

/** Exact `claude` argument list (spec §5.2). Never `--bare`. */
export function buildArgs(prompt: string, task: Task, station: Station, cfg: RunnerConfig, opts: { gated?: boolean } = {}): string[] {
  const m = modelForTier(task.fm.tier, cfg.tiers)
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'auto',
    '--permission-prompts', 'none',
    '--model', m.model,
    '--max-turns', String(station.maxTurns),
    '--max-budget-usd', String(m.maxBudgetUsd),
    '--append-system-prompt-file', station.skillPath,
    '--add-dir', cfg.vaultRoot,
    '--no-session-persistence',
  ]
  if (m.fallbackModel) args.push('--fallback-model', m.fallbackModel)
  if (station.tools.length) args.push('--allowedTools', ...scopeTools(station.tools, cfg.vaultRoot))
  if (opts.gated) args.push('--disallowedTools', ...OUTWARD_TOOLS)
  return args
}

function runStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Spawn one `claude -p` worker for a task, stream its events, enforce the
 * timeout (SIGINT, then SIGTERM) and return the parsed summary.
 */
export async function runWorker(
  task: Task,
  station: Station,
  cfg: RunnerConfig,
  hooks: RunnerHooks,
  opts: RunOptions,
): Promise<RunSummary> {
  const prompt = buildPrompt(task, {
    publishAllowed: opts.publishAllowed,
    vaultRoot: cfg.vaultRoot,
    statusPath: join(cfg.vaultRoot, 'Status.md'),
  })
  const args = buildArgs(prompt, task, station, cfg, { gated: opts.gated })
  const bin = resolveClaudeBin(opts.env)
  const preargs = opts.env.LIMITLESS_CLAUDE_PREARGS?.trim() ? [opts.env.LIMITLESS_CLAUDE_PREARGS.trim()] : []

  const runsDir = join(cfg.dataDir, 'runs')
  await mkdir(runsDir, { recursive: true })
  const rawFile = join(runsDir, `${task.fm.id}-${runStamp(new Date())}.jsonl`)
  const raw = createWriteStream(rawFile, { encoding: 'utf8' })

  const childEnv: NodeJS.ProcessEnv = {
    ...opts.env,
    LIMITLESS_TASK_ID: task.fm.id,
    LIMITLESS_VAULT_ROOT: cfg.vaultRoot,
    LIMITLESS_DATA_DIR: cfg.dataDir,
    LIMITLESS_PUBLISH_ALLOWED: opts.publishAllowed ? '1' : '0',
    LIMITLESS_ALLOW_WRITES: task.fm.needs_approval ? '0' : '1',
  }
  // Never let a stray API key turn subscription usage into API billing.
  delete childEnv.ANTHROPIC_API_KEY

  return new Promise<RunSummary>((resolve) => {
    let result: Record<string, unknown> | null = null
    let rateLimited = false
    let retriedForRateLimit = false
    const denials: string[] = []
    let timedOut = false
    let settled = false
    let spawnFailed = false

    const finish = (summary: RunSummary): void => {
      if (settled) return
      settled = true
      raw.end()
      resolve(summary)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, [...preargs, ...args], { cwd: opts.cwd, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      finish({ ...summarizeResult(null, { rateLimited: false, denials: [] }), reason: 'error' })
      return
    }

    const grace = opts.killGraceMs ?? 30_000
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGINT')
      setTimeout(() => {
        if (!settled) child.kill('SIGTERM')
      }, grace).unref()
    }, opts.timeoutMs)

    child.on('error', () => {
      spawnFailed = true
      clearTimeout(timer)
      finish({ ...summarizeResult(null, { rateLimited: false, denials: [] }), reason: 'error' })
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      raw.write(JSON.stringify({ type: 'stderr', text: chunk.toString('utf8') }) + '\n')
    })

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity })
    rl.on('line', (line) => {
      raw.write(line + '\n')
      hooks.onLine?.(line)
      const ev = parseStreamLine(line)
      if (!ev) return
      hooks.onEvent(ev)
      if (ev.kind === 'result') result = ev.raw
      if (ev.kind === 'rate_limit' && ev.signal.status === 'rejected') rateLimited = true
      if (ev.kind === 'api_retry' && (ev.error === 'rate_limit' || ev.status === 429)) retriedForRateLimit = true
      if (ev.kind === 'permission_denied') denials.push(ev.tool)
    })

    child.on('close', () => {
      clearTimeout(timer)
      if (spawnFailed) return
      // Give readline a tick to flush the last line.
      setImmediate(() => {
        const summary = summarizeResult(result, { rateLimited, denials, retriedForRateLimit })
        if (timedOut && !result) finish({ ...summary, reason: 'timeout', ok: false })
        else finish(summary)
      })
    })
  })
}
