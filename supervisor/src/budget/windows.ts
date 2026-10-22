// Window math for the budget guard (spec §6.1). Everything is local time:
// the PC runs in Europe/Berlin and the weekly reset is Thursday 18:00 local.

export interface WeekReset {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  hour: number
  minute: number
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_MS = 5 * 60 * 60 * 1000

/** Most recent reset instant that is ≤ now. */
export function weekStart(now: Date, r: WeekReset): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), r.hour, r.minute, 0, 0)
  const dayDiff = (now.getDay() - r.weekday + 7) % 7
  candidate.setDate(candidate.getDate() - dayDiff)
  if (candidate.getTime() > now.getTime()) candidate.setDate(candidate.getDate() - 7)
  return candidate
}

/** Next reset instant that is strictly > now. */
export function nextWeekReset(now: Date, r: WeekReset): Date {
  const start = weekStart(now, r)
  const next = new Date(start)
  next.setDate(next.getDate() + 7)
  return next
}

/** Elapsed share of the current week, 0 at the reset, → 1 just before the next. */
export function weekFraction(now: Date, r: WeekReset): number {
  const start = weekStart(now, r).getTime()
  const end = nextWeekReset(now, r).getTime()
  const span = end - start || WEEK_MS
  return Math.min(1, Math.max(0, (now.getTime() - start) / span))
}

/** Start of the 5-hour window containing `now`, with windows anchored at `firstRunAt`. */
export function sessionStartFor(firstRunAt: Date, now: Date): Date {
  const elapsed = now.getTime() - firstRunAt.getTime()
  if (elapsed <= 0) return new Date(firstRunAt)
  const windows = Math.floor(elapsed / SESSION_MS)
  return new Date(firstRunAt.getTime() + windows * SESSION_MS)
}

/** 00:00–06:59 local: no premium runs (spec §6.3). */
export function isNight(now: Date): boolean {
  return now.getHours() < 7
}
