import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildArgs, buildPrompt, resolveClaudeBin, runWorker, scopeTools, NEVER_TOOLS, type RunnerConfig } from '../../src/runner/claude.js'
import type { Station } from '../../src/stations/loader.js'
import type { Task } from '../../src/types.js'
import type { StreamEvent } from '../../src/runner/stream.js'

const here = dirname(fileURLToPath(import.meta.url))
const FAKE = join(here, '..', 'fixtures', 'fake-claude.mjs')
const fixture = (n: string): string => join(here, '..', 'fixtures', 'stream', `${n}.jsonl`)

const station: Station = {
  name: 'content',
  display: 'Content-Studio',
  description: 'Posts',
  tier: 'standard',
  maxTurns: 40,
  timeoutMin: 25,
  tools: ['Read', 'Write', 'mcp__metricool__*'],
  context: ['Marke/Kern.md'],
  requires: { mcp: ['metricool'], env: [], services: [], any: [] },
  autopilot: 1,
  cooldownHours: 0,
  outputsDir: null,
  dir: '/repo/stations/content',
  skillPath: '/repo/stations/content/SKILL.md',
}

const task: Task = {
  fm: {
    type: 'task',
    id: '20261022-093000-karussell',
    title: 'Karussell „Ein Poster, 5 Räume“',
    status: 'doing',
    station: 'content',
    priority: 2,
    tier: 'standard',
    due: '2026-10-25',
    created: '2026-10-22T09:30:00',
    updated: '2026-10-22T09:30:00',
    started: null,
    completed: null,
    attempts: 1,
    max_attempts: 3,
    cost_usd: 0,
    tokens_in: 0,
    tokens_out: 0,
    model_used: null,
    outputs: [],
    needs_approval: true,
    origin: 'planer',
    parent: null,
    published_at: null,
    tags: ['task'],
  },
  body: '## Auftrag\nSchreibe das Karussell.\n',
  path: '/vault/LimitlessOS/Aufgaben/20261022-093000-karussell.md',
}

const cfg: RunnerConfig = {
  repoRoot: '/repo',
  vaultRoot: '/vault/LimitlessOS',
  dataDir: '/tmp/unused',
  tiers: {
    cheap: { model: 'haiku', maxBudgetUsd: 0.3 },
    standard: { model: 'sonnet', maxBudgetUsd: 1.5 },
    premium: { model: 'opus', maxBudgetUsd: 6, fallbackModel: 'sonnet' },
  },
}

describe('resolveClaudeBin', () => {
  it('prefers LIMITLESS_CLAUDE_BIN, then a platform default', () => {
    expect(resolveClaudeBin({ LIMITLESS_CLAUDE_BIN: '/x/claude' }, 'win32')).toBe('/x/claude')
    expect(resolveClaudeBin({}, 'win32')).toBe('claude.exe')
    expect(resolveClaudeBin({}, 'linux')).toBe('claude')
  })
})

describe('buildPrompt', () => {
  it('names the note, the vault, approval and publishing state in German', () => {
    const p = buildPrompt(task, { publishAllowed: true, vaultRoot: cfg.vaultRoot, statusPath: '/vault/LimitlessOS/Status.md' })
    expect(p).toContain(task.path)
    expect(p).toContain('Freigabe nötig: ja')
    expect(p).toContain('Veröffentlichen heute erlaubt: ja')
    expect(p).toContain('## Ergebnis')
    expect(p).toContain('## Offene Fragen an Julius')
    expect(p).toContain('Status.md')
    const p2 = buildPrompt({ ...task, fm: { ...task.fm, needs_approval: false } }, { publishAllowed: false, vaultRoot: cfg.vaultRoot, statusPath: 's' })
    expect(p2).toContain('Freigabe nötig: nein')
    expect(p2).toContain('Veröffentlichen heute erlaubt: nein')
  })
})

describe('buildArgs', () => {
  it('produces the exact argument list for a standard task', () => {
    const prompt = 'PROMPT'
    expect(buildArgs(prompt, task, station, cfg)).toEqual([
      '-p', 'PROMPT',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'auto',
      '--permission-prompts', 'none',
      '--model', 'sonnet',
      '--max-turns', '40',
      '--max-budget-usd', '1.5',
      '--append-system-prompt-file', '/repo/stations/content/SKILL.md',
      '--add-dir', '/vault/LimitlessOS',
      '--no-session-persistence',
      '--allowedTools', 'Read', 'Write(///vault/LimitlessOS/**)', 'mcp__metricool__*',
      '--disallowedTools', ...NEVER_TOOLS,
    ])
  })

  it('scopes bare Write/Edit to the vault (Windows paths become forward slashes)', () => {
    const args = buildArgs('P', task, { ...station, tools: ['Read', 'Write', 'Edit'] }, { ...cfg, vaultRoot: 'C:\\Users\\Julius\\Vault\\LimitlessOS' })
    const from = args.indexOf('--allowedTools') + 1
    expect(args.slice(from, args.indexOf('--disallowedTools'))).toEqual(['Read', 'Write(//C:/Users/Julius/Vault/LimitlessOS/**)', 'Edit(//C:/Users/Julius/Vault/LimitlessOS/**)'])
  })

  it('always blocks the never-tools and adds the outward tools to --disallowedTools when gated', () => {
    const gated = buildArgs('P', task, station, cfg, { gated: true })
    const i = gated.indexOf('--disallowedTools')
    expect(i).toBeGreaterThan(0)
    expect(gated.slice(i + 1)).toEqual([
      ...NEVER_TOOLS,
      'Bash(node supervisor/dist/adapters/metricool.js schedule*)',
      'PowerShell(node supervisor/dist/adapters/metricool.js schedule*)',
      'mcp__shopify__update-product',
      'Bash(node supervisor/dist/adapters/shopify.js update-product*)',
      'Bash(node supervisor/dist/adapters/shopify.js upload-file*)',
      'PowerShell(node supervisor/dist/adapters/shopify.js update-product*)',
      'PowerShell(node supervisor/dist/adapters/shopify.js upload-file*)',
    ])
    const open = buildArgs('P', task, station, cfg, { gated: false })
    const j = open.indexOf('--disallowedTools')
    expect(open.slice(j + 1)).toEqual(NEVER_TOOLS)
    expect(NEVER_TOOLS).toContain('mcp__shopify__switch-shop')
    expect(NEVER_TOOLS).toContain('mcp__shopify__graphql_mutation')
    // publishing only through adapters/metricool.js (duplicate guard) – the MCP planners are gone for everyone
    expect(NEVER_TOOLS).toContain('mcp__metricool__createScheduledPost')
    expect(NEVER_TOOLS).toContain('mcp__metricool__updateScheduledPost')
    expect(open).not.toContain('mcp__shopify__update-product')
  })

  it('mirrors Bash rules as PowerShell rules for Windows machines without Git Bash', () => {
    expect(scopeTools(['Read', 'Bash(node supervisor/dist/adapters/studio.js *)'], '/v')).toEqual([
      'Read',
      'Bash(node supervisor/dist/adapters/studio.js *)',
      'PowerShell(node supervisor/dist/adapters/studio.js *)',
    ])
  })

  it('adds the fallback model for premium tasks', () => {
    const args = buildArgs('P', { ...task, fm: { ...task.fm, tier: 'premium' } }, { ...station, tier: 'premium', tools: [] }, cfg)
    expect(args).toContain('--fallback-model')
    expect(args[args.indexOf('--fallback-model') + 1]).toBe('sonnet')
    expect(args[args.indexOf('--model') + 1]).toBe('opus')
    expect(args).not.toContain('--allowedTools')
  })

  it('never contains --bare', () => {
    expect(buildArgs('P', task, station, cfg)).not.toContain('--bare')
  })
})

describe('runWorker (fake claude)', () => {
  const env = (fixtureName: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...process.env,
    LIMITLESS_CLAUDE_BIN: process.execPath,
    LIMITLESS_CLAUDE_PREARGS: FAKE,
    FAKE_CLAUDE_FIXTURE: fixture(fixtureName),
    ...extra,
  })

  it('returns a success summary and emits init and result events', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'los-runs-'))
    const events: StreamEvent[] = []
    const s = await runWorker(task, station, { ...cfg, dataDir }, { onEvent: (e) => events.push(e) }, {
      timeoutMs: 10_000,
      cwd: process.cwd(),
      env: env('success'),
      publishAllowed: false,
    })
    expect(s.ok).toBe(true)
    expect(s.costUsd).toBe(0.0612)
    expect(events.some((e) => e.kind === 'init')).toBe(true)
    expect(events.some((e) => e.kind === 'result')).toBe(true)
    // raw stream saved for debugging
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(dataDir, 'runs'))
    expect(files.length).toBe(1)
    expect(files[0].startsWith(task.fm.id)).toBe(true)
    expect((await readFile(join(dataDir, 'runs', files[0]), 'utf8')).split('\n').filter(Boolean).length).toBe(5)
  })

  it('passes the built argument list to the binary', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'los-runs-'))
    const argsFile = join(dataDir, 'args.json')
    await runWorker(task, station, { ...cfg, dataDir }, { onEvent: () => {} }, {
      timeoutMs: 10_000,
      cwd: process.cwd(),
      env: env('success', { FAKE_CLAUDE_ARGS_FILE: argsFile }),
      publishAllowed: true,
    })
    const argv = JSON.parse(await readFile(argsFile, 'utf8')) as string[]
    expect(argv[0]).toBe('-p')
    expect(argv).toContain('--no-session-persistence')
    expect(argv[argv.indexOf('--model') + 1]).toBe('sonnet')
  })

  it('reports rate_limited when the stream ends after a rejection without a result', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'los-runs-'))
    const s = await runWorker(task, station, { ...cfg, dataDir }, { onEvent: () => {} }, {
      timeoutMs: 10_000,
      cwd: process.cwd(),
      env: env('rate_limited_no_result'),
      publishAllowed: false,
    })
    expect(s.ok).toBe(false)
    expect(s.reason).toBe('rate_limited')
  })

  it('kills a hanging worker and reports timeout', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'los-runs-'))
    const started = Date.now()
    const s = await runWorker(task, station, { ...cfg, dataDir }, { onEvent: () => {} }, {
      timeoutMs: 500,
      cwd: process.cwd(),
      env: env('success', { FAKE_CLAUDE_HANG: '1' }),
      publishAllowed: false,
      killGraceMs: 200,
    })
    expect(s.reason).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('reports error when the binary cannot be started', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'los-runs-'))
    const s = await runWorker(task, station, { ...cfg, dataDir }, { onEvent: () => {} }, {
      timeoutMs: 2_000,
      cwd: process.cwd(),
      env: { ...process.env, LIMITLESS_CLAUDE_BIN: '/gibt/es/nicht/claude' },
      publishAllowed: false,
    })
    expect(s.ok).toBe(false)
    expect(s.reason).toBe('error')
  })
})
