import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, parseDotenv } from '../src/config.js'

const BASE = {
  vaultRoot: '/vault/MeinVault/LimitlessOS',
  maxParallel: 2,
  reserveForJuliusPct: 30,
  weekReset: { weekday: 4, hour: 18, minute: 0 },
  dailyPostLimit: 3,
  dailyShopChangeLimit: 5,
  maxOpenPlannerTasks: 15,
  worldPort: 4242,
  tickSeconds: 30,
  tiers: {
    cheap: { model: 'haiku', maxBudgetUsd: 0.3 },
    standard: { model: 'sonnet', maxBudgetUsd: 1.5 },
    premium: { model: 'opus', maxBudgetUsd: 6, fallbackModel: 'sonnet' },
  },
  budget: { initialWeeklyCapacityUsd: { opus: 300, sonnet: 600, haiku: 200 }, sessionFraction: 0.1 },
}

describe('parseDotenv', () => {
  it('parses KEY=VALUE lines, ignores comments and strips quotes', () => {
    expect(parseDotenv('# k\nA=1\nB="zwei drei"\nC=\'x\'\n\nD=   # leer\nE=a=b\n')).toEqual({ A: '1', B: 'zwei drei', C: 'x', D: '', E: 'a=b' })
  })
})

describe('loadConfig', () => {
  it('merges limitless.config.json and .env without mutating process.env', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'los-cfg-'))
    await writeFile(join(repo, 'limitless.config.json'), JSON.stringify(BASE), 'utf8')
    await writeFile(join(repo, '.env'), 'SHOPIFY_CLIENT_ID=abc\n', 'utf8')
    const env = { PATH: '/bin' }
    const cfg = await loadConfig(repo, env)
    expect(cfg.repoRoot).toBe(repo)
    expect(cfg.vaultRoot).toBe('/vault/MeinVault/LimitlessOS')
    expect(cfg.vaultName).toBe('MeinVault')
    expect(cfg.dataDir).toBe(join(repo, 'supervisor', 'data'))
    expect(cfg.maxParallel).toBe(2)
    expect(cfg.tiers.premium.fallbackModel).toBe('sonnet')
    expect(cfg.env.SHOPIFY_CLIENT_ID).toBe('abc')
    expect(cfg.env.PATH).toBe('/bin')
    expect(cfg.fakeClaude).toBe(false)
    expect(env).toEqual({ PATH: '/bin' })
  })

  it('lets process-level env win over .env and reads FAKE_CLAUDE', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'los-cfg-'))
    await writeFile(join(repo, 'limitless.config.json'), JSON.stringify(BASE), 'utf8')
    await writeFile(join(repo, '.env'), 'A=file\n', 'utf8')
    const cfg = await loadConfig(repo, { A: 'proc', FAKE_CLAUDE: '1' })
    expect(cfg.env.A).toBe('proc')
    expect(cfg.fakeClaude).toBe(true)
  })

  it('works without a .env and fills defaults for missing optional keys', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'los-cfg-'))
    await writeFile(join(repo, 'limitless.config.json'), JSON.stringify({ ...BASE, tickSeconds: undefined, worldPort: undefined }), 'utf8')
    const cfg = await loadConfig(repo, {})
    expect(cfg.tickSeconds).toBe(30)
    expect(cfg.worldPort).toBe(4242)
  })

  it('throws a German error when the config file is missing', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'los-cfg-'))
    await expect(loadConfig(repo, {})).rejects.toThrow(/limitless\.config\.json/)
  })
})
