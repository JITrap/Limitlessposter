import { describe, it, expect } from 'vitest'
import {
  weekStart,
  nextWeekReset,
  weekFraction,
  sessionStartFor,
  isNight,
  type WeekReset,
} from '../../src/budget/windows.js'

const r: WeekReset = { weekday: 4, hour: 18, minute: 0 } // Thursday 18:00

const d = (s: string): Date => new Date(s)

describe('weekStart', () => {
  it('returns the exact reset instant when now is on it', () => {
    expect(weekStart(d('2026-10-22T18:00:00'), r)).toEqual(d('2026-10-22T18:00:00'))
  })
  it('returns the previous week when now is one second before the reset', () => {
    expect(weekStart(d('2026-10-22T17:59:59'), r)).toEqual(d('2026-10-15T18:00:00'))
  })
  it('works for a day later in the week', () => {
    expect(weekStart(d('2026-10-26T12:00:00'), r)).toEqual(d('2026-10-22T18:00:00'))
  })
  it('works for a day earlier in the week (Wednesday)', () => {
    expect(weekStart(d('2026-10-21T09:00:00'), r)).toEqual(d('2026-10-15T18:00:00'))
  })
})

describe('nextWeekReset', () => {
  it('is the following Thursday 18:00', () => {
    expect(nextWeekReset(d('2026-10-26T12:00:00'), r)).toEqual(d('2026-10-29T18:00:00'))
  })
  it('is one week later when now is exactly on the reset', () => {
    expect(nextWeekReset(d('2026-10-22T18:00:00'), r)).toEqual(d('2026-10-29T18:00:00'))
  })
})

describe('weekFraction', () => {
  it('is 0.5 half-way through a normal week', () => {
    // 2026-11-05 18:00 → 2026-11-12 18:00 has no DST change; midpoint is Monday 06:00.
    expect(weekFraction(d('2026-11-09T06:00:00'), r)).toBeCloseTo(0.5, 3)
  })
  it('uses real elapsed time across the DST change (169-hour week)', () => {
    // Clocks go back on 2026-10-25 (Sunday has 25 hours), so Monday 06:00 is 85 of 169 hours into the week.
    expect(weekFraction(d('2026-10-26T06:00:00'), r)).toBeCloseTo(85 / 169, 3)
  })
  it('is 0 at the reset and approaches 1 before the next', () => {
    expect(weekFraction(d('2026-10-22T18:00:00'), r)).toBe(0)
    expect(weekFraction(d('2026-10-29T17:59:00'), r)).toBeGreaterThan(0.999)
  })
})

describe('sessionStartFor', () => {
  it('anchors 5-hour windows at the first run', () => {
    expect(sessionStartFor(d('2026-10-22T10:00:00'), d('2026-10-22T16:30:00'))).toEqual(d('2026-10-22T15:00:00'))
    expect(sessionStartFor(d('2026-10-22T10:00:00'), d('2026-10-22T12:00:00'))).toEqual(d('2026-10-22T10:00:00'))
  })
  it('returns the anchor itself when now is before it', () => {
    expect(sessionStartFor(d('2026-10-22T10:00:00'), d('2026-10-22T09:00:00'))).toEqual(d('2026-10-22T10:00:00'))
  })
})

describe('isNight', () => {
  it('is true from 00:00 to 06:59 and false from 07:00', () => {
    expect(isNight(d('2026-10-22T03:00:00'))).toBe(true)
    expect(isNight(d('2026-10-22T00:00:00'))).toBe(true)
    expect(isNight(d('2026-10-22T06:59:59'))).toBe(true)
    expect(isNight(d('2026-10-22T07:00:00'))).toBe(false)
    expect(isNight(d('2026-10-22T23:00:00'))).toBe(false)
  })
})
