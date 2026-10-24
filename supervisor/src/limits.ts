// Per-network daily post limits ("3 Posts auf Instagram, nicht 3 insgesamt"). Defaults here,
// overridden by limitless.config.json → dailyPostLimits and finally by Julius in
// Strategie.md → frontmatter `daily_post_limits:` (the note wins, it is his control surface).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNote } from './vault/frontmatter.js'

export type Limits = Record<string, number>

export const DEFAULT_LIMITS: Limits = { instagram: 4, tiktok: 4, facebook: 2, linkedin: 1, gmb: 1, pinterest: 2, youtube: 1 }

export function limitFor(limits: Limits, network: string): number {
  return limits[network.toLowerCase()] ?? limits.default ?? 1
}

export function totalLimit(limits: Limits): number {
  return Object.entries(limits).filter(([k]) => k !== 'default').reduce((s, [, v]) => s + v, 0)
}

export function parseLimits(raw: unknown): Limits {
  const out: Limits = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(v)
      if (Number.isInteger(n) && n >= 0) out[k.toLowerCase()] = n
    }
  }
  return out
}

/** Strategie.md → `daily_post_limits: { instagram: 4, … }`; missing note or key → {} */
export async function strategieLimits(vaultRoot: string): Promise<Limits> {
  try {
    const { data } = parseNote(await readFile(join(vaultRoot, 'Strategie.md'), 'utf8'))
    return parseLimits(data.daily_post_limits)
  } catch {
    return {}
  }
}

/** defaults ← config ← Strategie.md */
export async function loadLimits(configLimits: Limits | undefined, vaultRoot: string): Promise<Limits> {
  return { ...DEFAULT_LIMITS, ...(configLimits ?? {}), ...(vaultRoot ? await strategieLimits(vaultRoot) : {}) }
}
