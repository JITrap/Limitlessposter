import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs with Europe/Berlin timezone', () => {
    expect(process.env.TZ).toBe('Europe/Berlin')
    expect(new Date('2026-10-22T18:00:00').getHours()).toBe(18)
  })
})
