import { describe, it, expect } from 'vitest'
import { familyOf, modelForTier, type TierConfig } from '../../src/budget/models.js'

const tiers: Record<'cheap' | 'standard' | 'premium', TierConfig> = {
  cheap: { model: 'haiku', maxBudgetUsd: 0.3 },
  standard: { model: 'sonnet', maxBudgetUsd: 1.5 },
  premium: { model: 'opus', maxBudgetUsd: 6, fallbackModel: 'sonnet' },
}

describe('familyOf', () => {
  it('maps full model ids and aliases to families', () => {
    expect(familyOf('claude-opus-5-5')).toBe('opus')
    expect(familyOf('claude-sonnet-5-5')).toBe('sonnet')
    expect(familyOf('claude-haiku-5-5')).toBe('haiku')
    expect(familyOf('opus')).toBe('opus')
    expect(familyOf('claude-fable-5-1')).toBe('other')
    expect(familyOf('')).toBe('other')
  })
})

describe('modelForTier', () => {
  it('returns model, budget and optional fallback per tier', () => {
    expect(modelForTier('premium', tiers)).toEqual({ model: 'opus', maxBudgetUsd: 6, fallbackModel: 'sonnet' })
    expect(modelForTier('cheap', tiers)).toEqual({ model: 'haiku', maxBudgetUsd: 0.3 })
  })
})
