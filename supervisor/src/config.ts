import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { TierTable } from './budget/models.js'
import type { WeekReset } from './budget/windows.js'

export interface Config {
  repoRoot: string
  /** `<Vault>/LimitlessOS` */
  vaultRoot: string
  /** Name of the Obsidian vault folder (for obsidian:// links). */
  vaultName: string
  /** `supervisor/data` */
  dataDir: string
  maxParallel: number
  reserveForJuliusPct: number
  weekReset: WeekReset
  dailyPostLimit: number
  dailyShopChangeLimit: number
  maxOpenPlannerTasks: number
  worldPort: number
  tickSeconds: number
  tiers: TierTable
  budget: {
    initialWeeklyCapacityUsd: Partial<Record<'opus' | 'sonnet' | 'haiku' | 'other', number>>
    sessionFraction: number
  }
  fakeClaude: boolean
  /** Process env merged with `.env` (process wins). Never logged. */
  env: NodeJS.ProcessEnv
}

/** Minimal `.env` parser: KEY=VALUE, `#` comments, optional single/double quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
      if (value.startsWith('#')) value = ''
    }
    out[key] = value
  }
  return out
}

const DEFAULTS = {
  maxParallel: 2,
  reserveForJuliusPct: 30,
  weekReset: { weekday: 4, hour: 18, minute: 0 },
  dailyPostLimit: 3,
  dailyShopChangeLimit: 5,
  maxOpenPlannerTasks: 15,
  worldPort: 4242,
  tickSeconds: 30,
  budget: { initialWeeklyCapacityUsd: { opus: 300, sonnet: 600, haiku: 200 }, sessionFraction: 0.1 },
}

export async function loadConfig(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const file = join(repoRoot, 'limitless.config.json')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    throw new Error(`limitless.config.json nicht gefunden oder ungültig (${file}) – install.ps1 ausführen`)
  }

  let dotenv: Record<string, string> = {}
  try {
    dotenv = parseDotenv(await readFile(join(repoRoot, '.env'), 'utf8'))
  } catch {
    dotenv = {}
  }
  const merged: NodeJS.ProcessEnv = { ...dotenv, ...env }

  const vaultRoot = typeof raw.vaultRoot === 'string' ? raw.vaultRoot : ''
  const num = (key: keyof typeof DEFAULTS): number =>
    typeof raw[key] === 'number' ? (raw[key] as number) : (DEFAULTS[key] as number)

  return {
    repoRoot,
    vaultRoot,
    vaultName: vaultRoot ? basename(dirname(vaultRoot)) : '',
    dataDir: join(repoRoot, 'supervisor', 'data'),
    maxParallel: num('maxParallel'),
    reserveForJuliusPct: num('reserveForJuliusPct'),
    weekReset: (raw.weekReset as WeekReset) ?? DEFAULTS.weekReset,
    dailyPostLimit: num('dailyPostLimit'),
    dailyShopChangeLimit: num('dailyShopChangeLimit'),
    maxOpenPlannerTasks: num('maxOpenPlannerTasks'),
    worldPort: num('worldPort'),
    tickSeconds: num('tickSeconds'),
    tiers: raw.tiers as TierTable,
    budget: (raw.budget as Config['budget']) ?? DEFAULTS.budget,
    fakeClaude: merged.FAKE_CLAUDE === '1',
    env: merged,
  }
}
