import type { ModelFamily, Tier } from '../types.js'

export interface TierConfig {
  /** Alias or full model id passed to `claude --model`. */
  model: string
  /** Passed to `--max-budget-usd`; a client-side estimate, not billing (spec §6.4). */
  maxBudgetUsd: number
  /** Passed to `--fallback-model` (premium only: Opus window closed → Sonnet). */
  fallbackModel?: string
}

export type TierTable = Record<Tier, TierConfig>

/** Opus and Sonnet have separate weekly windows; Haiku is counted on its own (spec §6.1). */
export function familyOf(modelId: string): ModelFamily {
  const id = modelId.toLowerCase()
  if (id.includes('opus')) return 'opus'
  if (id.includes('sonnet')) return 'sonnet'
  if (id.includes('haiku')) return 'haiku'
  return 'other'
}

export function modelForTier(tier: Tier, tiers: TierTable): TierConfig {
  const cfg = tiers[tier]
  return cfg.fallbackModel
    ? { model: cfg.model, maxBudgetUsd: cfg.maxBudgetUsd, fallbackModel: cfg.fallbackModel }
    : { model: cfg.model, maxBudgetUsd: cfg.maxBudgetUsd }
}
